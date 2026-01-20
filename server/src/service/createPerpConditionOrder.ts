import Decimal from 'decimal.js'
import { ORDER_TYPES, ORDER_SIDES, ORDER_AMOUNT_TYPES } from 'share/const.js'
import { getPrecisionLength, checkSymbol } from 'share/utils.js'
import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import orderWatcher from '../monitor/orderMonitor.js'
import type { CreateOrderParams } from '../types/index.js'

export default async function createPerpConditionOrder(data: CreateOrderParams): Promise<any> {
    const { exchange, symbol, side, amount, unit, usePct, amountPct, triggerPrice, leverage, id, withSLTP, slPrice, tpPrice, useTWAP, totalMinute, priceLimit } = data
    const exchangeMonitor = getExchangeMonitor(exchange)
    if (!exchangeMonitor) {
        throw new Error(`Exchange ${exchange} not found`)
    }
    const { linear, inverse } = exchangeMonitor.markets
    const market = [...linear, ...inverse].find(mar => mar.symbol === symbol)
    
    if (!triggerPrice) {
        throw new Error('委托触发价格设置错误')
    }
    if (!market) {
        throw new Error('错误: 交易对无效')
    }
    
    const { last: lastPrice } = await exchangeMonitor.awaitTickersUpdate(symbol)
    
    if (side === ORDER_SIDES.BUY ? triggerPrice >= lastPrice : triggerPrice <= lastPrice) {
        throw new Error(`无效的触发价格 ${triggerPrice} ${lastPrice}`)
    }

    const leverages = await exchangeMonitor.fetchLeverages([symbol])
    const { longLeverage: realLeverage } = Object.values(leverages)[0] as { longLeverage: number; shortLeverage: number }
    if (leverage) {
        if (leverage !== realLeverage) {
            throw new Error('错误: 杠杆参数不一致')
        }
    }
    const params: any = {
        exchange,
        symbol,
        side,
        type: ORDER_TYPES.CONDITION,
        triggerPrice,
        leverage,
        amount,
        unit,
        useTWAP,
        totalMinute,
        priceLimit,
    }
    if (withSLTP) {
        params.withSLTP = true
        if (side === ORDER_SIDES.BUY) {
            if (slPrice) {
                if (slPrice < triggerPrice) {
                    params.slPrice = slPrice
                } else {
                    throw new Error('止损触发价格设置错误')
                }
            }
            if (tpPrice) {
                if (tpPrice > triggerPrice) {
                    params.tpPrice = tpPrice
                } else {
                    throw new Error('止盈触发价格设置错误')
                }
            }
        } else {
            if (slPrice) {
                if (slPrice > triggerPrice) {
                    params.slPrice = slPrice
                } else {
                    throw new Error('止损触发价格设置错误')
                }
            }
            if (tpPrice) {
                if (tpPrice < triggerPrice) {
                    params.tpPrice = tpPrice
                } else {
                    throw new Error('止盈触发价格设置错误')
                }
            }
        }
    }
    
    if (usePct) {
        const cSymbol = checkSymbol(symbol)
        if (cSymbol.isLinear) {
            const balance = exchangeMonitor.balance.linear[cSymbol.quote]?.free || 0
            params.amount = new Decimal(amountPct).div(100).mul(balance).toDecimalPlaces(getPrecisionLength(market.precision.quote)).toNumber()
            params.unit = ORDER_AMOUNT_TYPES.QUOTE
        } else {
            const balance = exchangeMonitor.balance.inverse[cSymbol.base]?.free || 0
            params.amount = new Decimal(amountPct).div(100).mul(balance).toDecimalPlaces(getPrecisionLength(market.precision.base)).toNumber()
            params.unit = ORDER_AMOUNT_TYPES.BASE
        }
    }
    
    let order
    if (id) {
        order = await orderWatcher.updateOrder(id, params)
    } else {
        order = await orderWatcher.creatOrder(params)
    }
    return order
}

