const logger = require('./logger')

function normalizeString(value) {
  if (value == null) return ''
  return String(value).trim()
}

function buildActorFromContext(context = {}) {
  return {
    ip: normalizeString(context.CLIENTIP || context.ip),
    userAgent: normalizeString(context.CLIENTUA || context.userAgent),
    appid: normalizeString(context.APPID || context.appid),
    deviceId: normalizeString(context.deviceId)
  }
}

function auditSecurity(action, meta = {}) {
  logger.info('security audit', {
    category: 'security_audit',
    action,
    ...meta
  })
}

module.exports = {
  buildActorFromContext,
  auditSecurity
}
