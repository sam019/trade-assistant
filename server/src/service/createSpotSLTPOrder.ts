import Decimal from 'decimal.js'
import { ORDER_AMOUNT_TYPES, ORDER_TYPES } from 'share/const.js'
import { getPrecisionLength, checkSymbol } from 'share/utils.js'
import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import orderWatcher from '../monitor/orderMonitor.js'
import type { CreateOrderParams } from '../types/index.js'
import { or } from 'sequelize'

export default async function createSpotSLTPOrder(data: CreateOrderParams): Promise<any> {
    const { exchange, symbol, amount, unit, usePct, amountPct, slPrice, tpPrice, useTWAP, totalMinute, priceLimit, id } = data
    if (!slPrice && !tpPrice) {
        throw new Error('止盈止损触发价格设置错误')
    }
    const exchangeMonitor = getExchangeMonitor(exchange)
    if (!exchangeMonitor) {
        throw new Error(`Exchange ${exchange} not found`)
    }
    const market = exchangeMonitor.markets.spot.find(mar => mar.symbol === symbol)
    if (!market) {
        throw new Error('错误: 交易对无效')
    }
    
    const params: any = {
        exchange,
        symbol,
        type: ORDER_TYPES.SLTP,
        amount,
        unit,
        useTWAP,
        totalMinute,
        priceLimit,
    }
    
    if (usePct) {
        const cSymbol = checkSymbol(symbol)
        const balance = exchangeMonitor.balance.spot[cSymbol.base]?.free
        if (!balance) {
            throw new Error('止盈止损数量错误: 没有余额')
        }
        params.amount = new Decimal(amountPct).mul(balance).div(100).toDecimalPlaces(getPrecisionLength(market.precision.base)).toNumber()
        params.unit = ORDER_AMOUNT_TYPES.BASE
    }
    
    const { last: lastPrice } = await exchangeMonitor.awaitTickersUpdate(symbol)
    
    if (slPrice) {
        if (slPrice < lastPrice) {
            params.slPrice = slPrice
        } else {
            throw new Error('止损触发价格设置错误')
        }
    }
    if (tpPrice) {
        if (tpPrice > lastPrice) {
            params.tpPrice = tpPrice
        } else {
            throw new Error('止盈触发价格设置错误')
        }
    }
    
    let order
    if (id) {
        order = await orderWatcher.updateOrder(id, params)
    } else {
        order = await orderWatcher.creatOrder(params)
    }
    console.log(params, order)
    return order
}

