import Decimal from 'decimal.js'

import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import { ORDER_TYPES, ORDER_SIDES, ORDER_AMOUNT_TYPES, POSITION_SIDES, TWAP_INTERVAL } from 'share/const.js'
import { getPrecisionLength, sleep } from 'share/utils.js'
import orderWatcher from '../monitor/orderMonitor.js'
import logger from '../logger.js'

export async function createTWAPOrder({ exchange, symbol, side, reduceOnly, params, withSLTP, sltpParams, totalMinute, market }) {
    const stepNum = Math.ceil(totalMinute * 60 * 1000 / TWAP_INTERVAL)
    const quantityStep = Math.max(new Decimal(params.quantity).div(stepNum).toDecimalPlaces(getPrecisionLength(market.precision.amount)).toNumber(), market.precision.amount)

    let remainQuantity = params.quantity, sltpOrder

    while (remainQuantity > 0) {
        const stepParmas = {
            reduceOnly,
            quantity: remainQuantity < new Decimal(quantityStep).mul(2).toNumber() ? remainQuantity : quantityStep,
        }
        try {
            console.log(`创建市价单(TWAP): ${exchange} ${symbol} quantity:${stepParmas.quantity}`)
            const sign = Date.now()
            const result = await getExchangeMonitor(exchange).exchange.createOrderWs(symbol, ORDER_TYPES.MARKET, side, undefined, undefined, stepParmas)
            // todo 向前端推送twap进度
            remainQuantity -= result.filled
            // await getExchangeMonitor(exchange).awaitPositionsUpdate([symbol])
            if (withSLTP) {
                if (!sltpOrder) {
                    sltpOrder = await orderWatcher.creatOrder({ ...sltpParams, amount: result.filled, unit: ORDER_AMOUNT_TYPES.CONTRACT })
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

// 创建U本位合约市价单
export default async function createLinearPerpMarketOrder(data, options = {}) {
    const { exchange, symbol, side, amount, leverage, amountPct, usePct, unit, withSLTP, slPrice, tpPrice, reduceOnly = false, useTWAP, totalMinute } = data
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
    // console.log('balance keys', getExchangeMonitor(exchange).balance, market.swap ? market.subType : market.type, market.quote)
    if (reduceOnly && !position) {
        throw new Error('错误：未检测到仓位')
    }
    // console.log('isReduce', isReduce)
    if (reduceOnly !== isReduce) {
        throw new Error('错误：前后端增减仓逻辑协调错误')
    }
    const tickers = await getExchangeMonitor(exchange).awaitTickersUpdate([symbol])
    // console.log('ticker', tickers[0])
    const last = tickers[0] && tickers[0].last || 0
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
                if (slPrice < last) {
                    sltpParams.slPrice = slPrice
                } else {
                    throw new Error(`无效的止损价格 sl:${slPrice} last:${last}`)
                }
            } else {
                if (slPrice > last) {
                    sltpParams.slPrice = slPrice
                } else {
                    throw new Error(`无效的止损价格 sl:${slPrice} last:${last}`)
                }
            }
        }
        if (tpPrice) {
            if (side === ORDER_SIDES.BUY) {
                if (tpPrice > last) {
                    sltpParams.tpPrice = tpPrice
                } else {
                    throw new Error(`无效的止盈价格 tp:${slPrice} last:${last}`)
                }
            } else {
                if (tpPrice < last) {
                    sltpParams.tpPrice = tpPrice
                } else {
                    throw new Error(`无效的止盈价格 tp:${slPrice} last:${last}`)
                }
            }
        }
    }
    // console.log('last', last)
    // const precisionLength = (Number(market.precision.amount) + 1).toString().split('.')[1].length;
    
    
    
    const precisionLength = getPrecisionLength(market.precision.amount)
    const params = {
        reduceOnly,
    }

    if (unit === ORDER_AMOUNT_TYPES.CONTRACT) {
        // 按张下单，目前只有止盈止损单会触发
        params.quantity = new Decimal(amount).toDecimalPlaces(precisionLength).toNumber()
    } else if (isReduce) {
        if (usePct) {
            // 百分比减仓
            params.quantity = new Decimal(position.contracts).mul(amountPct).div(100).toDecimalPlaces(precisionLength).toNumber()
            // console.log('params.quantity', params.quantity)
        } else if (unit === ORDER_AMOUNT_TYPES.QUOTE) {
            // U本位绝对数量减仓
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount).mul(last)
            const quantity = new Decimal(amount).div(qtoAmountStep).floor().mul(qtoAmountStep).div(market.contractSize).div(last).toDecimalPlaces(precisionLength).toNumber()
            params.quantity = quantity
        } else {
            // 币本位绝对数量减仓
            const baseAmountStep = new Decimal(market.contractSize).mul(market.precision.amount)
            const quantity = new Decimal(amount).div(baseAmountStep).floor().mul(baseAmountStep).toDecimalPlaces(precisionLength).toNumber()
            params.quantity = quantity
        }
    } else {
        // 建仓
        if (unit === ORDER_AMOUNT_TYPES.BASE) {
            // 币本位绝对数量建仓
            const baseAmountStep = new Decimal(market.contractSize).mul(market.precision.amount)
            const quantity = new Decimal(amount).div(baseAmountStep).floor().mul(baseAmountStep).mul(realLeverage).toDecimalPlaces(precisionLength).toNumber()
            params.quantity = quantity
        } else {
            // 可开仓位按quote计价的数量的最小粒度
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount).mul(last)
            // console.log('qtoAmountStep', market.contractSize, market.precision.amount, last, qtoAmountStep.toNumber())
            let maxStepAmount // 最小粒度的数量
            if (usePct) {
                // 百分比数量建仓
                const balance = getExchangeMonitor(exchange).balance[market.subType][market.quote].free
                // console.log('maxStepAmount', getExchangeMonitor(exchange).balance, balance, amountPct, qtoAmountStep.toNumber())
                maxStepAmount = new Decimal(balance).mul(amountPct).div(100).div(qtoAmountStep).floor()
            } else {
                // U本位绝对数量建仓
                // console.log(new Decimal(amount).div(qtoAmountStep).toNumber())
                maxStepAmount = new Decimal(amount).div(qtoAmountStep).floor()
            }
            // console.log('quantity', maxStepAmount.toNumber(), qtoAmountStep.toNumber(), market.contractSize, last)
            // 逻辑正确，quantity参数是计算杠杆后的开仓数量，所以要把要开的保证金乘以杠杆
            const quantity = maxStepAmount.mul(qtoAmountStep).div(market.contractSize).div(last).mul(realLeverage).toDecimalPlaces(precisionLength).toNumber()
            // console.log('quantity', quantity)
            params.quantity = quantity
        }
    }
    // console.log('createLinearPerpMarketOrder quantity', params.quantity, precisionLength); 
    if (useTWAP) {
        if (totalMinute < 1) {
            throw new Error('TWAP总时间不能少于1分钟')
        }
        return createTWAPOrder({ exchange, symbol, side, reduceOnly, params, withSLTP, sltpParams, totalMinute, market })
    }

    console.log(`创建U本位市价单 ${exchange} ${symbol} ${params.quantity}(contract) leverage: ${realLeverage}`)
    const result = await getExchangeMonitor(exchange).exchange.createOrderWs(symbol, ORDER_TYPES.MARKET, side, undefined, undefined, params)
    console.log(`下单成功 filled:${result.filled} amount:${result.amount} cost:${result.cost}`)
    await getExchangeMonitor(exchange).awaitPositionsUpdate([symbol])
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
// 创