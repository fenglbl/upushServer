const express = require('express')
const db = require('../../db')
const logger = require('../../utils/logger')

const RANGE_SET = new Set(['7d', '30d', '24h'])
const PUSH_BATCH_COLLECTION = 'admin-push-batches'
const ADMIN_SETTINGS_COLLECTION = 'admin-settings'
const ADMIN_SETTINGS_KEY = 'default'
const FEEDBACK_COLLECTION = 'app_feedback'
const AGREEMENT_COLLECTION = 'app_agreement'
const VERSION_COLLECTION = 'app_version'

function pad(num) {
  return String(num).padStart(2, '0')
}

function toDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function normalizeRange(value) {
  const next = String(value || '7d').trim().toLowerCase()
  return RANGE_SET.has(next) ? next : '7d'
}

function getDateRange(range) {
  const now = new Date()
  const dates = []

  if (range === '24h') {
    dates.push(toDateKey(now))
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    dates.push(toDateKey(yesterday))
    return dates
  }

  const days = range === '30d' ? 30 : 7
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    dates.push(toDateKey(date))
  }
  return dates
}

function getRangeStartMs(range) {
  const now = new Date()

  if (range === '24h') {
    return now.getTime() - 24 * 60 * 60 * 1000
  }

  const days = range === '30d' ? 30 : 7
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  return start.getTime()
}

function getTodayRange() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  return {
    startMs: start.getTime(),
    endMs: end.getTime()
  }
}

function createEmptyPoint(label) {
  return {
    label,
    total: 0,
    success: 0,
    failed: 0
  }
}

function isFailedStatus(status) {
  return ['failed', 'no_device'].includes(status)
}

function buildSummary(todayPushes) {
  const total = todayPushes.length
  const success = todayPushes.filter((item) => item.status === 'success').length
  const partial = todayPushes.filter((item) => item.status === 'partial').length
  const failed = todayPushes.filter((item) => isFailedStatus(item.status)).length
  const successRate = total ? Number(((success / total) * 100).toFixed(2)) : 0

  return {
    total,
    success,
    partial,
    failed,
    successRate
  }
}

function normalizeBatchRecord(doc) {
  const status = doc.status || 'unknown'
  const successCount = Number(doc.success_count || 0)
  const failureCount = Number(doc.failure_count || 0)
  const totalDevices = Number(doc.total_devices || 0)

  let summary = '状态未知'
  if (status === 'success') summary = '全部成功'
  else if (status === 'partial') summary = `部分失败（成功 ${successCount} / 失败 ${failureCount}）`
  else if (status === 'no_device') summary = '无可用设备'
  else if (status === 'failed') summary = '推送失败'

  return {
    id: String(doc._id || ''),
    title: doc.title || '未命名推送',
    createdAt: doc.create_time ? new Date(doc.create_time).toLocaleString('zh-CN', { hour12: false }) : '',
    createdAtMs: Number(doc.create_time || 0),
    resultCode: Number(doc.result_code || 0),
    totalDevices,
    successCount,
    failureCount,
    status,
    summary
  }
}

function buildErrorRecordFromBatch(doc) {
  const status = doc.status || 'unknown'
  const level = status === 'partial' || status === 'no_device' ? 'WARN' : 'ERROR'
  const title = doc.title || '未命名推送'
  const resultMsg = doc.result_msg || '推送异常'

  return {
    time: doc.create_time ? new Date(doc.create_time).toLocaleString('zh-CN', { hour12: false }) : '',
    level,
    message: `[${title}] ${resultMsg}`
  }
}

function buildTrend(range, statsMap) {
  const now = new Date()

  if (range === '24h') {
    const points = Array.from({ length: 24 }, (_, index) => {
      const hour = new Date(now)
      hour.setHours(now.getHours() - (23 - index), 0, 0, 0)
      const key = `${hour.getFullYear()}-${pad(hour.getMonth() + 1)}-${pad(hour.getDate())} ${pad(hour.getHours())}`
      return {
        key,
        point: {
          ...createEmptyPoint(`${pad(hour.getHours())}:00`),
          ...statsMap.get(key)
        }
      }
    })

    return {
      range,
      unit: 'hour',
      points: points.map((item) => item.point)
    }
  }

  const dates = getDateRange(range)
  return {
    range,
    unit: 'day',
    points: dates.map((dateKey) => ({
      ...createEmptyPoint(dateKey.slice(5)),
      ...statsMap.get(dateKey),
      label: dateKey.slice(5)
    }))
  }
}

async function queryTrend(batchCollection, range, startMs) {
  const format = range === '24h' ? '%Y-%m-%d %H' : '%Y-%m-%d'
  const rows = await batchCollection.aggregate([
    {
      $match: {
        create_time: { $gte: startMs }
      }
    },
    {
      $project: {
        bucket: {
          $dateToString: {
            format,
            date: { $toDate: '$create_time' },
            timezone: 'Asia/Shanghai'
          }
        },
        status: 1
      }
    },
    {
      $group: {
        _id: '$bucket',
        total: { $sum: 1 },
        success: {
          $sum: {
            $cond: [{ $eq: ['$status', 'success'] }, 1, 0]
          }
        },
        failed: {
          $sum: {
            $cond: [{ $in: ['$status', ['failed', 'no_device']] }, 1, 0]
          }
        }
      }
    }
  ]).toArray()

  const statsMap = new Map(
    rows.map((item) => [
      item._id,
      {
        label: range === '24h' ? `${item._id.slice(-2)}:00` : item._id.slice(5),
        total: Number(item.total || 0),
        success: Number(item.success || 0),
        failed: Number(item.failed || 0)
      }
    ])
  )

  return buildTrend(range, statsMap)
}

function normalizePagination(req) {
  const page = Math.max(1, Number(req.query.page || 1) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20) || 20))
  return { page, pageSize }
}

function normalizeKeyword(value) {
  return String(value || '').trim()
}

function normalizeStatus(value) {
  const status = String(value || 'all').trim().toLowerCase()
  const allow = new Set(['all', 'success', 'partial', 'failed', 'no_device'])
  return allow.has(status) ? status : 'all'
}

