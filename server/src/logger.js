import log4js from 'log4js'

import { ORDER_SIDES } from '../../share/const.js'
import { checkSymbol } from '../../share/utils.js'

// 配置日志记录器
log4js.configure({
    appenders: {
        out: { type: "stdout" }, // 输出到控制台
        app: {
            type: "file", // 使用 file appender 进行文件输出
            filename: "logs/app.log", // 日志文件路径（不需要扩展名，自动添加）
            pattern: "yyyy-MM-dd", // 日志文件轮换的模式，按天轮换
            alwaysIncludePattern: true, // 始终在文件名中添加日期后缀
            daysToKeep: 7, // 保留最近 7 天的日志文件
            compress: true, // 启用日志文件压缩（.gz 格式）
        },
    },
    categories: {
        default: { appenders: ["out", "app"], level: "info" }, // 设置日志级别和输出方式
    },
})

const _logger =log4js.getLogger()

function getSLTPOperName(symbol, side) {
    const cSymbol = checkSymbol(symbol)
    if (cSymbol.isSpot) {
        return 'SELL'
    } else {
        if (side === ORDER_SIDES.BUY) {
            return 'SELL SHORT'
        } else {
            return 'SELL LONG'
        }
    }
}

function getCondOperName(symbol, side) {
    const cSymbol = checkSymbol(symbol)
    if (cSymbol.isSpot) {
        return 'BUY'
    } else {
        if (side === ORDER_SIDES.BUY) {
            return 'BUY LONG'
        } else {
            return 'BUY SHORT'
        }
    }
}

const TICKER_SUSPENPOSITIOND_TIME = 5 * 1000
const POSITION_SUSPEND_TIME = 5 * 1000

class Logger {
    order(amount) {
        _logger.info(`Orders changed, amount:${amount}`)
    }

    _tickerReceiveTimeout = {}
    _receiveTickerTimout(exchange) {
        return setTimeout(() => {
            _logger.warn(`Tickers SUSPEND receive from ${exchange}`)
            this._tickerReceiveTimeout[exchange] = null
        }, TICKER_SUSPENPOSITIOND_TIME)
    }
    ticker({ exchange }) {
        if (!this._tickerReceiveTimeout[exchange]) {
            // console.log('ticker log new', exchange)
            _logger.info(`Tickers START receive from ${exchange}`)
        } else {
            // console.log('ticker log contiu', exchange)
            clearTimeout(this._tickerReceiveTimeout[exchange])
        }
        this._tickerReceiveTimeout[exchange] = this._receiveTickerTimout(exchange)
    }

    _positionReceiveTimout = {}
    _receivePositionTimeout(exchange) {
        return setTimeout(() => {
            _logger.warn(`Positions SUSPEND receive from ${exchange}`)
            this._positionReceiveTimout[exchange] = null
        }, POSITION_SUSPEND_TIME)
    }
    position({ exchange }) {
        if (!this._positionReceiveTimout[exchange]) {
            _logger.info(`Positions START receive from ${exchange}`)
        } else {
            clearTimeout(this._positionReceiveTimout[exchange])
        }
        this._positionReceiveTimout[exchange] = this._receivePositionTimeout(exchange)
    }

    sltp({ exchange, symbol, isSL, side, triggerPrice, lastPrice, amount, unit }) {
        _logger.info(`${isSL ? 'SL' : 'TP'} Order TRIGGERED on ${exchange}, ${symbol}, ${getSLTPOperName(symbol, side)}, last:${lastPrice}, trigger:${triggerPrice}, amount:${amount} unit:${unit}`)
    }
    sltpSucc({ exchange, symbol, isSL, side, amount, unit, price }) {
        _logger.info(`${isSL ? 'SL' : 'TP'} Order SUCCESS on ${exchange}, ${symbol}, ${getSLTPOperName(symbol, side)}, amount:${amount} unit:${unit}, price:${price}`)
    }
    sltpErr({ exchange, symbol, e }) {
        _logger.trace(`SLTP Order FAILED on ${exchange}, ${symbol}`, e)
    }

    cond({ exchange, symbol, side, lastPrice, triggerPrice }) {
        _logger.info(`Condition Order TRIGGERED on ${exchange}, ${symbol}, ${getCondOperName(symbol, side)}, last:${lastPrice}, trigger:${triggerPrice}`)
    }
    condSucc({ exchange, symbol, side, amount, price }) {
        _logger.info(`Condition Order SUCCESS on ${exchange}, ${symbol}, ${getCondOperName(symbol, side)}, amount:${amount}, price:${price}`)
    }
    condErr({ exchange, symbol, e }) {
        _logger.trace(`Condition Order FAILED on ${exchange}, ${symbol}`, e)
    }
}

export default new Proxy(new Logger, {
    get(t, p) {
        return t[p] || _logger[p]
    },
})