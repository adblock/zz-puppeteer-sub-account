const puppeteer = require('puppeteer');
const dateFormat = require('dateformat');
const { mongoInit, mysqlCfgSql } = require('../commons/db');
const { asyncForEach, setJs } = require('../commons/func');
const config = require('../config');

/**
 * 检查 更新mongo cookie状态
 * */
let G_MONGO = null;

const startLogin = async (wangwang,cookie, account, password) => {
    const browser = await puppeteer.launch({
        headless: config.headless,
        // userDataDir: config.user_data+'user_'+wangwang,
        args: [
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--no-first-run',
            '--no-sandbox',
            '--no-zygote',
            '--single-process',
            '--disable-setuid-sandbox',
            '--start-maximized'
        ],
        ignoreDefaultArgs: ["--enable-automation"]
    });

    const page = await setJs(await browser.newPage());
    page.setViewport({
        width: 1024,
        height: 768
    });
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);

    try {
        await asyncForEach(cookie.sycmCookie, async (value) => {
            await page.setCookie(value);
        });

        const homeUrl = 'https://myseller.taobao.com/home.htm';
         // 打开生意参谋首页
        await page.goto(homeUrl);
        console.log(page.url());
        if (page.url().indexOf('https://login.taobao.com/member/login.jhtml') !== -1 || page.url().indexOf('https://loginmyseller.taobao.com/') !== -1) {
            // cookie失效，将有效状态保存为 0
            await updateCookieStatus(wangwang, 0,null, account, password);
            await browser.close();
        } else{
            // cookie有效，将有效状态保存为 1
            const cookie = await page.cookies();
            await updateCookieStatus(wangwang, 1,cookie, account, password);
            await browser.close();
        }
    } catch (e) {
        console.log(e);
        await browser.close();
    }

};

// 更新cookie状态
const updateCookieStatus = async (wangwang,status,cookie, account, password)=>{
    if(status===0){
        await G_MONGO.db.collection('sub_account_login').updateMany({
          'account':account,'password': password,'f_use': {$exists: 1}
        },{$set:{
                'f_valid_status':status,
                'updated_at':new Date(),
                'f_raw_cookies':null,
            }});
    }else {
        await G_MONGO.db.collection('sub_account_login').updateMany({
            'account':account,'password': password,'f_use': {$exists: 1}
        },{$set:{
                'f_valid_status':status,
                'f_raw_cookies': {"sycmCookie":cookie},
                'updated_at':new Date(),
            }});
    }
};

// 获取子账号方法
async function get_sub_account(){
    const new_boss = config.new_boss;
    let sql = `select f_account, f_password, f_use from t_order_account`;
    return await mysqlCfgSql(new_boss, sql);
}

//店铺列表去重
const dropMutiAccount = async(order_list)=>{
    let jsons = order_list.map(item => {
        item['f_account'] = item['f_account'].trim();
        item['f_password'] = item['f_password'].trim();
        let keys = ['f_account','f_password'];
        let obj = {}
        keys.forEach(key => { obj[key] = item[key] })
        return JSON.stringify(obj)
    })
    let orderListNew =[...new Set(jsons)].map(item => JSON.parse(item));
    return orderListNew;
}

//不存在则添加
const addSubAccount = async(order_list)=>{
    await asyncForEach(order_list, async (order, index) => {
        let account = order['f_account'].trim();
        let password = order['f_password'].trim();
        let wangwang = order['f_account'].split(':')[0];
        let account_list = await G_MONGO.db.collection('sub_account_login').find({'account': account,'password':password,'f_use':order['f_use']}).toArray();
        if(account_list.length === 0){
            let cookieObj = {
                f_raw_cookies: null,
                f_valid_status: 0,
                wangwang_id: wangwang,
                account: account,
                password: password,
                f_use:order['f_use'],
                f_is_used: '',
                f_date:dateFormat(new Date(), "yyyy-mm-dd"),
                created_at:new Date(),
                updated_at:new Date(),
            };
            console.log(wangwang);
            await G_MONGO.db.collection('sub_account_login').insertOne(cookieObj);
        }
    })
}

(async () => {
    // 获取子账号
    const today = dateFormat(new Date(), "yyyy-mm-dd");
    G_MONGO = await mongoInit();
    const order_list = await get_sub_account();
    console.log(order_list.length);
    //不存在的添加到sub_account_login
    await addSubAccount(order_list, G_MONGO);
    //存在检查cookies更新
    if(order_list.length>1){
        //店铺去重
        let orderListNew = await dropMutiAccount(order_list);
        //再次循环，更新cookies
        await asyncForEach(orderListNew, async(order,index)=>{
            let account1 = order['f_account'].trim();
            let password1 = order['f_password'].trim();
            let sub_list = await G_MONGO.db.collection('sub_account_login').find({'account': account1,'password':password1,'f_use': {$exists: 1}}).toArray();
            const cookies = sub_list[0].f_raw_cookies;
            let wangwang = sub_list[0].wangwang_id;
            console.log(index, wangwang);
            if(cookies){
                await startLogin(wangwang,cookies,account1,password1).catch(async (err) => {
                    console.error(err);
                });
            } else {
                await updateCookieStatus(wangwang, 0,null,account1,password1)
            }
        })
    }
    await G_MONGO.close();
    process.exit();
})();
