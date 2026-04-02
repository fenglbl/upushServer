'use strict';

const md5 = require('md5')
const uniCloud = require('../../db/index.js')
const { verifyEmailCode } = require('../../utils/emailCode.js')
const { auditSecurity, buildActorFromContext } = require('../../utils/auditLogger')

exports.main = async (event, context = {}) => {
  const db = uniCloud.database()
  const actor = buildActorFromContext(context)
  const usersDB = db.collection('uni-id-users')
  const t = Date.now()
  const key = 'fenglbl.upush.'
  const username = (event.username || '').trim()
  const email = (event.email || '').trim().toLowerCase()
  const password = event.password || ''

  if (!username) {
    auditSecurity('register_failed', {
      result: 'rejected',
      reason: 'username_required',
      username,
      email,
      actor
    })

    return {
      code: 201,
      msg: '账号不能为空',
      data: {}
    }
  }

  if (!password) {
    auditSecurity('register_failed', {
      result: 'rejected',
      reason: 'password_required',
      username,
      email,
      actor
    })

    return {
      code: 201,
      msg: '密码不能为空',
      data: {}
    }
  }

  if (password.length < 6) {
    auditSecurity('register_failed', {
      result: 'rejected',
      reason: 'password_too_short',
      username,
      email,
      actor
    })

    return {
      code: 201,
      msg: '密码至少 6 位',
      data: {}
    }
  }

  if (!email) {
    auditSecurity('register_failed', {
      result: 'rejected',
      reason: 'email_required',
      username,
      email,
      actor
    })

    return {
      code: 201,
      msg: '邮箱不能为空',
      data: {}
    }
  }

  const emailReg = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
  if (!emailReg.test(email)) {
    auditSecurity('register_failed', {
      result: 'rejected',
      reason: 'email_invalid',
      username,
      email,
      actor
    })

    return {
      code: 201,
      msg: '邮箱格式不正确',
      data: {}
    }
  }

  const exists = await usersDB.find({ username }).toArray()
  if (exists.length) {
    auditSecurity('register_failed', {
      result: 'rejected',
      reason: 'username_exists',
      username,
      email,
      actor
    })

    return {
      code: 201,
      msg: '账号已存在',
      data: {}
    }
  }

  const emailExists = await usersDB.find({ email }).toArray()
  if (emailExists.length) {
    auditSecurity('register_failed', {
      result: 'rejected',
      reason: 'email_exists',
      username,
      email,
      actor
    })

    return {
      code: 201,
      msg: '邮箱已存在',
      data: {}
    }
  }

  const verifyResult = await verifyEmailCode(db, {
    email,
    code: event.email_code || '',
    scene: 'register'
  })
  if (!verifyResult.valid) {
    auditSecurity('register_failed', {
      result: 'rejected',
      reason: verifyResult.message,
      username,
      email,
      actor
    })

    return {
      code: 201,
      msg: verifyResult.message,
      data: {}
    }
  }

  const pwd = md5(key + password)
  await usersDB.insertOne({
    username,
    email,
    password: pwd,
    token: '',
    create_date: t,
    register_date: t,
    nickname: username,
    status: 0
  })

  auditSecurity('register_succeeded', {
    result: 'success',
    username,
    email,
    actor
  })

  return {
    code: 200,
    msg: '注册成功',
    data: {
      username
    }
  }
}
