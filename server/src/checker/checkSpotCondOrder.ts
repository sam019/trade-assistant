import Decimal from 'decimal.js'
import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import orderWatcher from '../monitor/orderMonitor.js'
import service from '../service/index.js'
import { ORDER_SIDES, ORDER_AMOUNT_TYPES } from 'share/const.js'
import { checkSymbol, sleep } from 'share/utils.js'
import logger from '../logger.js'
import type { Order, Ticker } from '../types/index.js'

interface GetRealAmountParams {
    balance?: { free: number; used: number; total: number } | null
    _id: string
    unit: string
    lastPrice: number
    amount: number
    exchange: string
    symbol: string
    cSymbol: ReturnType<typeof checkSymbol>
}

function getRealAmount({ balance, _id, unit, lastPrice, amount, exchange, symbol, cSymbol }: GetRealAmountParams): { realAmount: number; realUnit: string } | undefined {
    let realAmount = amount
    let realUnit = unit
    
    if (!balance) {
        console.log('无法获取余额数据，尝试直接下单')
    } else if (!balance.free) {
        console.log('委托订单余额为0，已自动取消')
        orderWatcher.closeOrder(_id)
        return
    } else if (unit === ORDER_AMOUNT_TYPES.QUOTE) {
        if (amount > balance.free) {
            realAmount = balance.free
            console.log(`委托订单余额不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 买入数量:${realAmount}${cSymbol[realUnit as keyof typeof cSymbol]}`)
        }
    } else {
        if (new Decimal(amount).div(lastPrice).toNumber() > balance.free) {
            realAmount = balance.free
            realUnit = ORDER_AMOUNT_TYPES.QUOTE
            console.log(`委托订单余额不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}${cSymbol[realUnit as keyof typeof cSymbol]}`)
        }
    }
    return { realAmount, realUnit }
}

export default async function checkSpotCondOrder(order: Order, ticker: Ticker): Promise<void> {
    const { _id, symbol, amount, unit, triggerPrice, exchange, withSLTP, slPrice, tpPrice, useTWAP, totalMinute, priceLimit } = order
    try {
        if (orderWatcher.isOrderDealing(_id)) {
            return
        }
        const lastPrice = ticker.last
        if (!lastPrice) {
            throw new Error('错误: 无法获取tick: ' + symbol)
        }

        if (lastPrice <= triggerPrice! || (global.__Force?.v() ?? false)) {
            orderWatcher.markOrderDealing(_id)

            const cSymbol = checkSymbol(symbol)
            const exchangeMonitor = getExchangeMonitor(exchange)
            if (!exchangeMonitor) {
                throw new Error(`Exchange ${exchange} not found`)
            }
            const balance = exchangeMonitor.balance.spot[cSymbol.quote]

            const realAmountResult = getRealAmount({ balance, lastPrice, amount, unit, _id, exchange, symbol, cSymbol })
            if (!realAmountResult) {
                return
            }

            const { realAmount, realUnit } = realAmountResult
            const params = {
                exchange,
                symbol,
                amount: realAmount,
                unit: realUnit,
                side: ORDER_SIDES.BUY,
                withSLTP,
                slPrice,
                tpPrice,
                useTWAP,
                totalMinute,
                priceLimit,
            }

            const options = { skipSLTPOrderSave: true }

            logger.cond({ exchange, symbol, side: params.side, lastPrice, triggerPrice: triggerPrice!, amount: params.amount, unit: params.unit })
            const result = await service.createSpotMarketOrder(params, options)
            logger.condSucc({ exchange, symbol, side: params.side, cost: result.cost, price: result.price, unit: cSymbol.base, useTWAP, totalMinute, priceLimit })
            await orderWatcher.resolveOrder(_id)
        }
    } catch (e) {
        logger.condErr({ exchange, symbol, e: e as Error })
        await sleep(1000)
        orderWatcher.unmarkOrderDealing(_id)
    }
}