function normalizeBatchDetail(doc) {
  if (!doc) return null

  return {
    id: String(doc._id || ''),
    userId: String(doc.user_id || ''),
    title: doc.title || '未命名推送',
    content: doc.content || '',
    payload: doc.payload || {},
    createTime: Number(doc.create_time || 0),
    createTimeText: doc.create_time ? new Date(doc.create_time).toLocaleString('zh-CN', { hour12: false }) : '',
    updatedAt: Number(doc.updated_at || 0),
    updatedAtText: doc.updated_at ? new Date(doc.updated_at).toLocaleString('zh-CN', { hour12: false }) : '',
    status: doc.status || 'unknown',
    resultCode: Number(doc.result_code || 0),
    resultMsg: doc.result_msg || '',
    totalDevices: Number(doc.total_devices || 0),
    successCount: Number(doc.success_count || 0),
    failureCount: Number(doc.failure_count || 0),
    ip: doc.ip || '',
    results: Array.isArray(doc.results) ? doc.results : []
  }
}

function buildBatchQuery(req) {
  const range = normalizeRange(req.query.range)
  const startMs = getRangeStartMs(range)
  const status = normalizeStatus(req.query.status)
  const keyword = normalizeKeyword(req.query.keyword)

  const query = {
    create_time: { $gte: startMs }
  }

  if (status !== 'all') {
    query.status = status
  }

  if (keyword) {
    query.$or = [
      { title: { $regex: keyword, $options: 'i' } },
      { content: { $regex: keyword, $options: 'i' } },
      { result_msg: { $regex: keyword, $options: 'i' } },
      { 'results.providerMsg': { $regex: keyword, $options: 'i' } },
      { 'results.error': { $regex: keyword, $options: 'i' } }
    ]
  }

  return {
    query,
    range,
    status,
    keyword
  }
}

function buildUserQuery(req) {
  const keyword = normalizeKeyword(req.query.keyword)
  const statusValue = String(req.query.status || 'all').trim().toLowerCase()
  const query = {}

  if (statusValue !== 'all' && statusValue !== '') {
    const parsedStatus = Number(statusValue)
    if (Number.isFinite(parsedStatus)) {
      query.status = parsedStatus
    }
  }

  if (keyword) {
    query.$or = [
      { username: { $regex: keyword, $options: 'i' } },
      { nickname: { $regex: keyword, $options: 'i' } },
      { email: { $regex: keyword, $options: 'i' } }
    ]
  }

  return {
    query,
    keyword,
    status: statusValue || 'all'
  }
}

function normalizeUserRecord(doc) {
  return {
    id: String(doc._id || ''),
    username: doc.username || '',
    nickname: doc.nickname || '',
    email: doc.email || '',
    status: Number(doc.status || 0),
    registerDate: Number(doc.register_date || 0),
    registerDateText: doc.register_date ? new Date(doc.register_date).toLocaleString('zh-CN', { hour12: false }) : '',
    lastLoginDate: Number(doc.last_login_date || 0),
    lastLoginDateText: doc.last_login_date ? new Date(doc.last_login_date).toLocaleString('zh-CN', { hour12: false }) : ''
  }
}

function normalizeDeviceRecord(doc) {
  return {
    id: String(doc._id || ''),
    userId: String(doc.user_id || ''),
    deviceId: doc.device_id || '',
    platform: doc.platform || '',
    createDate: Number(doc.create_date || 0),
    createDateText: doc.create_date ? new Date(doc.create_date).toLocaleString('zh-CN', { hour12: false }) : '',
    lastActiveDate: Number(doc.last_active_date || 0),
    lastActiveDateText: doc.last_active_date ? new Date(doc.last_active_date).toLocaleString('zh-CN', { hour12: false }) : '',
    tokenExpired: typeof doc.token_expired === 'boolean' ? doc.token_expired : null
  }
}

function normalizeUserStatusInput(value) {
  const next = Number(value)
  if (!Number.isFinite(next)) return null
  return next === 0 || next === 1 ? next : null
}

function buildDeviceQuery(req) {
  const keyword = normalizeKeyword(req.query.keyword)
  const userId = normalizeKeyword(req.query.userId)
  const query = {}

  if (userId) {
    const values = [userId]
    try {
      values.push(new db.ObjectId(userId))
    } catch (error) {
      // ignore invalid object id
    }
    query.user_id = { $in: values }
  }

  if (keyword) {
    query.$or = [
      { device_id: { $regex: keyword, $options: 'i' } },
      { platform: { $regex: keyword, $options: 'i' } }
    ]
  }

  return {
    query,
    keyword,
    userId
  }
}

function createDefaultAdminSettings() {
  return {
    push: {
      defaultRange: '7d',
      defaultTargetMode: 'user',
      defaultPayloadTemplate: 'default',
      autoOpenBatchDetail: true
    },
    logs: {
      defaultLevel: '',
      defaultLimit: 100,
      defaultOrder: 'desc',
      keepQueryInUrl: true
    },
    ui: {
      appName: 'UPUSH Admin',
      theme: 'light',
      showQuickActions: true,
      compactTable: false
    }
  }
}

function normalizeAdminSettingsPayload(payload) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload
    : {}

  const push = source.push && typeof source.push === 'object' && !Array.isArray(source.push)
    ? source.push
    : {}
  const logs = source.logs && typeof source.logs === 'object' && !Array.isArray(source.logs)
    ? source.logs
    : {}
  const ui = source.ui && typeof source.ui === 'object' && !Array.isArray(source.ui)
    ? source.ui
    : {}

  const range = normalizeRange(push.defaultRange)
  const targetMode = ['user', 'group', 'all'].includes(String(push.defaultTargetMode || '').trim())
    ? String(push.defaultTargetMode).trim()
    : 'user'
  const payloadTemplate = ['default', 'simple', 'system_notice'].includes(String(push.defaultPayloadTemplate || '').trim())
    ? String(push.defaultPayloadTemplate).trim()
    : 'default'

  const level = ['', 'INFO', 'WARN', 'ERROR'].includes(String(logs.defaultLevel || '').trim().toUpperCase())
    ? String(logs.defaultLevel || '').trim().toUpperCase()
    : ''
  const limit = Math.min(500, Math.max(1, Number(logs.defaultLimit || 100) || 100))
  const order = String(logs.defaultOrder || 'desc').trim().toLowerCase() === 'asc' ? 'asc' : 'desc'

  const theme = ['light', 'dark', 'system'].includes(String(ui.theme || '').trim().toLowerCase())
    ? String(ui.theme).trim().toLowerCase()
    : 'light'
  const appName = String(ui.appName || 'UPUSH Admin').trim() || 'UPUSH Admin'

  return {
    push: {
      defaultRange: range,
      defaultTargetMode: targetMode,
      defaultPayloadTemplate: payloadTemplate,
      autoOpenBatchDetail: Boolean(push.autoOpenBatchDetail)
    },
    logs: {
      defaultLevel: level,
      defaultLimit: limit,
      defaultOrder: order,
      keepQueryInUrl: Boolean(logs.keepQueryInUrl)
    },
    ui: {
      appName,
      theme,
      showQuickActions: Boolean(ui.showQuickActions),
      compactTable: Boolean(ui.compactTable)
    }
  }
}

