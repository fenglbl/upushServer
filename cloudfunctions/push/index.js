'use strict';
const uniCloud = require('../../db/index.js');
const unipush = require('../../unipush/index.js')
// const uniPush = uniCloud.getPushManager({appId:"__UNI__0805689"}) //注意这里需要传入你的应用appId，用于指定接收消息的客户端
exports.main = async (event, context) =>{
  const ip = context.CLIENTIP
  //event为客户端上传的参数
  let { id, title , content , payload } = event
  const db = uniCloud.database();
  const deviceDB = db.collection("uni-id-device")
  const pushMsgDB = db.collection("uni-push-message")
  id = new uniCloud.ObjectId(id)
  let devices
  try{
    devices = await deviceDB.find({user_id:id}).toArray()
  }catch(err){
    console.log(err);
  }
  devices.map(async item=>{
    const t = new Date().getTime()
    let insertData = await pushMsgDB.insertOne({ 
      user_id:item.user_id,
      ip,
      device_id:item.device_id,
      create_time:t,
      title,content,payload
    })
    if(!payload) return
    payload.mid = insertData.insertedId
    unipush.sendMessage({
      "push_clientid":item.device_id,
      "title": title,	
      "content": content,
      "payload": payload
    }).then(res=>{
      console.log(res);
    })
  })
  return {
    code:200,
    msg:"推送请求已提交"
  }
  //返回数据给客户端
}

