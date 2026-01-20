import log4js from 'log4js'
import _ from 'lodash-es'
import { ORDER_SIDES, type Exchange, type OrderSide } from 'share/const.js'
import { checkSymbol, isDev } from 'share/utils.js'
import bot from './bot.js'

const appenders: string[] = ['console']
if (!isDev()) {
    appenders.push('fileFilter')
    log4js.addLayout('fileLayout', (config) => (logEvent: log4js.LoggingEvent) => {
        return `[${logEvent.startTime.toLocaleString()}] [${logEvent.level.levelStr}]` + logEvent.data.map(d => d instanceof Error ? ` ${d.message}\n${d.stack}\n` : ` ${d}`).join('')
    })
}

// 配置日志记录器
log4js.configure({
    appenders: {
        console: {
            type: 'stdout',
        },
        file: {
            type: 'file',
            filename: 'logs/app.log',
            pattern: 'yyyy-MM-dd',
            alwaysIncludePattern: true,
            daysToKeep: 7,
            compress: false,
            layout: {
                type: 'fileLayout',
            },
        },
        fileFilter: {
            type: 'logLevelFilter',
            appender: 'file',
            level: 'warn',
        },
    },
    categories: {
        default: { appenders, level: 'trace' },
    },
})

const _logger = log4js.getLogger()

