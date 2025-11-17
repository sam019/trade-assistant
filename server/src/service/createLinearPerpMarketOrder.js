import Decimal from 'decimal.js'

import { ORDER_TYPES, ORDER_SIDES, ORDER_AMOUNT_TYPES, POSITION_SIDES, TWAP_INTERVAL, ORDER_STATES } from 'share/const.js'
import { getPrecisionLength, sleep, isDev } from 'share/utils.js'

import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import orderWatcher from '../monitor/orderMonitor.js'
import logger from '../logger.js'
import { isMarginInsufficientErr } from '../utils.js'

export async function createTWAPOrder({ exchange, symbol, side, params, leverage, withSLTP, sltpParams, totalMinute, priceLimit, market }) {
    const stepNum = Math.ceil(totalMinute * 60 * 1000 / TWAP_INTERVAL)
    const { reduceOnly, quantity: totalAmount } = params
    logger.info(`开始 合约TWAP ${exchange} ${symbol} ${side} 总数量:${totalAmount}(张) 总时长:${totalMinute}(分钟) 限价:${priceLimit || '无'}`)

    let twapState = {
        exchange,
        symbol,
        side,
        leverage,
        slPrice: sltpParams?.slPrice,
        totalAmount,
        filledAmount: 0,
        unit: ORDER_AMOUNT_TYPES.CONTRACT,
        totalMinute,
        priceLimit,
        state: ORDER_STATES.OPENING,
    }
    const exchangeMonitor = getExchangeMonitor(exchange)
    exchangeMonitor.updateTWAPOrder(twapState)

    const precision = getPrecisionLength(market.precision.amount)
    
    let remainAmount = totalAmount
    let sltpOrder
    
    process.nextTick(async () => {
        while (remainAmount > 0) {
            const sign = Date.now()
            try {
                let lastPrice
                if (reduceOnly) {
                    ({ markPrice: lastPrice } = await exchangeMonitor.awaitPositionsUpdate(symbol))
                } else {
                    ({ last: lastPrice } = await exchangeMonitor.awaitTickersUpdate(symbol))
                }

                // 订单状态检测和下单之间最好不能有任何异步过程,防止在异步过程中,订单被取消或发生其他变化,无法被检测到
                twapState = exchangeMonitor.getTWAPOrder(symbol)
                // console.log('twapState', twapState)
                if (!twapState) {
                    logger.info('TWAP订单已取消, 终止TWAP')
                    break
                }

                if (twapState.state === ORDER_STATES.STOPED) {
                    // 手动暂停
                    logger.info('TWAP订单已暂停')
                    await sleep(TWAP_INTERVAL, sign)
                    continue
                }

                const realMinQuantity = Math.max(
                    market.limits.amount.min,
                    market.limits.cost?.min ? new Decimal(market.limits.cost.min).div(lastPrice).toDecimalPlaces(precision, Decimal.ROUND_UP).toNumber() : 0,
                )

                const amountStep = Math.max(
                    new Decimal(params.quantity).div(stepNum).toDecimalPlaces(precision).toNumber(),
                    realMinQuantity,
                )

                // 合约带有sltp的twap订单只能是加仓单，因为减仓单不支持sltp
                if (!reduceOnly && withSLTP && sltpParams.slPrice) {
                    let isSLTriggered = false
                    if (side === ORDER_SIDES.BUY) {
                        if (lastPrice < sltpParams.slPrice) {
                            isSLTriggered = true
                        }
                    } else {
                        if (lastPrice > sltpParams.slPrice) {
                            isSLTriggered = true
                        }
                    }
                    // 越过止损价，停止twap
                    if (isSLTriggered) {
                        twapState.state = ORDER_STATES.CLOSED
                        exchangeMonitor.updateTWAPOrder(twapState)
                        logger.info('止损已触发, 终止TWAP')
                        break
                    }
                }

                if (priceLimit) {
                    let isPriceOverLimit = false
                    if (side === ORDER_SIDES.BUY) {
                        // 做多/平空 价格要比limit低
                        if (lastPrice > priceLimit) {
                            isPriceOverLimit = true
                        }
                    } else {
                        // 做空/平多 价格要比limit高
                        if (lastPrice < priceLimit) {
                            isPriceOverLimit = true
                        }
                    }
                    if (isPriceOverLimit) {
                        logger.info(`价格(${lastPrice})超过TWAP限价(${priceLimit}), 暂停TWAP`)
                        twapState.state = ORDER_STATES.SUSPEND
                        exchangeMonitor.updateTWAPOrder(twapState)
                        await sleep(TWAP_INTERVAL, sign)
                        continue
                    }
                }

                const stepParmas = {
                    reduceOnly,
                    quantity: (remainAmount < new Decimal(amountStep).mul(2).toNumber()) ? remainAmount : amountStep,
                }

                logger.info(`创建合约市价单(TWAP) ${exchange} ${symbol} ${side} 数量:${stepParmas.quantity}(张)`)
                const result = await exchangeMonitor.exchange.createOrderWs(symbol, ORDER_TYPES.MARKET, side, undefined, undefined, stepParmas)
                logger.info(`市价单(TWAP)成交 ${exchange} ${symbol} ${side} 成交价格:${result.average} 成交额:${result.cost}(${market.quote}) 成交量:${result.filled}(张)`)
                // todo 向前端推送twap进度
                remainAmount = new Decimal(remainAmount).sub(result.filled).toNumber()
                twapState.filledAmount = new Decimal(twapState.filledAmount).add(result.filled).toNumber()
                logger.info(`总成交量:${twapState.filledAmount} 剩余数量:${remainAmount}(张)`)

                // await getExchangeMonitor(exchange).awaitPositionsUpdate([symbol])

                if (withSLTP) {
                    if (!sltpOrder) {
                        sltpOrder = await orderWatcher.creatOrder({ ...sltpParams, amount: twapState.filledAmount, unit: ORDER_AMOUNT_TYPES.CONTRACT })
                        // console.log('sltpOrder', sltpOrder._id)
                    } else {
                        sltpOrder = await orderWatcher.updateOrder(sltpOrder._id, { amount: twapState.filledAmount })
                        // console.log('sltpOrder', sltpOrder._id)
                    }
                }

                if (!remainAmount) {
                    twapState.state = ORDER_STATES.RESOLVED
                    exchangeMonitor.updateTWAPOrder(twapState)
                    logger.info('TWAP已完成')
                    break
                }
                if (remainAmount < realMinQuantity) {
                    twapState.state = ORDER_STATES.RESOLVED
                    exchangeMonitor.updateTWAPOrder(twapState)
                    logger.info('TWAP剩余数量不满足最小成交数量, 终止TWAP')
                    break
                }
                
                exchangeMonitor.updateTWAPOrder(twapState)
                
                await sleep(TWAP_INTERVAL, sign)
            } catch (e) {
                // if (isDev()) {
                //     throw e
                // }
                

                let sleepTime = TWAP_INTERVAL
                if (isMarginInsufficientErr(e)) {
                    
                    // console.log('remainAmount', remainAmount)
                    // 交易所提示余额不足，可能是价格变动导致合约需要的保证金变化，所以减小下单数量
                    remainAmount = new Decimal(remainAmount).mul(0.995).toDecimalPlaces(precision).toNumber()
                    logger.warn('保证金余额不足, 尝试减少下单数量, 新数量: ', remainAmount)
                    // console.log('remainAmount', remainAmount)
                    sleepTime = 1000
                } else {
                    logger.error('createTWAPOrder error: ', e)
                }
                await sleep(sleepTime, sign)
            }
        }
    })
    return {
        _twap: twapState,
    }
}

