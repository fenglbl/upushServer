'use strict';

const uniCloud = require('../db/index.js')

function isUserDisabledStatus(status) {
  return Number(status) === 0
}

async function requireAuthedUser(event = {}, options = {}) {
  const { allowClosed = false } = options
  const db = uniCloud.database()
  const tokenDB = db.collection('token')
  const usersDB = db.collection('uni-id-users')
  const token = String(event.token || '').trim()

  if (!token) {
    return {
      ok: false,
      response: {
        code: 202,
        msg: '请先登录',
        data: {}
      }
    }
  }

  const tokenInfo = await tokenDB.find({ token }).limit(1).toArray()
  if (!tokenInfo.length) {
    return {
      ok: false,
      response: {
        code: 202,
        msg: '登录已失效',
        data: {}
      }
    }
  }

  const tokenDoc = tokenInfo[0]
  const userId = tokenDoc.user_id
  const userInfo = await usersDB.find({ _id: userId }).limit(1).toArray()
  const user = userInfo[0]

  if (!user) {
    await tokenDB.deleteMany({ token })
    return {
      ok: false,
      response: {
        code: 202,
        msg: '用户不存在或登录已失效',
        data: {}
      }
    }
  }

  const status = Number(user.status)
  if (!allowClosed && status === -1) {
    await tokenDB.deleteMany({ user_id: userId })
    return {
      ok: false,
      response: {
        code: 202,
        msg: '账号已注销',
        data: {}
      }
    }
  }

  if (isUserDisabledStatus(status)) {
    await tokenDB.deleteMany({ user_id: userId })
    return {
      ok: false,
      response: {
        code: 202,
        msg: '账号已被禁用',
        data: {}
      }
    }
  }

  return {
    ok: true,
    db,
    token,
    tokenDoc,
    tokenDB,
    usersDB,
    userId,
    user,
    status
  }
}

module.exports = {
  isUserDisabledStatus,
  requireAuthedUser
}
