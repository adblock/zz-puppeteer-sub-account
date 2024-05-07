const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const dateFormat = require('dateformat');
const {mongoInit, mysqlCfgSql} = require('../commons/db');
const {asyncForEach, setJs} = require('../commons/func');
const config = require('../config');
puppeteer.use(StealthPlugin())
/**
 * 获取 boss 的子账号登录，存到mongodb 中
 * */

let G_CHECK_FLAG = 0;
let G_RETRY = 0;
let G_SUCCESS = 0;
let G_CHECKARR = [];
let G_SEND_TIME = '';
let G_BROWSER = null;
let G_MONGO = null;
let G_HuaKuai = 0;


const startLogin = async (wangwang, account, password) => {
    let succ = 0;
    try {
        const browser = await puppeteer.launch({ 
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            headless: false 
        });


        G_BROWSER = browser;
        let pages = await browser.pages();
        for (let i = 0; i < pages.length; i++) {
            if (i > 0) {
                await pages[i].close();
            }
        }
        const page = pages[0];
        // await page.bringToFront();
        await page.setDefaultTimeout(60000);
        await page.setDefaultNavigationTimeout(60000);


        await page.on('response', async (response) => {
            const update_at = dateFormat(new Date(), "yyyy-mm-dd HH:MM:ss");
            if (response.url().indexOf('getPersonalView.json') > -1) {
                G_SUCCESS = 1;
                const cookie = await page.cookies();
                await saveSuccessCookies(cookie, wangwang, account, password);
                succ = 1;
                await browser.close();
            }

            if (response.url().indexOf('https://aq.taobao.com/durex/pageLog') > -1) {
                await page.waitFor(5000);
                const frames = await page.frames();
                const checkFrames = frames.find(f => f.url().indexOf("aq.taobao.com/durex/validate") > -1);
                G_CHECK_FLAG = 0;
                await checkCode(checkFrames, wangwang, account, password)
            }

            if (response.url().indexOf('aq.taobao.com/durex/checkcode') > -1) {
                let data = await response.json();
                if (G_CHECK_FLAG === 1 && data.isG_SUCCESS === false) {
                    const frames = await page.frames();
                    const checkFrames = frames.find(f => f.url().indexOf("aq.taobao.com/durex/validate") > -1);
                    if (G_CHECKARR.length > 0) {
                        await writeCheck(checkFrames, wangwang, account, password)
                    } else {
                        if (G_RETRY < 3) {     // 重试三次
                            G_RETRY += 1;
                            await checkCode(checkFrames, wangwang, account, password)
                        }
                    }
                }
            }
        });

        // 打开生意参谋首页
        const homeUrl = 'https://sycm.taobao.com/custom/login.htm?_target=http://sycm.taobao.com/portal/home.htm';
        await page.goto(homeUrl, {
            waitUntil: 'networkidle0',
        });

        if (false) {  // cookie有效，将有效状态保证为 1
            const cookie = await page.cookies();
            await saveSuccessCookies(cookie, wangwang, account, password);
            succ = 1;
            await browser.close()
        } else {
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

            let loginBtn = await loginFrame.$('[type="submit"]');
            await loginBtn.click({
                delay: 200
            });
            await page.waitFor(1500);

            // 滑块
            let moreFrames = await page.frames();
            let huaFrames = moreFrames.find(f=>f.url().indexOf('/_____tmd_____/punish?')>-1);
            if(huaFrames){
                G_HuaKuai =1;
                // await G_BROWSER.close();
                return true;
            }
        }


        if (await browser.isConnected()) {
            await page.waitForNavigation({waitUntil: 'networkidle2'});
            await browser.close();
        }
    } catch (e) {
        console.log('Error:',e.message);
        //出现滑块且页面超时且账号有效，则保存滑块内容
        if(e.message.includes('Navigation timeout of') && G_HuaKuai && !succ){
            await saveErrorCookies(wangwang, '出现滑块，请尝试手动划过滑块', account, password);
        }
        await G_BROWSER.close();
        return succ
    }
};
const sleep = async(time=0) => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, time);
    })
};
// 获取子账号方法
async function get_sub_account(wangwang) {
    const boss = config.mysql_boss;
    let sql = `
        select t_order.f_lz_account as f_lz_account, t_order.f_lz_password as f_lz_password 
        from (t_order left join t_product on t_order.f_foreign_product_id = t_product.id) 
        left join t_task on t_order.id = t_task.f_foreign_order_id
        where t_product.f_foreign_sku_kind in ('淘宝/天猫代运营','淘宝/天猫流量','直通车', '钻展', '超级推荐', '超级直播', '超级互动城', '万相台', '引力魔方') 
        and t_order.f_copy_wangwangid = '${wangwang}' 
        and (t_task.f_foreign_task_state_id in (1,2) 
        or (t_task.f_foreign_task_state_id in (3,10) and datediff(now(),t_task.f_last_stop_time) <= 30)
        or (t_task.f_foreign_task_state_id = 4 and datediff(now(),t_task.f_task_end_time) <= 30))
        order by field(t_product.f_foreign_sku_kind,'淘宝/天猫代运营','淘宝/天猫流量','直通车', '钻展', '超级推荐', '超级直播', '超级互动城', '万相台', '引力魔方');
    `;
    return await mysqlCfgSql(boss, sql);

}

