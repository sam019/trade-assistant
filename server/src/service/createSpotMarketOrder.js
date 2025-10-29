import Decimal from 'decimal.js'

import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import { ORDER_TYPES, ORDER_SIDES, ORDER_AMOUNT_TYPES, TWAP_INTERVAL } from '../../../share/const.js'
import { getPrecisionLength, sleep } from '../../../share/utils.js'
import orderWatcher from '../monitor/orderMonitor.js'
import logger from '../logger.js'

async function createTWAPOrder({ exchange, symbol, side, params, withSLTP, sltpParams, totalMinute, market }) {
    const stepNum = Math.ceil(totalMinute * 60 * 1000 / TWAP_INTERVAL)

    let remainQuantity = params.quoteOrderQty || params.quantity, sltpOrder
    let quantityStep = Math.max(new Decimal(params.quantity).div(stepNum).toDecimalPlaces(getPrecisionLength(market.precision.amount)).toNumber(), market.precision.amount)
    while (remainQuantity > 0) {
        if (params.quoteOrderQty) {
            const lastTicker = await getExchangeMonitor(exchange).awaitTickersUpdate([symbol])
            const lastPrice = lastTicker[0] && lastTicker[0].last || 0
            const stepMinQuote = new Decimal(market.precision.amount).mul(lastPrice).toNumber()
            quantityStep = Math.max(new Decimal(params.quoteOrderQty).div(stepNum).toDecimalPlaces(getPrecisionLength(market.precision.amount)).toNumber(), stepMinQuote)
        }
        const stepParmas = {
            [params.quoteOrderQty ? 'quoteOrderQty' : 'quantity']: remainQuantity < new Decimal(quantityStep).mul(2).toNumber() ? remainQuantity : quantityStep,
        }
        try {
            console.log(`创建市价单(TWAP): ${exchange} ${symbol} ${Object.keys(stepParmas)[0]}:${stepParmas.quoteOrderQty || stepParmas.quantity}`)
            const sign = Date.now()
            const result = await getExchangeMonitor(exchange).exchange.createOrderWs(symbol, ORDER_TYPES.MARKET, side, undefined, undefined, stepParmas)
            // todo 向前端推送twap进度
            remainQuantity -= params.quoteOrderQty ? result.cost : result.filled
            if (withSLTP) {
                if (!sltpOrder) {
                    sltpOrder = await orderWatcher.creatOrder({ ...sltpParams, amount: result.filled, unit: ORDER_AMOUNT_TYPES.BASE })
                } else {
                    sltpOrder = await orderWatcher.updateOrder(sltpOrder._id, { amount: sltpOrder.amount + result.filled })
                }
            }
            await sleep(TWAP_INTERVAL, sign)
        } catch (e) {
            logger.error('createTWAPOrder error: ', e.message)
            throw e
        }
    }
}

// 创建现货市价单
export default async function createSpotMarketOrder(data, options = {}) {
    const { exchange, symbol, side, amount, unit, usePct, amountPct, withSLTP, slPrice, tpPrice, withTWAP, totalMinute } = data
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
    if (withTWAP) {
        if (totalMinute < 1) {
            throw new Error('TWAP总时间不能少于1分钟')
        }
        createTWAPOrder({ exchange, symbol, side, params, withSLTP, sltpParams, totalMinute, market })
        return
    }
    
    console.log('创建现货市价单', exchange, symbol, side, params.quantity || params.quoteOrderQty, params.quantity ? market.base : market.quote)
    const result = await getExchangeMonitor(exchange).exchange.createOrderWs(symbol, ORDER_TYPES.MARKET, side, undefined, undefined, params)
    console.log('下单成功', result.filled, result.cost)
    if (withSLTP) {
        sltpParams.amount = result.filled
        sltpParams.unit = ORDER_AMOUNT_TYPES.BASE
        const order = orderWatcher.creatOrder(sltpParams)
        if (!options.skipSLTPOrderSave) {
            await order
        }
    }
    return result
}