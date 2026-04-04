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

function normalizePagination(req) {
  const page = Math.max(1, Number(req.query.page || 1) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20) || 20))
  return { page, pageSize }
}

function normalizeKeyword(value) {
  return String(value || '').trim()
}

function normalizeStatus(value) {
  const status = String(value || 'all').trim().toLowerCase()
  const allow = new Set(['all', 'success', 'partial', 'failed', 'no_device'])
  return allow.has(status) ? status : 'all'
}

function normalizeBatchDetail(doc) {
  if (!doc) return null

  return {
    id: String(doc._id || ''),
    userId: String(doc.user_id || ''),
    title: doc.title || '未命名推送',
    content: doc.content || '',
    payload: doc.payload || {},
    createTime: Number(doc.create_time || 0),
    createTimeText: doc.create_time ? new Date(doc.create_time).toLocaleString('zh-CN', { hour12: false }) : '',
    updatedAt: Number(doc.updated_at || 0),
    updatedAtText: doc.updated_at ? new Date(doc.updated_at).toLocaleString('zh-CN', { hour12: false }) : '',
    status: doc.status || 'unknown',
    resultCode: Number(doc.result_code || 0),
    resultMsg: doc.result_msg || '',
    totalDevices: Number(doc.total_devices || 0),
    successCount: Number(doc.success_count || 0),
    failureCount: Number(doc.failure_count || 0),
    ip: doc.ip || '',
    results: Array.isArray(doc.results) ? doc.results : []
  }
}

function buildBatchQuery(req) {
  const range = normalizeRange(req.query.range)
  const startMs = getRangeStartMs(range)
  const status = normalizeStatus(req.query.status)
  const keyword = normalizeKeyword(req.query.keyword)

  const query = {
    create_time: { $gte: startMs }
  }

  if (status !== 'all') {
    query.status = status
  }

  if (keyword) {
    query.$or = [
      { title: { $regex: keyword, $options: 'i' } },
      { content: { $regex: keyword, $options: 'i' } },
      { result_msg: { $regex: keyword, $options: 'i' } },
      { 'results.providerMsg': { $regex: keyword, $options: 'i' } },
      { 'results.error': { $regex: keyword, $options: 'i' } }
    ]
  }

  return {
    query,
    range,
    status,
    keyword
  }
}

function buildUserQuery(req) {
  const keyword = normalizeKeyword(req.query.keyword)
  const statusValue = String(req.query.status || 'all').trim().toLowerCase()
  const query = {}

  if (statusValue !== 'all' && statusValue !== '') {
    const parsedStatus = Number(statusValue)
    if (Number.isFinite(parsedStatus)) {
      query.status = parsedStatus
    }
  }

  if (keyword) {
    query.$or = [
      { username: { $regex: keyword, $options: 'i' } },
      { nickname: { $regex: keyword, $options: 'i' } },
      { email: { $regex: keyword, $options: 'i' } }
    ]
  }

  return {
    query,
    keyword,
    status: statusValue || 'all'
  }
}

function normalizeUserRecord(doc) {
  return {
    id: String(doc._id || ''),
    username: doc.username || '',
    nickname: doc.nickname || '',
    email: doc.email || '',
    status: Number(doc.status || 0),
    registerDate: Number(doc.register_date || 0),
    registerDateText: doc.register_date ? new Date(doc.register_date).toLocaleString('zh-CN', { hour12: false }) : '',
    lastLoginDate: Number(doc.last_login_date || 0),
    lastLoginDateText: doc.last_login_date ? new Date(doc.last_login_date).toLocaleString('zh-CN', { hour12: false }) : ''
  }
}

function normalizeDeviceRecord(doc) {
  return {
    id: String(doc._id || ''),
    userId: String(doc.user_id || ''),
    deviceId: doc.device_id || '',
    platform: doc.platform || '',
    createDate: Number(doc.create_date || 0),
    createDateText: doc.create_date ? new Date(doc.create_date).toLocaleString('zh-CN', { hour12: false }) : '',
    lastActiveDate: Number(doc.last_active_date || 0),
    lastActiveDateText: doc.last_active_date ? new Date(doc.last_active_date).toLocaleString('zh-CN', { hour12: false }) : '',
    tokenExpired: typeof doc.token_expired === 'boolean' ? doc.token_expired : null
  }
}

