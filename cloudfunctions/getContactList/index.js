'use strict';

const uniCloud = require('../../db/index.js')

exports.main = async () => {
  const db = uniCloud.database()
  const contactDB = db.collection('app_contact')

  const list = await contactDB.find({
    status: 1
  }).sort({
    create_date: -1
  }).toArray()

  return {
    code: 200,
    msg: '获取成功',
    data: {
      list: list.map((item) => ({
        _id: item._id,
        type: item.type,
        value: item.value
      }))
    }
  }
}
