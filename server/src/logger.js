import log4js from 'log4js'
import _ from 'lodash-es'
import { ORDER_SIDES } from 'share/const.js'
import { checkSymbol, isDev } from 'share/utils.js'
import bot from './bot.js'

const appenders = ['console']
if (!isDev()) {
    appenders.push('fileFilter')
}
// 配置日志记录器
log4js.configure({
    appenders: {
        console: {
            type: 'stdout',
        }, // 输出到控制台
        file: {
            type: 'file', // 使用 file appender 进行文件输出
            filename: 'logs/app.log', // 日志文件路径（不需要扩展名，自动添加）
            pattern: 'yyyy-MM-dd', // 日志文件轮换的模式，按天轮换
            alwaysIncludePattern: true, // 始终在文件名中添加日期后缀
            daysToKeep: 7, // 保留最近 7 天的日志文件
            compress: false, // 启用日志文件压缩（.gz 格式）
            layout: {
                type: "pattern",
                pattern: "[%d] [%p] - %m",
            },
        },
        fileFilter: {
            type: 'logLevelFilter',
            appender: 'file',
            level: 'warn', // 仅warn以上级别日志写入到磁盘
        },
    },
    categories: {
        default: { appenders, level: 'trace' }, // 设置日志级别和输出方式
    },
})

const _logger = log4js.getLogger()

function getSLTPOperName(symbol, side, isZh = false) {
    const cSymbol = checkSymbol(symbol)
    if (cSymbol.isSpot) {
        return !isZh ? 'SELL' : '卖出'
    } else {
        if (side === ORDER_SIDES.BUY) {
            return !isZh ? 'SELL SHORT' : '卖空'
        } else {
            return !isZh ? 'SELL LONG' : '卖多'
        }
    }
}

function getOperName(symbol, side, isZh = false) {
    const cSymbol = checkSymbol(symbol)
    if (cSymbol.isSpot) {
        return !isZh ? 'BUY' : '买入'
    } else {
        if (side === ORDER_SIDES.BUY) {
            return !isZh ? 'BUY LONG' : '做多'
        } else {
            return !isZh ? 'BUY SHORT' : '做空'
        }
    }
}

const TICKER_SUSPENPOSITIOND_TIME = 10 * 1000
const POSITION_SUSPEND_TIME = 10 * 1000

class Logger {
    order(amount) {
        _logger.info(`Orders changed, amount:${amount}`)
    }

    // createMarketOrder({ exchange, symbol, side, amount, unitName }) {
    //     _logger.info(`创建现货市价单 ${exchange} ${symbol} ${getOperName(symbol, side)} ${amount}(${unitName})`)
    // }

    // markOrderSucc({ exchange, symbol, side, result, market }) {
    //     console.log(result)
    //     logger.info(`现货市价单成交 ${exchange} ${getOperName(symbol, side)} 成交价格:${result.average} 成交额(${market.quote}):${result.cost} 成交量(${market.base}):${result.filled}`)
    // }

    _lastUpdateTime = {}
    getLastUpdateTime() {
        // console.log('getLastUpdateTime', this._lastUpdateTime)
        return this._lastUpdateTime
    }

