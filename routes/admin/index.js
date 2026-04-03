const express = require('express')
const db = require('../../db')
const logger = require('../../utils/logger')

const RANGE_SET = new Set(['7d', '30d', '24h'])
const PUSH_BATCH_COLLECTION = 'admin-push-batches'

function pad(num) {
  return String(num).padStart(2, '0')
}

function toDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function normalizeRange(value) {
  const next = String(value || '7d').trim().toLowerCase()
  return RANGE_SET.has(next) ? next : '7d'
}

function getDateRange(range) {
  const now = new Date()
  const dates = []

  if (range === '24h') {
    dates.push(toDateKey(now))
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    dates.push(toDateKey(yesterday))
    return dates
  }

  const days = range === '30d' ? 30 : 7
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    dates.push(toDateKey(date))
  }
  return dates
}

function getRangeStartMs(range) {
  const now = new Date()

  if (range === '24h') {
    return now.getTime() - 24 * 60 * 60 * 1000
  }

  const days = range === '30d' ? 30 : 7
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  return start.getTime()
}

function getTodayRange() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  return {
    startMs: start.getTime(),
    endMs: end.getTime()
  }
}

function createEmptyPoint(label) {
  return {
    label,
    total: 0,
    success: 0,
    failed: 0
  }
}

function isFailedStatus(status) {
  return ['failed', 'no_device'].includes(status)
}

function buildSummary(todayPushes) {
  const total = todayPushes.length
  const success = todayPushes.filter((item) => item.status === 'success').length
  const partial = todayPushes.filter((item) => item.status === 'partial').length
  const failed = todayPushes.filter((item) => isFailedStatus(item.status)).length
  const successRate = total ? Number(((success / total) * 100).toFixed(2)) : 0

  return {
    total,
    success,
    partial,
    failed,
    successRate
  }
}

function normalizeBatchRecord(doc) {
  const status = doc.status || 'unknown'
  const successCount = Number(doc.success_count || 0)
  const failureCount = Number(doc.failure_count || 0)
  const totalDevices = Number(doc.total_devices || 0)

  let summary = '状态未知'
  if (status === 'success') summary = '全部成功'
  else if (status === 'partial') summary = `部分失败（成功 ${successCount} / 失败 ${failureCount}）`
  else if (status === 'no_device') summary = '无可用设备'
  else if (status === 'failed') summary = '推送失败'

  return {
    id: String(doc._id || ''),
    title: doc.title || '未命名推送',
    createdAt: doc.create_time ? new Date(doc.create_time).toLocaleString('zh-CN', { hour12: false }) : '',
    createdAtMs: Number(doc.create_time || 0),
    resultCode: Number(doc.result_code || 0),
    totalDevices,
    successCount,
    failureCount,
    status,
    summary
  }
}

function buildErrorRecordFromBatch(doc) {
  const status = doc.status || 'unknown'
  const level = status === 'partial' || status === 'no_device' ? 'WARN' : 'ERROR'
  const title = doc.title || '未命名推送'
  const resultMsg = doc.result_msg || '推送异常'

  return {
    time: doc.create_time ? new Date(doc.create_time).toLocaleString('zh-CN', { hour12: false }) : '',
    level,
    message: `[${title}] ${resultMsg}`
  }
}

function buildTrend(range, statsMap) {
  const now = new Date()

  if (range === '24h') {
    const points = Array.from({ length: 24 }, (_, index) => {
      const hour = new Date(now)
      hour.setHours(now.getHours() - (23 - index), 0, 0, 0)
      const key = `${hour.getFullYear()}-${pad(hour.getMonth() + 1)}-${pad(hour.getDate())} ${pad(hour.getHours())}`
      return {
        key,
        point: {
          ...createEmptyPoint(`${pad(hour.getHours())}:00`),
          ...statsMap.get(key)
        }
      }
    })

    return {
      range,
      unit: 'hour',
      points: points.map((item) => item.point)
    }
  }

  const dates = getDateRange(range)
  return {
    range,
    unit: 'day',
    points: dates.map((dateKey) => ({
      ...createEmptyPoint(dateKey.slice(5)),
      ...statsMap.get(dateKey),
      label: dateKey.slice(5)
    }))
  }
}

async function queryTrend(batchCollection, range, startMs) {
  const format = range === '24h' ? '%Y-%m-%d %H' : '%Y-%m-%d'
  const rows = await batchCollection.aggregate([
    {
      $match: {
        create_time: { $gte: startMs }
      }
    },
    {
      $project: {
        bucket: {
          $dateToString: {
            format,
            date: { $toDate: '$create_time' }
          }
        },
        status: 1
      }
    },
    {
      $group: {
        _id: '$bucket',
        total: { $sum: 1 },
        success: {
          $sum: {
            $cond: [{ $eq: ['$status', 'success'] }, 1, 0]
          }
        },
        failed: {
          $sum: {
            $cond: [{ $in: ['$status', ['failed', 'no_device']] }, 1, 0]
          }
        }
      }
    }
  ]).toArray()

  const statsMap = new Map(
    rows.map((item) => [
      item._id,
      {
        label: range === '24h' ? `${item._id.slice(-2)}:00` : item._id.slice(5),
        total: Number(item.total || 0),
        success: Number(item.success || 0),
        failed: Number(item.failed || 0)
      }
    ])
  )

  return buildTrend(range, statsMap)
}

function createAdminRouter() {
  const router = express.Router()

  router.get('/dashboard', async (req, res) => {
    const range = normalizeRange(req.query.range)
    const startMs = getRangeStartMs(range)
    const { startMs: todayStartMs, endMs: todayEndMs } = getTodayRange()

    try {
      const database = db.database()
      const batchCollection = database.collection(PUSH_BATCH_COLLECTION)

      const recentDocs = await batchCollection.find({
        create_time: { $gte: startMs }
      })
        .sort({ create_time: -1 })
        .limit(10)
        .toArray()

      const todayDocs = await batchCollection.find({
        create_time: {
          $gte: todayStartMs,
          $lt: todayEndMs
        }
      }, {
        projection: {
          status: 1
        }
      }).toArray()

      const errorDocs = await batchCollection.find({
        create_time: { $gte: startMs },
        status: { $in: ['failed', 'partial', 'no_device'] }
      })
        .sort({ create_time: -1 })
        .limit(10)
        .toArray()

      const recentPushes = recentDocs.map(normalizeBatchRecord)
      const todayPushes = todayDocs.map(normalizeBatchRecord)
      const recentErrors = errorDocs.map(buildErrorRecordFromBatch)
      const trend = await queryTrend(batchCollection, range, startMs)

      res.send({
        code: 200,
        msg: 'ok',
        data: {
          summary: buildSummary(todayPushes),
          trend,
          recentPushes,
          recentErrors,
          meta: {
            generatedAt: new Date().toISOString(),
            range,
            rangeOptions: ['7d', '30d', '24h'],
            source: 'mongodb:admin-push-batches'
          }
        }
      })
    } catch (error) {
      logger.error('admin dashboard query failed', error, {
        range,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: 'dashboard 查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  return router
}

module.exports = createAdminRouter
