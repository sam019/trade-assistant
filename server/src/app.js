import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import fs from 'fs'
import { createServer } from 'node:https'
import Decimal from "decimal.js"

import { isDev } from "../../share/utils.js"

import connectDB from "./database/db.js"
import monitor from "./monitor/monitor.js"
import orderRoute from "./api/order.js"
import marketRoute from "./api/market.js"
import exchangeRoute from "./api/exchange.js"
import positionRoute from "./api/position.js"
import transferRoute from "./api/transfer.js"
import { authRouter, httpAuth } from "./auth/auth.js"
import socket from "./socket/socket.js"

// 设置Decimal的默认舍入模式
Decimal.config({ rounding: Decimal.ROUND_DOWN })

let corsOrigin
// console.log('isDev', isDev())
if (isDev()) {
    corsOrigin = ['localhost', '127.0.0.1', '0.0.0.0', process.env.LAN_IP].map(host => `https://${host}:${process.env.WEB_PORT}`)
} else {
    corsOrigin = [`https://${process.env.DOMAIN}:${process.env.WEB_PORT}`]
}

async function init() {
    await connectDB()
    monitor.start()
    const app = new Hono()

    app.use('*', cors({
        origin(domain) {
            // console.log('domain', domain)
            if (corsOrigin.includes(domain)) {
                return domain
            }
            return ''
        },
        credentials: true,
        maxAge: 3600,
    })).use('*', httpAuth)
        .get("/", (c) => {
            return c.text("Hello Hono!")
        })
        .route("/exchange", exchangeRoute)
        .route("/order", orderRoute)
        .route("/market", marketRoute)
        .route("/position", positionRoute)
        .route("/transfer", transferRoute)
        .route("/auth", authRouter)

    app.onError((err, c) => {
        console.error(err.message)
        return c.json(err.message, 500)
    })
    const serverParams = {
        fetch: app.fetch,
        port: process.env.PORT || 3000,
    }
    if (isDev()) {
        serverParams.createServer = createServer
        serverParams.serverOptions = {
            key: fs.readFileSync('../localhost+3-key.pem'),
            cert: fs.readFileSync('../localhost+3.pem'),
        }
    }
    const server = serve(
        serverParams,
        (info) => {
            console.log(`Server is running on https://localhost:${info.port}`)
        },
    )
    // console.log('corsOrigin', corsOrigin)
    socket.serve({ server, corsOrigin })
}

init()
