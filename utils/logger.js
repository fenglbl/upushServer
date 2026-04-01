const fs = require('fs')
const path = require('path')
const util = require('util')

// 日志目录，按天拆分文件，便于后续排查与归档
const logsDir = path.join(__dirname, '..', 'logs')

// 可选的实时日志推送器：
// 由 app.js 在服务启动后注入，当前用于把日志同步广播到 /ws/logger
let realtimeTransport = null

function ensureLogsDir() {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true })
  }
}

function pad(num) {
  return String(num).padStart(2, '0')
}

function getLocalTimestamp(date = new Date()) {
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

function getLogFilePath(date = new Date()) {
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  return path.join(logsDir, `${year}-${month}-${day}.log`)
}

// 简单脱敏：第一版先保护最明显的敏感信息，避免日志直接落明文
function maskEmail(email) {
  if (!email || typeof email !== 'string') return email
  const parts = email.split('@')
  if (parts.length !== 2) return email
  const [localPart, domain] = parts
  if (!localPart) return `***@${domain}`
  if (localPart.length === 1) return `${localPart}***@${domain}`
  return `${localPart.slice(0, 1)}***${localPart.slice(-1)}@${domain}`
}

function maskToken(token) {
  if (!token || typeof token !== 'string') return token
  if (token.length <= 10) return `${token.slice(0, 2)}***`
  return `${token.slice(0, 6)}***${token.slice(-4)}`
}

function sanitizeValue(key, value) {
  if (value == null) return value

  const lowerKey = String(key || '').toLowerCase()

  if (lowerKey.includes('password')) return '[REDACTED]'
  if (lowerKey.includes('secret')) return '[REDACTED]'
  if (lowerKey.includes('apikey')) return '[REDACTED]'
  if (lowerKey.includes('api_key')) return '[REDACTED]'
  if (lowerKey.includes('token')) return maskToken(value)
  if (lowerKey.includes('code')) {
    if (lowerKey.includes('email') || lowerKey.includes('verify')) {
      return '[REDACTED]'
    }
  }
  if (lowerKey.includes('email') && typeof value === 'string') return maskEmail(value)

  return value
}

function sanitizeObject(input) {
  if (input == null) return input
  if (Array.isArray(input)) return input.map((item) => sanitizeObject(item))
  if (typeof input !== 'object') return input

  const output = {}
  Object.keys(input).forEach((key) => {
    const value = input[key]
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = sanitizeObject(value)
    } else if (Array.isArray(value)) {
      output[key] = value.map((item) => sanitizeObject(item))
    } else {
      output[key] = sanitizeValue(key, value)
    }
  })
  return output
}

function normalizeMeta(meta) {
  if (!meta) return {}
  return sanitizeObject(meta)
}

function stringifyMeta(meta) {
  const normalized = normalizeMeta(meta)
  if (!normalized || Object.keys(normalized).length === 0) return ''
  return ` ${util.inspect(normalized, { depth: 6, breakLength: 140, compact: true })}`
}

function writeLine(line) {
  try {
    ensureLogsDir()
    fs.appendFileSync(getLogFilePath(), `${line}\n`, 'utf8')
  } catch (error) {
    console.error('[logger] write file failed:', error.message)
  }
}

function emitRealtimeLog(payload) {
  if (typeof realtimeTransport !== 'function') return

  try {
    realtimeTransport(payload)
  } catch (error) {
    console.error('[logger] realtime transport failed:', error.message)
  }
}

function log(level, message, meta = null) {
  const upperLevel = String(level || 'info').toUpperCase()
  const normalizedMeta = normalizeMeta(meta)
  const line = `[${getLocalTimestamp()}] [${upperLevel}] ${message}${stringifyMeta(normalizedMeta)}`

  if (upperLevel === 'ERROR') {
    console.error(line)
  } else if (upperLevel === 'WARN') {
    console.warn(line)
  } else {
    console.log(line)
  }

  writeLine(line)

  // 除了控制台和文件，也把日志实时广播给 /ws/logger 订阅者
  emitRealtimeLog({
    type: 'log',
    level: upperLevel,
    time: getLocalTimestamp(),
    message,
    meta: normalizedMeta
  })
}

function error(message, err = null, meta = null) {
  const errorMeta = {
    ...(meta || {}),
    ...(err
      ? {
          errorMessage: err.message,
          stack: err.stack
        }
      : {})
  }
  log('error', message, errorMeta)
}

module.exports = {
  log,
  info(message, meta) {
    log('info', message, meta)
  },
  warn(message, meta) {
    log('warn', message, meta)
  },
  error,
  sanitizeObject,
  // 由外部注入实时日志传输器，例如 websocket 广播函数
  setRealtimeTransport(fn) {
    realtimeTransport = fn
  }
}
