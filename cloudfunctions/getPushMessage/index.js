'use strict';
const uniCloud = require('../../db/index.js');
const { requireAuthedUser } = require('../../utils/auth')

const tokenLong = 1000 * 60 * 60 * 24 * 365 * 100 // 默认100年

function normalizePushMessage(item) {
  if (!item || typeof item !== 'object') return item

  const nextItem = {
    ...item,
    id: String(item._id || item.id || item.mid || '')
  }

  return nextItem
}

exports.main = async (event) => {
  const db = uniCloud.database()
  const pushMsgDB = db.collection('uni-push-message')
  const now = Date.now()

  const auth = await requireAuthedUser(event)
  if (!auth.ok) {
    return auth.response
  }

  const tokenCreateTime = Number(auth.tokenDoc?.addtime || 0)
  if (tokenCreateTime + tokenLong < now) {
    await auth.tokenDB.deleteMany({ token: auth.token })
    return {
      code: 202,
      msg: 'token过期',
      data: []
    }
  }

  const page = event.page || 1
  const pageSize = event.pageSize || 20
  const skip = (page - 1) * pageSize
  const userId = auth.userId

  const msg = await pushMsgDB.find({
    user_id: userId,
    device_id: event.device_id
  }, {
    projection: {
      device_id: 0,
      ip: 0
    }
  })
    .sort({
      create_time: -1
    })
    .skip(skip)
    .limit(pageSize)
    .toArray()

  const total = await pushMsgDB.countDocuments({
    user_id: userId,
    device_id: event.device_id
  })

  const pageTotal = Math.ceil(total / pageSize)
  const list = msg.map(normalizePushMessage)

  return {
    code: 200,
    msg: '',
    data: {
      list,
      total: pageTotal
    }
  }
}
