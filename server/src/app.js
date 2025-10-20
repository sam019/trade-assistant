import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { Server } from "socket.io"

import connectDB from "./database/db.js"
import monitor from "./monitor/monitor.js"

import orderRoute from "./api/order.js"
import marketRoute from "./api/market.js"
import exchangeRoute from "./api/exchange.js"
import positionRoute from "./api/position.js"

import socketHandler from "./api/socketHandler.js"

async function init() {
    await connectDB()
    monitor.start()
    const app = new Hono()

    app.use('*', cors())
        .get("/", (c) => {
            return c.text("Hello Hono!")
        })
        .route("/exchange", exchangeRoute)
        .route("/order", orderRoute)
        .route("/market", marketRoute)
        .route("/position", positionRoute)

    // app.onError((err, c) => {
    //     console.error(err.message);
    //     return c.json(err.message, 500);
    // })

    const server = serve(
        {
            fetch: app.fetch,
            port: 3000,
        },
        (info) => {
            console.log(`Server is running on http://localhost:${info.port}`)
        },
    )

    const io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
        },
    })
    io.on("connection", socketHandler)
}

init()
