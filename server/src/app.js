/*
 *                        _oo0oo_
 *                       o8888888o
 *                       88" . "88
 *                       (| -_- |)
 *                       0\  =  /0
 *                     ___/`---'\___
 *                   .' \\|     |// '.
 *                  / \\|||  :  |||// \
 *                 / _||||| -:- |||||- \
 *                |   | \\\  - /// |   |
 *                | \_|  ''\---/''  |_/ |
 *                \  .-\__  '-'  ___/-. /
 *              ___'. .'  /--.--\  `. .'___
 *           ."" '<  `.___\_<|>_/___.' >' "".
 *          | | :  `- \`.;`\ _ /`;.`/ - ` : | |
 *          \  \ `_.   \_ __\ /__ _/   .-` /  /
 *      =====`-.____`.___ \_____/___.-`___.-'=====
 *                        `=---='
 * 
 * 
 *      ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * 
 *            佛祖保佑       财源滚滚     永无BUG
 */
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import Decimal from 'decimal.js'

import connectDB from './database/db.js'

import monitor from './monitor/monitor.js'

import orderRoute from './api/order.js'
import marketRoute from './api/market.js'
import exchangeRoute from './api/exchange.js'
import positionRoute from './api/position.js'
import transferRoute from './api/transfer.js'

import { authRouter, httpAuth } from './auth/auth.js'

import socket from './socket/socket.js'
import logger from './logger.js'

// 设置Decimal的默认舍入模式
Decimal.config({ rounding: Decimal.ROUND_DOWN })

async function init() {
    try {
        logger.warn('init server!')

        await connectDB()
        await monitor.start()

        const app = new Hono()

        app.use('*', httpAuth)
            .get('/', (c) => {
                return c.text('Hello Hono!')
            })
            .route('/exchange', exchangeRoute)
            .route('/order', orderRoute)
            .route('/market', marketRoute)
            .route('/position', positionRoute)
            .route('/transfer', transferRoute)
            .route('/auth', authRouter)

        app.onError((err, c) => {
            logger.error(err)
            return c.json(err.message, 500)
        })
        const server = serve(
            {
                fetch: app.fetch,
                port: process.env.PORT || 3000,
            },
            (info) => {
                logger.info(`Server is running on http://localhost:${info.port}`)
            },
        )
        socket.serve({ server })
    } catch (e) {
        logger.fatal(e)
        // 主程序错误，抛出并终止，由docker重启
        throw e
    }
}

init()