    // _lastTickerTime = {}
    _tickerReceiveTimeout = {}
    _receiveTickerTimout(exchange) {
        return setTimeout(() => {
            _logger.warn(`Tickers SUSPEND receive from ${exchange}`)
            bot.pushMessage(`${exchange} Ticker监听已中断`)
            this._tickerReceiveTimeout[exchange] = null
            _.set(this._lastUpdateTime, [exchange, 'ticker'], null)
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
        _.set(this._lastUpdateTime, [exchange, 'ticker'], Date.now())
        // this._lastUpdateTime[exchange] = Date.now()
    }

    // _lastPositinTime = {}
    _positionReceiveTimout = {}
    _receivePositionTimeout(exchange) {
        return setTimeout(() => {
            _logger.warn(`Positions SUSPEND receive from ${exchange}`)
            bot.pushMessage(`${exchange} Position监听已中断`)
            this._positionReceiveTimout[exchange] = null
            _.set(this._lastUpdateTime, [exchange, 'position'], null)
        }, POSITION_SUSPEND_TIME)
    }
    position({ exchange }) {
        if (!this._positionReceiveTimout[exchange]) {
            _logger.info(`Positions START receive from ${exchange}`)
        } else {
            clearTimeout(this._positionReceiveTimout[exchange])
        }
        this._positionReceiveTimout[exchange] = this._receivePositionTimeout(exchange)
        // this._lastPositinTime[exchange] = Date.now()
        _.set(this._lastUpdateTime, [exchange, 'position'], Date.now())
    }

    sltp({ exchange, symbol, isSL, side, triggerPrice, lastPrice, amount, unit }) {
        _logger.info(`${isSL ? 'SL' : 'TP'} Order TRIGGERED on ${exchange}, ${symbol}, ${getSLTPOperName(symbol, side)}, last:${lastPrice}, trigger:${triggerPrice}, amount:${amount} unit:${unit}`)
    }
    sltpSucc({ exchange, symbol, isSL, side, cost, price, useTWAP, totalMinute, priceLimit }) {
        if (!useTWAP) {
            _logger.info(`${isSL ? 'SL' : 'TP'} Order SUCCESS on ${exchange}, ${symbol}, ${getSLTPOperName(symbol, side)}, volume:${cost}, price:${price}`)
            bot.pushMessage(`${isSL ? '止损' : '止盈'} 成功\n${exchange} ${symbol}\n${getSLTPOperName(symbol, side, true)} 价格: ${price} 消费: ${cost}`)
        } else {
            _logger.info(`${isSL ? 'SL' : 'TP'} Order Trigger TWAP on ${exchange}, ${symbol}, ${getSLTPOperName(symbol, side)}, totalMinute:${totalMinute}, priceLimit:${priceLimit}`)
            bot.pushMessage(`${isSL ? '止损' : '止盈'} 触发TWAP 成功\n${exchange} ${symbol}\n${getSLTPOperName(symbol, side, true)} 分钟: ${totalMinute} 限价: ${priceLimit}`)
        }
    }
    sltpErr({ exchange, symbol, e }) {
        _logger.trace(`SLTP Order FAILED on ${exchange}, ${symbol}`, e)
        bot.pushMessage(`止盈止损 失败\n${exchange} ${symbol}\n${e.message}`)
    }

    cond({ exchange, symbol, side, lastPrice, triggerPrice }) {
        _logger.info(`Condition Order TRIGGERED on ${exchange}, ${symbol}, ${getOperName(symbol, side)}, last:${lastPrice}, trigger:${triggerPrice}`)
    }
    condSucc({ exchange, symbol, side, cost, price, useTWAP, totalMinute, priceLimit }) {
        if (!useTWAP) {
            _logger.info(`Condition Order SUCCESS on ${exchange}, ${symbol}, ${getOperName(symbol, side)}, volume:${cost}, price:${price}`)
            bot.pushMessage(`条件委托 成功\n${exchange}, ${symbol}\n${getOperName(symbol, side, true)} 价格: ${price} 消费: ${cost}`)
        } else {
            _logger.info(`Condition Order Trigger TWAP on ${exchange}, ${symbol}, ${getOperName(symbol, side)}, totalMinute:${totalMinute}, priceLimit:${priceLimit}`)
            bot.pushMessage(`条件委托 触发TWAP 成功\n${exchange}, ${symbol}\n${getOperName(symbol, side, true)} 分钟: ${totalMinute} 限价: ${priceLimit}`)
        }
        
    }
    condErr({ exchange, symbol, e }) {
        _logger.error(`Condition Order FAILED on ${exchange}, ${symbol}`, e)
        bot.pushMessage(`条件委托 失败\n${exchange} ${symbol}\n${e.message}`)
    }
}

// export default new Proxy(new Logger(), (() => {
//     const funcMap = new Map()
//     return {
//         get(t, p) {
//             if (t[p]) {
//                 return t[p]
//             }
//             if (!funcMap.has(p)) {
//                 funcMap.set(p, _logger[p] && _logger[p].bind(_logger))
//             }
//             return funcMap.get(p)
//         },
//     }
// })())

const logger = new Proxy(new Logger(), {
    get(t, p) {
        return t[p] || _logger[p]
    },
})

// const logger = new Logger()
// Object.setPrototypeOf(logger, _logger)
// console.log('logger', logger.order, logger.trace)
export default logger