function buildDeviceQuery(req) {
  const keyword = normalizeKeyword(req.query.keyword)
  const userId = normalizeKeyword(req.query.userId)
  const query = {}

  if (userId) {
    const values = [userId]
    try {
      values.push(new db.ObjectId(userId))
    } catch (error) {
      // ignore invalid object id
    }
    query.user_id = { $in: values }
  }

  if (keyword) {
    query.$or = [
      { device_id: { $regex: keyword, $options: 'i' } },
      { platform: { $regex: keyword, $options: 'i' } }
    ]
  }

  return {
    query,
    keyword,
    userId
  }
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

  router.get('/push-batches', async (req, res) => {
    const { page, pageSize } = normalizePagination(req)
    const { query, range, status, keyword } = buildBatchQuery(req)

    try {
      const database = db.database()
      const batchCollection = database.collection(PUSH_BATCH_COLLECTION)

      const [total, docs] = await Promise.all([
        batchCollection.countDocuments(query),
        batchCollection.find(query)
          .sort({ create_time: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .toArray()
      ])

      res.send({
        code: 200,
        msg: 'ok',
        data: {
          list: docs.map(normalizeBatchRecord),
          total,
          page,
          pageSize,
          meta: {
            range,
            status,
            keyword
          }
        }
      })
    } catch (error) {
      logger.error('admin push batches query failed', error, {
        query,
        page,
        pageSize,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '推送批次查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.get('/push-batches/:id', async (req, res) => {
    const id = String(req.params.id || '').trim()

    if (!id) {
      res.status(400).send({
        code: 400,
        msg: 'id 不能为空'
      })
      return
    }

    let objectId
    try {
      objectId = new db.ObjectId(id)
    } catch (error) {
      res.status(400).send({
        code: 400,
        msg: 'id 格式错误'
      })
      return
    }

    try {
      const database = db.database()
      const batchCollection = database.collection(PUSH_BATCH_COLLECTION)
      const doc = await batchCollection.findOne({ _id: objectId })

      if (!doc) {
        res.status(404).send({
          code: 404,
          msg: '批次不存在'
        })
        return
      }

      res.send({
        code: 200,
        msg: 'ok',
        data: normalizeBatchDetail(doc)
      })
    } catch (error) {
      logger.error('admin push batch detail query failed', error, {
        id,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '推送批次详情查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.get('/users', async (req, res) => {
    const { page, pageSize } = normalizePagination(req)
    const { query, keyword, status } = buildUserQuery(req)

    try {
      const database = db.database()
      const collection = database.collection('uni-id-users')

      const [total, docs] = await Promise.all([
        collection.countDocuments(query),
        collection.find(query, {
          projection: {
            username: 1,
            nickname: 1,
            email: 1,
            status: 1,
            register_date: 1,
            last_login_date: 1
          }
        })
          .sort({ register_date: -1, _id: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .toArray()
      ])

      res.send({
        code: 200,
        msg: 'ok',
        data: {
          list: docs.map(normalizeUserRecord),
          total,
          page,
          pageSize,
          meta: {
            keyword,
            status
          }
        }
      })
    } catch (error) {
      logger.error('admin users query failed', error, {
        query,
        page,
        pageSize,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '用户列表查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.get('/users/:id', async (req, res) => {
    const id = String(req.params.id || '').trim()
    if (!id) {
      res.status(400).send({ code: 400, msg: 'id 不能为空' })
      return
    }

    let objectId
    try {
      objectId = new db.ObjectId(id)
    } catch (error) {
      res.status(400).send({ code: 400, msg: 'id 格式错误' })
      return
    }

    try {
      const database = db.database()
      const userCollection = database.collection('uni-id-users')
      const deviceCollection = database.collection('uni-id-device')

      const [userDoc, deviceCount] = await Promise.all([
        userCollection.findOne({ _id: objectId }, {
          projection: {
            username: 1,
            nickname: 1,
            email: 1,
            status: 1,
            register_date: 1,
            last_login_date: 1
          }
        }),
        deviceCollection.countDocuments({
          user_id: { $in: [id, objectId] }
        })
      ])

      if (!userDoc) {
        res.status(404).send({ code: 404, msg: '用户不存在' })
        return
      }

      res.send({
        code: 200,
        msg: 'ok',
        data: {
          ...normalizeUserRecord(userDoc),
          deviceCount
        }
      })
    } catch (error) {
      logger.error('admin user detail query failed', error, {
        id,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '用户详情查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.get('/devices', async (req, res) => {
    const { page, pageSize } = normalizePagination(req)
    const { query, keyword, userId } = buildDeviceQuery(req)

    try {
      const database = db.database()
      const collection = database.collection('uni-id-device')
      const docs = await collection.find(query, {
        projection: {
          user_id: 1,
          device_id: 1,
          platform: 1,
          create_date: 1,
          last_active_date: 1,
          token_expired: 1
        }
      })
        .sort({ create_date: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray()

      const total = await collection.countDocuments(query)
      const userIds = Array.from(new Set(docs.map((item) => String(item.user_id || '')).filter(Boolean)))
      const userDocs = userIds.length
        ? await database.collection('uni-id-users').find({ _id: { $in: userIds.map((item) => new db.ObjectId(item)) } }, { projection: { username: 1, nickname: 1, email: 1 } }).toArray()
        : []
      const userMap = new Map(userDocs.map((item) => [String(item._id), item]))

      res.send({
        code: 200,
        msg: 'ok',
        data: {
          list: docs.map((item) => {
            const normalized = normalizeDeviceRecord(item)
            const user = userMap.get(normalized.userId)
            return {
              ...normalized,
              user: user ? {
                id: String(user._id),
                username: user.username || '',
                nickname: user.nickname || '',
                email: user.email || ''
              } : null
            }
          }),
          total,
          page,
          pageSize,
          meta: {
            keyword,
            userId
          }
        }
      })
    } catch (error) {
      logger.error('admin devices query failed', error, {
        query,
        page,
        pageSize,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '设备列表查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.get('/devices/:id', async (req, res) => {
    const id = String(req.params.id || '').trim()
    if (!id) {
      res.status(400).send({ code: 400, msg: 'id 不能为空' })
      return
    }

    let objectId
    try {
      objectId = new db.ObjectId(id)
    } catch (error) {
      res.status(400).send({ code: 400, msg: 'id 格式错误' })
      return
    }

    try {
      const database = db.database()
      const deviceCollection = database.collection('uni-id-device')
      const doc = await deviceCollection.findOne({ _id: objectId }, {
        projection: {
          user_id: 1,
          device_id: 1,
          platform: 1,
          create_date: 1,
          last_active_date: 1,
          token_expired: 1
        }
      })

      if (!doc) {
        res.status(404).send({ code: 404, msg: '设备不存在' })
        return
      }

      let user = null
      const uid = String(doc.user_id || '')
      if (uid) {
        try {
          const userDoc = await database.collection('uni-id-users').findOne({ _id: new db.ObjectId(uid) }, { projection: { username: 1, nickname: 1, email: 1 } })
          if (userDoc) {
            user = {
              id: String(userDoc._id),
              username: userDoc.username || '',
              nickname: userDoc.nickname || '',
              email: userDoc.email || ''
            }
          }
        } catch (error) {
          user = null
        }
      }

      res.send({
        code: 200,
        msg: 'ok',
        data: {
          ...normalizeDeviceRecord(doc),
          user
        }
      })
    } catch (error) {
      logger.error('admin device detail query failed', error, {
        id,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '设备详情查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  return router
}

module.exports = createAdminRouter
