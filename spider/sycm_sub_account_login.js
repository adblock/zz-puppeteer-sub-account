const puppeteer = require('puppeteer');
const dateFormat = require('dateformat');
const { mongoQuery, mysqlCfgSql } = require('../commons/db');
const { getStrCookies } = require('../commons/cookies');
const { sendDingding, asyncForEach, setJs } = require('../commons/func');
const config = require('../config');

/**
 * 获取 boss 的子账号登录，存到mongodb 中
 * */

let G_CHECK_FLAG = 0;
let G_RETRY = 0;
let G_SUCCESS = 0;
let G_CHECKARR = [];
let G_SEND_TIME = '';
let G_BROWSER = null;


const startLogin = async (wangwang,account,password,cookie) => {

    let db = await mongoQuery();
    const browser = await puppeteer.launch({
        headless: config.headless,
        // userDataDir: config.user_data+'user_'+wangwang,
        args: [
            '-disable-gpu',
            '-disable-dev-shm-usage',
            '-disable-setuid-sandbox',
            '-no-first-run',
            '-no-sandbox',
            '-no-zygote',
            '-single-process',
        ],
        ignoreDefaultArgs: ["--enable-automation"]
    });
    G_BROWSER = browser;

    const page = await setJs(await browser.newPage());
    page.setViewport({
        width: 1376,
        height: 1376
    });
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);

    try {
        if(cookie !== null){
            await asyncForEach(cookie.sycmCookie, async (value) => {
                await page.setCookie(value);
            });
        }

         // 打开生意参谋首页
        const homeUrl = 'http://sycm.taobao.com/portal/home.htm';
        await page.goto(homeUrl, {
            waitUntil: 'networkidle2',
        });

        if (page.url() === 'https://sycm.taobao.com/portal/home.htm') {  // cookie有效，将有效状态保证为 1
            const cookie = await page.cookies();
            await saveSuccessCookies(cookie,wangwang);
            await browser.close()
        } else{
            const frames = await page.frames();
            const loginFrame = frames.find(f => f.url().indexOf("//login.taobao.com/member/login.jhtml") > -1);
            // 输入账号密码 点击登录按钮
            await page.waitFor(Math.floor(Math.random() * 100) * Math.floor(Math.random() * 10));
            const opts = {
                delay: 2 + Math.floor(Math.random() * 2), //每个字母之间输入的间隔
            };

            await loginFrame.type('#fm-login-id', account, opts);

            await page.waitFor(1500);

            await loginFrame.type('#fm-login-password', password, opts);
            await page.waitFor(1500);

            // 滑块
            let hua = await loginFrame.$eval('#nocaptcha-password', el => {
                return window.getComputedStyle(el).getPropertyValue('display') === 'block'
            });
            for (let i = 0; i < 3; i++) {
                if (hua) {
                    const slide = await loginFrame.$('#nc_1_n1z');
                    await page.waitFor(1500);
                    const loc = await slide.boundingBox();
                    await page.mouse.move(loc.x, loc.y);
                    await page.mouse.down();
                    await page.mouse.move(loc.x + 400, loc.y);
                    await page.mouse.up();
                    await page.waitFor(1500);

                    const err = await loginFrame.$('.errloading');
                    if (err) {
                        await loginFrame.click('.errloading > span.nc-lang-cnt > a')
                    }
                    const huaText = await loginFrame.$('#nc_1__scale_text');
                    if (huaText) {
                        const text = await loginFrame.$eval('#nc_1__scale_text > span.nc-lang-cnt', el => el.innerHTML);
                        console.log(text)
                        if (text.indexOf('验证通过') > -1) {
                            break
                        }
                    }
                    hua = await loginFrame.$eval('#nocaptcha-password', el => {
                        return window.getComputedStyle(el).getPropertyValue('display') === 'block'
                    });
                } else {
                    break
                }
            }

            let loginBtn = await loginFrame.$('[type="submit"]');
            await loginBtn.click({
                delay: 200
            });
        }

        await page.on('response', async (response) => {
            const update_at = dateFormat(new Date(), "yyyy-mm-dd HH:MM:ss");
            if (response.url().indexOf('getPersonalView.json') > -1) {
                G_SUCCESS = 1;
                const cookie = await page.cookies();
                await saveSuccessCookies(cookie,wangwang);
                await browser.close();
            }
            if (response.url().indexOf('https://login.taobao.com/newlogin/login.do') > -1) {
                let data = await response.json();
                if(data.content.data.iframeRedirectUrl){
                    if(data.content.data.iframeRedirectUrl.indexOf('member/login_unusual.htm') > -1) {
                        await page.waitFor(5000);
                        const frames = await page.frames();
                        const checkFrames = frames.find(f => f.url().indexOf("aq.taobao.com/durex/validate") > -1);
                        G_CHECK_FLAG = 0;
                        await checkCode(checkFrames,wangwang)
                    }
                }
                if (data.content.data.titleMsg) {
                    console.log(data.content.data.titleMsg);
                    await saveErrorCookies(wangwang,data.content.data.titleMsg);
                    await browser.close()
                }
            }
            if (response.url().indexOf('aq.taobao.com/durex/checkcode') > -1) {
                let data = await response.json();
                if(G_CHECK_FLAG === 1 && data.isG_SUCCESS === false){
                    const frames = await page.frames();
                    const checkFrames = frames.find(f => f.url().indexOf("aq.taobao.com/durex/validate") > -1);
                    if(G_CHECKARR.length > 0){
                        await writeCheck(checkFrames,wangwang)
                    } else {
                        if (G_RETRY < 3) {     // 重试三次
                            G_RETRY += 1;
                            await checkCode(checkFrames,wangwang)
                        }
                    }
                }
            }
        });

        if(await browser.isConnected()){
            await page.waitForNavigation({waitUntil: 'networkidle2'});
            await browser.close();
        }
    } catch (e) {
        console.log(e);
        const cookie = await page.cookies();
        await saveErrorCookies(wangwang,e);
        await browser.close();
    }

};

