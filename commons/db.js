const mysql = require('mysql');
const config = require('../config');
const MongoClient = require('mongodb').MongoClient;

// mysql 传入配置和sql语句执行
const mysqlCfgSql = function(config_this, sql, values ) {
  const pool_this = mysql.createPool(config_this);
  return new Promise(( resolve, reject ) => {
    pool_this.getConnection(function(err, connection) {
      if (err) {
        reject( err )
      } else {
        connection.query(sql, values, ( err, rows) => {
          if ( err ) {
            reject( err )
          } else {
            resolve( rows )
          }
          connection.release()
        })
      }
    })
  })
};

// mongo 查询
const mongoQuery = async (db_name) => {
  const client = await MongoClient.connect(config.mongo.url, {useUnifiedTopology: true});
  let db = client.db('zz_web');
  if(db_name){
    db = client.db(db_name);
  }
  return db;
};

/*
* mongo 链接初始化
* @param dbName 数据库名称
* */
const mongoInit = async (dbName='zz_web') => {
  const client = await MongoClient.connect(config.mongo.url, {useUnifiedTopology: true});
  const db = client.db('zz_web');
  const clientClose = async function () {
    await client.close();
  };
  return {
    'db':db,
    'client':client,
    'close':clientClose
  };
};

module.exports = { mongoQuery, mysqlCfgSql, mongoInit };
