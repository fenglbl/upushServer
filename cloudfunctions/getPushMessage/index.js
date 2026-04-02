'use strict';
const uniCloud = require('../../db/index.js');

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
  const usersDB = db.collection('uni-id-users')
  const tokenDB = db.collection('token')
  const now = Date.now()

  const userToken = await tokenDB.find({
    token: event.token
  }).toArray()

  if (!userToken.length) {
    return {
      code: 202,
      msg: 'token不存在',
      data: {}
    }
  }

  const tokenCreateTime = userToken[0].addtime
  if (tokenCreateTime + tokenLong < now) {
    return {
      code: 202,
      msg: 'token过期',
      data: []
    }
  }

  const user = await usersDB.find({
    token: event.token
  }).toArray()

  if (user.length) {
    const page = event.page || 1
    const pageSize = event.pageSize || 20
    const skip = (page - 1) * pageSize
    const userId = user[0]._id

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

  return {
    code: 202,
    msg: 'token异常',
    data: []
  }
}
