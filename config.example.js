const config = {
    headless: false,
    serverName:'dev',
    // tuijian_spider_concurrency: 3,
    // canmou_index_concurrency: 3,
    // canmou_login_user_data:'D:\\data\\workspace\\zz-puppeteer\\canmou\\',
    // report_exec_path: 'D:\\data\\workspace\\zz-puppeteer\\', // 文件执行的路径，不包含文件名
    mysql:{
        host     : '',
        user     : '',
        password : '',
        database : 'jupin_spider_config'
      },
    mysql_zhizuan:{
        host     : '',
        user     : '',
        password : '',
        database : 'jupin_zhizuan'
      },
    mysql_boss:{
        host     : '',
        user     : '',
        password : '',
        database : 'jupin_erp_business'
    },
    mongo:{
        url : 'mongodb:///zz_web',
      },

    mail:{
        user: '',
        password: '',
        server: '',
        to:''
    }
    }

module.exports = config