function normalizeAdminSettingsDoc(doc) {
  const defaults = createDefaultAdminSettings()
  const normalized = normalizeAdminSettingsPayload(doc || defaults)

  return {
    ...normalized,
    meta: {
      key: String(doc?.key || ADMIN_SETTINGS_KEY),
      updatedAt: Number(doc?.updated_at || 0),
      updatedAtText: doc?.updated_at ? new Date(doc.updated_at).toLocaleString('zh-CN', { hour12: false }) : '',
      createdAt: Number(doc?.create_time || 0),
      createdAtText: doc?.create_time ? new Date(doc.create_time).toLocaleString('zh-CN', { hour12: false }) : ''
    }
  }
}

async function getOrCreateAdminSettings(collection) {
  let doc = await collection.findOne({ key: ADMIN_SETTINGS_KEY })

  if (!doc) {
    const now = Date.now()
    const settings = createDefaultAdminSettings()
    doc = {
      key: ADMIN_SETTINGS_KEY,
      ...settings,
      create_time: now,
      updated_at: now
    }
    await collection.insertOne(doc)
  }

  return doc
}

function normalizeReplyStatus(value) {
  const num = Number(value)
  return num === 1 ? 1 : 0
}

function normalizeFeedbackType(value) {
  const type = String(value || 'all').trim().toLowerCase()
  const allow = new Set(['all', 'bug', 'suggestion', 'other'])
  return allow.has(type) ? type : 'all'
}

function normalizeFeedbackRecord(doc) {
  return {
    id: String(doc._id || ''),
    type: doc.type || 'other',
    contact: doc.contact || '',
    content: doc.content || '',
    screenshots: Array.isArray(doc.screenshots) ? doc.screenshots : [],
    replyStatus: Number(doc.reply_status || 0),
    replyContent: doc.reply_content || '',
    replyTime: Number(doc.reply_time || 0),
    replyTimeText: doc.reply_time ? new Date(doc.reply_time).toLocaleString('zh-CN', { hour12: false }) : '',
    status: Number(doc.status || 0),
    createDate: Number(doc.create_date || 0),
    createDateText: doc.create_date ? new Date(doc.create_date).toLocaleString('zh-CN', { hour12: false }) : ''
  }
}

function buildFeedbackQuery(req) {
  const keyword = normalizeKeyword(req.query.keyword)
  const type = normalizeFeedbackType(req.query.type)
  const replyStatus = String(req.query.replyStatus || 'all').trim().toLowerCase()
  const query = {
    status: 1
  }

  if (type !== 'all') {
    query.type = type
  }

  if (replyStatus !== 'all' && replyStatus !== '') {
    const parsed = Number(replyStatus)
    if (parsed === 0 || parsed === 1) {
      query.reply_status = parsed
    }
  }

  if (keyword) {
    query.$or = [
      { content: { $regex: keyword, $options: 'i' } },
      { contact: { $regex: keyword, $options: 'i' } },
      { reply_content: { $regex: keyword, $options: 'i' } }
    ]
  }

  return {
    query,
    keyword,
    type,
    replyStatus: replyStatus || 'all'
  }
}

function normalizeAgreementStatus(value) {
  const num = Number(value)
  return num === 1 ? 1 : 0
}

function normalizeAgreementId(value) {
  const next = String(value || '').trim().toLowerCase()
  return next
}

function normalizeAgreementRecord(doc) {
  return {
    id: String(doc._id || ''),
    agreementId: doc.agreement_id || '',
    title: doc.title || '',
    content: doc.content || '',
    publishTime: Number(doc.publish_time || 0),
    publishTimeText: doc.publish_time ? new Date(doc.publish_time).toLocaleString('zh-CN', { hour12: false }) : '',
    status: Number(doc.status || 0),
    createDate: Number(doc.create_date || 0),
    createDateText: doc.create_date ? new Date(doc.create_date).toLocaleString('zh-CN', { hour12: false }) : '',
    updateTime: Number(doc.update_time || 0),
    updateTimeText: doc.update_time ? new Date(doc.update_time).toLocaleString('zh-CN', { hour12: false }) : ''
  }
}

function buildAgreementQuery(req) {
  const keyword = normalizeKeyword(req.query.keyword)
  const agreementId = normalizeAgreementId(req.query.agreementId || req.query.agreement_id)
  const statusValue = String(req.query.status || 'all').trim().toLowerCase()
  const query = {}

  if (agreementId && agreementId !== 'all') {
    query.agreement_id = agreementId
  }

  if (statusValue !== 'all' && statusValue !== '') {
    const parsed = Number(statusValue)
    if (parsed === 0 || parsed === 1) {
      query.status = parsed
    }
  }

  if (keyword) {
    query.$or = [
      { title: { $regex: keyword, $options: 'i' } },
      { content: { $regex: keyword, $options: 'i' } },
      { agreement_id: { $regex: keyword, $options: 'i' } }
    ]
  }

  return {
    query,
    keyword,
    agreementId: agreementId || 'all',
    status: statusValue || 'all'
  }
}

function normalizeVersionStatus(value) {
  const num = Number(value)
  return num === 1 ? 1 : 0
}

