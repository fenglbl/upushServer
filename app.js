require('dotenv').config()

const path = require('path')
const fs = require('fs')
const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')
const db = require('./db/index.js')
const createPushMessageRouter = require('./routes/pushMessage')
const createCloudfunctionRouter = require('./routes/cloudfunction')

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
app.use('/pushMessage', createPushMessageRouter({ cloudfunctions }))
app.use('/cloudfunction', createCloudfunctionRouter({ cloudfunctions }))

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

app.listen(port, () => {
  console.log(`[startup] upushServer listening on port ${port}`)
})
