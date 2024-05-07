const https = require("https");
const dateFormat = require('dateformat');
const { mongoQuery } = require('../commons/db');
const log4js = require('log4js');
const moment = require('moment');

// ForEach async
async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
}

// 获取当天的超级推荐店铺列表
async function getTuijianShopList(date) {
    let db = await mongoQuery();
    const shop_list = await db.collection('chaojituijian.shop_list').find({}).sort({_id:-1}).limit(1).toArray();
    return shop_list;
}

// param $isAt 是否AT管理员
async function sendDingding (content, isAt=false){
    let queryParams = {
        "msgtype": "text",
         "text": {
             "content": content,
         }
    };
    if(isAt === true){
        queryParams.at = {
                 "atMobiles": [18561738659], 
                 "isAtAll": false
             }
    }
    const requestData = JSON.stringify(queryParams);
    const req = https.request({
        hostname: 'oapi.dingtalk.com',
        port: 443,
        path: '/robot/send?access_token=5adb0ed002a46761df517eacee2a99ba285c613891adf110255bce2ea326a047',
        method: "POST",
        json: true,
        headers: {
            'Content-Type' : "application/json; charset=utf-8"
        }
    },(res) => {
        process.exit()
    });
    req.write(requestData);
    req.on('error',function(err){
        console.error(err);
    });
    req.end();
}

// 获取当天的钻展店铺列表
async function getZuanzhanShopList() {
    let db = await mongoQuery();
    const shop_list = await db.collection('zuanzhan.shop_list').find({}).sort({_id:-1}).limit(1).toArray();
    return shop_list;
}

// 设置浏览器js值
const setJs = async (page) => {
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
        });
        Object.defineProperty(chrome, 'runtime', {
            get: function () {
                return { "OnInstalledReason": { "CHROME_UPDATE": "chrome_update", "INSTALL": "install", "SHARED_MODULE_UPDATE": "shared_module_update", "UPDATE": "update" }, "OnRestartRequiredReason": { "APP_UPDATE": "app_update", "OS_UPDATE": "os_update", "PERIODIC": "periodic" }, "PlatformArch": { "ARM": "arm", "MIPS": "mips", "MIPS64": "mips64", "X86_32": "x86-32", "X86_64": "x86-64" }, "PlatformNaclArch": { "ARM": "arm", "MIPS": "mips", "MIPS64": "mips64", "X86_32": "x86-32", "X86_64": "x86-64" }, "PlatformOs": { "ANDROID": "android", "CROS": "cros", "LINUX": "linux", "MAC": "mac", "OPENBSD": "openbsd", "WIN": "win" }, "RequestUpdateCheckStatus": { "NO_UPDATE": "no_update", "THROTTLED": "throttled", "UPDATE_AVAILABLE": "update_available" } }
            },
        });
    });
    return page;
};


const setLog = async(name) => {
    let today = moment().format('YYYY-MM-DD');
    log4js.configure({
        appenders:{
            out:{
                type: 'file',
                filename: 'logs/' + today + '_' + name + '.log'
            }
        },
        categories: { default: { appenders: ["out"], level: "info" }}
    });
    return log4js.getLogger(name);
};

const logPrint = async(name, message, level='info') => {
    let LOGGER = await setLog(name);
    if(level === 'info'){
        console.log(message);
        LOGGER.info(message);
    } else if(level === 'error'){
        console.error(message);
        LOGGER.error(message);
    } else {
        console.error('level error' + message);
        LOGGER.error('level error' + message);
    }
};


module.exports = { asyncForEach, sendDingding, getTuijianShopList, getZuanzhanShopList, setJs, logPrint };