// 获取子账号方法
async function get_sub_account(page, type){
    const boss = config.mysql_boss;
    // let sql = 'select\n' +
    //     '       distinct t_order.f_copy_wangwangid,\n' +
    //     '       t_order.f_lz_account as f_lz_account,\n' +
    //     '       t_order.f_lz_password as f_lz_password\n' +
    //     'from t_order\n' +
    //     '         left join t_product on t_order.f_foreign_product_id = t_product.id\n' +
    //     'where t_product.f_foreign_sku_kind in (\'直通车\', \'钻展\', \'超级推荐\', \'淘宝/天猫代运营\')\n' +
    //     'and t_order.f_foreign_order_state_id in (2,3);';
    let sql = `
        select distinct t_order.f_copy_wangwangid, t_order.f_lz_account as f_lz_account, t_order.f_lz_password as f_lz_password
        from (t_order left join t_product on t_order.f_foreign_product_id = t_product.id)
        left join t_task on t_order.id = t_task.f_foreign_order_id
        where t_product.f_foreign_sku_kind in ('直通车', '钻展', '超级推荐', '淘宝/天猫代运营')
        and (t_task.f_foreign_task_state_id in (1,2)
        or (t_task.f_foreign_task_state_id in (3,10) and datediff(now(),t_task.f_last_stop_time) <= 30)
        or (t_task.f_foreign_task_state_id = 4 and datediff(now(),t_task.f_task_end_time) <= 30))
    `;
    if('yunying' === type){
        sql = 'select\n' +
        '       distinct t_order.f_copy_wangwangid,\n' +
        '       t_order.f_lz_account as f_lz_account,\n' +
        '       t_order.f_lz_password as f_lz_password\n' +
        'from t_order\n' +
        '         left join t_product on t_order.f_foreign_product_id = t_product.id\n' +
        'where t_product.f_foreign_sku_kind =\'淘宝/天猫代运营\'' +
        '  and t_order.f_foreign_order_state_id = 2' +
        '   limit '+page[0]+','+page[1]+';'
    }
    return await mysqlCfgSql(boss, sql);

}

