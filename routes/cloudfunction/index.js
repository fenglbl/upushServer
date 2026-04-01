const express = require('express')

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
      res.send({
        code: -1,
        error: 'function not found'
      })
      return
    }

    if (typeof targetFunction.main !== 'function') {
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

      res.send({
        result
      })
    } catch (error) {
      console.error(`[cloudfunction:${functionName}]`, error)
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