function getSLTPOperName(symbol: string, side: OrderSide, isZh: boolean = false): string {
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

function getOperName(symbol: string, side: OrderSide, isZh: boolean = false): string {
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

interface LoggerMethods {
    order(amount: number): void
    ticker(params: { exchange: Exchange }): void
    position(params: { exchange: Exchange }): void
    sltp(params: { exchange: Exchange; symbol: string; isSL: boolean; side: OrderSide; triggerPrice: number; lastPrice: number; amount: number; unit: string }): void
    sltpSucc(params: { exchange: Exchange; symbol: string; isSL: boolean; side: OrderSide; cost: number; price: number; useTWAP?: boolean; totalMinute?: number; priceLimit?: number }): void
    sltpErr(params: { exchange: Exchange; symbol: string; e: Error }): void
    cond(params: { exchange: Exchange; symbol: string; side: OrderSide; lastPrice: number; triggerPrice: number }): void
    condSucc(params: { exchange: Exchange; symbol: string; side: OrderSide; cost: number; price: number; useTWAP?: boolean; totalMinute?: number; priceLimit?: number }): void
    condErr(params: { exchange: Exchange; symbol: string; e: Error }): void
    getLastUpdateTime(): Record<string, any>
    info(message: string, ...args: any[]): void
    warn(message: string, ...args: any[]): void
    error(message: string, ...args: any[]): void
    fatal(message: string, ...args: any[]): void
    trace(message: string, ...args: any[]): void
    debug(message: string, ...args: any[]): void
}

class Logger implements LoggerMethods {
    _lastUpdateTime: Record<string, any> = {}
    _tickerReceiveTimeout: Record<string, NodeJS.Timeout | null> = {}
    _positionReceiveTimout: Record<string, NodeJS.Timeout | null> = {}

    order(amount: number): void {
        _logger.info(`Orders changed, amount:${amount}`)
    }

    getLastUpdateTime(): Record<string, any> {
        return this._lastUpdateTime
    }

    _receiveTickerTimout(exchange: Exchange): NodeJS.Timeout {
        return setTimeout(() => {
            _logger.warn(`Tickers SUSPEND receive from ${exchange}`)
            bot.pushMessage(`${exchange} Ticker监听已中断`)
            this._tickerReceiveTimeout[exchange] = null
            _.set(this._lastUpdateTime, [exchange, 'ticker'], null)
        }, TICKER_SUSPENPOSITIOND_TIME)
    }

    ticker({ exchange }: { exchange: Exchange }): void {
        if (!this._tickerReceiveTimeout[exchange]) {
            _logger.info(`Tickers START receive from ${exchange}`)
        } else {
            clearTimeout(this._tickerReceiveTimeout[exchange]!)
        }
        this._tickerReceiveTimeout[exchange] = this._receiveTickerTimout(exchange)
        _.set(this._lastUpdateTime, [exchange, 'ticker'], Date.now())
    }

    _receivePositionTimeout(exchange: Exchange): NodeJS.Timeout {
        return setTimeout(() => {
            _logger.warn(`Positions SUSPEND receive from ${exchange}`)
            bot.pushMessage(`${exchange} Position监听已中断`)
            this._positionReceiveTimout[exchange] = null
            _.set(this._lastUpdateTime, [exchange, 'position'], null)
        }, POSITION_SUSPEND_TIME)
    }

    position({ exchange }: { exchange: Exchange }): void {
        if (!this._positionReceiveTimout[exchange]) {
            _logger.info(`Positions START receive from ${exchange}`)
        } else {
            clearTimeout(this._positionReceiveTimout[exchange]!)
        }
        this._positionReceiveTimout[exchange] = this._receivePositionTimeout(exchange)
        _.set(this._lastUpdateTime, [exchange, 'position'], Date.now())
    }

    sltp({ exchange, symbol, isSL, side, triggerPrice, lastPrice, amount, unit }: { exchange: Exchange; symbol: string; isSL: boolean; side: OrderSide; triggerPrice: number; lastPrice: number; amount: number; unit: string }): void {
        _logger.info(`${isSL ? 'SL' : 'TP'} Order TRIGGERED on ${exchange}, ${symbol}, ${getSLTPOperName(symbol, side)}, last:${lastPrice}, trigger:${triggerPrice}, amount:${amount} unit:${unit}`)
    }

    sltpSucc({ exchange, symbol, isSL, side, cost, price, useTWAP, totalMinute, priceLimit }: { exchange: Exchange; symbol: string; isSL: boolean; side: OrderSide; cost: number; price: number; useTWAP?: boolean; totalMinute?: number; priceLimit?: number }): void {
        if (!useTWAP) {
            _logger.info(`${isSL ? 'SL' : 'TP'} Order SUCCESS on ${exchange}, ${symbol}, ${getSLTPOperName(symbol, side)}, volume:${cost}, price:${price}`)
            bot.pushMessage(`${isSL ? '止损' : '止盈'} 成功\n${exchange} ${symbol}\n${getSLTPOperName(symbol, side, true)} 价格: ${price} 消费: ${cost}`)
        } else {
            _logger.info(`${isSL ? 'SL' : 'TP'} Order Trigger TWAP on ${exchange}, ${symbol}, ${getSLTPOperName(symbol, side)}, totalMinute:${totalMinute}, priceLimit:${priceLimit}`)
            bot.pushMessage(`${isSL ? '止损' : '止盈'} 触发TWAP 成功\n${exchange} ${symbol}\n${getSLTPOperName(symbol, side, true)} 分钟: ${totalMinute} 限价: ${priceLimit}`)
        }
    }

    sltpErr({ exchange, symbol, e }: { exchange: Exchange; symbol: string; e: Error }): void {
        _logger.error(`SLTP Order FAILED on ${exchange}, ${symbol}`, e)
        bot.pushMessage(`止盈止损 失败\n${exchange} ${symbol}\n${e.message}`)
    }

    cond({ exchange, symbol, side, lastPrice, triggerPrice }: { exchange: Exchange; symbol: string; side: OrderSide; lastPrice: number; triggerPrice: number }): void {
        _logger.info(`Condition Order TRIGGERED on ${exchange}, ${symbol}, ${getOperName(symbol, side)}, last:${lastPrice}, trigger:${triggerPrice}`)
    }

    condSucc({ exchange, symbol, side, cost, price, useTWAP, totalMinute, priceLimit }: { exchange: Exchange; symbol: string; side: OrderSide; cost: number; price: number; useTWAP?: boolean; totalMinute?: number; priceLimit?: number }): void {
        if (!useTWAP) {
            _logger.info(`Condition Order SUCCESS on ${exchange}, ${symbol}, ${getOperName(symbol, side)}, volume:${cost}, price:${price}`)
            bot.pushMessage(`条件委托 成功\n${exchange}, ${symbol}\n${getOperName(symbol, side, true)} 价格: ${price} 消费: ${cost}`)
        } else {
            _logger.info(`Condition Order Trigger TWAP on ${exchange}, ${symbol}, ${getOperName(symbol, side)}, totalMinute:${totalMinute}, priceLimit:${priceLimit}`)
            bot.pushMessage(`条件委托 触发TWAP 成功\n${exchange}, ${symbol}\n${getOperName(symbol, side, true)} 分钟: ${totalMinute} 限价: ${priceLimit}`)
        }
    }

    condErr({ exchange, symbol, e }: { exchange: Exchange; symbol: string; e: Error }): void {
        _logger.error(`Condition Order FAILED on ${exchange}, ${symbol}`, e)
        bot.pushMessage(`条件委托 失败\n${exchange} ${symbol}\n${e.message}`)
    }
}

const logger = new Proxy(new Logger(), {
    get(t, p: string | symbol) {
        return (t as any)[p] || (_logger as any)[p]
    },
}) as Logger & typeof _logger

export default logger

