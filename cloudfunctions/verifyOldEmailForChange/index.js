'use strict';

const uniCloud = require('../../db/index.js')
const { verifyEmailCode } = require('../../utils/emailCode.js')

function createChangeEmailToken() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`
}

exports.main = async (event) => {
  const db = uniCloud.database()
  const tokenDB = db.collection('token')
  const usersDB = db.collection('uni-id-users')
  const changeSessionDB = db.collection('app_email_change_session')
  const oldEmail = (event.old_email || '').trim().toLowerCase()
  const oldEmailCode = event.old_email_code || ''
  const token = event.token || ''

  if (!token) {
    return {
      code: 202,
      msg: '请先登录',
      data: {}
    }
  }

  if (!oldEmail) {
    return {
      code: 201,
      msg: '旧邮箱不能为空',
      data: {}
    }
  }

  if (!oldEmailCode) {
    return {
      code: 201,
      msg: '请输入旧邮箱验证码',
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

  if (!currentEmail) {
    return {
      code: 201,
      msg: '当前账号未绑定旧邮箱，暂不支持此修改方式',
      data: {}
    }
  }

  if (oldEmail !== currentEmail) {
    return {
      code: 201,
      msg: '旧邮箱与当前绑定邮箱不一致',
      data: {}
    }
  }

  const verifyResult = await verifyEmailCode(db, {
    email: oldEmail,
    code: oldEmailCode,
    scene: 'verify_old_email'
  })

  if (!verifyResult.valid) {
    return {
      code: 201,
      msg: `旧邮箱验证失败：${verifyResult.message}`,
      data: {}
    }
  }

  const now = Date.now()
  const changeToken = createChangeEmailToken()
  const expireTime = now + 10 * 60 * 1000

  await changeSessionDB.updateMany({
    user_id: userId,
    status: 1
  }, {
    $set: {
      status: 0,
      update_date: now
    }
  })

  await changeSessionDB.insertOne({
    user_id: userId,
    old_email: oldEmail,
    token: changeToken,
    status: 1,
    expire_time: expireTime,
    create_date: now,
    update_date: now
  })

  return {
    code: 200,
    msg: '旧邮箱验证成功',
    data: {
      change_email_token: changeToken,
      expire_time: expireTime
    }
  }
}
