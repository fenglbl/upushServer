const express = require('express')
const fs = require('fs')
const path = require('path')
const logger = require('../../utils/logger')

const logsDir = path.join(__dirname, '..', '..', 'logs')
const ENTRY_START_RE = /^\[(?<time>[^\]]+)\]\s+\[(?<level>[A-Z]+)\]\s+(?<message>.*)$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const RANGE_SET = new Set(['7d', '30d', '24h'])

function pad(num) {
  return String(num).padStart(2, '0')
}

function toDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
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

function normalizeRange(value) {
  const next = String(value || '7d').trim().toLowerCase()
  return RANGE_SET.has(next) ? next : '7d'
}

function readLogEntriesByDate(dateKey) {
  if (!DATE_RE.test(dateKey)) return []

  const filePath = path.join(logsDir, `${dateKey}.log`)
  if (!fs.existsSync(filePath)) return []

  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/).filter(Boolean)
  const grouped = []
  let current = null

  for (const line of lines) {
    if (ENTRY_START_RE.test(line)) {
      if (current) grouped.push(current)
      current = line
    } else if (current) {
      current += `\n${line}`
    }
  }

  if (current) grouped.push(current)

  return grouped
    .map((raw) => {
      const firstLine = raw.split(/\r?\n/)[0]
      const match = firstLine.match(ENTRY_START_RE)
      if (!match) {
        return {
          raw,
          parsed: false,
          time: '',
          level: 'INFO',
          message: firstLine
        }
      }

      return {
        raw,
        parsed: true,
        time: match.groups.time,
        level: match.groups.level,
        message: match.groups.message
      }
    })
}

function extractNumber(raw, key) {
  const match = raw.match(new RegExp(`${key}:\\s*(\\d+)`))
  return match ? Number(match[1]) : 0
}

function extractString(raw, key) {
  const match = raw.match(new RegExp(`${key}:\\s*'([^']*)'`))
  return match ? match[1] : ''
}

function buildPushRecord(entry) {
  if (!String(entry.message || '').startsWith('pushMessage executed')) return null

  const resultCode = extractNumber(entry.raw, 'resultCode')
  const title = extractString(entry.raw, 'title') || '未命名推送'
  const successCount = extractNumber(entry.raw, 'successCount')
  const failureCount = extractNumber(entry.raw, 'failureCount')
  const totalDevices = extractNumber(entry.raw, 'totalDevices')

  let status = 'failed'
  if (resultCode === 200) status = 'success'
  else if (resultCode === 207) status = 'partial'
  else if (resultCode === 404) status = 'no_device'

  return {
    title,
    createdAt: entry.time,
    resultCode,
    totalDevices,
    successCount,
    failureCount,
    status,
    summary:
      status === 'success'
        ? '全部成功'
        : status === 'partial'
          ? `部分失败（成功 ${successCount} / 失败 ${failureCount}）`
          : status === 'no_device'
            ? '无可用设备'
            : '推送失败'
  }
}

function buildErrorRecord(entry) {
  if (!['ERROR', 'WARN'].includes(entry.level)) return null

  return {
    time: entry.time,
    level: entry.level,
    message: entry.message
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

function buildTrend(range, pushRecords) {
  const now = new Date()

  if (range === '24h') {
    const points = Array.from({ length: 24 }, (_, index) => {
      const hour = new Date(now)
      hour.setHours(now.getHours() - (23 - index), 0, 0, 0)
      return {
        key: `${hour.getFullYear()}-${pad(hour.getMonth() + 1)}-${pad(hour.getDate())} ${pad(hour.getHours())}`,
        point: createEmptyPoint(`${pad(hour.getHours())}:00`)
      }
    })

    const pointMap = new Map(points.map((item) => [item.key, item.point]))

    pushRecords.forEach((record) => {
      const date = new Date(record.createdAt.replace(' ', 'T'))
      if (Number.isNaN(date.getTime())) return
      const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}`
      const point = pointMap.get(key)
      if (!point) return
      point.total += 1
      point.success += record.status === 'success' ? 1 : 0
      point.failed += record.status === 'failed' ? 1 : 0
    })

    return {
      range,
      unit: 'hour',
      points: points.map((item) => item.point)
    }
  }

  const dates = getDateRange(range)
  const pointMap = new Map(dates.map((dateKey) => [dateKey, createEmptyPoint(dateKey.slice(5))]))

  pushRecords.forEach((record) => {
    const dateKey = record.createdAt.slice(0, 10)
    const point = pointMap.get(dateKey)
    if (!point) return
    point.total += 1
    point.success += record.status === 'success' ? 1 : 0
    point.failed += record.status === 'failed' ? 1 : 0
  })

  return {
    range,
    unit: 'day',
    points: dates.map((dateKey) => pointMap.get(dateKey))
  }
}

function buildSummary(todayPushes) {
  const total = todayPushes.length
  const success = todayPushes.filter((item) => item.status === 'success').length
  const partial = todayPushes.filter((item) => item.status === 'partial').length
  const failed = todayPushes.filter((item) => item.status === 'failed').length
  const successRate = total ? Number(((success / total) * 100).toFixed(2)) : 0

  return {
    total,
    success,
    partial,
    failed,
    successRate
  }
}

function createAdminRouter() {
  const router = express.Router()

  router.get('/dashboard', async (req, res) => {
    const range = normalizeRange(req.query.range)
    const dateKeys = getDateRange(range)

    try {
      const entries = dateKeys.flatMap((dateKey) => readLogEntriesByDate(dateKey))
      const pushRecords = entries
        .map((entry) => buildPushRecord(entry))
        .filter(Boolean)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))

      const errorRecords = entries
        .map((entry) => buildErrorRecord(entry))
        .filter(Boolean)
        .sort((a, b) => String(b.time).localeCompare(String(a.time)))

      const todayKey = toDateKey(new Date())
      const todayPushes = pushRecords.filter((item) => String(item.createdAt).startsWith(todayKey))

      res.send({
        code: 200,
        msg: 'ok',
        data: {
          summary: buildSummary(todayPushes),
          trend: buildTrend(range, pushRecords),
          recentPushes: pushRecords.slice(0, 10),
          recentErrors: errorRecords.slice(0, 10),
          meta: {
            generatedAt: new Date().toISOString(),
            range,
            rangeOptions: ['7d', '30d', '24h']
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
