const dbConfig = require('./config.js')
const { MongoClient , ObjectId  } = require('mongodb');

const missingKeys = ['db_host', 'db_port', 'db_user', 'db_password', 'db_name'].filter((key) => !dbConfig[key]);

if (missingKeys.length) {
  throw new Error(`缺少数据库环境变量: ${missingKeys.join(', ')}`);
}

const url = `mongodb://${dbConfig.db_user}:${dbConfig.db_password}@${dbConfig.db_host}:${dbConfig.db_port}/?authSource=admin`;
const client = new MongoClient(url);
client.connect().then(res=>{
  console.log('connect db success');
  
});

async function healthCheck() {
  try {
    await client.db(dbConfig.db_name).admin().ping()
    return {
      status: 'UP'
    }
  } catch (error) {
    return {
      status: 'DOWN',
      message: error.message
    }
  }
}



module.exports = {
  database(){
    return client.db(dbConfig.db_name)
  },
  healthCheck,
  ObjectId
}
