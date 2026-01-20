import Decimal from 'decimal.js'
import { ORDER_TYPES, ORDER_SIDES, ORDER_AMOUNT_TYPES, POSITION_SIDES, TWAP_INTERVAL, ORDER_STATES } from 'share/const.js'
import { getPrecisionLength, sleep } from 'share/utils.js'
import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import orderWatcher from '../monitor/orderMonitor.js'
import logger from '../logger.js'
import { isMarginInsufficientErr } from '../utils.js'
import type { CreateOrderParams, Market } from '../types/index.js'
import type ccxt from 'ccxt'

interface CreateTWAPOrderParams {
    exchange: string
    symbol: string
    side: string
    params: { reduceOnly?: boolean; quantity: number }
    leverage: number
    withSLTP: boolean
    sltpParams: any
    totalMinute: number
    priceLimit?: number
    market: ccxt.Market
}

export async function createTWAPOrder({ exchange, symbol, side, params, leverage, withSLTP, sltpParams, totalMinute, priceLimit, market }: CreateTWAPOrderParams): Promise<{ _twap: any }> {
    const stepNum = Math.ceil(totalMinute * 60 * 1000 / TWAP_INTERVAL)
    const { reduceOnly, quantity: totalAmount } = params
    logger.info(`开始 合约TWAP ${exchange} ${symbol} ${side} 总数量:${totalAmount}(张) 总时长:${totalMinute}(分钟) 限价:${priceLimit || '无'}`)

    let twapState: any = {
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
    if (!exchangeMonitor) {
        throw new Error(`Exchange ${exchange} not found`)
    }
    exchangeMonitor.updateTWAPOrder(twapState)

    const precision = getPrecisionLength(market.precision.amount)
    
    let remainAmount = totalAmount
    let sltpOrder: any = null
    
    process.nextTick(async () => {
        while (remainAmount > 0) {
            const sign = Date.now()
            try {
                let lastPrice: number
                if (reduceOnly) {
                    const position = await exchangeMonitor.awaitPositionsUpdate(symbol)
                    lastPrice = position.markPrice
                } else {
                    const ticker = await exchangeMonitor.awaitTickersUpdate(symbol)
                    lastPrice = ticker.last || 0
                }

                twapState = exchangeMonitor.getTWAPOrder(symbol)
                if (!twapState) {
                    logger.info('TWAP订单已取消, 终止TWAP')
                    break
                }

                if (twapState.state === ORDER_STATES.STOPED) {
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
                        if (lastPrice > priceLimit) {
                            isPriceOverLimit = true
                        }
                    } else {
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

                const stepParams = {
                    reduceOnly,
                    quantity: (remainAmount < new Decimal(amountStep).mul(2).toNumber()) ? remainAmount : amountStep,
                }

                logger.info(`创建合约市价单(TWAP) ${exchange} ${symbol} ${side} 数量:${stepParams.quantity}(张)`)
                const result = await (exchangeMonitor.exchange as any).createOrderWs(symbol, ORDER_TYPES.MARKET, side, undefined, undefined, stepParams)
                logger.info(`市价单(TWAP)成交 ${exchange} ${symbol} ${side} 成交价格:${result.average} 成交额:${result.cost}(${market.quote}) 成交量:${result.filled}(张)`)
                
                remainAmount = new Decimal(remainAmount).sub(result.filled).toNumber()
                twapState.filledAmount = new Decimal(twapState.filledAmount).add(result.filled).toNumber()
                logger.info(`总成交量:${twapState.filledAmount} 剩余数量:${remainAmount}(张)`)

                if (withSLTP) {
                    if (!sltpOrder) {
                        sltpOrder = await orderWatcher.creatOrder({ ...sltpParams, amount: twapState.filledAmount, unit: ORDER_AMOUNT_TYPES.CONTRACT })
                    } else {
                        sltpOrder = await orderWatcher.updateOrder(sltpOrder._id, { amount: twapState.filledAmount })
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
                let sleepTime = TWAP_INTERVAL
                if (isMarginInsufficientErr(e)) {
                    remainAmount = new Decimal(remainAmount).mul(0.995).toDecimalPlaces(precision).toNumber()
                    logger.warn('保证金余额不足, 尝试减少下单数量, 新数量: ', remainAmount)
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

interface CreateLinearPerpMarketOrderOptions {
    skipSLTPOrderSave?: boolean
}

export default async function createLinearPerpMarketOrder(data: CreateOrderParams, options: CreateLinearPerpMarketOrderOptions = {}): Promise<ccxt.Order | { _twap: any }> {
    const { exchange, symbol, side, amount, leverage, amountPct, usePct, unit, withSLTP, slPrice, tpPrice, reduceOnly = false, useTWAP, totalMinute, priceLimit } = data
    const exchangeMonitor = getExchangeMonitor(exchange)
    if (!exchangeMonitor) {
        throw new Error(`Exchange ${exchange} not found`)
    }
    const market = (exchangeMonitor.exchange as any).markets[symbol] as ccxt.Market
    const position = await exchangeMonitor.awaitPositionsUpdate(symbol)
    const isReduce = !!position && ((side === ORDER_SIDES.BUY && position.side === POSITION_SIDES.SHORT) || (side === ORDER_SIDES.SELL && position.side === POSITION_SIDES.LONG))

    const leverages = await exchangeMonitor.fetchLeverages(symbol)
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
        } else if (unit === ORDER_AMOUNT_TYPES.QUOTE) {
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount).mul(lastPrice)
            const quantity = new Decimal(amount).div(qtoAmountStep).floor().mul(qtoAmountStep).div(market.contractSize).div(lastPrice).toDecimalPlaces(precision).toNumber()
            params.quantity = quantity
        } else {
            const baseAmountStep = new Decimal(market.contractSize).mul(market.precision.amount)
            const quantity = new Decimal(amount).div(baseAmountStep).floor().mul(baseAmountStep).toDecimalPlaces(precision).toNumber()
            params.quantity = quantity
        }
    } else {
        if (unit === ORDER_AMOUNT_TYPES.BASE) {
            const baseAmountStep = new Decimal(market.contractSize).mul(market.precision.amount)
            const quantity = new Decimal(amount).mul(realLeverage).div(baseAmountStep).floor().mul(baseAmountStep).toDecimalPlaces(precision).toNumber()
            params.quantity = quantity
        } else {
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount).mul(lastPrice)
            let maxStepAmount: Decimal
            if (usePct) {
                const balance = exchangeMonitor.balance[(market as any).subType][market.quote].free
                maxStepAmount = new Decimal(balance).mul(amountPct || 0).div(100).mul(realLeverage).div(qtoAmountStep).floor()
            } else {
                maxStepAmount = new Decimal(amount).mul(realLeverage).div(qtoAmountStep).floor()
            }
            const quantity = maxStepAmount.mul(qtoAmountStep).div(market.contractSize).div(lastPrice).toDecimalPlaces(precision).toNumber()
            params.quantity = quantity
        }
    }

    const realMinQuantity = Math.max(
        market.limits.amount.min,
        new Decimal(market.limits.cost.min).div(lastPrice).toDecimalPlaces(precision, Decimal.ROUND_UP).toNumber(),
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

