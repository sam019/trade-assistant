import Decimal from 'decimal.js'
import { ORDER_TYPES, ORDER_AMOUNT_TYPES, POSITION_SIDES } from 'share/const.js'
import { getPrecisionLength } from 'share/utils.js'
import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import orderWatcher from '../monitor/orderMonitor.js'
import type { CreateOrderParams } from '../types/index.js'
import type ccxt from 'ccxt'

export default async function createPerpSLTPOrder(data: CreateOrderParams): Promise<any> {
    const { exchange, symbol, amount, unit, usePct, amountPct, slPrice, tpPrice, useTWAP, totalMinute, priceLimit, id } = data
    const exchangeMonitor = getExchangeMonitor(exchange)
    if (!exchangeMonitor) {
        throw new Error(`Exchange ${exchange} not found`)
    }
    const { linear, inverse } = exchangeMonitor.markets
    const market = [...linear, ...inverse].find(mar => mar.symbol === symbol)
    const position = exchangeMonitor.positions?.find((pos: ccxt.Position) => pos.symbol === symbol)
    
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
    
    const params: any = {
        exchange,
        symbol,
        type: ORDER_TYPES.SLTP,
        amount,
        unit,
        slPrice,
        tpPrice,
        useTWAP,
        totalMinute,
        priceLimit,
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

