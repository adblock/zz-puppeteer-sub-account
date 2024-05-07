const { mysqlCfgSql } = require('../commons/db');
const config = require('../config');

async function get_account(){
    const boss = config.mysql_boss;
    const sql = '';
    const accounts = mysqlCfgSql(boss, sql);

}