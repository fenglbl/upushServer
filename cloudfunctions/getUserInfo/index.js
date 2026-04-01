'use strict';

const uniCloud = require('../../db/index.js')

exports.main = async (event) => {
  const db = uniCloud.database()
  const tokenDB = db.collection('token')
  const usersDB = db.collection('uni-id-users')
  const token = event.token || ''

  if (!token) {
    return {
      code: 202,
      msg: '请先登录',
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
  const userInfo = await usersDB.find({ _id: userId }).toArray()
  const user = userInfo[0]

  if (!user) {
    return {
      code: 201,
      msg: '用户不存在',
      data: {}
    }
  }

  return {
    code: 200,
    msg: '获取成功',
    data: {
      id: user._id,
      username: user.username,
      nickname: user.nickname,
      email: user.email || '',
      token: user.token || token
    }
  }
}