function normalizeVersionPlatform(value) {
  const next = String(value || 'app').trim().toLowerCase()
  return next || 'app'
}

function normalizeVersionRecord(doc) {
  return {
    id: String(doc._id || ''),
    platform: doc.platform || 'app',
    versionName: doc.version_name || '',
    versionCode: Number(doc.version_code || 0),
    status: Number(doc.status || 0),
    forceUpdate: !!doc.force_update,
    downloadUrl: doc.download_url || '',
    notes: doc.notes || '',
    createDate: Number(doc.create_date || 0),
    createDateText: doc.create_date ? new Date(doc.create_date).toLocaleString('zh-CN', { hour12: false }) : '',
    updateTime: Number(doc.update_time || 0),
    updateTimeText: doc.update_time ? new Date(doc.update_time).toLocaleString('zh-CN', { hour12: false }) : '',
    publishTime: Number(doc.publish_time || 0),
    publishTimeText: doc.publish_time ? new Date(doc.publish_time).toLocaleString('zh-CN', { hour12: false }) : ''
  }
}

function buildVersionQuery(req) {
  const keyword = normalizeKeyword(req.query.keyword)
  const platform = normalizeVersionPlatform(req.query.platform)
  const statusValue = String(req.query.status || 'all').trim().toLowerCase()
  const query = {}

  if (platform && platform !== 'all') {
    query.platform = platform
  }

  if (statusValue !== 'all' && statusValue !== '') {
    const parsed = Number(statusValue)
    if (parsed === 0 || parsed === 1) {
      query.status = parsed
    }
  }

  if (keyword) {
    query.$or = [
      { version_name: { $regex: keyword, $options: 'i' } },
      { notes: { $regex: keyword, $options: 'i' } },
      { download_url: { $regex: keyword, $options: 'i' } }
    ]
  }

  return {
    query,
    keyword,
    platform: platform || 'all',
    status: statusValue || 'all'
  }
}

