'use strict';

const md5 = require('md5')
const uniCloud = require('../../db/index.js')
const { verifyEmailCode } = require('../../utils/emailCode.js')

exports.main = async (event) => {
  const db = uniCloud.database()
  const usersDB = db.collection('uni-id-users')
  const t = Date.now()
  const key = 'fenglbl.upush.'
  const username = (event.username || '').trim()
  const email = (event.email || '').trim().toLowerCase()
  const password = event.password || ''

  if (!username) {
    return {
      code: 201,
      msg: '账号不能为空',
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

  if (!email) {
    return {
      code: 201,
      msg: '邮箱不能为空',
      data: {}
    }
  }

  const emailReg = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
  if (!emailReg.test(email)) {
    return {
      code: 201,
      msg: '邮箱格式不正确',
      data: {}
    }
  }

  const exists = await usersDB.find({ username }).toArray()
  if (exists.length) {
    return {
      code: 201,
      msg: '账号已存在',
      data: {}
    }
  }

  const emailExists = await usersDB.find({ email }).toArray()
  if (emailExists.length) {
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

  return {
    code: 200,
    msg: '注册成功',
    data: {
      username
    }
  }
}
