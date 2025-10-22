import Decimal from 'decimal.js'

import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import { ORDER_TYPES, ORDER_SIDES, ORDER_AMOUNT_TYPES, POSITION_SIDES } from '../../../share/const.js'
import { getPrecisionLength } from '../../../share/utils.js'
import orderWatcher from '../monitor/orderMonitor.js'

// 创建合约止盈止损委托（止盈止损委托负责卖）
export default async function createPerpSLTPOrder(data) {
    const { exchange, symbol, amount, unit, usePct, amountPct, slPrice, tpPrice, id } = data
    const { linear, inverse } = getExchangeMonitor(exchange).markets
    const market = [...linear, ...inverse].find(mar => mar.symbol === symbol)
    const position = getExchangeMonitor(exchange).positions?.find(pos => pos.symbol === symbol)
    console.log('sltp', slPrice, tpPrice, position?.markPrice)
    if (!market) {
        throw new Error('错误: 交易对无效')
    }
    if (!position) {
        throw new Error(`错误: 未检测到仓位: ${symbol}`)
    }
    
    if (!slPrice && !tpPrice) {
        throw new Error('无效的止盈止损价格')
    }
    if (position.side === POSITION_SIDES.LONG) {
        if (slPrice && slPrice >= position.markPrice) {
            throw new Error(`无效的止损价格 sl:${slPrice} mark:${position.markPrice}`)
        }
        if (tpPrice && tpPrice <= position.markPrice) {
            throw new Error(`无效的止盈价格 tp:${tpPrice} mark:${position.markPrice}`)
        }
    } else {
        if (slPrice && slPrice <= position.markPrice) {
            throw new Error(`无效的止损价格 sl:${slPrice} mark:${position.markPrice}`)
        }
        if (tpPrice && tpPrice >= position.markPrice) {
            throw new Error(`无效的止盈价格 tp:${tpPrice} mark:${position.markPrice}`)
        }
    }
    
    const params = {
        exchange,
        symbol,
        type: ORDER_TYPES.SLTP,
        amount,
        unit,
        slPrice,
        tpPrice,
    }
    if (usePct) {
        params.amount = new Decimal(amountPct).div(100).mul(position.contracts).toDecimalPlaces(getPrecisionLength(market.precision.amount)).toNumber()
        params.unit = ORDER_AMOUNT_TYPES.CONTRACT
    }
    let order
    if (id) {
        order = await orderWatcher.updateOrder(id, params)
    } else {
        order = await orderWatcher.creatOrder(params)
    }
    return order
}