import Decimal from 'decimal.js'

import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import { ORDER_TYPES, ORDER_SIDES, ORDER_AMOUNT_TYPES, POSITION_SIDES } from '../../../share/const.js'
import { getPrecisionLength } from '../../../share/utils.js'
import orderWatcher from '../monitor/orderMonitor.js'

export default async function createSpotConditionOrder(data) {
    const { exchange, symbol, amount, unit, usePct, amountPct, triggerPrice, withSLTP, slPrice, tpPrice, id } = data
    if (!triggerPrice) {
        throw new Error('委托触发价格设置错误')
    }
    const market = getExchangeMonitor(exchange).markets.spot.find(mar => mar.symbol === symbol)
    if (!market) {
        throw new Error('错误: 交易对无效')
    }

    const params = {
        exchange,
        symbol,
        type: ORDER_TYPES.CONDITION,
        amount,
        unit,
    }
    // usePct为true时，换算为绝对值
    if (usePct) {
        const currencyMatch = symbol.match(/(\w+)\/(\w+)/)
        // console.log('currencyMatch', currencyMatch[1], getExchangeMonitor(exchange).balance.spot['BTC']);
        const balance = getExchangeMonitor(exchange).balance.spot[currencyMatch[2]]?.free
        if (!balance) {
            throw new Error('条件委托数量错误：没有余额')
        }
        params.amount = new Decimal(amountPct).mul(balance).div(100).toDecimalPlaces(getPrecisionLength(market.precision.quote)).toNumber()
        params.unit = ORDER_AMOUNT_TYPES.QUOTE
    }
    
    const lastTicker = await getExchangeMonitor(exchange).awaitTickersUpdate([symbol])
    const lastPrice = lastTicker[0] && lastTicker[0].last || 0
    
    if (triggerPrice < lastPrice) {
        params.triggerPrice = triggerPrice
    } else {
        throw new Error('委托触发价格设置错误')
    }

    if (withSLTP) {
        params.withSLTP = true
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
    }
    let order
    if (id) {
        order = await orderWatcher.updateOrder(id, params)
    } else {
        order = await orderWatcher.creatOrder(params)
    }
    return order
}