'use strict';

const uniCloud = require('../../db/index.js')
const { verifyEmailCode } = require('../../utils/emailCode.js')
const { auditSecurity, buildActorFromContext } = require('../../utils/auditLogger')

exports.main = async (event, context = {}) => {
  const db = uniCloud.database()
  const actor = buildActorFromContext(context)
  const tokenDB = db.collection('token')
  const usersDB = db.collection('uni-id-users')
  const changeSessionDB = db.collection('app_email_change_session')
  const nickname = (event.nickname || '').trim()
  const email = (event.email || '').trim().toLowerCase()
  const emailCode = event.email_code || ''
  const oldEmail = (event.old_email || '').trim().toLowerCase()
  const changeEmailToken = event.change_email_token || ''
  const token = event.token || ''

  if (!token) {
    auditSecurity('profile_update_failed', {
      result: 'rejected',
      reason: 'token_required',
      actor
    })

    return {
      code: 202,
      msg: '请先登录',
      data: {}
    }
  }

  if (!nickname) {
    auditSecurity('profile_update_failed', {
      result: 'rejected',
      reason: 'nickname_required',
      email,
      actor
    })

    return {
      code: 201,
      msg: '昵称不能为空',
      data: {}
    }
  }

  const tokenInfo = await tokenDB.find({ token }).toArray()
  if (!tokenInfo.length) {
    auditSecurity('profile_update_failed', {
      result: 'rejected',
      reason: 'token_invalid',
      email,
      actor
    })

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

  if (email) {
    const emailReg = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
    if (!emailReg.test(email)) {
      auditSecurity('change_email_failed', {
        result: 'rejected',
        reason: 'email_invalid',
        userId,
        oldEmail,
        newEmail: email,
        actor
      })

      return {
        code: 201,
        msg: '邮箱格式不正确',
        data: {}
      }
    }

    if (!currentEmail) {
      auditSecurity('change_email_failed', {
        result: 'rejected',
        reason: 'current_email_missing',
        userId,
        oldEmail,
        newEmail: email,
        actor
      })

      return {
        code: 201,
        msg: '当前账号未绑定旧邮箱，暂不支持此修改方式',
        data: {}
      }
    }

    if (!oldEmail) {
      auditSecurity('change_email_failed', {
        result: 'rejected',
        reason: 'old_email_required',
        userId,
        newEmail: email,
        actor
      })

      return {
        code: 201,
        msg: '旧邮箱不能为空',
        data: {}
      }
    }

    if (oldEmail !== currentEmail) {
      auditSecurity('change_email_failed', {
        result: 'rejected',
        reason: 'old_email_mismatch',
        userId,
        oldEmail,
        currentEmail,
        newEmail: email,
        actor
      })

      return {
        code: 201,
        msg: '旧邮箱与当前绑定邮箱不一致',
        data: {}
      }
    }

    if (!changeEmailToken) {
      auditSecurity('change_email_failed', {
        result: 'rejected',
        reason: 'change_email_token_required',
        userId,
        oldEmail,
        newEmail: email,
        actor
      })

      return {
        code: 201,
        msg: '旧邮箱验证状态已失效，请重新验证旧邮箱',
        data: {}
      }
    }

    if (!emailCode) {
      auditSecurity('change_email_failed', {
        result: 'rejected',
        reason: 'new_email_code_required',
        userId,
        oldEmail,
        newEmail: email,
        actor
      })

      return {
        code: 201,
        msg: '请输入新邮箱验证码',
        data: {}
      }
    }

    if (email === currentEmail) {
      auditSecurity('change_email_failed', {
        result: 'rejected',
        reason: 'new_email_same_as_current',
        userId,
        oldEmail,
        newEmail: email,
        actor
      })

      return {
        code: 201,
        msg: '新邮箱不能与当前邮箱相同',
        data: {}
      }
    }

    const changeSessionList = await changeSessionDB.find({
      user_id: userId,
      old_email: oldEmail,
      token: changeEmailToken,
      status: 1
    }).sort({
      create_date: -1
    }).limit(1).toArray()

    if (!changeSessionList.length) {
      auditSecurity('change_email_failed', {
        result: 'rejected',
        reason: 'change_email_session_not_found',
        userId,
        oldEmail,
        newEmail: email,
        actor
      })

      return {
        code: 201,
        msg: '旧邮箱验证状态已失效，请重新验证旧邮箱',
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

      auditSecurity('change_email_failed', {
        result: 'rejected',
        reason: 'change_email_session_expired',
        userId,
        oldEmail,
        newEmail: email,
        actor
      })

      return {
        code: 201,
        msg: '旧邮箱验证状态已过期，请重新验证旧邮箱',
        data: {}
      }
    }

    const newEmailVerifyResult = await verifyEmailCode(db, {
      email,
      code: emailCode,
      scene: 'verify_new_email'
    })
    if (!newEmailVerifyResult.valid) {
      auditSecurity('change_email_failed', {
        result: 'rejected',
        reason: newEmailVerifyResult.message,
        userId,
        oldEmail,
        newEmail: email,
        actor
      })

      return {
        code: 201,
        msg: `新邮箱验证失败：${newEmailVerifyResult.message}`,
        data: {}
      }
    }

    const emailExists = await usersDB.find({ email, _id: { $ne: userId } }).toArray()
    if (emailExists.length) {
      auditSecurity('change_email_failed', {
        result: 'rejected',
        reason: 'new_email_exists',
        userId,
        oldEmail,
        newEmail: email,
        actor
      })

      return {
        code: 201,
        msg: '邮箱已存在',
        data: {}
      }
    }

    await changeSessionDB.updateOne({ _id: changeSession._id }, {
      $set: {
        status: 0,
        update_date: now
      }
    })
  }

  await usersDB.updateOne({ _id: userId }, {
    $set: {
      nickname,
      ...(email ? { email } : {})
    }
  })

  auditSecurity(email ? 'change_email_succeeded' : 'profile_update_succeeded', {
    result: 'success',
    userId,
    nickname,
    ...(email ? { oldEmail, newEmail: email } : {}),
    actor
  })

  const nextUserInfo = await usersDB.find({ _id: userId }).toArray()
  const nextUser = nextUserInfo[0] || {}

  return {
    code: 200,
    msg: '资料已更新',
    data: {
      id: nextUser._id,
      username: nextUser.username,
      nickname: nextUser.nickname,
      email: nextUser.email || '',
      token: nextUser.token || token
    }
  }
}
