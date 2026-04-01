const express = require('express')

function createPushMessageRouter({ cloudfunctions }) {
  const router = express.Router()

  router.post('/', async (req, res) => {
    if (req.body) {
      const pushData = { ...req.body }
      await pushMessage(pushData, req, res, cloudfunctions)
    } else {
      res.send({ code: 202, msg: '参数错误' })
    }
  })

  router.get('/', async (req, res) => {
    if (req.query) {
      const pushData = { ...req.query }
      await pushMessage(pushData, req, res, cloudfunctions)
    } else {
      res.send({ code: 202, msg: '参数错误' })
    }
  })

  router.get('/:id', async (req, res) => {
    if (req.query) {
      const pushData = { ...req.query }
      if (req.params) {
        pushData.id = req.params.id
      }
      await pushMessage(pushData, req, res, cloudfunctions)
    } else {
      res.send({ code: 202, msg: '参数错误' })
    }
  })

  return router
}

async function pushMessage(pushData, req, res, cloudfunctions) {
  if (!pushData.id) {
    res.send({ code: 202, msg: 'id error' })
    return
  }

  if (!pushData.title) {
    res.send({ code: 202, msg: 'title error' })
    return
  }

  if (!pushData.content) pushData.content = ''
  if (!pushData.payload) pushData.payload = ''

  await cloudfunctions.push.main(pushData, {
    CLIENTIP: req.ip,
    CLIENTUA: req.headers['user-agent'],
    APPID: 'test',
    deviceId: 'test'
  })

  res.send({ code: 200, msg: '推送已提交' })
}

module.exports = createPushMessageRouter
