'use strict';

const md5 = require('md5')
const uniCloud = require('../../db/index.js')

exports.main = async (event) => {
  const db = uniCloud.database()
  const tokenDB = db.collection('token')
  const usersDB = db.collection('uni-id-users')
  const changeSessionDB = db.collection('app_email_change_session')
  const token = event.token || ''
  const changeEmailToken = event.change_email_token || ''
  const password = event.password || ''
  const confirmPassword = event.confirm_password || ''
  const key = 'fenglbl.upush.'

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

  if (!password) {
    return {
      code: 201,
      msg: '密码不能为空',
      data: {}
    }
  }

  if (password.length < 6) {
    return {
      code: 201,
      msg: '密码至少 6 位',
      data: {}
    }
  }

  if (password !== confirmPassword) {
    return {
      code: 201,
      msg: '两次密码输入不一致',
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
      password: md5(key + password),
      update_date: now
    }
  })

  await changeSessionDB.updateOne({ _id: changeSession._id }, {
    $set: {
      status: 0,
      update_date: now
    }
  })

  return {
    code: 200,
    msg: '密码已修改',
    data: {}
  }
}
