const express = require('express')
const fs = require('fs')
const path = require('path')
const logger = require('../../utils/logger')

const logsDir = path.join(__dirname, '..', '..', 'logs')
const LOG_LINE_RE = /^\[(?<time>[^\]]+)\]\s+\[(?<level>[A-Z]+)\]\s+(?<message>.*)$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function normalizeDate(value) {
  if (!value) {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  return String(value).trim()
}

function normalizeLimit(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 100
  return Math.min(Math.floor(parsed), 500)
}

function parseLogLine(line, index) {
  const match = line.match(LOG_LINE_RE)
  if (!match) {
    return {
      index,
      raw: line,
      parsed: false
    }
  }

  return {
    index,
    raw: line,
    parsed: true,
    time: match.groups.time,
    level: match.groups.level,
    message: match.groups.message
  }
}

function createLogsRouter() {
  const router = express.Router()

  router.get('/', async (req, res) => {
    const date = normalizeDate(req.query.date)
    const level = req.query.level ? String(req.query.level).trim().toUpperCase() : ''
    const keyword = req.query.keyword ? String(req.query.keyword).trim().toLowerCase() : ''
    const message = req.query.message ? String(req.query.message).trim().toLowerCase() : ''
    const limit = normalizeLimit(req.query.limit)
    const desc = String(req.query.order || 'desc').toLowerCase() !== 'asc'

    if (!DATE_RE.test(date)) {
      res.status(400).send({
        code: 400,
        msg: 'date 参数格式错误，应为 YYYY-MM-DD',
        data: {}
      })
      return
    }

    const filePath = path.join(logsDir, `${date}.log`)
    if (!fs.existsSync(filePath)) {
      res.status(404).send({
        code: 404,
        msg: '日志文件不存在',
        data: {
          date,
          file: filePath
        }
      })
      return
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8')
      const lines = content.split(/\r?\n/).filter(Boolean)
      let entries = lines.map((line, index) => parseLogLine(line, index + 1))

      if (level) {
        entries = entries.filter((entry) => entry.level === level)
      }

      if (keyword) {
        entries = entries.filter((entry) => entry.raw.toLowerCase().includes(keyword))
      }

      if (message) {
        entries = entries.filter((entry) => (entry.message || '').toLowerCase().includes(message))
      }

      if (desc) {
        entries = entries.slice(-limit).reverse()
      } else {
        entries = entries.slice(0, limit)
      }

      res.send({
        code: 200,
        msg: 'ok',
        data: {
          date,
          file: filePath,
          totalLines: lines.length,
          returned: entries.length,
          filters: {
            level: level || null,
            keyword: keyword || null,
            message: message || null,
            limit,
            order: desc ? 'desc' : 'asc'
          },
          entries
        }
      })
    } catch (error) {
      logger.error('logs query failed', error, {
        date,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '日志查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  return router
}

module.exports = createLogsRouter
