'use strict';
const uniCloud = require('../../db/index.js');
const unipush = require('../../unipush/index.js')
const logger = require('../../utils/logger')

const PUSH_BATCH_COLLECTION = 'admin-push-batches'

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
  const pushBatchDB = db.collection(PUSH_BATCH_COLLECTION)
  const requestTime = Date.now()

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

    const batchDoc = {
      user_id: userId,
      title,
      content: content || '',
      payload: normalizePayload(payload),
      ip,
      create_time: requestTime,
      total_devices: 0,
      success_count: 0,
      failure_count: 0,
      result_code: 404,
      result_msg: '目标用户没有可用设备',
      status: 'no_device',
      results: []
    }

    const insertBatchRes = await pushBatchDB.insertOne(batchDoc)

    return {
      code: 404,
      msg: '目标用户没有可用设备',
      data: {
        batchId: String(insertBatchRes.insertedId),
        totalDevices: 0,
        successCount: 0,
        failureCount: 0,
        results: []
      }
    }
  }

  const normalizedPayload = normalizePayload(payload)

  const batchSeed = {
    user_id: userId,
    title,
    content: content || '',
    payload: normalizedPayload,
    ip,
    create_time: requestTime,
    total_devices: devices.length,
    success_count: 0,
    failure_count: 0,
    result_code: 0,
    result_msg: '',
    status: 'processing',
    results: []
  }

  const batchInsertRes = await pushBatchDB.insertOne(batchSeed)
  const batchId = batchInsertRes.insertedId

  const results = await Promise.all(devices.map(async (item) => {
    const t = Date.now()
    let insertedMessageId = null

    try {
      const insertData = await pushMsgDB.insertOne({
        user_id: item.user_id,
        ip,
        device_id: item.device_id,
        create_time: t,
        title,
        content: content || '',
        payload: normalizedPayload,
        batch_id: batchId,
        send_status: 'pending'
      })

      insertedMessageId = insertData.insertedId
      const pushPayload = buildPushPayload(normalizedPayload, insertData.insertedId)

      const pushResponse = await unipush.sendMessage({
        push_clientid: item.device_id,
        title,
        content,
        payload: pushPayload
      })

      await pushMsgDB.updateOne({ _id: insertData.insertedId }, {
        $set: {
          payload: pushPayload,
          send_status: 'success',
          provider_response: pushResponse || null,
          sent_at: Date.now()
        }
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
      const failureMessage = error.message || 'push failed'

      if (insertedMessageId) {
        await pushMsgDB.updateOne({ _id: insertedMessageId }, {
          $set: {
            send_status: 'failed',
            provider_response: providerResponse,
            error_message: failureMessage,
            sent_at: Date.now()
          }
        })
      }

      return {
        ok: false,
        deviceId: item.device_id,
        messageId: insertedMessageId ? String(insertedMessageId) : '',
        error: failureMessage,
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
    ip,
    batchId: String(batchId)
  })

  let code = 200
  let msg = '推送请求已提交'
  let status = 'success'

  if (!successCount) {
    code = 500
    msg = '推送失败'
    status = 'failed'
  } else if (failureCount) {
    code = 207
    msg = '部分设备推送失败'
    status = 'partial'
  }

  await pushBatchDB.updateOne({ _id: batchId }, {
    $set: {
      success_count: successCount,
      failure_count: failureCount,
      result_code: code,
      result_msg: msg,
      status,
      results,
      updated_at: Date.now()
    }
  })

  return {
    code,
    msg,
    data: {
      batchId: String(batchId),
      totalDevices: devices.length,
      successCount,
      failureCount,
      results
    }
  }
}
