'use strict';

const uniCloud = require('../../db/index.js')
const { verifyEmailCode } = require('../../utils/emailCode.js')
const { auditSecurity, buildActorFromContext } = require('../../utils/auditLogger')
const { requireAuthedUser } = require('../../utils/auth')

function createChangeEmailToken() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`
}

exports.main = async (event, context = {}) => {
  const db = uniCloud.database()
  const actor = buildActorFromContext(context)
  const changeSessionDB = db.collection('app_email_change_session')
  const oldEmail = (event.old_email || '').trim().toLowerCase()
  const oldEmailCode = event.old_email_code || ''

  const auth = await requireAuthedUser(event)
  if (!auth.ok) {
    auditSecurity('verify_old_email_for_change_failed', {
      result: 'rejected',
      reason: 'auth_invalid',
      oldEmail,
      actor
    })
    return auth.response
  }

  const userId = auth.userId
  const user = auth.user || {}

  if (!oldEmail) {
    auditSecurity('verify_old_email_for_change_failed', {
      result: 'rejected',
      reason: 'old_email_required',
      oldEmail,
      actor
    })

    return {
      code: 201,
      msg: '旧邮箱不能为空',
      data: {}
    }
  }

  if (!oldEmailCode) {
    auditSecurity('verify_old_email_for_change_failed', {
      result: 'rejected',
      reason: 'old_email_code_required',
      oldEmail,
      actor
    })

    return {
      code: 201,
      msg: '请输入旧邮箱验证码',
      data: {}
    }
  }

  const currentEmail = (user.email || '').trim().toLowerCase()

  if (!currentEmail) {
    auditSecurity('verify_old_email_for_change_failed', {
      result: 'rejected',
      reason: 'current_email_missing',
      userId,
      oldEmail,
      actor
    })

    return {
      code: 201,
      msg: '当前账号未绑定旧邮箱，暂不支持此修改方式',
      data: {}
    }
  }

  if (oldEmail !== currentEmail) {
    auditSecurity('verify_old_email_for_change_failed', {
      result: 'rejected',
      reason: 'old_email_mismatch',
      userId,
      oldEmail,
      currentEmail,
      actor
    })

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
    auditSecurity('verify_old_email_for_change_failed', {
      result: 'rejected',
      reason: verifyResult.message,
      userId,
      oldEmail,
      actor
    })

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

  auditSecurity('verify_old_email_for_change_succeeded', {
    result: 'success',
    userId,
    oldEmail,
    actor
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
