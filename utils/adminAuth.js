const crypto = require('crypto')

const ADMIN_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

function getAdminConfig() {
  return {
    username: String(process.env.ADMIN_USERNAME || '').trim(),
    password: String(process.env.ADMIN_PASSWORD || '').trim(),
    secret: String(process.env.ADMIN_JWT_SECRET || '').trim()
  }
}

function ensureAdminConfig() {
  const config = getAdminConfig()
  const missing = []
  if (!config.username) missing.push('ADMIN_USERNAME')
  if (!config.password) missing.push('ADMIN_PASSWORD')
  if (!config.secret) missing.push('ADMIN_JWT_SECRET')

  if (missing.length) {
    throw new Error(`缺少管理端鉴权环境变量: ${missing.join(', ')}`)
  }

  return config
}

function toBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function fromBase64Url(value) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
  return Buffer.from(padded, 'base64').toString('utf8')
}

function signTokenPayload(payload, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function issueAdminToken() {
  const config = ensureAdminConfig()
  const payload = {
    username: config.username,
    exp: Date.now() + ADMIN_TOKEN_TTL_MS
  }
  const encodedPayload = toBase64Url(JSON.stringify(payload))
  const signature = signTokenPayload(encodedPayload, config.secret)
  return `${encodedPayload}.${signature}`
}

function verifyAdminToken(token) {
  const config = ensureAdminConfig()
  const raw = String(token || '').trim()
  if (!raw) {
    return { ok: false, code: 401, msg: '未提供管理员凭证' }
  }

  const [encodedPayload, signature] = raw.split('.')
  if (!encodedPayload || !signature) {
    return { ok: false, code: 401, msg: '管理员凭证格式错误' }
  }

  const expectedSignature = signTokenPayload(encodedPayload, config.secret)
  if (signature !== expectedSignature) {
    return { ok: false, code: 401, msg: '管理员凭证无效' }
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload))
    if (!payload || payload.username !== config.username) {
      return { ok: false, code: 401, msg: '管理员凭证无效' }
    }
    if (!payload.exp || Number(payload.exp) < Date.now()) {
      return { ok: false, code: 401, msg: '管理员凭证已过期' }
    }
    return {
      ok: true,
      data: {
        username: payload.username,
        exp: Number(payload.exp)
      }
    }
  } catch (error) {
    return { ok: false, code: 401, msg: '管理员凭证解析失败' }
  }
}

function extractBearerToken(req) {
  const authHeader = String(req.headers.authorization || '').trim()
  if (!authHeader) return ''
  const matched = authHeader.match(/^Bearer\s+(.+)$/i)
  return matched ? matched[1].trim() : ''
}

function requireAdminAuth(req, res, next) {
  try {
    const token = extractBearerToken(req)
    const result = verifyAdminToken(token)
    if (!result.ok) {
      return res.status(result.code || 401).send({
        code: result.code || 401,
        msg: result.msg || '未授权',
        data: {}
      })
    }

    req.admin = result.data
    next()
  } catch (error) {
    return res.status(500).send({
      code: 500,
      msg: error.message || '管理员鉴权初始化失败',
      data: {}
    })
  }
}

function validateAdminLogin(username, password) {
  const config = ensureAdminConfig()
  return username === config.username && password === config.password
}

module.exports = {
  ADMIN_TOKEN_TTL_MS,
  ensureAdminConfig,
  issueAdminToken,
  verifyAdminToken,
  requireAdminAuth,
  validateAdminLogin
}
