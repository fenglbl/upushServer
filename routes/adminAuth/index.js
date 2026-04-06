const express = require('express')
const { ensureAdminConfig, issueAdminToken, verifyAdminToken, validateAdminLogin, ADMIN_TOKEN_TTL_MS } = require('../../utils/adminAuth')
const logger = require('../../utils/logger')

function createAdminAuthRouter() {
  const router = express.Router()

  router.post('/login', (req, res) => {
    try {
      ensureAdminConfig()
    } catch (error) {
      return res.status(500).send({
        code: 500,
        msg: error.message || '管理员配置缺失',
        data: {}
      })
    }

    const username = String(req.body && req.body.username || '').trim()
    const password = String(req.body && req.body.password || '').trim()

    if (!username || !password) {
      return res.status(400).send({
        code: 400,
        msg: '账号和密码不能为空',
        data: {}
      })
    }

    if (!validateAdminLogin(username, password)) {
      logger.warn('admin login failed', { username })
      return res.status(401).send({
        code: 401,
        msg: '账号或密码错误',
        data: {}
      })
    }

    const token = issueAdminToken()
    logger.info('admin login succeeded', { username })

    return res.send({
      code: 200,
      msg: '登录成功',
      data: {
        token,
        user: {
          username
        },
        expiresInMs: ADMIN_TOKEN_TTL_MS
      }
    })
  })

  router.get('/me', (req, res) => {
    try {
      ensureAdminConfig()
    } catch (error) {
      return res.status(500).send({
        code: 500,
        msg: error.message || '管理员配置缺失',
        data: {}
      })
    }

    const authHeader = String(req.headers.authorization || '').trim()
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const result = verifyAdminToken(token)

    if (!result.ok) {
      return res.status(result.code || 401).send({
        code: result.code || 401,
        msg: result.msg || '未授权',
        data: {}
      })
    }

    return res.send({
      code: 200,
      msg: 'ok',
      data: {
        user: {
          username: result.data.username
        },
        exp: result.data.exp
      }
    })
  })

  router.post('/logout', (req, res) => {
    return res.send({
      code: 200,
      msg: '已退出登录',
      data: {}
    })
  })

  return router
}

module.exports = createAdminAuthRouter
