const { mysqlQuery }  = require('./db');

// 获取一个可用的有效cookies
const getOneAccountCookiesByid = async(account_id) => {
    account = await mysqlQuery('select * from t_sycm_account where  id = ' + account_id);
    if(account.length>0){
        return account[0];
    }else{
        return undefined;
    }
}

module.exports = { getOneAccountCookiesByid }
