require('dotenv').config()

const path = require('path')
const fs = require('fs')
const http = require('http')
const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')
const db = require('./db/index.js')
const createPushMessageRouter = require('./routes/pushMessage')
const createCloudfunctionRouter = require('./routes/cloudfunction')
const WebSocketServerManager = require('./websocket')

// 云函数目录，服务启动时会自动扫描并加载每个云函数入口
const cloudfunctionsDir = path.join(__dirname, 'cloudfunctions')
const cloudfunctions = {}

fs.readdirSync(cloudfunctionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .forEach((entry) => {
    const functionName = entry.name
    const filePath = path.join(cloudfunctionsDir, functionName, 'index.js')
    cloudfunctions[functionName] = require(filePath)
    console.log(`[bootstrap] loaded cloud function: ${functionName}`)
  })

const app = express()
const port = Number(process.env.PORT || 3000)

app.use(cors())
app.use(bodyParser.json())

// 用原生 http server 承载 express，方便和 WebSocket 共用同一个 3000 端口
const server = http.createServer(app)

// 初始化 WebSocket 管理器：
// - 连接路径约定为 /ws/:id
// - 由 websocket/index.js 负责 upgrade 和连接管理
const wsServer = new WebSocketServerManager(server)

// 推送接口在推送成功后，会通过 wsServer 给对应 id 的客户端广播消息
app.use('/pushMessage', createPushMessageRouter({ cloudfunctions, wsServer }))

// 云函数统一入口
app.use('/cloudfunction', createCloudfunctionRouter({ cloudfunctions }))

// 健康检查接口：用于快速确认服务和数据库是否正常
app.get('/health', async (req, res) => {
  const database = await db.healthCheck()
  const appStatus = database.status === 'UP' ? 'UP' : 'DEGRADED'

  res.send({
    code: database.status === 'UP' ? 200 : 503,
    msg: database.status === 'UP' ? 'ok' : 'db error',
    data: {
      status: appStatus,
      timestamp: Date.now(),
      uptime: process.uptime(),
      env: process.env.NODE_ENV || 'development',
      database
    }
  })
})

// HTTP 与 WebSocket 共用同一个端口监听
server.listen(port, () => {
  console.log(`[startup] upushServer listening on port ${port}`)
  console.log(`[startup] websocket endpoint: ws://127.0.0.1:${port}/ws/:id`)
})
