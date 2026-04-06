'use strict';
const uniCloud = require('../../db/index.js');
const { requireAuthedUser } = require('../../utils/auth')

exports.main = async (event) => {
  const db = uniCloud.database()
  const deviceDB = db.collection('uni-id-device')
  const auth = await requireAuthedUser(event)

  if (!auth.ok) {
    return auth.response
  }

  const id = String(event.id || '').trim()
  if (!id) {
    return {
      code: 201,
      msg: '设备记录 id 不能为空',
      data: {}
    }
  }

  let objectId
  try {
    objectId = new uniCloud.ObjectId(id)
  } catch (error) {
    return {
      code: 201,
      msg: '设备记录 id 格式错误',
      data: {}
    }
  }

  const current = await deviceDB.findOne({ _id: objectId }, {
    projection: {
      user_id: 1,
      device_id: 1,
      platform: 1
    }
  })

  if (!current) {
    return {
      code: 404,
      msg: '设备不存在',
      data: {}
    }
  }

  if (String(current.user_id || '') !== String(auth.userId || '')) {
    return {
      code: 403,
      msg: '无权操作该设备',
      data: {}
    }
  }

  await deviceDB.deleteOne({ _id: objectId })

  return {
    code: 200,
    msg: '设备已移除',
    data: {
      id,
      deviceId: current.device_id || '',
      platform: current.platform || ''
    }
  }
}
