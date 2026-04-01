const axios = require('axios');
const crypto = require('crypto');

const fs = require('fs');
const path = require('path');

// 配置文件路径
const TOKEN_CACHE_PATH = path.join(__dirname, 'getui_token_cache.json');

function trimTrailingSlash(value) {
  return value ? value.replace(/\/+$/, '') : value;
}

const config = {
  appkey: process.env.GETUI_APPKEY,
  mastersecret: process.env.GETUI_MASTERSECRET,
  serverUrl: trimTrailingSlash(process.env.GETUI_SERVER_URL)
};

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
      const response = await axios.post(`${config.serverUrl}/auth`, {
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
        console.log('获取新token成功，过期时间:', new Date(parseInt(expire_time)));
        return token;
      } else {
        throw new Error(`获取token失败: ${response.data.msg}`);
      }
    } catch (error) {
      console.error('获取个推token出错:', error.message);
      // throw error;
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

async function sendMessage(pushData) {
  try {
    // 自动获取有效token
    const token = await geTui.getValidToken();
    
    const pushParams = {
      "request_id": Date.now().toString(),
      "audience": {
        "cid": [
          pushData.push_clientid
        ]
      },
      "push_message": {
        "notification": {
          "title":pushData.title || "",
          "body":pushData.content || "",
          "payload":pushData.payload ||  "",
          "click_type": "startapp",
          "channel_level": 4
        }
      }
    }
    console.log(pushParams);
    const response = await axios.post(
      `${config.serverUrl}/push/single/cid`,
      pushParams,
      {
        headers: {
          'Content-Type': 'application/json',
          'token': token
        }
      }
    );
    return response.data;
  } catch (error) {
    // 如果token过期错误(10001)，尝试刷新一次token
    if (error.response && error.response.data.code === 10001) {
      console.log('token过期，尝试刷新后重新发送');
      const newToken = await geTui.fetchNewToken();
      return sendMessage(pushData); // 递归重试
    }
    console.log(error.response.data);
    // throw error;
  }
}

module.exports = {
  sendMessage
}
