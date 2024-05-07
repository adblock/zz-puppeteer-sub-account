const puppeteer = require('puppeteer');
const dateFormat = require('dateformat');
const { mongoInit, mysqlCfgSql } = require('../commons/db');
const { asyncForEach, setJs } = require('../commons/func');
const config = require('../config');

/**
 * 检查 更新mongo cookie状态
 * */
let G_MONGO = null;

const startLogin = async (wangwang,cookie) => {
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
            await updateCookieStatus(wangwang, 0,null);
            await browser.close();
        } else{
            // cookie有效，将有效状态保存为 1
            const cookie = await page.cookies();
            await updateCookieStatus(wangwang, 1,cookie);
            await browser.close();
        }
    } catch (e) {
        console.log(e);
        await browser.close();
    }

};

// 更新cookie状态
const updateCookieStatus = async (wangwang,status,cookie)=>{
    if(status===0){
        await G_MONGO.db.collection('sub_account_login').updateMany({
            'wangwang_id': wangwang,
            'f_use': {$exists: 0}
        },{$set:{
                'f_valid_status':status,
                'updated_at':new Date(),
                'f_raw_cookies':null,
            }});
    }else {
        await G_MONGO.db.collection('sub_account_login').updateMany({
            'wangwang_id': wangwang,
            'f_use': {$exists: 0}
        },{$set:{
                'f_valid_status':status,
                'f_raw_cookies': {"sycmCookie":cookie},
                'updated_at':new Date(),
            }});
    }
};

// 获取子账号方法
async function get_sub_account(){
    const boss = config.mysql_boss;
    let sql = `
        select distinct t_order.f_copy_wangwangid, t_order.f_lz_account as f_lz_account, t_order.f_lz_password as f_lz_password 
        from (t_order left join t_product on t_order.f_foreign_product_id = t_product.id) 
        left join t_task on t_order.id = t_task.f_foreign_order_id
        where t_product.f_foreign_sku_kind in ('淘宝/天猫代运营','淘宝/天猫流量','直通车', '钻展', '超级推荐', '超级直播', '超级互动城', '万相台', '引力魔方')
        and (t_task.f_foreign_task_state_id in (1,2) 
        or (t_task.f_foreign_task_state_id in (3,10) and datediff(now(),t_task.f_last_stop_time) <= 30)
        or (t_task.f_foreign_task_state_id = 4 and datediff(now(),t_task.f_task_end_time) <= 30))
        order by field(t_product.f_foreign_sku_kind,'淘宝/天猫代运营', '淘宝/天猫流量','直通车', '钻展', '超级推荐', '超级直播', '超级互动城', '万相台', '引力魔方');
    `;

    return  await mysqlCfgSql(boss, sql);
}


(async () => {
    // 获取子账号
    const today = dateFormat(new Date(), "yyyy-mm-dd");
    G_MONGO = await mongoInit();

    const order_list = await get_sub_account();
    console.log(order_list);
    await asyncForEach(order_list, async (order, index) => {
        const wangwang = order.f_copy_wangwangid;
        console.log(wangwang);
        let account_list = await G_MONGO.db.collection('sub_account_login').find({'wangwang_id': wangwang,'f_use': {$exists: 0}}).toArray();
        if(account_list.length > 0){
            const cookies = account_list[0].f_raw_cookies;
            if(cookies){
                await startLogin(wangwang,cookies).catch(async (err) => {
                    console.error(err);
                });
            } else {
               await updateCookieStatus(wangwang, 0,null)
            }
        } else{
            let cookieObj = {
                f_raw_cookies: null,
                f_valid_status: 0,
                wangwang_id: wangwang,
                account: order.f_lz_account,
                password: order.f_lz_password,
                f_is_used: '',
                f_date:dateFormat(new Date(), "yyyy-mm-dd"),
                created_at:new Date(),
                updated_at:new Date(),
            };
            await G_MONGO.db.collection('sub_account_login').insertOne(cookieObj);
        }
    })
    await G_MONGO.close();
    process.exit();
})();
