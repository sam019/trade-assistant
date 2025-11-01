import TelegramBot  from 'node-telegram-bot-api'
import fs from 'fs'

import logger from './logger.js'
import { isDev } from '../../share/utils.js'

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
            logger.error('Telegram Bot error: ', e.message)
        }
    })
}




export default {
    pushMessage(text) {
        bot && bot.sendMessage(myChatId, text)
    },
}