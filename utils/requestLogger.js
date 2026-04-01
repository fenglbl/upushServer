const logger = require('./logger')

// 统一请求日志中间件：
// - 记录请求方法、路径、状态码、耗时、IP、UA
// - 请求结束后再落日志，避免只记到“开始”却没有结果
function requestLogger(req, res, next) {
  const startAt = Date.now()

  res.on('finish', () => {
    const durationMs = Date.now() - startAt
    logger.info('request completed', {
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || ''
    })
  })

  next()
}

module.exports = requestLogger
