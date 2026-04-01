'use strict'

const CODE_EXPIRE_MINUTES = Number(process.env.EMAIL_CODE_EXPIRE_MINUTES || 5)
const EMAIL_CODE_SEND_COOLDOWN_SECONDS = Number(process.env.EMAIL_CODE_SEND_COOLDOWN_SECONDS || 60)
const EMAIL_CODE_SEND_WINDOW_MINUTES = Number(process.env.EMAIL_CODE_SEND_WINDOW_MINUTES || 10)
const EMAIL_CODE_SEND_MAX_PER_WINDOW = Number(process.env.EMAIL_CODE_SEND_MAX_PER_WINDOW || 5)

function createEmailCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

async function checkEmailCodeSendRateLimit(db, { email, scene }) {
  const emailCodeDB = db.collection('app_email_code')
  const now = Date.now()
  const cooldownStart = now - EMAIL_CODE_SEND_COOLDOWN_SECONDS * 1000
  const windowStart = now - EMAIL_CODE_SEND_WINDOW_MINUTES * 60 * 1000

  const latestList = await emailCodeDB.find({
    email,
    scene,
    create_date: { $gte: cooldownStart }
  }).sort({
    create_date: -1
  }).limit(1).toArray()

  if (latestList.length) {
    const retryAfterSeconds = Math.max(1, Math.ceil((latestList[0].create_date + EMAIL_CODE_SEND_COOLDOWN_SECONDS * 1000 - now) / 1000))

    return {
      allowed: false,
      message: `发送过于频繁，请 ${retryAfterSeconds} 秒后再试`,
      retryAfterSeconds
    }
  }

  const sentCount = await emailCodeDB.countDocuments({
    email,
    scene,
    create_date: { $gte: windowStart }
  })

  if (sentCount >= EMAIL_CODE_SEND_MAX_PER_WINDOW) {
    return {
      allowed: false,
      message: `该邮箱在 ${EMAIL_CODE_SEND_WINDOW_MINUTES} 分钟内请求次数过多，请稍后再试`,
      retryAfterSeconds: EMAIL_CODE_SEND_COOLDOWN_SECONDS
    }
  }

  return {
    allowed: true
  }
}

async function saveEmailCode(db, { email, code, scene }) {
  const emailCodeDB = db.collection('app_email_code')
  const now = Date.now()
  const expireTime = now + CODE_EXPIRE_MINUTES * 60 * 1000

  await emailCodeDB.updateMany({
    email,
    scene,
    status: 1,
    used: 0
  }, {
    $set: {
      status: 0,
      update_date: now
    }
  })

  await emailCodeDB.insertOne({
    email,
    scene,
    code,
    status: 1,
    used: 0,
    expire_time: expireTime,
    create_date: now,
    update_date: now
  })

  return {
    expireTime
  }
}

async function verifyEmailCode(db, { email, code, scene }) {
  const emailCodeDB = db.collection('app_email_code')
  const now = Date.now()
  const list = await emailCodeDB.find({
    email,
    scene,
    code,
    status: 1,
    used: 0
  }).sort({
    create_date: -1
  }).limit(1).toArray()

  if (!list.length) {
    return {
      valid: false,
      message: '邮箱验证码不正确'
    }
  }

  const record = list[0]
  if (record.expire_time < now) {
    await emailCodeDB.updateOne({ _id: record._id }, {
      $set: {
        status: 0,
        update_date: now
      }
    })

    return {
      valid: false,
      message: '邮箱验证码已过期'
    }
  }

  await emailCodeDB.updateOne({ _id: record._id }, {
    $set: {
      used: 1,
      update_date: now
    }
  })

  return {
    valid: true
  }
}

module.exports = {
  CODE_EXPIRE_MINUTES,
  EMAIL_CODE_SEND_COOLDOWN_SECONDS,
  EMAIL_CODE_SEND_WINDOW_MINUTES,
  EMAIL_CODE_SEND_MAX_PER_WINDOW,
  createEmailCode,
  checkEmailCodeSendRateLimit,
  saveEmailCode,
  verifyEmailCode
}
