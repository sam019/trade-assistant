import Decimal from 'decimal.js'

import { ORDER_TYPES, ORDER_SIDES, ORDER_AMOUNT_TYPES } from 'share/const.js'
import { getPrecisionLength, checkSymbol } from 'share/utils.js'

import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import orderWatcher from '../monitor/orderMonitor.js'

// 创建合约条件委托（条件委托负责买）
export default async function createPerpConditionOrder(data) {
    const { exchange, symbol, side, amount, unit, usePct, amountPct, triggerPrice, leverage, id, withSLTP, slPrice, tpPrice } = data
    const { linear, inverse } = getExchangeMonitor(exchange).markets
    const market = [...linear, ...inverse].find(mar => mar.symbol === symbol)
    // console.log('condition', triggerPrice)
    if (!triggerPrice) {
        throw new Error('委托触发价格设置错误')
    }
    if (!market) {
        throw new Error('错误: 交易对无效')
    }
    
    const { last: lastPrice } = await getExchangeMonitor(exchange).awaitTickersUpdate(symbol)
    
    if (side === ORDER_SIDES.BUY ? triggerPrice >= lastPrice : triggerPrice <= lastPrice) {
        throw new Error(`无效的触发价格 ${triggerPrice} ${lastPrice}`)
    }

    const { longLeverage: realLeverage } = Object.values(await getExchangeMonitor(exchange).fetchLeverages([symbol]))[0]
    if (leverage) {
        if (leverage !== realLeverage) {
            throw new Error('错误: 杠杆参数不一致')
        }
    }
    
    const params = {
        exchange,
        symbol,
        side,
        type: ORDER_TYPES.CONDITION,
        triggerPrice,
        leverage,
        amount,
        unit,
        withSLTP,
    }

    if (usePct) {
        const cSymbol = checkSymbol(symbol)
        if (cSymbol.isLinear) {
            const balance = getExchangeMonitor(exchange).balance.linear[cSymbol.quote]?.free || 0
            params.amount = new Decimal(amountPct).div(100).mul(balance).toDecimalPlaces(getPrecisionLength(market.precision.quote)).toNumber()
            params.unit = ORDER_AMOUNT_TYPES.QUOTE
        } else {
            const balance = getExchangeMonitor(exchange).balance.inverse[cSymbol.base]?.free || 0
            params.amount = new Decimal(amountPct).div(100).mul(balance).toDecimalPlaces(getPrecisionLength(market.precision.base)).toNumber()
            params.unit = ORDER_AMOUNT_TYPES.BASE
        }
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
    // console.log('createPerpMarketConditionOrder', params)
    let order
    if (id) {
        order = await orderWatcher.updateOrder(id, params)
    } else {
        order = await orderWatcher.creatOrder(params)
    }
    return order
}