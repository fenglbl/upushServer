const express = require('express')
const logger = require('../../utils/logger')

/**
 * 创建 pushMessage 路由
 *
 * 这里通过依赖注入拿到：
 * - cloudfunctions：负责实际推送逻辑
 * - wsServer：负责在推送成功后通知在线客户端
 */
function createPushMessageRouter({ cloudfunctions, wsServer }) {
  const router = express.Router()

  // POST /pushMessage
  router.post('/', async (req, res) => {
    if (req.body) {
      const pushData = { ...req.body }
      await pushMessage(pushData, req, res, cloudfunctions, wsServer)
    } else {
      res.send({ code: 202, msg: '参数错误' })
    }
  })

  // GET /pushMessage
  router.get('/', async (req, res) => {
    if (req.query) {
      const pushData = { ...req.query }
      await pushMessage(pushData, req, res, cloudfunctions, wsServer)
    } else {
      res.send({ code: 202, msg: '参数错误' })
    }
  })

  // GET /pushMessage/:id
  // 允许把 id 写在路径中，便于按目标 id 发送推送
  router.get('/:id', async (req, res) => {
    if (req.query) {
      const pushData = { ...req.query }
      if (req.params) {
        pushData.id = req.params.id
      }
      await pushMessage(pushData, req, res, cloudfunctions, wsServer)
    } else {
      res.send({ code: 202, msg: '参数错误' })
    }
  })

  return router
}

/**
 * 推送处理主逻辑
 *
 * 流程：
 * 1. 校验基础参数
 * 2. 调用 push 云函数执行实际推送
 * 3. 如果推送成功，则通过 WebSocket 向对应 id 广播一条实时消息
 * 4. 返回接口响应
 */
async function pushMessage(pushData, req, res, cloudfunctions, wsServer) {
  if (!pushData.id) {
    res.send({ code: 202, msg: 'id error' })
    return
  }

  if (!pushData.title) {
    res.send({ code: 202, msg: 'title error' })
    return
  }

  // 兼容空内容 / 空 payload 的情况，避免后续字段缺失
  if (!pushData.content) pushData.content = ''
  if (!pushData.payload) pushData.payload = ''

  try {
    const pushRes = await cloudfunctions.push.main(pushData, {
      CLIENTIP: req.ip,
      CLIENTUA: req.headers['user-agent'],
      APPID: 'test',
      deviceId: 'test'
    })

    logger.info('pushMessage executed', {
      id: pushData.id,
      title: pushData.title,
      resultCode: pushRes && pushRes.code,
      resultMsg: pushRes && pushRes.msg,
      resultData: pushRes && pushRes.data
    })

    // 推送成功后，给对应 id 的在线 WebSocket 客户端发一条实时通知
    // 这样客户端除了收到系统推送外，也能在前台立刻感知到新消息
    if (pushRes && pushRes.code === 200 && wsServer) {
      const wsData = {
        type: 'push',
        id: String(pushData.id),
        title: pushData.title,
        content: pushData.content,
        payload: pushData.payload,
        time: Date.now()
      }

      wsServer.broadcast(JSON.stringify(wsData), String(pushData.id))
    }

    const isSuccess = pushRes && (pushRes.code === 200 || pushRes.code === 207)

    if (!isSuccess) {
      res.status(500).send({
        code: pushRes && pushRes.code ? pushRes.code : 500,
        msg: pushRes && pushRes.msg ? pushRes.msg : '推送失败',
        data: pushRes && pushRes.data ? pushRes.data : {}
      })
      return
    }

    res.send({
      code: pushRes.code,
      msg: pushRes.msg,
      data: pushRes.data || {}
    })
  } catch (error) {
    logger.error('pushMessage execute failed', error, {
      path: req.originalUrl || req.url,
      method: req.method,
      pushData
    })

    res.status(500).send({
      code: 500,
      msg: '推送处理失败',
      error: error.message || 'unknown error'
    })
  }
}

module.exports = createPushMessageRouter
