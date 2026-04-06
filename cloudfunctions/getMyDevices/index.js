'use strict';
const uniCloud = require('../../db/index.js');
const { requireAuthedUser } = require('../../utils/auth')

function normalizePlatform(platform) {
  const value = String(platform || '').trim().toLowerCase()
  if (!value) return ''

  if (value === 'h5' || value === 'web') return 'H5'
  if (value === 'android') return 'Android'
  if (value === 'ios') return 'iOS'
  if (value === 'app' || value === 'app-plus' || value === 'app_plus') return 'App'
  if (value === 'mp-weixin' || value === 'weixin' || value === 'wechat' || value === 'wechat-miniprogram') return '微信小程序'
  if (value === 'windows') return 'Windows'
  if (value === 'mac' || value === 'macos' || value === 'darwin') return 'macOS'
  return String(platform || '').trim()
}

function normalizeDeviceItem(item) {
  if (!item || typeof item !== 'object') return item

  return {
    id: String(item._id || ''),
    userId: String(item.user_id || ''),
    deviceId: item.device_id || '',
    platform: normalizePlatform(item.platform),
    createDate: item.create_date || null,
    lastActiveDate: item.last_active_date || null,
    tokenExpired: typeof item.token_expired === 'boolean' ? item.token_expired : null
  }
}

exports.main = async (event) => {
  const db = uniCloud.database()
  const deviceDB = db.collection('uni-id-device')

  const auth = await requireAuthedUser(event)
  if (!auth.ok) {
    return auth.response
  }

  const list = await deviceDB.find({ user_id: auth.userId }, {
    projection: {
      user_id: 1,
      device_id: 1,
      platform: 1,
      create_date: 1,
      last_active_date: 1,
      token_expired: 1
    }
  }).sort({
    last_active_date: -1,
    create_date: -1
  }).toArray()

  return {
    code: 200,
    msg: '获取成功',
    data: {
      list: list.map(normalizeDeviceItem),
      total: list.length
    }
  }
}
