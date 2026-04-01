'use strict';

const uniCloud = require('../../db/index.js')

exports.main = async (event) => {
  const db = uniCloud.database()
  const feedbackDB = db.collection('app_feedback')
  const type = (event.type || '').trim()
  const contact = (event.contact || '').trim()
  const content = (event.content || '').trim()
  const screenshots = Array.isArray(event.screenshots) ? event.screenshots : []
  const now = Date.now()

  if (!type) {
    return {
      code: 201,
      msg: '反馈类型不能为空',
      data: {}
    }
  }

  if (!contact) {
    return {
      code: 201,
      msg: '联系方式不能为空',
      data: {}
    }
  }

  if (!content) {
    return {
      code: 201,
      msg: '反馈内容不能为空',
      data: {}
    }
  }

  const result = await feedbackDB.insertOne({
    type,
    contact,
    content,
    screenshots,
    reply_status: 0,
    reply_content: '',
    reply_time: 0,
    status: 1,
    create_date: now
  })

  return {
    code: 200,
    msg: '反馈已提交',
    data: {
      _id: result.insertedId
    }
  }
}