// 创建U本位合约市价单
export default async function createLinearPerpMarketOrder(data, options = {}) {
    const { exchange, symbol, side, amount, leverage, amountPct, usePct, unit, withSLTP, slPrice, tpPrice, reduceOnly = false, useTWAP, totalMinute, priceLimit } = data
    const market = getExchangeMonitor(exchange).exchange.markets[symbol]
    const position = await getExchangeMonitor(exchange).awaitPositionsUpdate(symbol)
    // 如果当前有仓位并且仓位方向和下单放下相反，判断为减仓单
    const isReduce = !!position && ((side === ORDER_SIDES.BUY && position.side === POSITION_SIDES.SHORT) || (side === ORDER_SIDES.SELL && position.side === POSITION_SIDES.LONG))

    const { longLeverage: realLeverage } = await getExchangeMonitor(exchange).fetchLeverages(symbol)
    if (leverage) {
        if (leverage !== realLeverage) {
            throw new Error('错误: 杠杆参数不一致')
        }
    }
    // console.log('balance keys', getExchangeMonitor(exchange).balance, market.swap ? market.subType : market.type, market.quote)
    if (reduceOnly && !position) {
        throw new Error('错误: 未检测到仓位')
    }
    // console.log('isReduce', isReduce)
    if (reduceOnly !== isReduce) {
        throw new Error('错误: 前后端增减仓逻辑协调错误')
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
        reduceOnly, // binance特殊字段, 防止减仓单加仓到反向
    }

    if (unit === ORDER_AMOUNT_TYPES.CONTRACT) {
        // 按张下单，目前只有止盈止损单会触发
        params.quantity = new Decimal(amount).toDecimalPlaces(precision).toNumber()
    } else if (isReduce) {
        if (usePct) {
            // 百分比减仓
            params.quantity = new Decimal(position.contracts).mul(amountPct).div(100).toDecimalPlaces(precision).toNumber()
            // console.log('params.quantity', params.quantity)
        } else if (unit === ORDER_AMOUNT_TYPES.QUOTE) {
            // U本位绝对数量减仓
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount).mul(lastPrice)
            const quantity = new Decimal(amount).div(qtoAmountStep).floor().mul(qtoAmountStep).div(market.contractSize).div(lastPrice).toDecimalPlaces(precision).toNumber()
            params.quantity = quantity
        } else {
            // 币本位绝对数量减仓
            const baseAmountStep = new Decimal(market.contractSize).mul(market.precision.amount)
            const quantity = new Decimal(amount).div(baseAmountStep).floor().mul(baseAmountStep).toDecimalPlaces(precision).toNumber()
            params.quantity = quantity
        }
    } else {
        // 建仓
        if (unit === ORDER_AMOUNT_TYPES.BASE) {
            // 币本位绝对数量建仓
            const baseAmountStep = new Decimal(market.contractSize).mul(market.precision.amount)
            const quantity = new Decimal(amount).mul(realLeverage).div(baseAmountStep).floor().mul(baseAmountStep).toDecimalPlaces(precision).toNumber()
            params.quantity = quantity
        } else {
            // 可开仓位按quote计价的数量的最小粒度
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount).mul(lastPrice)
            // console.log('qtoAmountStep', market.contractSize, market.precision.amount, lastPrice, qtoAmountStep.toNumber())
            let maxStepAmount // 最小粒度的数量
            if (usePct) {
                // 百分比数量建仓
                const balance = getExchangeMonitor(exchange).balance[market.subType][market.quote].free
                // console.log('maxStepAmount', getExchangeMonitor(exchange).balance, balance, amountPct, qtoAmountStep.toNumber())
                maxStepAmount = new Decimal(balance).mul(amountPct).div(100).mul(realLeverage).div(qtoAmountStep).floor()
            } else {
                // U本位绝对数量建仓
                // console.log(new Decimal(amount).div(qtoAmountStep).toNumber())
                maxStepAmount = new Decimal(amount).mul(realLeverage).div(qtoAmountStep).floor()
            }
            // console.log('quantity', maxStepAmount.toNumber(), qtoAmountStep.toNumber(), market.contractSize, lastPrice)
            // 逻辑正确，quantity参数是计算杠杆后的开仓数量，所以要把要开的保证金乘以杠杆
            const quantity = maxStepAmount.mul(qtoAmountStep).div(market.contractSize).div(lastPrice).toDecimalPlaces(precision).toNumber()
            // console.log('quantity', quantity)
            params.quantity = quantity
        }
    }

    const realMinQuantity = Math.max(
        market.limits.amount.min,
        new Decimal(market.limits.cost.min).div(lastPrice).toDecimalPlaces(precision, Decimal.ROUND_UP).toNumber(),
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
    // await getExchangeMonitor(exchange).awaitPositionsUpdate(symbol)
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
