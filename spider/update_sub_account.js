/*
@File     ：update_sub_account.py
@Author   ：qingyang
@Date     ：2021/8/19 10:27 
@describe ：
*/
const puppeteer = require('puppeteer');
const dateFormat = require('dateformat');
const { mongoInit, mysqlCfgSql } = require('../commons/db');
const { asyncForEach, setJs, logPrint } = require('../commons/func');
const config = require('../config');
const random = require('string-random');
const crypto = require('crypto');

let G_CHECK_FLAG = 0;
let G_RETRY = 0;
let G_SUCCESS = 0;
let G_CHECKARR = [];
let G_SEND_TIME = '';
let G_MONGO = null;
let G_BROWSER = null;
let G_PARAMS = null;

/**
 * 更新cookie（如果成功更新cookie，更改状态为1（有效）和更新密码， 失败更新状态为0（无效））
 * @param status
 * @param cookie
 * @param password
 * @returns {Promise<void>}
 */
const updateCookieStatus = async (status,cookie, password)=>{
    if(status===0){
        await G_MONGO.db.collection('sub_account_login').updateOne({
            'account': G_PARAMS[0],
        },{$set:{
                'f_valid_status':status,
                'updated_at':new Date(),
                'f_raw_cookies':cookie,
            }});
    }else {
        await G_MONGO.db.collection('sub_account_login').updateOne({
            'account': G_PARAMS[0],
        },{$set:{
                'f_valid_status':status,
                'password':password,
                'f_raw_cookies': {"sycmCookie":cookie},
                'updated_at':new Date(),
            }});
    }
};

/**
 * 获取page对象
 * @returns {Promise<*>}
 */
