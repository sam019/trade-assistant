import Decimal from 'decimal.js'

import { ORDER_TYPES, ORDER_SIDES, ORDER_AMOUNT_TYPES, POSITION_SIDES } from 'share/const.js'
import { getPrecisionLength } from 'share/utils.js'

import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import orderWatcher from '../monitor/orderMonitor.js'
import { createTWAPOrder } from './createLinearPerpMarketOrder.js'
import logger from '../logger.js'

export default async function createInversePerpMarketOrder(data, options = {}) {
    const { exchange, symbol, side, amount, leverage, amountPct, usePct, unit, withSLTP, slPrice, tpPrice, reduceOnly = false, useTWAP, totalMinute, priceLimit } = data
    const market = getExchangeMonitor(exchange).exchange.markets[symbol]
    const position = getExchangeMonitor(exchange).positions.find(pos => pos.symbol === symbol)
    // 如果当前有仓位并且仓位方向和下单放下相反，判断为减仓单
    const isReduce = !!position && ((side === ORDER_SIDES.BUY && position.side === POSITION_SIDES.SHORT) || (side === ORDER_SIDES.SELL && position.side === POSITION_SIDES.LONG))

    const { longLeverage: realLeverage } = Object.values(await getExchangeMonitor(exchange).fetchLeverages([symbol]))[0]
    if (leverage) {
        if (leverage !== realLeverage) {
            throw new Error('错误: 杠杆参数不一致')
        }
    }
    if (reduceOnly && !position) {
        throw new Error('错误：未检测到仓位')
    }
    // console.log('isReduce', isReduce)
    if (reduceOnly !== isReduce) {
        throw new Error('错误：前后端增减仓逻辑协调错误')
    }

    let lastPrice
    if (reduceOnly) {
        ({ markPrice: lastPrice } = await getExchangeMonitor(exchange).awaitPositionsUpdate(symbol))
    } else {
        ({ last: lastPrice } = await getExchangeMonitor(exchange).awaitTickersUpdate(symbol))
    }

    const sltpParams = {
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
    const params = {
        reduceOnly,
    }
    // console.log('unit', unit, amount, side)
    // 币本位合约一张代表张数*contractSize的USD，比如btcusd，一张代表100usd
    if (unit === ORDER_AMOUNT_TYPES.CONTRACT) {
        // 按张下单，目前只有止盈止损单会触发
        params.quantity = new Decimal(amount).toDecimalPlaces(precision).toNumber()
    } else if (isReduce) {
        if (usePct) {
            // 百分比减仓
            params.quantity = new Decimal(position.contracts).mul(amountPct).div(100).toDecimalPlaces(precision).toNumber()
            // console.log('params.quantity', params.quantity)
        } else if (unit === ORDER_AMOUNT_TYPES.BASE) {
            // 币本位绝对值减仓
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount)
            const quantity = new Decimal(amount).mul(lastPrice).div(qtoAmountStep).floor().mul(qtoAmountStep).div(market.contractSize).toDecimalPlaces(precision).toNumber()
            params.quantity = quantity
        } else {
            // U本位绝对值减仓
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount)
            const quantity = new Decimal(amount).div(qtoAmountStep).floor().mul(qtoAmountStep).div(market.contractSize).toDecimalPlaces(precision).toNumber()
            params.quantity = quantity
        }
    } else {
        // 建仓
        if (unit === ORDER_AMOUNT_TYPES.QUOTE) {
            // U本位绝对值建仓
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount)
            const quantity = new Decimal(amount).mul(realLeverage).div(qtoAmountStep).floor().mul(qtoAmountStep).div(market.contractSize).toDecimalPlaces(precision).toNumber()
            params.quantity = quantity
        } else {
            // 可开仓位按quote计价的数量的最小粒度
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount)
            // console.log('qtoAmountStep', market.contractSize, market.precision.amount, lastPrice, qtoAmountStep.toNumber())
            let maxStepAmount // 最小粒度的最大数量
            if (usePct) {
                // 百分比建仓
                const balance = getExchangeMonitor(exchange).balance[market.subType][market.base].free || 0
                // console.log('maxStepAmount', getExchangeMonitor(exchange).balance, balance, amountPct, qtoAmountStep.toNumber())
                maxStepAmount = new Decimal(balance).mul(amountPct).div(100).mul(realLeverage).mul(lastPrice).div(qtoAmountStep).floor()
            } else {
                // 币本位绝对值建仓
                // console.log(new Decimal(amount).div(qtoAmountStep).toNumber())
                maxStepAmount = new Decimal(amount).mul(realLeverage).mul(lastPrice).div(qtoAmountStep).floor()
            }
            // console.log('quantity', maxStepAmount.toNumber(), qtoAmountStep.toNumber(), market.contractSize, lastPrice)
            // 逻辑正确，quantity参数是计算杠杆后的开仓数量，所以要把要开的保证金乘以杠杆
            const quantity = maxStepAmount.mul(qtoAmountStep).div(market.contractSize).toDecimalPlaces(precision).toNumber()
            // console.log('quantity', quantity)
            params.quantity = quantity
        }
    }
    // console.log('realMinQuantity', market.limits, lastPrice)
    const realMinQuantity = Math.max(
        market.limits.amount.min,
        // 币本位合约可能没有cost.min
        market.limits.cost?.min ? new Decimal(market.limits.cost.min).div(lastPrice).toDecimalPlaces(precision, Decimal.ROUND_UP).toNumber() : 0,
    )

    if (params.quantity < realMinQuantity) {
        throw new Error('下单数量不满足最低成交量')
    }
    // console.log('createLinearPerpMarketOrder quantity', params.quantity, precision); 
    if (useTWAP) {
        if (totalMinute < 1) {
            throw new Error('TWAP总时间不能少于1分钟')
        }
        if (withSLTP && priceLimit) {
            // 合约带止损的twap只有加仓订单, 减仓订单没有止盈止损选项
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
        return createTWAPOrder({ exchange, symbol, side, params, leverage: realLeverage, withSLTP, sltpParams, totalMinute, priceLimit, market })
    }
    logger.info(`创建合约市价单 ${exchange} ${symbol} ${side} ${params.quantity}(张) 杠杆:${realLeverage}x`)
    const result = await getExchangeMonitor(exchange).exchange.createOrderWs(symbol, ORDER_TYPES.MARKET, side, undefined, undefined, params)
    logger.info(`市价单成交 ${exchange} ${symbol} ${side} 成交价格:${result.average} 成交额:${result.cost}(${market.quote}) 成交量:${result.filled}(张)`)
    // await getExchangeMonitor(exchange).awaitPositionsUpdate([symbol])
    if (withSLTP) {
        sltpParams.amount = result.amount
        sltpParams.unit = ORDER_AMOUNT_TYPES.CONTRACT
        const sltpOrder = orderWatcher.creatOrder(sltpParams)
        if (!options.skipSLTPOrderSave) {
            result._sltp = await sltpOrder
        }
    }
    return result
}