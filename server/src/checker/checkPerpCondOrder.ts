import Decimal from 'decimal.js'
import { ORDER_SIDES, ORDER_AMOUNT_TYPES } from 'share/const.js'
import { checkSymbol, sleep } from 'share/utils.js'
import service from '../service/index.js'
import orderWatcher from '../monitor/orderMonitor.js'
import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import logger from '../logger.js'
import type { Order, Ticker } from '../types/index.js'

interface GetRealAmountParams {
    balance?: { free: number; used: number; total: number } | null
    lastPrice: number
    _id: string
    amount: number
    unit: string
    exchange: string
    symbol: string
    cSymbol: ReturnType<typeof checkSymbol>
}

function getRealAmount({ balance, lastPrice, _id, amount, unit, exchange, symbol, cSymbol }: GetRealAmountParams): { realAmount: number; realUnit: string } | undefined {
    let realAmount = amount
    let realUnit = unit
    
    if (!balance) {
        console.log('无法获取余额数据，尝试直接下单')
    } else if (!balance.free) {
        console.log('委托订单余额为0，已自动取消')
        orderWatcher.closeOrder(_id)
        return
    } else if (unit === ORDER_AMOUNT_TYPES.QUOTE) {
        if (cSymbol.isLinear) {
            if (amount > balance.free) {
                realAmount = balance.free
                console.log(`委托订单余额不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 买入数量:${realAmount}${cSymbol.quote}`)
            }
        } else {
            if (new Decimal(amount).div(lastPrice).toNumber() > balance.free) {
                realAmount = balance.free
                realUnit = ORDER_AMOUNT_TYPES.BASE
                console.log(`委托订单余额不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 买入数量:${realAmount}${cSymbol.base}`)
            }
        }
    } else {
        if (cSymbol.isLinear) {
            if (new Decimal(amount).mul(lastPrice).toNumber() > balance.free) {
                realAmount = balance.free
                realUnit = ORDER_AMOUNT_TYPES.QUOTE
                console.log(`委托订单余额不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}${cSymbol.quote}`)
            }
        } else {
            if (amount > balance.free) {
                realAmount = balance.free
                console.log(`委托订单余额不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 买入数量:${realAmount}${cSymbol.base}`)
            }
        }
    }
    return { realAmount, realUnit }
}

export default async function checkPerpCondOrder(order: Order, ticker: Ticker): Promise<void> {
    const { _id, symbol, side, amount, unit, triggerPrice, exchange, withSLTP, slPrice, tpPrice, leverage, useTWAP, totalMinute, priceLimit } = order
    try {
        if (orderWatcher.isOrderDealing(_id)) {
            return
        }
        const lastPrice = ticker.last
        if (!lastPrice) {
            throw new Error('错误: 无法获取tick: ' + symbol)
        }
        
        if ((side === ORDER_SIDES.BUY ? lastPrice <= triggerPrice! : lastPrice >= triggerPrice!) || (global.__Force?.v() ?? false)) {
            orderWatcher.markOrderDealing(_id)

            const cSymbol = checkSymbol(symbol)
            const exchangeMonitor = getExchangeMonitor(exchange)
            if (!exchangeMonitor) {
                throw new Error(`Exchange ${exchange} not found`)
            }

            const balance = cSymbol.isLinear
                ? exchangeMonitor.balance.linear[cSymbol.quote]
                : exchangeMonitor.balance.inverse[cSymbol.base]

            const realAmountResult = getRealAmount({ balance, _id, lastPrice, amount, unit, exchange, symbol, cSymbol })
            if (!realAmountResult) {
                return
            }

            const { realAmount, realUnit } = realAmountResult
            const params = {
                exchange,
                symbol,
                side,
                amount: realAmount,
                unit: realUnit,
                withSLTP,
                slPrice,
                tpPrice,
                leverage,
                useTWAP,
                totalMinute,
                priceLimit,
            }

            const options = { skipSLTPOrderSave: true }

            logger.cond({ exchange, symbol, side: params.side, lastPrice, triggerPrice: triggerPrice!, amount: params.amount, unit: params.unit })

            let result
            if (cSymbol.isLinear) {
                result = await service.createLinearPerpMarketOrder(params, options)
            } else {
                result = await service.createInversePerpMarketOrder(params, options)
            }
            logger.condSucc({ exchange, symbol, side: params.side, cost: result.cost, price: result.price, unit: ORDER_AMOUNT_TYPES.CONTRACT, useTWAP, totalMinute, priceLimit })
            await orderWatcher.resolveOrder(_id)
        }
    } catch (e) {
        logger.condErr({ exchange, symbol, e: e as Error })
        await sleep(1000)
        orderWatcher.unmarkOrderDealing(_id)
    }
}