const getPage = async() => {
    const browser = await puppeteer.launch({
        headless: config.headless,
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
    G_BROWSER = browser;
    let pages = await browser.pages();
    for (let i = 0; i < pages.length; i++) {
        if (i > 0) {
            await pages[i].close();
        }
    }
    const page = await setJs(pages[0]);
    await page.bringToFront();
    await page.setViewport({
        width: 1024,
        height: 768
    });
    await page.setDefaultTimeout(90000);
    await page.setDefaultNavigationTimeout(90000);

    return page;
};

/**
 * 滑块解决
 * @param page
 * @param loginFrame
 * @returns {Promise<void>}
 */
const huakuai = async(page, loginFrame) => {
    // 滑块
    let hua = await loginFrame.$eval('#nocaptcha-password', el => {
        return window.getComputedStyle(el).getPropertyValue('display') === 'block'
    });
    for (let i = 0; i < 3; i++) {
        if (hua) {
            let rad_num = 400;
            const slide = await loginFrame.$('#nc_1_n1z');
            await page.waitFor(1500);
            const loc = await slide.boundingBox();
            await page.mouse.move(loc.x, loc.y);
            await page.mouse.down();
            rad_num = Math.ceil(Math.random() * 10) * 10 + 400;
            await page.mouse.move(loc.x + rad_num, loc.y);
            rad_num = Math.ceil(Math.random() * 10) * 10 + 400;
            await page.waitFor(1000 + rad_num);
            await page.mouse.up();
            await page.waitFor(1500);

            const err = await loginFrame.$('.errloading');
            if (err) {
                await loginFrame.click('.errloading > span.nc-lang-cnt > a')
            }
            const huaText = await loginFrame.$('#nc_1__scale_text');
            if (huaText) {
                const text = await loginFrame.$eval('#nc_1__scale_text > span.nc-lang-cnt', el => el.innerHTML);
                console.log(text);
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
    if (hua) {
        const huaText = await loginFrame.$('#nc_1__scale_text');
        if (huaText) {
            const text = await loginFrame.$eval('#nc_1__scale_text > span.nc-lang-cnt', el => el.innerHTML);
            console.log(text);
            if (text.indexOf('验证通过') === -1) {
                await G_BROWSER.close();
                process.exit();
            }
        }
    }
};

const loginSubAccount = async(page, params) => {
    let account = params[0];
    let password = params[1];

    await page.goto('https://zizhanghao.taobao.com/subaccount/myself/detail.htm', {waitUntil: 'networkidle2'});

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

    await huakuai(page, loginFrame);

    let loginBtn = await loginFrame.$('[type="submit"]');
    await loginBtn.click({
        delay: 200
    });
    let success = 0;
    await page.on('response', async (response) => {
            if (response.url().indexOf('sub/myself') > -1) {
                success = 1;
            }
            if (response.url().indexOf('https://login.taobao.com/newlogin/login.do') > -1) {
                let data = await response.json();
                if (data.content.data.iframeRedirectUrl) {
                    if (data.content.data.iframeRedirectUrl.indexOf('member/login_unusual.htm') > -1) {
                        await page.waitFor(5000);
                        const frames = await page.frames();
                        const checkFrames = frames.find(f => f.url().indexOf("aq.taobao.com/durex/validate") > -1);
                        await checkCode(checkFrames, account, password)
                    }
                }
                if (data.content.data.titleMsg) {
                    console.log(data.content.data.titleMsg);
                }
            }
            if (response.url().indexOf('aq.taobao.com/durex/checkcode') > -1) {
                let data = await response.json();
                if (G_CHECK_FLAG === 1 && data.isG_SUCCESS === false) {
                    const frames = await page.frames();
                    const checkFrames = frames.find(f => f.url().indexOf("aq.taobao.com/durex/validate") > -1);
                    if (G_CHECKARR.length > 0) {
                        await writeCheck(checkFrames, account, password)
                    } else {
                        if (G_RETRY < 3) {     // 重试三次
                            G_RETRY += 1;
                            await checkCode(checkFrames, account, password)
                        }
                    }
                }
            }
        });
    await page.waitFor(3000);
    if(success === 0){
        if(page.url().indexOf('login') > -1){
            const text = await loginFrame.$eval('.login-error-msg', el => el.innerHTML);
            console.log(text);
            await G_BROWSER.close();
            process.exit();
        } else {
            await page.waitForNavigation({waitUntil: 'networkidle2'});
        }
    }
};

// 获取验证码方法
const checkCode = async (checkFrames, account, password) => {
    const phone = await checkFrames.$eval('.new-phone-current', el => el.innerHTML);
    console.log(phone);
    const phone_end = phone.slice(-4);
    if (!(phone_end === '6910' || phone_end === '6912' || phone_end === '6913')) {
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
    console.log(G_SEND_TIME);

    await checkFrames.waitFor(20000);     // 等待20s 验证码发送
    G_CHECKARR = await G_MONGO.db.collection('zz_sms').find({'phone_num': phone_end}).sort({"time": -1}).limit(3).toArray();
    G_SEND_TIME = await dateFormat(new Date(), 'yyyy-mm-dd HH:MM:ss');
    // 循环填入
    await writeCheck(checkFrames, account, password)
};

// 填写验证码
const writeCheck = async (checkFrames, account, password) => {
    try {
        console.log(G_CHECKARR);
        let check = G_CHECKARR.shift();
        if (G_CHECKARR.length > 0) {
            console.log(check['message']);
            const code = check['message'].match(/验证码(\S*)，/)[1];
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
            G_BROWSER.close();
            G_BROWSER = null;
        }
    } catch (e) {
        console.log(e);
    }
};

const getSign = async (params) => {
    let data = JSON.stringify(params['data']);
    let str = "";
    str = str.concat(params['token'], "&", params['t'], "&", params['appKey'], "&", data);
    return crypto.createHash('md5').update(str).digest('hex');    //md5加密 十六进制
};

/**
 *
 * @param page
 * @param password_new
 * @returns {Promise<void>}
 */
const updateSubAccount = async(page, password_new) => {
    let token = '';
    let cookies = await page.cookies();
    await asyncForEach(cookies, async(cookie) => {
        if(cookie['name'] === '_m_h5_tk'){
            token = cookie['value'].split('_')[0]
        }
    });
    if(token){
        let t = new Date().getTime().toString();
        let data = {"password":password_new,"subId":0,"oldPassword":G_PARAMS[1]};
        let appKey = "12574478";
        let sign_param = {
            'token': token,
            't': t,
            'data': data,
            'appKey': appKey
        };
        let sign = await getSign(sign_param);
        let update_url = `https://acs.m.taobao.com/h5/mtop.taobao.eaweb.subaccount.password.modify/1.0/?jsv=2.6.1&appKey=${appKey}&t=${t}&sign=${sign}&api=mtop.taobao.eaweb.subaccount.password.modify&v=1.0&type=originaljson&needLogin=true&valueType=original&dataType=json&timeout=20000`;
        let body = {
            'data': JSON.stringify(data)
        };
        console.log(update_url, body);
        await sendPostRequest(page, body, update_url);
        await page.waitFor(3000);
        await page.reload();
        await page.waitForResponse(response => response.url().indexOf('login') > -1);
    }
};

/**
 * 发送请求的方法（POST）
 * @param {Object} page page类
 * @param body
 * @param {String} url  请求的url
 * */
const sendPostRequest = async (page, body, url)=>{
    body = Object.entries(body).map(([key, val]) => `${key}=${val}`).join('&');
    console.log(body);
    return await page.evaluate(async (body,url) => {
        let headers = {
            'sec-fetch-mode':'cors',
            'sec-fetch-site':'same-origin',
            'sec-fetch-dest':'empty',
            'content-type':'application/x-www-form-urlencoded',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Safari/537.36'
        };
        const response = await fetch(url,
            {
                body:body,
                credentials: 'include',
                method: 'POST',
                headers:headers,
            }
        );
        return await response.json();
    },body,url);
};

const checkLogin = async(page, password) => {
    const cookies = await page.cookies();
    await asyncForEach(cookies, async (value) => {
        await page.setCookie(value);
    });

    const homeUrl = 'https://myseller.taobao.com/home.htm';

    await page.setRequestInterception(true);
    page.on('request',  async(req) => {
        if(['image', 'stylesheet', 'font', 'script', 'other', 'fetch'].includes(req.resourceType())) {
            return req.abort();
        }
        return req.continue();
    });

     // 打开生意参谋首页
    await page.goto(homeUrl, {waitUntil: 'networkidle2'});
    console.log(page.url());
    let success = 0;
    if (page.url().indexOf('login') > -1) {
        // cookie失效，将有效状态保存为 0
        await updateCookieStatus(success, null, G_PARAMS[1]);
        return success;
    } else{
        // cookie有效，将有效状态保存为 1
        success = 1;
        const cookie = await page.cookies();
        await updateCookieStatus(success,cookie, password);
        return success;
    }
};

(async () => {
    // 获取子账号
    G_MONGO = await mongoInit();
    G_PARAMS = process.argv.splice(2);    // [0]账号， [1]密码

    try {
        let page = await getPage();
        // 登录
        await loginSubAccount(page, G_PARAMS);
        await page.waitFor(3000);

        // 更新子账号密码
        let new_password = random(8);   // Math.ceil(Math.random()*15); 可以随机长度字符串 todo
        await updateSubAccount(page, new_password);
        await logPrint('update_sub_account', G_PARAMS[0] + ', new_password: ' + new_password);

        // 使用新帐号登录
        let new_params = [G_PARAMS[0], new_password];
        await loginSubAccount(page, new_params);

        // 检查是否成功登录
        let success = await checkLogin(page, new_password);
        console.log(success);
        if(success){    // 如果成功，更新boss子账号密码
            let sql = `update t_order set f_lz_password='${new_password}' where f_lz_account='${G_PARAMS[0]}'`;
            let message = await mysqlCfgSql(config.mysql_boss, sql);
            console.log(message)
        }
    } catch (e) {
        console.log(e);
    } finally {
        await G_BROWSER.close();
        process.exit();
    }
})();
