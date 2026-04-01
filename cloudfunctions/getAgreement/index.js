'use strict';

const uniCloud = require('../../db/index.js')

exports.main = async (event) => {
  const db = uniCloud.database()
  const agreementDB = db.collection('app_agreement')
  const agreementId = (event.agreement_id || '').trim()

  if (!agreementId) {
    return {
      code: 201,
      msg: '协议id不能为空',
      data: {}
    }
  }

  const agreementList = await agreementDB.find({
    agreement_id: agreementId,
    status: 1
  }).sort({
    publish_time: -1,
    create_date: -1
  }).limit(1).toArray()

  if (!agreementList.length) {
    return {
      code: 201,
      msg: '未找到协议内容',
      data: {}
    }
  }

  const agreement = agreementList[0]

  return {
    code: 200,
    msg: '获取成功',
    data: {
      _id: agreement._id,
      agreement_id: agreement.agreement_id,
      title: agreement.title,
      content: agreement.content,
      publish_time: agreement.publish_time
    }
  }
}
