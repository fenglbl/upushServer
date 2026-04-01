'use strict';

const uniCloud = require('../../db/index.js')

exports.main = async (event) => {
  const db = uniCloud.database()
  const tokenDB = db.collection('token')
  const usersDB = db.collection('uni-id-users')
  const changeSessionDB = db.collection('app_email_change_session')
  const token = event.token || ''
  const changeEmailToken = event.change_email_token || ''
  const confirmText = (event.confirm_text || '').trim()

  if (!token) {
    return {
      code: 202,
      msg: '请先登录',
      data: {}
    }
  }

  if (!changeEmailToken) {
    return {
      code: 201,
      msg: '邮箱验证状态已失效，请重新验证邮箱',
      data: {}
    }
  }

  if (confirmText !== 'DELETE') {
    return {
      code: 201,
      msg: '请输入 DELETE 以确认注销',
      data: {}
    }
  }

  const tokenInfo = await tokenDB.find({ token }).toArray()
  if (!tokenInfo.length) {
    return {
      code: 202,
      msg: '登录已失效',
      data: {}
    }
  }

  const userId = tokenInfo[0].user_id
  const userInfo = await usersDB.find({ _id: userId }).limit(1).toArray()
  const user = userInfo[0] || {}
  const currentEmail = (user.email || '').trim().toLowerCase()

  const changeSessionList = await changeSessionDB.find({
    user_id: userId,
    old_email: currentEmail,
    token: changeEmailToken,
    status: 1
  }).sort({
    create_date: -1
  }).limit(1).toArray()

  if (!changeSessionList.length) {
    return {
      code: 201,
      msg: '邮箱验证状态已失效，请重新验证邮箱',
      data: {}
    }
  }

  const changeSession = changeSessionList[0]
  const now = Date.now()
  if (changeSession.expire_time < now) {
    await changeSessionDB.updateOne({ _id: changeSession._id }, {
      $set: {
        status: 0,
        update_date: now
      }
    })

    return {
      code: 201,
      msg: '邮箱验证状态已过期，请重新验证邮箱',
      data: {}
    }
  }

  await usersDB.updateOne({ _id: userId }, {
    $set: {
      status: -1,
      token: '',
      update_date: now,
      close_account_date: now
    }
  })

  await tokenDB.deleteMany({ user_id: userId })
  await changeSessionDB.updateOne({ _id: changeSession._id }, {
    $set: {
      status: 0,
      update_date: now
    }
  })

  return {
    code: 200,
    msg: '账户已注销',
    data: {}
  }
}
