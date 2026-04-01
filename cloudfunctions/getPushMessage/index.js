'use strict';
const uniCloud = require('../../db/index.js');
const tokenLong = 1000 * 60 * 60 * 24 * 365 * 100; // 默认100年
exports.main = async (event, context) => {
  //event为客户端上传的参数
  const db = uniCloud.database();
  const pushMsgDB = db.collection("uni-push-message")
  const usersDB = db.collection("uni-id-users")
  const tokenDB = db.collection("token")
  // console.log(tokenDB);
  const t = new Date().getTime()
  // 判断token是否过期
  const userToken = await tokenDB.find({
    token: event.token
  }).toArray()
  console.log(userToken);
  if (!userToken.length) {
    return {
      code: 202,
      msg: "token不存在",
      data: {}
    }
  }
  let tokenCreateTime = userToken[0].addtime
  if (tokenCreateTime + tokenLong < t) {
    // 创建数据表token
    return {
      code: 202,
      msg: "token过期",
      data: []
    }
  }
  const user = await usersDB.find({
    token: event.token
  }).toArray()
  if (user.length) {
    const page = event.page || 1
    const pageSize = event.pageSize || 20

    // 计算跳过的文档数量
    const skip = (page - 1) * pageSize;

    let user_id = user[0]._id
    console.log('event: ', event);
    let msg = await pushMsgDB.find({
        user_id: user_id,
        device_id:event.device_id // 暂时注释设备id
      }, {
        projection: {
          device_id: 0,
          ip: 0,
        },
      })
      .sort({
        'create_time': -1
      })
      .skip(skip)
      .limit(pageSize)
      .toArray()
    const total = await pushMsgDB.countDocuments({
      user_id: user_id,
      device_id: event.device_id
    })
    const pageTotal = Math.ceil(total / pageSize)

    return {
      code: 200,
      msg: "",
      data: {
        list: msg,
        total: pageTotal
      },
    }
  }
  //返回数据给客户端
  return {
    code: 202,
    msg: "token异常",
    data: []
  }
};