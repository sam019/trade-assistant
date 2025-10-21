import Decimal from 'decimal.js'

import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import { ORDER_TYPES, ORDER_SIDES, ORDER_AMOUNT_TYPES, POSITION_SIDES } from '../../../share/const.js'
import { getPrecisionLength } from '../../../share/utils.js'
import orderWatcher from '../monitor/orderMonitor.js'

// 创建现货市价单
export default async function createSpotMarketOrder(data) {
    const { exchange, symbol, side, amount, unit, usePct, amountPct, withSLTP, slPrice, tpPrice } = data
    /* todo 校验 */
    const market = getExchangeMonitor(exchange).markets.spot.find(mar => mar.symbol === symbol)
    if (!market) {
        throw new Error('错误: 交易对无效')
    }
    const params = {}
    if (usePct) {
        const currencyMatch = symbol.match(/(\w+)\/(\w+)/)
        if (side === ORDER_SIDES.SELL) {
            const balance = getExchangeMonitor(exchange).balance.spot[currencyMatch[1]]?.free
            params.quantity = new Decimal(balance).mul(amountPct).div(100).toDecimalPlaces(getPrecisionLength(market.precision.amount)).toNumber()
        } else {
            const balance = getExchangeMonitor(exchange).balance.spot[currencyMatch[2]]?.free
            if (!balance) {
                throw new Error('错误: 未检测到余额')
            }
            params.quoteOrderQty = new Decimal(balance).mul(amountPct).div(100).toDecimalPlaces(getPrecisionLength(market.precision.quote)).toNumber()
        }
    } else if (unit === ORDER_AMOUNT_TYPES.QUOTE) {
        params.quoteOrderQty = new Decimal(amount).toDecimalPlaces(getPrecisionLength(market.precision.quote)).toNumber()
    } else {
        params.quantity = new Decimal(amount).toDecimalPlaces(getPrecisionLength(market.precision.amount)).toNumber()
    }
    const sltpParams = {
        exchange,
        symbol,
        type: ORDER_TYPES.SLTP,
    }
    if (withSLTP) {
        if (!slPrice && !tpPrice) {
            throw new Error('无效的止盈止损价格')
        }
        const lastTicker = await getExchangeMonitor(exchange).awaitTickersUpdate([symbol])
        const lastPrice = lastTicker[0] && lastTicker[0].last || 0
        if (slPrice) {
            if (slPrice < lastPrice) {
                sltpParams.slPrice = slPrice
            } else {
                throw new Error('无效的止损价格')
            }
        }
        if (tpPrice) {
            if (tpPrice > lastPrice) {
                sltpParams.tpPrice = tpPrice
            } else {
                throw new Error('无效的止盈价格')
            }
        }
    }
    console.log('创建市价单', exchange, symbol, side, params.quantity || params.quoteOrderQty, params.quantity ? market.base : market.quote)

    const result = await getExchangeMonitor(exchange).exchange.createOrderWs(symbol, ORDER_TYPES.MARKET, side, undefined, undefined, params)
    // console.log('下单成功', result)
    if (withSLTP) {
        sltpParams.amount = result.filled
        sltpParams.unit = ORDER_AMOUNT_TYPES.BASE
        await orderWatcher.creatOrder(sltpParams)
    }
    return result
}