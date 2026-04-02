'use strict';
const uniCloud = require('../../db/index.js');
const unipush = require('../../unipush/index.js')
const logger = require('../../utils/logger')

function normalizePayload(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return { ...payload }
  }

  if (typeof payload === 'string' && payload.trim()) {
    return {
      value: payload
    }
  }

  return {}
}

function buildPushPayload(basePayload, messageId) {
  const nextPayload = {
    type: basePayload.type || 'push_message',
    action: basePayload.action || 'open_home_message_list',
    route: basePayload.route || '/pages/home/index',
    mid: String(messageId),
    ...basePayload
  }

  nextPayload.mid = String(messageId)
  return nextPayload
}

exports.main = async (event, context = {}) => {
  const ip = context.CLIENTIP
  let { id, title, content, payload } = event

  const db = uniCloud.database()
  const deviceDB = db.collection('uni-id-device')
  const pushMsgDB = db.collection('uni-push-message')

  if (!id) {
    return {
      code: 201,
      msg: '目标用户 id 不能为空',
      data: {}
    }
  }

  if (!title) {
    return {
      code: 201,
      msg: '推送标题不能为空',
      data: {}
    }
  }

  let userId
  try {
    userId = new uniCloud.ObjectId(id)
  } catch (error) {
    logger.warn('push target id invalid', {
      id,
      ip
    })
    return {
      code: 201,
      msg: '目标用户 id 格式错误',
      data: {}
    }
  }

  const devices = await deviceDB.find({ user_id: userId }).toArray()
  if (!devices.length) {
    logger.warn('push target devices not found', {
      userId: id,
      ip
    })
    return {
      code: 404,
      msg: '目标用户没有可用设备',
      data: {
        totalDevices: 0,
        successCount: 0,
        failureCount: 0,
        results: []
      }
    }
  }

  const normalizedPayload = normalizePayload(payload)

  const results = await Promise.all(devices.map(async (item) => {
    const t = Date.now()

    try {
      const insertData = await pushMsgDB.insertOne({
        user_id: item.user_id,
        ip,
        device_id: item.device_id,
        create_time: t,
        title,
        content: content || '',
        payload: normalizedPayload
      })

      const pushPayload = buildPushPayload(normalizedPayload, insertData.insertedId)

      const pushResponse = await unipush.sendMessage({
        push_clientid: item.device_id,
        title,
        content,
        payload: pushPayload
      })

      return {
        ok: true,
        deviceId: item.device_id,
        messageId: String(insertData.insertedId),
        payload: pushPayload,
        providerResponse: pushResponse || null
      }
    } catch (error) {
      logger.error('push delivery failed', error, {
        userId: String(item.user_id),
        deviceId: item.device_id,
        title
      })

      const providerResponse = error.response && error.response.data ? error.response.data : null

      return {
        ok: false,
        deviceId: item.device_id,
        error: error.message || 'push failed',
        providerCode: providerResponse && providerResponse.code ? providerResponse.code : null,
        providerMsg: providerResponse && providerResponse.msg ? providerResponse.msg : null,
        providerResponse
      }
    }
  }))

  const successCount = results.filter((item) => item.ok).length
  const failureCount = results.length - successCount

  logger.info('push cloudfunction completed', {
    userId: id,
    totalDevices: devices.length,
    successCount,
    failureCount,
    ip
  })

  if (!successCount) {
    return {
      code: 500,
      msg: '推送失败',
      data: {
        totalDevices: devices.length,
        successCount,
        failureCount,
        results
      }
    }
  }

  return {
    code: failureCount ? 207 : 200,
    msg: failureCount ? '部分设备推送失败' : '推送请求已提交',
    data: {
      totalDevices: devices.length,
      successCount,
      failureCount,
      results
    }
  }
}
