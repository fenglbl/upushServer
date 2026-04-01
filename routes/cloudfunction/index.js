const express = require('express')
const logger = require('../../utils/logger')

function createCloudfunctionRouter({ cloudfunctions }) {
  const router = express.Router()

  router.post('/', async (req, res) => {
    if (!req.body) {
      res.send({
        code: -1,
        error: 'body is NULL'
      })
      return
    }

    const { functionName, params } = req.body

    if (!functionName || typeof functionName !== 'string') {
      res.send({
        code: -1,
        error: 'functionName is NULL'
      })
      return
    }

    const targetFunction = cloudfunctions[functionName]
    if (!targetFunction) {
      logger.warn('cloudfunction not found', {
        functionName,
        path: req.originalUrl || req.url
      })

      res.send({
        code: -1,
        error: 'function not found'
      })
      return
    }

    if (typeof targetFunction.main !== 'function') {
      logger.warn('cloudfunction main is invalid', {
        functionName,
        path: req.originalUrl || req.url
      })

      res.send({
        code: -1,
        error: 'function main is invalid'
      })
      return
    }

    try {
      const result = await targetFunction.main(params || {}, {
        CLIENTIP: req.ip,
        CLIENTUA: req.headers['user-agent'],
        APPID: 'test',
        deviceId: 'test'
      })

      logger.info('cloudfunction executed', {
        functionName,
        resultCode: result && result.code
      })

      res.send({
        result
      })
    } catch (error) {
      logger.error('cloudfunction execute failed', error, {
        functionName,
        path: req.originalUrl || req.url,
        params
      })

      res.status(500).send({
        code: -1,
        error: 'cloudfunction execute failed',
        message: error.message || 'unknown error'
      })
    }
  })

  return router
}

module.exports = createCloudfunctionRouter
