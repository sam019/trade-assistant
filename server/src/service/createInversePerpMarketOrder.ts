import Decimal from 'decimal.js'
import { ORDER_TYPES, ORDER_SIDES, ORDER_AMOUNT_TYPES, POSITION_SIDES } from 'share/const.js'
import { getPrecisionLength } from 'share/utils.js'
import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import orderWatcher from '../monitor/orderMonitor.js'
import { createTWAPOrder } from './createLinearPerpMarketOrder.js'
import logger from '../logger.js'
import type { CreateOrderParams } from '../types/index.js'
import type ccxt from 'ccxt'

interface CreateInversePerpMarketOrderOptions {
    skipSLTPOrderSave?: boolean
}

export default async function createInversePerpMarketOrder(data: CreateOrderParams, options: CreateInversePerpMarketOrderOptions = {}): Promise<ccxt.Order | { _twap: any }> {
    const { exchange, symbol, side, amount, leverage, amountPct, usePct, unit, withSLTP, slPrice, tpPrice, reduceOnly = false, useTWAP, totalMinute, priceLimit } = data
    const exchangeMonitor = getExchangeMonitor(exchange)
    if (!exchangeMonitor) {
        throw new Error(`Exchange ${exchange} not found`)
    }
    const market = (exchangeMonitor.exchange as any).markets[symbol] as ccxt.Market
    const position = exchangeMonitor.positions.find((pos: ccxt.Position) => pos.symbol === symbol)
    const isReduce = !!position && ((side === ORDER_SIDES.BUY && position.side === POSITION_SIDES.SHORT) || (side === ORDER_SIDES.SELL && position.side === POSITION_SIDES.LONG))

    const leverages = await exchangeMonitor.fetchLeverages([symbol])
    const { longLeverage: realLeverage } = leverages[symbol]
    if (leverage) {
        if (leverage !== realLeverage) {
            throw new Error('错误: 杠杆参数不一致')
        }
    }
    if (reduceOnly && !position) {
        throw new Error('错误: 未检测到仓位')
    }
    if (reduceOnly !== isReduce) {
        throw new Error('错误: 前后端增减仓逻辑协调错误')
    }

    let lastPrice: number
    if (reduceOnly) {
        const pos = await exchangeMonitor.awaitPositionsUpdate(symbol)
        lastPrice = pos.markPrice
    } else {
        const ticker = await exchangeMonitor.awaitTickersUpdate(symbol)
        lastPrice = ticker.last || 0
    }

    const sltpParams: any = {
        exchange,
        symbol,
        type: ORDER_TYPES.SLTP,
        slPrice,
        tpPrice,
        leverage,
    }
    if (withSLTP) {
        if (!slPrice && !tpPrice) {
            throw new Error('无效的止盈止损价格')
        }
        if (slPrice) {
            if (side === ORDER_SIDES.BUY) {
                if (slPrice < lastPrice) {
                    sltpParams.slPrice = slPrice
                } else {
                    throw new Error(`无效的止损价格 止损:${slPrice} 最新:${lastPrice}`)
                }
            } else {
                if (slPrice > lastPrice) {
                    sltpParams.slPrice = slPrice
                } else {
                    throw new Error(`无效的止损价格 止损:${slPrice} 最新:${lastPrice}`)
                }
            }
        }
        if (tpPrice) {
            if (side === ORDER_SIDES.BUY) {
                if (tpPrice > lastPrice) {
                    sltpParams.tpPrice = tpPrice
                } else {
                    throw new Error(`无效的止盈价格 止盈:${slPrice} 最新:${lastPrice}`)
                }
            } else {
                if (tpPrice < lastPrice) {
                    sltpParams.tpPrice = tpPrice
                } else {
                    throw new Error(`无效的止盈价格 止盈:${slPrice} 最新:${lastPrice}`)
                }
            }
        }
    }
    const precision = getPrecisionLength(market.precision.amount)
    const params: { reduceOnly: boolean; quantity?: number } = {
        reduceOnly,
    }
    
    if (unit === ORDER_AMOUNT_TYPES.CONTRACT) {
        params.quantity = new Decimal(amount).toDecimalPlaces(precision).toNumber()
    } else if (isReduce) {
        if (usePct) {
            params.quantity = new Decimal(position.contracts).mul(amountPct || 0).div(100).toDecimalPlaces(precision).toNumber()
        } else if (unit === ORDER_AMOUNT_TYPES.BASE) {
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount)
            const quantity = new Decimal(amount).mul(lastPrice).div(qtoAmountStep).floor().mul(qtoAmountStep).div(market.contractSize).toDecimalPlaces(precision).toNumber()
            params.quantity = quantity
        } else {
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount)
            const quantity = new Decimal(amount).div(qtoAmountStep).floor().mul(qtoAmountStep).div(market.contractSize).toDecimalPlaces(precision).toNumber()
            params.quantity = quantity
        }
    } else {
        if (unit === ORDER_AMOUNT_TYPES.QUOTE) {
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount)
            const quantity = new Decimal(amount).mul(realLeverage).div(qtoAmountStep).floor().mul(qtoAmountStep).div(market.contractSize).toDecimalPlaces(precision).toNumber()
            params.quantity = quantity
        } else {
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount)
            let maxStepAmount: Decimal
            if (usePct) {
                const balance = exchangeMonitor.balance[(market as any).subType][market.base].free || 0
                maxStepAmount = new Decimal(balance).mul(amountPct || 0).div(100).mul(realLeverage).mul(lastPrice).div(qtoAmountStep).floor()
            } else {
                maxStepAmount = new Decimal(amount).mul(realLeverage).mul(lastPrice).div(qtoAmountStep).floor()
            }
            const quantity = maxStepAmount.mul(qtoAmountStep).div(market.contractSize).toDecimalPlaces(precision).toNumber()
            params.quantity = quantity
        }
    }
    
    const realMinQuantity = Math.max(
        market.limits.amount.min,
        market.limits.cost?.min ? new Decimal(market.limits.cost.min).div(lastPrice).toDecimalPlaces(precision, Decimal.ROUND_UP).toNumber() : 0,
    )

    if (params.quantity && params.quantity < realMinQuantity) {
        throw new Error('下单数量不满足最低成交量')
    }
    
    if (useTWAP) {
        if (totalMinute && totalMinute < 1) {
            throw new Error('TWAP总时间不能少于1分钟')
        }
        if (withSLTP && priceLimit) {
            if (side === ORDER_SIDES.BUY) {
                if (sltpParams.tpPrice && priceLimit > sltpParams.tpPrice) {
                    throw new Error('TWAP限价不能大于止盈价格')
                } else if (sltpParams.slPrice && priceLimit < sltpParams.slPrice) {
                    throw new Error('TWAP限价不能小于止损价格')
                }
            } else {
                if (sltpParams.tpPrice && priceLimit < sltpParams.tpPrice) {
                    throw new Error('TWAP限价不能小于止盈价格')
                } else if (sltpParams.slPrice && priceLimit > sltpParams.slPrice) {
                    throw new Error('TWAP限价不能大于止损价格')
                }
            }
        }
        return createTWAPOrder({ exchange, symbol, side, params: params as { reduceOnly: boolean; quantity: number }, leverage: realLeverage, withSLTP: withSLTP || false, sltpParams, totalMinute: totalMinute || 0, priceLimit, market })
    }
    logger.info(`创建合约市价单 ${exchange} ${symbol} ${side} ${params.quantity}(张) 杠杆:${realLeverage}x`)
    const result = await (exchangeMonitor.exchange as any).createOrderWs(symbol, ORDER_TYPES.MARKET, side, undefined, undefined, params)
    logger.info(`市价单成交 ${exchange} ${symbol} ${side} 成交价格:${result.average} 成交额:${result.cost}(${market.quote}) 成交量:${result.filled}(张)`)
    
    if (withSLTP) {
        sltpParams.amount = result.amount
        sltpParams.unit = ORDER_AMOUNT_TYPES.CONTRACT
        const sltpOrder = orderWatcher.creatOrder(sltpParams)
        if (!options.skipSLTPOrderSave) {
            (result as any)._sltp = await sltpOrder
        }
    }
    return result
}

