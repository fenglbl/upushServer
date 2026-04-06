const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger')

const fs = require('fs');
const path = require('path');

// 配置文件路径
const TOKEN_CACHE_PATH = path.join(__dirname, 'getui_token_cache.json');

function trimTrailingSlash(value) {
  return value ? value.replace(/\/+$/, '') : value;
}

function normalizeHttpsUrl(value) {
  const text = trimTrailingSlash(String(value || '').trim())
  if (!text) return text
  if (/^https:\/\//i.test(text)) return text
  if (/^http:\/\//i.test(text)) return `https://${text.replace(/^http:\/\//i, '')}`
  return `https://${text.replace(/^\/+/, '')}`
}

const config = {
  appkey: process.env.GETUI_APPKEY,
  mastersecret: process.env.GETUI_MASTERSECRET,
  serverUrl: normalizeHttpsUrl(process.env.GETUI_SERVER_URL)
};

const http = axios.create({
  timeout: 15000,
  proxy: false
})

function validateConfig() {
  const missingKeys = [];

  if (!config.appkey) missingKeys.push('GETUI_APPKEY');
  if (!config.mastersecret) missingKeys.push('GETUI_MASTERSECRET');
  if (!config.serverUrl) missingKeys.push('GETUI_SERVER_URL');

  if (missingKeys.length) {
    throw new Error(`缺少个推环境变量: ${missingKeys.join(', ')}`);
  }
}

function getSign(appkey,timestamp,mastersecret){
  return crypto
    .createHash('sha256')
    .update(appkey + timestamp + mastersecret)
    .digest('hex');
}

class GeTui {
  constructor(){
    this.token = null;
    this.expireTime = 0;
    this.loadTokenCache();
  }
  
  /**
   * 从本地加载缓存的token
   */
  loadTokenCache() {
    try {
      if (fs.existsSync(TOKEN_CACHE_PATH)) {
        const cache = JSON.parse(fs.readFileSync(TOKEN_CACHE_PATH, 'utf-8'));
        if (cache.token && cache.expireTime > Date.now()) {
          this.token = cache.token;
          this.expireTime = cache.expireTime;
          console.log('从缓存加载token成功');
        }
      }
    } catch (err) {
      console.error('加载token缓存失败:', err.message);
    }
  }
  /**
   * 保存token到本地
   */
  saveTokenCache(token, expireTime) {
    this.token = token;
    this.expireTime = expireTime;
    
    fs.writeFileSync(
      TOKEN_CACHE_PATH,
      JSON.stringify({ token, expireTime }),
      'utf-8'
    );
  }
  
  /**
   * 获取有效token（自动判断是否需要刷新）
   */
  async getValidToken() {
    // 如果token存在且未过期（提前5分钟刷新）
    if (this.token && this.expireTime > Date.now() + 300000) {
      return this.token;
    }
    
    // 否则获取新token
    return await this.fetchNewToken();
  }
  
  /**
   * 从个推服务器获取新token
   */
  async fetchNewToken() {
    validateConfig();
    const timestamp = Date.now();
    const sign = getSign(config.appkey,timestamp,config.mastersecret)

    try {
      const response = await http.post(`${config.serverUrl}/auth`, {
        appkey: config.appkey,
        sign: sign,
        timestamp: timestamp
      }, {
        headers: {
          'Content-Type': 'application/json;charset=utf-8'
        }
      });

      if (response.data.code === 0) {
        const { token, expire_time } = response.data.data;
        this.saveTokenCache(token, parseInt(expire_time));
        logger.info('getui token refreshed', {
          expireTime: parseInt(expire_time)
        })
        return token;
      }

      throw new Error(`获取token失败: ${response.data.msg}`);
    } catch (error) {
      logger.error('getui token fetch failed', error, {
        serverUrl: config.serverUrl
      })
      throw error;
    }
  }
}



// 使用示例
// getGeTuiToken()
//   .then(({ token, expireTime }) => {
//     console.log('获取到的token:', token);
//     console.log('过期时间:', new Date(parseInt(expireTime)));
//   })
//   .catch();
const geTui = new GeTui()

function normalizeNotificationPayload(payload) {
  if (payload == null) return ''
  if (typeof payload === 'string') return payload

  try {
    return JSON.stringify(payload)
  } catch (error) {
    logger.warn('getui payload stringify failed, fallback to empty string', {
      errorMessage: error.message
    })
    return ''
  }
}

function normalizeNotificationBody(content, maxLength = 200) {
  if (content == null) return ''

  const text = String(content)
  if (text.length <= maxLength) {
    return text
  }

  return text.slice(0, maxLength)
}

function normalizeNotificationTitle(title, maxLength = 100) {
  if (title == null) return ''

  const text = String(title)
  if (text.length <= maxLength) {
    return text
  }

  return text.slice(0, maxLength)
}

async function sendMessage(pushData, options = {}) {
  const retryOnTokenExpired = options.retryOnTokenExpired !== false

  try {
    const token = await geTui.getValidToken()

    const notificationPayload = normalizeNotificationPayload(pushData.payload)
    const notificationBody = normalizeNotificationBody(pushData.content)
    const notificationTitle = normalizeNotificationTitle(pushData.title)

    if (String(pushData.title || '').length > notificationTitle.length) {
      logger.warn('getui notification title truncated', {
        pushClientId: pushData.push_clientid,
        originalLength: String(pushData.title || '').length,
        truncatedLength: notificationTitle.length
      })
    }

    if (String(pushData.content || '').length > notificationBody.length) {
      logger.warn('getui notification body truncated', {
        pushClientId: pushData.push_clientid,
        originalLength: String(pushData.content || '').length,
        truncatedLength: notificationBody.length
      })
    }

    const pushParams = {
      request_id: Date.now().toString(),
      audience: {
        cid: [pushData.push_clientid]
      },
      push_message: {
        notification: {
          title: notificationTitle,
          body: notificationBody,
          payload: notificationPayload,
          click_type: 'startapp',
          channel_level: 4
        }
      }
    }
    const response = await http.post(
      `${config.serverUrl}/push/single/cid`,
      pushParams,
      {
        headers: {
          'Content-Type': 'application/json',
          token
        }
      }
    )

    logger.info('getui push request succeeded', {
      pushClientId: pushData.push_clientid,
      requestId: pushParams.request_id,
      code: response.data && response.data.code,
      msg: response.data && response.data.msg
    })

    return response.data
  } catch (error) {
    const responseCode = error.response && error.response.data && error.response.data.code

    if (retryOnTokenExpired && responseCode === 10001) {
      logger.warn('getui token expired, retrying push once', {
        pushClientId: pushData.push_clientid
      })
      await geTui.fetchNewToken()
      return sendMessage(pushData, { retryOnTokenExpired: false })
    }

    logger.error('getui push request failed', error, {
      pushClientId: pushData.push_clientid,
      responseData: error.response && error.response.data ? error.response.data : null
    })
    throw error
  }
}

module.exports = {
  sendMessage
}
