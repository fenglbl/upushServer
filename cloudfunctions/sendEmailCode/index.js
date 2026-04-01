'use strict'

const { Resend } = require('resend')
const uniCloud = require('../../db/index.js')
const {
  CODE_EXPIRE_MINUTES,
  createEmailCode,
  checkEmailCodeSendRateLimit,
  saveEmailCode
} = require('../../utils/emailCode.js')

const ALLOWED_SCENES = new Set(['register', 'update_email', 'verify_old_email', 'verify_new_email'])

exports.main = async (event) => {
  const db = uniCloud.database()
  const email = (event.email || '').trim().toLowerCase()
  const scene = (event.scene || 'register').trim()

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

  if (!ALLOWED_SCENES.has(scene)) {
    return {
      code: 201,
      msg: '不支持的验证码场景',
      data: {}
    }
  }

  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    return {
      code: 201,
      msg: '邮件服务未配置',
      data: {}
    }
  }

  const rateLimitResult = await checkEmailCodeSendRateLimit(db, { email, scene })
  if (!rateLimitResult.allowed) {
    return {
      code: 429,
      msg: rateLimitResult.message,
      data: {
        email,
        scene,
        retryAfterSeconds: rateLimitResult.retryAfterSeconds || 0
      }
    }
  }

  const code = createEmailCode()
  await saveEmailCode(db, { email, code, scene })

  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to: email,
    subject: 'UPUSH 邮箱验证码',
    html: `<div><h2>UPUSH 邮箱验证码</h2><p>你的验证码是：<strong style="font-size:20px;">${code}</strong></p><p>验证码 ${CODE_EXPIRE_MINUTES} 分钟内有效。</p></div>`
  })

  return {
    code: 200,
    msg: '验证码已发送',
    data: {
      email,
      scene
    }
  }
}
