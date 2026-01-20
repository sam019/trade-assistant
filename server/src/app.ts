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
import { readFileSync } from 'fs'
import path from 'path'
import { createServer } from 'node:https'
import type { Server as HTTPServer } from 'node:https'

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import Decimal from 'decimal.js'

import { isDev } from 'share/utils.js'

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
import { getLocalIpAddress } from './utils.js'

// 设置Decimal的默认舍入模式
Decimal.config({ rounding: Decimal.ROUND_DOWN })

let corsOrigin: string[]
if (isDev()) {
    const localIp = getLocalIpAddress()
    corsOrigin = ['localhost', '127.0.0.1', '0.0.0.0', localIp]
        .filter((host): host is string => host !== null)
        .map(host => `https://${host}:${process.env.WEB_PORT || '443'}`)
} else {
    const domain = process.env.DOMAIN || ''
    const webPort = process.env.WEB_PORT || '443'
    corsOrigin = [`https://${domain}:${webPort}`]
}

async function init(): Promise<void> {
    try {
        logger.warn('init server!')

        await connectDB()
        await monitor.start()

        const app = new Hono()

        app.use('*', cors({
            origin(domain: string): string {
                if (corsOrigin.includes(domain)) {
                    return domain
                }
                return ''
            },
            credentials: true,
            maxAge: 7200,
        })).use('*', httpAuth)
            .get('/', (c) => {
                return c.text('Hello Hono!')
            })
            .route('/exchange', exchangeRoute)
            .route('/order', orderRoute)
            .route('/market', marketRoute)
            .route('/position', positionRoute)
            .route('/transfer', transferRoute)
            .route('/auth', authRouter)

        app.onError((err: Error, c) => {
            logger.error(err)
            return c.json(err.message, 500)
        })

        interface ServerParams {
            fetch: typeof app.fetch
            port: number | string
            createServer?: typeof createServer
            serverOptions?: {
                key: Buffer
                cert: Buffer
            }
        }

        const serverParams: ServerParams = {
            fetch: app.fetch,
            port: process.env.PORT || 3000,
        }

        if (isDev()) {
            serverParams.createServer = createServer
            serverParams.serverOptions = {
                key: readFileSync(path.join(import.meta.dirname, '../../localhost+3-key.pem')),
                cert: readFileSync(path.join(import.meta.dirname, '../../localhost+3.pem')),
            }
        }

        const server = serve(
            serverParams,
            (info: { port: number }) => {
                logger.info(`Server is running on https://localhost:${info.port}`)
            },
        )

        socket.serve({ server, corsOrigin })
    } catch (e) {
        logger.fatal(e)
        // 主程序错误，抛出并终止，由docker重启
        throw e
    }
}

init()

