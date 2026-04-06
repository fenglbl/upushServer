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

function normalizeTargetType(value, deviceId) {
  const next = String(value || 'user').trim().toLowerCase()
  const hasExplicitDeviceId = String(deviceId || '').trim().length > 0

  // 兼容旧接口：只有显式声明 device 模式且明确传了 deviceId，
  // 才进入单设备推送分支；其他所有情况都回落到旧的用户推送逻辑。
  return next === 'device' && hasExplicitDeviceId ? 'device' : 'user'
}

function normalizeDevicePlatform(platform) {
  const value = String(platform || '').trim().toLowerCase()
  if (!value) return ''
  if (value === 'android') return 'android'
  if (value === 'ios') return 'ios'
  if (value === 'h5' || value === 'web') return 'h5'
  if (value === 'app' || value === 'app-plus' || value === 'app_plus') return 'app'
  if (value === 'mp-weixin' || value === 'weixin' || value === 'wechat' || value === 'wechat-miniprogram') return 'wechat'
  return value
}

function shouldUseGetui(device) {
  return normalizeDevicePlatform(device && device.platform) === 'android'
}

async function resolvePushTargets(deviceDB, event, ip) {
  const id = String(event.id || '').trim()
  const rawDeviceId = String(event.deviceId || '').trim()
  const targetType = normalizeTargetType(event.targetType, rawDeviceId)

  if (targetType === 'device') {
    const identifier = rawDeviceId
    if (!identifier) {
      return {
        ok: false,
        code: 201,
        msg: '目标设备不能为空',
        data: {}
      }
    }

    let device = null

    try {
      device = await deviceDB.findOne({ _id: new uniCloud.ObjectId(identifier) })
    } catch (error) {
      device = null
    }

    if (!device) {
      device = await deviceDB.findOne({ device_id: identifier })
    }

    if (!device) {
      logger.warn('push target device not found', {
        deviceId: identifier,
        ip
      })
      return {
        ok: false,
        code: 404,
        msg: '目标设备不存在',
        data: {}
      }
    }

    return {
      ok: true,
      targetType,
      userId: device.user_id || null,
      devices: [device],
      meta: {
        targetDeviceId: String(device._id || ''),
        rawDeviceId: device.device_id || ''
      }
    }
  }

  if (!id) {
    return {
      ok: false,
      code: 201,
      msg: '目标用户 id 不能为空',
      data: {}
    }
  }

  let userId
  try {
    userId = new uniCloud.ObjectId(id)
  } catch (error) {
    logger.warn('push target user id invalid', {
      id,
      ip
    })
    return {
      ok: false,
      code: 201,
      msg: '目标用户 id 格式错误',
      data: {}
    }
  }

  const devices = await deviceDB.find({ user_id: userId }).toArray()
  return {
    ok: true,
    targetType,
    userId,
    devices,
    meta: {
      targetUserId: id
    }
  }
}

exports.main = async (event, context = {}) => {
  const ip = context.CLIENTIP
  const { title } = event
  const content = event.content || ''
  const payload = event.payload

  const db = uniCloud.database()
  const deviceDB = db.collection('uni-id-device')
  const pushMsgDB = db.collection('uni-push-message')
  const pushBatchDB = db.collection(PUSH_BATCH_COLLECTION)
  const requestTime = Date.now()

  if (!title) {
    return {
      code: 201,
      msg: '推送标题不能为空',
      data: {}
    }
  }

  const target = await resolvePushTargets(deviceDB, event, ip)
  if (!target.ok) {
    return {
      code: target.code,
      msg: target.msg,
      data: target.data || {}
    }
  }

  const { targetType, userId, devices, meta } = target
  const normalizedPayload = normalizePayload(payload)

  if (!devices.length) {
    logger.warn('push target devices not found', {
      targetType,
      userId: userId ? String(userId) : '',
      ...meta,
      ip
    })

    const batchDoc = {
      user_id: userId || null,
      target_type: targetType,
      target_device_id: meta.targetDeviceId || '',
      target_device_raw_id: meta.rawDeviceId || '',
      title,
      content,
      payload: normalizedPayload,
      ip,
      create_time: requestTime,
      total_devices: 0,
      success_count: 0,
      failure_count: 0,
      result_code: 404,
      result_msg: targetType === 'device' ? '目标设备不可用' : '目标用户没有可用设备',
      status: 'no_device',
      results: []
    }

    const insertBatchRes = await pushBatchDB.insertOne(batchDoc)

    return {
      code: 404,
      msg: batchDoc.result_msg,
      data: {
        batchId: String(insertBatchRes.insertedId),
        totalDevices: 0,
        successCount: 0,
        failureCount: 0,
        results: []
      }
    }
  }

  const batchSeed = {
    user_id: userId || null,
    target_type: targetType,
    target_device_id: meta.targetDeviceId || '',
    target_device_raw_id: meta.rawDeviceId || '',
    title,
    content,
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
        content,
        payload: normalizedPayload,
        batch_id: batchId,
        send_status: 'pending'
      })

      insertedMessageId = insertData.insertedId
      const pushPayload = buildPushPayload(normalizedPayload, insertData.insertedId)
      const useGetui = shouldUseGetui(item)

      let pushResponse = null

      if (useGetui) {
        pushResponse = await unipush.sendMessage({
          push_clientid: item.device_id,
          title,
          content,
          payload: pushPayload
        })
      } else {
        pushResponse = {
          provider: 'storage_only',
          skipped: true,
          reason: 'platform_not_supported_by_getui',
          platform: item.platform || ''
        }

        logger.info('push provider skipped for non-android device', {
          deviceId: item.device_id,
          platform: item.platform || '',
          title,
          targetType
        })
      }

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
        providerResponse: pushResponse || null,
        providerSkipped: !useGetui
      }
    } catch (error) {
      logger.error('push delivery failed', error, {
        userId: String(item.user_id || ''),
        deviceId: item.device_id,
        title,
        targetType
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
    targetType,
    userId: userId ? String(userId) : '',
    totalDevices: devices.length,
    successCount,
    failureCount,
    ip,
    batchId: String(batchId),
    ...meta
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
      results,
      targetType
    }
  }
}
