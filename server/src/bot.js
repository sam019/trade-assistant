import fs from 'fs'

import TelegramBot  from 'node-telegram-bot-api'

import { isDev } from 'share/utils.js'

import logger from './logger.js'
import orderMonitor from './monitor/orderMonitor.js'



let token, myChatId
if (isDev()) {
    token = process.env.BOT_TOKEN
    myChatId = process.env.CHAT_ID
} else {
    token = fs.readFileSync('/run/secrets/BOT_TOKEN', 'utf8').trim()
    myChatId = fs.readFileSync('/run/secrets/CHAT_ID', 'utf8').trim()
}

// console.log('BOT_TOKEN', token)
// console.log('CHAT_ID', process.env.CHAT_ID)
let bot
if (!isDev()) {
    bot = new TelegramBot(token, { polling: true })

    // bot.sendMessage(process.env.CHAT_ID, 'Hello World')
    bot.onText('/state', (msg) => {
        try {
        // console.log('message', msg)
            const chatId = msg.chat.id
            const updateTime = logger.getLastUpdateTime()
            // console.log('updateTime', updateTime)
            const message = Object.entries(updateTime).map(([exchange, times]) => {
                const tickerTime = times.ticker ? `${Math.floor((Date.now() - times.ticker) / 1000) }秒前` : '超时'
                const positionTime = times.position ? `${Math.floor((Date.now() - times.position) / 1000) }秒前` : '超时'
                return `${exchange}\nticker更新时间 ${tickerTime}\nposition更新时间 ${positionTime}\n`
            }).join('\n')
            // console.log('message', message)
            bot.sendMessage(chatId, message || '无数据')
        } catch (e) {
        // console.log(e)
            logger.error('Telegram Bot error: ', e)
        }
    })

    bot.onText('/order', (msg) => {
        try {
            const chatId = msg.chat.id
            const message = orderMonitor.orders.map(order => {
                let text = `${order.exchange} ${order.symbol} ${order.type}`
                if (order.triggerPrice) {
                    text += ` 触发价:${order.slPrice}`
                }
                if (order.slPrice) {
                    text += ` 止损:${order.slPrice}`
                }
                if (order.tpPrice) {
                    text += ` 止盈:${order.slPrice}`
                }
                text += ` 数量:${order.amount} 单位:${order.unit}`
                if (order.leverage) {
                    text += ` ${order.leverage}x`
                }
                if (order.useTWAP) {
                    text += ` TWAP 时长:${order.totalMinute}`
                    if (order.priceLimit) {
                        text += ` 限价:${order.priceLimit}`
                    }
                }
                return text
            }).join('\n')
            // console.log('message', message)
            bot.sendMessage(chatId, message || '无数据')
        } catch (e) {
            logger.error('Telegram Bot error: ', e)
        }
    })
}

// setTimeout(() => {
//     const message = orderMonitor.orders.map(order => {
//         let text = `${order.exchange} ${order.symbol} ${order.type}`
//         if (order.triggerPrice) {
//             text += ` 触发价:${order.slPrice}`
//         }
//         if (order.slPrice) {
//             text += ` 止损:${order.slPrice}`
//         }
//         if (order.tpPrice) {
//             text += ` 止盈:${order.slPrice}`
//         }
//         text += ` 数量:${order.amount} 单位:${order.unit}`
//         if (order.leverage) {
//             text += ` ${order.leverage}x`
//         }
//         if (order.useTWAP) {
//             text += ` TWAP 时长:${order.totalMinute}`
//             if (order.priceLimit) {
//                 text += ` 限价:${order.priceLimit}`
//             }
//         }
//         return text
//     }).join('\n')
//     console.log('orders', message)
// }, 1000 * 10)



export default {
    pushMessage(text) {
        bot && bot.sendMessage(myChatId, text)
    },
}