// 获取验证码方法
const checkCode = async(checkFrames,accountData) => {
    const phone = await checkFrames.$eval('.new-phone-current', el=>el.innerHTML);
    console.log(phone)
    const phone_end = phone.slice(-4);
    if(!(phone_end == '6910' || phone_end == '6912' || phone_end == '6913')){
        await saveErrorCookies(accountData, '接收验证码手机号不是本公司手机号');
        G_BROWSER.close();
        G_BROWSER = null;
    }
    const getCheck = await checkFrames.$('.send-code-btn');
    if(getCheck && G_CHECK_FLAG === 0){
        await getCheck.click();
        G_CHECK_FLAG = 1;
    }
    if(G_SEND_TIME === ''){
        G_SEND_TIME = await dateFormat(new Date(), 'yyyy-mm-dd HH:MM:ss');
    }
    console.log(G_SEND_TIME)
    let db = await mongoQuery();

    await checkFrames.waitFor(25000);     // 等待20s 验证码发送
    G_CHECKARR = await db.collection('zz_sms').find({'phone_num': phone_end}).sort({"time":-1}).limit(3).toArray();
    G_SEND_TIME = await dateFormat(new Date(), 'yyyy-mm-dd HH:MM:ss');
    // 循环填入
    await writeCheck(checkFrames,accountData)
};

// 填写验证码
const writeCheck = async(checkFrames,wangwang) =>{
    try {
        console.log(G_CHECKARR);
        let check = G_CHECKARR.shift();
        if(G_CHECKARR.length>0){
            console.log(check['message']);
            const code = check['message'].match(/验证码(\S*)，/)[1]
            if(code){
                const yanCode = code.slice(0,6);
                console.log(yanCode);
                //清空输入框的值
                await checkFrames.$eval('.J_SafeCode',input => input.value='' );
                await checkFrames.type('.J_SafeCode', yanCode.toString(), {delay: 100});
                await checkFrames.waitFor(1500);
                await checkFrames.click('#J_FooterSubmitBtn');
                await checkFrames.waitFor(5000);
            }
        }else {
            console.log(G_CHECKARR);
            await saveErrorCookies(
                wangwang,
                '未获取到验证码');
            G_BROWSER.close();
            G_BROWSER = null;

        }
    }catch (e) {
        console.log(e);
    }
};

// 存储cookie
const saveSuccessCookies = async (cookie,wangwang)=>{
    let db = await mongoQuery();
    let cookieObj = {
        f_raw_cookies: {"sycmCookie":cookie},
        f_valid_status: 1,
        wangwang_id: wangwang,
        f_is_used: 1,
        f_date:dateFormat(new Date(), "yyyy-mm-dd"),
        created_at:new Date(),
        updated_at:new Date(),
    };
    console.log(cookieObj);

    await db.collection('sub_account_login').deleteMany({
        'wangwang_id': wangwang
    });
    await db.collection('sub_account_login').insertOne(cookieObj);
};
const saveErrorCookies = async (wangwang,titleMsg)=>{
    let db = await mongoQuery();
    let cookieObj = {
        f_raw_cookies: null,
        f_valid_status: 0,
        wangwang_id: wangwang,
        f_is_used: titleMsg,
        f_date:dateFormat(new Date(), "yyyy-mm-dd"),
        created_at:new Date(),
        updated_at:new Date(),
    };

    await db.collection('sub_account_login').deleteMany({
        'wangwang_id': wangwang
    });
    await db.collection('sub_account_login').insertOne(cookieObj);
};


(async () => {
    // 获取子账号
    const args = process.argv.splice(2);
    const page = [args[0], args[1]];
    const type = args[2];
    console.log(page);
    const order_list = await get_sub_account(page, type);
    console.log(order_list.length);
    await asyncForEach(order_list, async (order, index) => {
        const account = order.f_lz_account;
        const password = order.f_lz_password;
        console.log(index+1, account);
        if(account.trim()){
            G_RETRY = 0;
            G_SUCCESS = 0;
            G_SEND_TIME = '';
            const wangwang = order.f_copy_wangwangid;
            let cookies = [];
            let db = await mongoQuery();
            let account_list = await db.collection('sub_account_login').find({'wangwang_id': wangwang}).toArray();
            if(account_list.length > 0){
                cookies = account_list[0].f_raw_cookies;
            }
            await startLogin(wangwang,account,password,cookies).catch(async (err) => {
                console.error(err);
            });
        }
    })
    process.exit()
})();