// 获取验证码方法
const checkCode = async (checkFrames, accountData, account, password) => {
    const phone = await checkFrames.$eval('.new-phone-current', el => el.innerHTML);
    console.log(phone)
    const phone_end = phone.slice(-4);
    if (!(phone_end == '6910' || phone_end == '6912' || phone_end == '6913')) {
        await saveErrorCookies(accountData, '接收验证码手机号不是本公司手机号', account, password);
        if (G_BROWSER) {
            await G_BROWSER.close();
            G_BROWSER = null;
        }
    }
    const getCheck = await checkFrames.$('.send-code-btn');
    if (getCheck && G_CHECK_FLAG === 0) {
        await getCheck.click();
        G_CHECK_FLAG = 1;
    }
    if (G_SEND_TIME === '') {
        G_SEND_TIME = await dateFormat(new Date(), 'yyyy-mm-dd HH:MM:ss');
    }
    console.log(G_SEND_TIME)

    await checkFrames.waitFor(20000);     // 等待20s 验证码发送
    G_CHECKARR = await G_MONGO.db.collection('zz_sms').find({'phone_num': phone_end}).sort({"time": -1}).limit(3).toArray();
    G_SEND_TIME = await dateFormat(new Date(), 'yyyy-mm-dd HH:MM:ss');
    // 循环填入
    await writeCheck(checkFrames, accountData, account, password)
};

// 填写验证码
const writeCheck = async (checkFrames, wangwang, account, password) => {
    try {
        console.log(G_CHECKARR);
        let check = G_CHECKARR.shift();
        if (G_CHECKARR.length > 0) {
            console.log(check['message']);
            const code = check['message'].match(/验证码(\S*)，/)[1]
            if (code) {
                const yanCode = code.slice(0, 6);
                console.log(yanCode);
                //清空输入框的值
                await checkFrames.$eval('.J_SafeCode', input => input.value = '');
                await checkFrames.type('.J_SafeCode', yanCode.toString(), {delay: 100});
                await checkFrames.waitFor(1500);
                await checkFrames.click('#J_FooterSubmitBtn');
                await checkFrames.waitFor(5000);
            }
        } else {
            console.log(G_CHECKARR);
            await saveErrorCookies(
                wangwang,
                '未获取到验证码', account, password);
            G_BROWSER.close();
            G_BROWSER = null;

        }
    } catch (e) {
        console.log(e);
    }
};

// 存储cookie
const saveSuccessCookies = async (cookie, wangwang, account, password) => {
    let cookieObj = {
        f_raw_cookies: {"sycmCookie": cookie},
        f_valid_status: 1,
        wangwang_id: wangwang,
        account: account,
        password: password,
        f_is_used: 1,
        f_date: dateFormat(new Date(), "yyyy-mm-dd"),
        created_at: new Date(),
        updated_at: new Date(),
    };
    console.log(cookieObj);

    await G_MONGO.db.collection('sub_account_login').deleteMany({
        'wangwang_id': wangwang,
        'f_use': {$exists: 0},
    });
    await G_MONGO.db.collection('sub_account_login').insertOne(cookieObj);
};
const saveErrorCookies = async (wangwang, titleMsg, account, password) => {
    let cookieObj = {
        f_raw_cookies: null,
        f_valid_status: 0,
        wangwang_id: wangwang,
        account: account,
        password: password,
        f_is_used: titleMsg,
        f_date: dateFormat(new Date(), "yyyy-mm-dd"),
        created_at: new Date(),
        updated_at: new Date(),
    };

    await G_MONGO.db.collection('sub_account_login').deleteMany({
        'wangwang_id': wangwang,
        'f_use': {$exists: 0},
    });
    await G_MONGO.db.collection('sub_account_login').insertOne(cookieObj);
};


(async () => {
    const args = process.argv.splice(2);
    const type = args[0];
    // 获取失效子账号
    const today = dateFormat(new Date(), "yyyy-mm-dd");
    G_MONGO = await mongoInit();
    let invalid_account = [];
    if (type === 'all') {
        invalid_account = await G_MONGO.db.collection('sub_account_login')
            .find({'wangwang_id': "伊心爱家纺旗舰店"})
            .toArray();
    } else {
        invalid_account = await G_MONGO.db.collection('sub_account_login').find({
            'f_valid_status': 0,
            'f_use': {$exists: 0},
            $or: [
                {'f_is_used': {}},
                {'f_is_used': 1},
                {'f_is_used': ""},
                {'f_is_used': "出现滑块，请尝试手动划过滑块"},
                {'f_is_used': "验证码错误，请重新输入"},
                {'f_is_used': "你输入的密码和账户名不匹配，如果你近期修改过密码，请使用新密码登录"},
                {'f_is_used': "登录名或登录密码不正确"},
                {"f_is_used": {"name": "TimeoutError"}}
            ]
        }).toArray();
    }

    await asyncForEach(invalid_account, async (invalid, index) => {
        const wangwang = invalid.wangwang_id;
        console.log(wangwang)
        const order_list = await get_sub_account(wangwang);
        if (order_list.length > 0) {
            for(let order of order_list){       // 多个子账号，所有账号尝试，登录成功就退出
                const account = order.f_lz_account.trim();
                const password = order.f_lz_password.trim();
                console.log(account, password)
                console.log(index + 1, account);
                if (account) {
                    G_RETRY = 0;
                    G_SUCCESS = 0;
                    G_SEND_TIME = '';
                    let status = await startLogin(wangwang, account, password).catch(async (err) => {
                        console.error(err);
                    });
                    if(status === 1){
                        break
                    }
                }
            }
        } else {
            await G_MONGO.db.collection('sub_account_login').deleteMany({
                'wangwang_id': wangwang,
                'f_use': {$exists: 0},
            });
        }
    })
    await G_MONGO.close();
    process.exit();
})();
