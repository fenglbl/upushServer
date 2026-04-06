'use strict';

const { requireAuthedUser } = require('../../utils/auth')

exports.main = async (event) => {
  const auth = await requireAuthedUser(event)
  if (!auth.ok) {
    return auth.response
  }

  const user = auth.user
  const token = auth.token

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