function createAdminRouter() {
  const router = express.Router()

  router.get('/dashboard', async (req, res) => {
    const range = normalizeRange(req.query.range)
    const startMs = getRangeStartMs(range)

    try {
      const database = db.database()
      const batchCollection = database.collection(PUSH_BATCH_COLLECTION)

      const recentDocs = await batchCollection.find({
        create_time: { $gte: startMs }
      })
        .sort({ create_time: -1 })
        .limit(10)
        .toArray()

      const rangeSummaryDocs = await batchCollection.find({
        create_time: { $gte: startMs }
      }, {
        projection: {
          status: 1
        }
      }).toArray()

      const errorDocs = await batchCollection.find({
        create_time: { $gte: startMs },
        status: { $in: ['failed', 'partial', 'no_device'] }
      })
        .sort({ create_time: -1 })
        .limit(10)
        .toArray()

      const recentPushes = recentDocs.map(normalizeBatchRecord)
      const rangeSummaryPushes = rangeSummaryDocs.map(normalizeBatchRecord)
      const recentErrors = errorDocs.map(buildErrorRecordFromBatch)
      const trend = await queryTrend(batchCollection, range, startMs)

      res.send({
        code: 200,
        msg: 'ok',
        data: {
          summary: buildSummary(rangeSummaryPushes),
          trend,
          recentPushes,
          recentErrors,
          meta: {
            generatedAt: new Date().toISOString(),
            range,
            rangeOptions: ['7d', '30d', '24h'],
            source: 'mongodb:admin-push-batches'
          }
        }
      })
    } catch (error) {
      logger.error('admin dashboard query failed', error, {
        range,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: 'dashboard 查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.get('/push-batches', async (req, res) => {
    const { page, pageSize } = normalizePagination(req)
    const { query, range, status, keyword } = buildBatchQuery(req)

    try {
      const database = db.database()
      const batchCollection = database.collection(PUSH_BATCH_COLLECTION)

      const [total, docs] = await Promise.all([
        batchCollection.countDocuments(query),
        batchCollection.find(query)
          .sort({ create_time: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .toArray()
      ])

      res.send({
        code: 200,
        msg: 'ok',
        data: {
          list: docs.map(normalizeBatchRecord),
          total,
          page,
          pageSize,
          meta: {
            range,
            status,
            keyword
          }
        }
      })
    } catch (error) {
      logger.error('admin push batches query failed', error, {
        query,
        page,
        pageSize,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '推送批次查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.get('/push-batches/:id', async (req, res) => {
    const id = String(req.params.id || '').trim()

    if (!id) {
      res.status(400).send({
        code: 400,
        msg: 'id 不能为空'
      })
      return
    }

    let objectId
    try {
      objectId = new db.ObjectId(id)
    } catch (error) {
      res.status(400).send({
        code: 400,
        msg: 'id 格式错误'
      })
      return
    }

    try {
      const database = db.database()
      const batchCollection = database.collection(PUSH_BATCH_COLLECTION)
      const doc = await batchCollection.findOne({ _id: objectId })

      if (!doc) {
        res.status(404).send({
          code: 404,
          msg: '批次不存在'
        })
        return
      }

      res.send({
        code: 200,
        msg: 'ok',
        data: normalizeBatchDetail(doc)
      })
    } catch (error) {
      logger.error('admin push batch detail query failed', error, {
        id,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '推送批次详情查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.get('/users', async (req, res) => {
    const { page, pageSize } = normalizePagination(req)
    const { query, keyword, status } = buildUserQuery(req)

    try {
      const database = db.database()
      const collection = database.collection('uni-id-users')

      const [total, docs] = await Promise.all([
        collection.countDocuments(query),
        collection.find(query, {
          projection: {
            username: 1,
            nickname: 1,
            email: 1,
            status: 1,
            register_date: 1,
            last_login_date: 1
          }
        })
          .sort({ register_date: -1, _id: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .toArray()
      ])

      res.send({
        code: 200,
        msg: 'ok',
        data: {
          list: docs.map(normalizeUserRecord),
          total,
          page,
          pageSize,
          meta: {
            keyword,
            status
          }
        }
      })
    } catch (error) {
      logger.error('admin users query failed', error, {
        query,
        page,
        pageSize,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '用户列表查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.get('/users/:id', async (req, res) => {
    const id = String(req.params.id || '').trim()
    if (!id) {
      res.status(400).send({ code: 400, msg: 'id 不能为空' })
      return
    }

    let objectId
    try {
      objectId = new db.ObjectId(id)
    } catch (error) {
      res.status(400).send({ code: 400, msg: 'id 格式错误' })
      return
    }

    try {
      const database = db.database()
      const userCollection = database.collection('uni-id-users')
      const deviceCollection = database.collection('uni-id-device')

      const [userDoc, deviceCount] = await Promise.all([
        userCollection.findOne({ _id: objectId }, {
          projection: {
            username: 1,
            nickname: 1,
            email: 1,
            status: 1,
            register_date: 1,
            last_login_date: 1
          }
        }),
        deviceCollection.countDocuments({
          user_id: { $in: [id, objectId] }
        })
      ])

      if (!userDoc) {
        res.status(404).send({ code: 404, msg: '用户不存在' })
        return
      }

      res.send({
        code: 200,
        msg: 'ok',
        data: {
          ...normalizeUserRecord(userDoc),
          deviceCount
        }
      })
    } catch (error) {
      logger.error('admin user detail query failed', error, {
        id,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '用户详情查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.post('/users/:id/status', async (req, res) => {
    const id = String(req.params.id || '').trim()
    if (!id) {
      res.status(400).send({ code: 400, msg: 'id 不能为空' })
      return
    }

    let objectId
    try {
      objectId = new db.ObjectId(id)
    } catch (error) {
      res.status(400).send({ code: 400, msg: 'id 格式错误' })
      return
    }

    const status = normalizeUserStatusInput(req.body?.status)
    if (status === null) {
      res.status(400).send({ code: 400, msg: 'status 仅支持 0 或 1' })
      return
    }

    try {
      const database = db.database()
      const userCollection = database.collection('uni-id-users')
      const deviceCollection = database.collection('uni-id-device')
      const now = Date.now()

      const current = await userCollection.findOne({ _id: objectId }, {
        projection: {
          username: 1,
          nickname: 1,
          email: 1,
          status: 1,
          register_date: 1,
          last_login_date: 1
        }
      })

      if (!current) {
        res.status(404).send({ code: 404, msg: '用户不存在' })
        return
      }

      await userCollection.updateOne(
        { _id: objectId },
        {
          $set: {
            status,
            updated_at: now
          }
        }
      )

      const [updated, deviceCount] = await Promise.all([
        userCollection.findOne({ _id: objectId }, {
          projection: {
            username: 1,
            nickname: 1,
            email: 1,
            status: 1,
            register_date: 1,
            last_login_date: 1
          }
        }),
        deviceCollection.countDocuments({
          user_id: { $in: [id, objectId] }
        })
      ])

      logger.info('admin user status updated', {
        userId: id,
        previousStatus: Number(current.status || 0),
        nextStatus: status,
        path: req.originalUrl || req.url
      })

      res.send({
        code: 200,
        msg: 'ok',
        data: {
          ...normalizeUserRecord(updated || current),
          deviceCount
        }
      })
    } catch (error) {
      logger.error('admin user status update failed', error, {
        id,
        status,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '用户状态更新失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.get('/devices', async (req, res) => {
    const { page, pageSize } = normalizePagination(req)
    const { query, keyword, userId } = buildDeviceQuery(req)

    try {
      const database = db.database()
      const collection = database.collection('uni-id-device')
      const docs = await collection.find(query, {
        projection: {
          user_id: 1,
          device_id: 1,
          platform: 1,
          create_date: 1,
          last_active_date: 1,
          token_expired: 1
        }
      })
        .sort({ create_date: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray()

      const total = await collection.countDocuments(query)
      const userIds = Array.from(new Set(docs.map((item) => String(item.user_id || '')).filter(Boolean)))
      const userDocs = userIds.length
        ? await database.collection('uni-id-users').find({ _id: { $in: userIds.map((item) => new db.ObjectId(item)) } }, { projection: { username: 1, nickname: 1, email: 1 } }).toArray()
        : []
      const userMap = new Map(userDocs.map((item) => [String(item._id), item]))

      res.send({
        code: 200,
        msg: 'ok',
        data: {
          list: docs.map((item) => {
            const normalized = normalizeDeviceRecord(item)
            const user = userMap.get(normalized.userId)
            return {
              ...normalized,
              user: user ? {
                id: String(user._id),
                username: user.username || '',
                nickname: user.nickname || '',
                email: user.email || ''
              } : null
            }
          }),
          total,
          page,
          pageSize,
          meta: {
            keyword,
            userId
          }
        }
      })
    } catch (error) {
      logger.error('admin devices query failed', error, {
        query,
        page,
        pageSize,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '设备列表查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.get('/devices/:id', async (req, res) => {
    const id = String(req.params.id || '').trim()
    if (!id) {
      res.status(400).send({ code: 400, msg: 'id 不能为空' })
      return
    }

    let objectId
    try {
      objectId = new db.ObjectId(id)
    } catch (error) {
      res.status(400).send({ code: 400, msg: 'id 格式错误' })
      return
    }

    try {
      const database = db.database()
      const deviceCollection = database.collection('uni-id-device')
      const doc = await deviceCollection.findOne({ _id: objectId }, {
        projection: {
          user_id: 1,
          device_id: 1,
          platform: 1,
          create_date: 1,
          last_active_date: 1,
          token_expired: 1
        }
      })

      if (!doc) {
        res.status(404).send({ code: 404, msg: '设备不存在' })
        return
      }

      let user = null
      const uid = String(doc.user_id || '')
      if (uid) {
        try {
          const userDoc = await database.collection('uni-id-users').findOne({ _id: new db.ObjectId(uid) }, { projection: { username: 1, nickname: 1, email: 1 } })
          if (userDoc) {
            user = {
              id: String(userDoc._id),
              username: userDoc.username || '',
              nickname: userDoc.nickname || '',
              email: userDoc.email || ''
            }
          }
        } catch (error) {
          user = null
        }
      }

      res.send({
        code: 200,
        msg: 'ok',
        data: {
          ...normalizeDeviceRecord(doc),
          user
        }
      })
    } catch (error) {
      logger.error('admin device detail query failed', error, {
        id,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '设备详情查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.delete('/devices/:id', async (req, res) => {
    const id = String(req.params.id || '').trim()
    if (!id) {
      res.status(400).send({ code: 400, msg: 'id 不能为空' })
      return
    }

    let objectId
    try {
      objectId = new db.ObjectId(id)
    } catch (error) {
      res.status(400).send({ code: 400, msg: 'id 格式错误' })
      return
    }

    try {
      const database = db.database()
      const deviceCollection = database.collection('uni-id-device')
      const current = await deviceCollection.findOne({ _id: objectId }, {
        projection: {
          user_id: 1,
          device_id: 1,
          platform: 1,
          token_expired: 1
        }
      })

      if (!current) {
        res.status(404).send({ code: 404, msg: '设备不存在' })
        return
      }

      await deviceCollection.deleteOne({ _id: objectId })

      logger.info('admin device removed', {
        deviceId: id,
        userId: String(current.user_id || ''),
        rawDeviceId: current.device_id || '',
        platform: current.platform || '',
        path: req.originalUrl || req.url
      })

      res.send({
        code: 200,
        msg: 'ok',
        data: {
          id,
          userId: String(current.user_id || ''),
          deviceId: current.device_id || '',
          platform: current.platform || ''
        }
      })
    } catch (error) {
      logger.error('admin device remove failed', error, {
        id,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '设备移除失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.get('/settings', async (req, res) => {
    try {
      const database = db.database()
      const collection = database.collection(ADMIN_SETTINGS_COLLECTION)
      const doc = await getOrCreateAdminSettings(collection)

      res.send({
        code: 200,
        msg: 'ok',
        data: normalizeAdminSettingsDoc(doc)
      })
    } catch (error) {
      logger.error('admin settings query failed', error, {
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '系统设置查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.post('/settings', async (req, res) => {
    try {
      const database = db.database()
      const collection = database.collection(ADMIN_SETTINGS_COLLECTION)
      const previousDoc = await getOrCreateAdminSettings(collection)
      const normalizedSettings = normalizeAdminSettingsPayload(req.body)
      const now = Date.now()

      await collection.updateOne(
        { key: ADMIN_SETTINGS_KEY },
        {
          $set: {
            ...normalizedSettings,
            updated_at: now
          },
          $setOnInsert: {
            key: ADMIN_SETTINGS_KEY,
            create_time: previousDoc?.create_time || now
          }
        },
        { upsert: true }
      )

      const nextDoc = await collection.findOne({ key: ADMIN_SETTINGS_KEY })

      logger.info('admin settings updated', {
        path: req.originalUrl || req.url,
        key: ADMIN_SETTINGS_KEY
      })

      res.send({
        code: 200,
        msg: '系统设置保存成功',
        data: normalizeAdminSettingsDoc(nextDoc)
      })
    } catch (error) {
      logger.error('admin settings update failed', error, {
        path: req.originalUrl || req.url,
        body: req.body
      })

      res.status(500).send({
        code: 500,
        msg: '系统设置保存失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.get('/feedback', async (req, res) => {
    const { page, pageSize } = normalizePagination(req)
    const { query, keyword, type, replyStatus } = buildFeedbackQuery(req)

    try {
      const database = db.database()
      const collection = database.collection(FEEDBACK_COLLECTION)

      const [total, docs] = await Promise.all([
        collection.countDocuments(query),
        collection.find(query)
          .sort({ create_date: -1, _id: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .toArray()
      ])

      res.send({
        code: 200,
        msg: 'ok',
        data: {
          list: docs.map(normalizeFeedbackRecord),
          total,
          page,
          pageSize,
          meta: {
            keyword,
            type,
            replyStatus
          }
        }
      })
    } catch (error) {
      logger.error('admin feedback list query failed', error, {
        query,
        page,
        pageSize,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '反馈列表查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.get('/feedback/:id', async (req, res) => {
    const id = String(req.params.id || '').trim()
    if (!id) {
      res.status(400).send({ code: 400, msg: 'id 不能为空' })
      return
    }

    let objectId
    try {
      objectId = new db.ObjectId(id)
    } catch (error) {
      res.status(400).send({ code: 400, msg: 'id 格式错误' })
      return
    }

    try {
      const database = db.database()
      const collection = database.collection(FEEDBACK_COLLECTION)
      const doc = await collection.findOne({ _id: objectId, status: 1 })

      if (!doc) {
        res.status(404).send({ code: 404, msg: '反馈不存在' })
        return
      }

      res.send({
        code: 200,
        msg: 'ok',
        data: normalizeFeedbackRecord(doc)
      })
    } catch (error) {
      logger.error('admin feedback detail query failed', error, {
        id,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '反馈详情查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.post('/feedback/:id/reply', async (req, res) => {
    const id = String(req.params.id || '').trim()
    const replyContent = String(req.body?.replyContent || '').trim()
    const replyStatus = normalizeReplyStatus(req.body?.replyStatus)

    if (!id) {
      res.status(400).send({ code: 400, msg: 'id 不能为空' })
      return
    }

    let objectId
    try {
      objectId = new db.ObjectId(id)
    } catch (error) {
      res.status(400).send({ code: 400, msg: 'id 格式错误' })
      return
    }

    if (!replyContent) {
      res.status(400).send({ code: 400, msg: '回复内容不能为空' })
      return
    }

    try {
      const database = db.database()
      const collection = database.collection(FEEDBACK_COLLECTION)
      const now = Date.now()

      const result = await collection.findOneAndUpdate(
        { _id: objectId, status: 1 },
        {
          $set: {
            reply_status: replyStatus,
            reply_content: replyContent,
            reply_time: now
          }
        },
        {
          returnDocument: 'after'
        }
      )

      const doc = result?.value || result
      if (!doc) {
        res.status(404).send({ code: 404, msg: '反馈不存在' })
        return
      }

      logger.info('admin feedback replied', {
        id,
        path: req.originalUrl || req.url,
        replyStatus
      })

      res.send({
        code: 200,
        msg: '反馈回复已保存',
        data: normalizeFeedbackRecord(doc)
      })
    } catch (error) {
      logger.error('admin feedback reply failed', error, {
        id,
        path: req.originalUrl || req.url,
        body: req.body
      })

      res.status(500).send({
        code: 500,
        msg: '反馈回复保存失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.get('/agreements', async (req, res) => {
    const { page, pageSize } = normalizePagination(req)
    const { query, keyword, agreementId, status } = buildAgreementQuery(req)

    try {
      const database = db.database()
      const collection = database.collection(AGREEMENT_COLLECTION)
      const [total, docs] = await Promise.all([
        collection.countDocuments(query),
        collection.find(query)
          .sort({ publish_time: -1, create_date: -1, _id: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .toArray()
      ])

      res.send({
        code: 200,
        msg: 'ok',
        data: {
          list: docs.map(normalizeAgreementRecord),
          total,
          page,
          pageSize,
          meta: {
            keyword,
            agreementId,
            status
          }
        }
      })
    } catch (error) {
      logger.error('admin agreement list query failed', error, {
        query,
        page,
        pageSize,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '协议列表查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.get('/agreements/:id', async (req, res) => {
    const id = String(req.params.id || '').trim()
    if (!id) {
      res.status(400).send({ code: 400, msg: 'id 不能为空' })
      return
    }

    let objectId
    try {
      objectId = new db.ObjectId(id)
    } catch (error) {
      res.status(400).send({ code: 400, msg: 'id 格式错误' })
      return
    }

    try {
      const database = db.database()
      const collection = database.collection(AGREEMENT_COLLECTION)
      const doc = await collection.findOne({ _id: objectId })

      if (!doc) {
        res.status(404).send({ code: 404, msg: '协议不存在' })
        return
      }

      res.send({
        code: 200,
        msg: 'ok',
        data: normalizeAgreementRecord(doc)
      })
    } catch (error) {
      logger.error('admin agreement detail query failed', error, {
        id,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '协议详情查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.post('/agreements', async (req, res) => {
    const agreementId = normalizeAgreementId(req.body?.agreementId || req.body?.agreement_id)
    const title = String(req.body?.title || '').trim()
    const content = String(req.body?.content || '')
    const status = normalizeAgreementStatus(req.body?.status)
    const publishTimeInput = Number(req.body?.publishTime || req.body?.publish_time || 0)
    const id = String(req.body?.id || '').trim()

    if (!agreementId) {
      res.status(400).send({ code: 400, msg: 'agreementId 不能为空' })
      return
    }

    if (!title) {
      res.status(400).send({ code: 400, msg: '标题不能为空' })
      return
    }

    if (!String(content).trim()) {
      res.status(400).send({ code: 400, msg: '协议内容不能为空' })
      return
    }

    try {
      const database = db.database()
      const collection = database.collection(AGREEMENT_COLLECTION)
      const now = Date.now()
      const publishTime = publishTimeInput > 0 ? publishTimeInput : 0

      if (status === 1) {
        await collection.updateMany(
          { agreement_id: agreementId, status: 1 },
          { $set: { status: 0 } }
        )
      }

      if (id) {
        let objectId
        try {
          objectId = new db.ObjectId(id)
        } catch (error) {
          res.status(400).send({ code: 400, msg: 'id 格式错误' })
          return
        }

        const result = await collection.findOneAndUpdate(
          { _id: objectId },
          {
            $set: {
              agreement_id: agreementId,
              title,
              content,
              status,
              publish_time: status === 1 ? (publishTime || now) : publishTime,
              update_time: now
            }
          },
          { returnDocument: 'after' }
        )

        const doc = result?.value || result
        if (!doc) {
          res.status(404).send({ code: 404, msg: '协议不存在' })
          return
        }

        logger.info('admin agreement updated', {
          id,
          agreementId,
          status,
          path: req.originalUrl || req.url
        })

        res.send({
          code: 200,
          msg: '协议保存成功',
          data: normalizeAgreementRecord(doc)
        })
        return
      }

      const payload = {
        agreement_id: agreementId,
        title,
        content,
        status,
        publish_time: status === 1 ? (publishTime || now) : publishTime,
        create_date: now,
        update_time: now
      }

      const result = await collection.insertOne(payload)
      const doc = await collection.findOne({ _id: result.insertedId })

      logger.info('admin agreement created', {
        agreementId,
        status,
        path: req.originalUrl || req.url
      })

      res.send({
        code: 200,
        msg: '协议创建成功',
        data: normalizeAgreementRecord(doc)
      })
    } catch (error) {
      logger.error('admin agreement save failed', error, {
        path: req.originalUrl || req.url,
        body: req.body
      })

      res.status(500).send({
        code: 500,
        msg: '协议保存失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.post('/agreements/:id/publish', async (req, res) => {
    const id = String(req.params.id || '').trim()
    if (!id) {
      res.status(400).send({ code: 400, msg: 'id 不能为空' })
      return
    }

    let objectId
    try {
      objectId = new db.ObjectId(id)
    } catch (error) {
      res.status(400).send({ code: 400, msg: 'id 格式错误' })
      return
    }

    try {
      const database = db.database()
      const collection = database.collection(AGREEMENT_COLLECTION)
      const current = await collection.findOne({ _id: objectId })

      if (!current) {
        res.status(404).send({ code: 404, msg: '协议不存在' })
        return
      }

      const now = Date.now()
      await collection.updateMany(
        { agreement_id: current.agreement_id, status: 1 },
        { $set: { status: 0 } }
      )

      const result = await collection.findOneAndUpdate(
        { _id: objectId },
        {
          $set: {
            status: 1,
            publish_time: now,
            update_time: now
          }
        },
        { returnDocument: 'after' }
      )

      const doc = result?.value || result

      logger.info('admin agreement published', {
        id,
        agreementId: current.agreement_id,
        path: req.originalUrl || req.url
      })

      res.send({
        code: 200,
        msg: '协议发布成功',
        data: normalizeAgreementRecord(doc)
      })
    } catch (error) {
      logger.error('admin agreement publish failed', error, {
        id,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '协议发布失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.get('/versions', async (req, res) => {
    const { page, pageSize } = normalizePagination(req)
    const { query, keyword, platform, status } = buildVersionQuery(req)

    try {
      const database = db.database()
      const collection = database.collection(VERSION_COLLECTION)
      const [total, docs] = await Promise.all([
        collection.countDocuments(query),
        collection.find(query)
          .sort({ publish_time: -1, create_date: -1, _id: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .toArray()
      ])

      res.send({
        code: 200,
        msg: 'ok',
        data: {
          list: docs.map(normalizeVersionRecord),
          total,
          page,
          pageSize,
          meta: {
            keyword,
            platform,
            status
          }
        }
      })
    } catch (error) {
      logger.error('admin version list query failed', error, {
        query,
        page,
        pageSize,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '版本列表查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.get('/versions/:id', async (req, res) => {
    const id = String(req.params.id || '').trim()
    if (!id) {
      res.status(400).send({ code: 400, msg: 'id 不能为空' })
      return
    }

    let objectId
    try {
      objectId = new db.ObjectId(id)
    } catch (error) {
      res.status(400).send({ code: 400, msg: 'id 格式错误' })
      return
    }

    try {
      const database = db.database()
      const collection = database.collection(VERSION_COLLECTION)
      const doc = await collection.findOne({ _id: objectId })

      if (!doc) {
        res.status(404).send({ code: 404, msg: '版本不存在' })
        return
      }

      res.send({
        code: 200,
        msg: 'ok',
        data: normalizeVersionRecord(doc)
      })
    } catch (error) {
      logger.error('admin version detail query failed', error, {
        id,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '版本详情查询失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.post('/versions', async (req, res) => {
    const platform = normalizeVersionPlatform(req.body?.platform)
    const versionName = String(req.body?.versionName || req.body?.version_name || '').trim()
    const versionCode = Number(req.body?.versionCode || req.body?.version_code || 0)
    const status = normalizeVersionStatus(req.body?.status)
    const forceUpdate = !!req.body?.forceUpdate || !!req.body?.force_update
    const downloadUrl = String(req.body?.downloadUrl || req.body?.download_url || '').trim()
    const notes = String(req.body?.notes || '')
    const id = String(req.body?.id || '').trim()

    if (!platform) {
      res.status(400).send({ code: 400, msg: 'platform 不能为空' })
      return
    }

    if (!versionName) {
      res.status(400).send({ code: 400, msg: '版本号不能为空' })
      return
    }

    if (!Number.isFinite(versionCode) || versionCode <= 0) {
      res.status(400).send({ code: 400, msg: '版本编码不能为空' })
      return
    }

    try {
      const database = db.database()
      const collection = database.collection(VERSION_COLLECTION)
      const now = Date.now()

      if (status === 1) {
        await collection.updateMany(
          { platform, status: 1 },
          { $set: { status: 0 } }
        )
      }

      if (id) {
        let objectId
        try {
          objectId = new db.ObjectId(id)
        } catch (error) {
          res.status(400).send({ code: 400, msg: 'id 格式错误' })
          return
        }

        const result = await collection.findOneAndUpdate(
          { _id: objectId },
          {
            $set: {
              platform,
              version_name: versionName,
              version_code: versionCode,
              status,
              force_update: forceUpdate,
              download_url: downloadUrl,
              notes,
              publish_time: status === 1 ? now : 0,
              update_time: now
            }
          },
          { returnDocument: 'after' }
        )

        const doc = result?.value || result
        if (!doc) {
          res.status(404).send({ code: 404, msg: '版本不存在' })
          return
        }

        logger.info('admin version updated', {
          id,
          platform,
          versionName,
          path: req.originalUrl || req.url
        })

        res.send({
          code: 200,
          msg: '版本保存成功',
          data: normalizeVersionRecord(doc)
        })
        return
      }

      const payload = {
        platform,
        version_name: versionName,
        version_code: versionCode,
        status,
        force_update: forceUpdate,
        download_url: downloadUrl,
        notes,
        create_date: now,
        update_time: now,
        publish_time: status === 1 ? now : 0
      }

      const result = await collection.insertOne(payload)
      const doc = await collection.findOne({ _id: result.insertedId })

      logger.info('admin version created', {
        platform,
        versionName,
        path: req.originalUrl || req.url
      })

      res.send({
        code: 200,
        msg: '版本创建成功',
        data: normalizeVersionRecord(doc)
      })
    } catch (error) {
      logger.error('admin version save failed', error, {
        path: req.originalUrl || req.url,
        body: req.body
      })

      res.status(500).send({
        code: 500,
        msg: '版本保存失败',
        error: error.message || 'unknown error'
      })
    }
  })

  router.post('/versions/:id/publish', async (req, res) => {
    const id = String(req.params.id || '').trim()
    if (!id) {
      res.status(400).send({ code: 400, msg: 'id 不能为空' })
      return
    }

    let objectId
    try {
      objectId = new db.ObjectId(id)
    } catch (error) {
      res.status(400).send({ code: 400, msg: 'id 格式错误' })
      return
    }

    try {
      const database = db.database()
      const collection = database.collection(VERSION_COLLECTION)
      const current = await collection.findOne({ _id: objectId })

      if (!current) {
        res.status(404).send({ code: 404, msg: '版本不存在' })
        return
      }

      const now = Date.now()
      await collection.updateMany(
        { platform: current.platform, status: 1 },
        { $set: { status: 0 } }
      )

      const result = await collection.findOneAndUpdate(
        { _id: objectId },
        {
          $set: {
            status: 1,
            publish_time: now,
            update_time: now
          }
        },
        { returnDocument: 'after' }
      )

      const doc = result?.value || result

      logger.info('admin version published', {
        id,
        platform: current.platform,
        versionName: current.version_name,
        path: req.originalUrl || req.url
      })

      res.send({
        code: 200,
        msg: '版本发布成功',
        data: normalizeVersionRecord(doc)
      })
    } catch (error) {
      logger.error('admin version publish failed', error, {
        id,
        path: req.originalUrl || req.url
      })

      res.status(500).send({
        code: 500,
        msg: '版本发布失败',
        error: error.message || 'unknown error'
      })
    }
  })

  return router
}

module.exports = createAdminRouter
