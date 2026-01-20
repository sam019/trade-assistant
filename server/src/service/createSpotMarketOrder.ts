import Decimal from 'decimal.js'
import { ORDER_TYPES, ORDER_SIDES, ORDER_AMOUNT_TYPES, TWAP_INTERVAL, ORDER_STATES } from 'share/const.js'
import { getPrecisionLength, sleep, checkSymbol } from 'share/utils.js'
import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import orderWatcher from '../monitor/orderMonitor.js'
import logger from '../logger.js'
import type { CreateOrderParams, Market } from '../types/index.js'
import type ccxt from 'ccxt'

interface CreateTWAPOrderParams {
    exchange: string
    symbol: string
    side: string
    params: { quoteOrderQty?: number; quantity?: number }
    withSLTP: boolean
    sltpParams: any
    totalMinute: number
    priceLimit?: number
    market: Market
}

async function createTWAPOrder({ exchange, symbol, side, params, withSLTP, sltpParams, totalMinute, priceLimit, market }: CreateTWAPOrderParams): Promise<{ _twap: any }> {
    const stepNum = Math.ceil(totalMinute * 60 * 1000 / TWAP_INTERVAL)
    const totalAmount = params.quoteOrderQty || params.quantity || 0
    const unit = params.quoteOrderQty ? ORDER_AMOUNT_TYPES.QUOTE : ORDER_AMOUNT_TYPES.BASE
    const unitName = market[unit as keyof Market] as string
    logger.info(`开始 现货TWAP ${exchange} ${symbol} ${side} 总数量:${totalAmount}(${unitName}) 总时长:${totalMinute}(分钟) 限价:${priceLimit || '无'}`)

    let twapState: any = {
        exchange,
        symbol,
        side,
        slPrice: sltpParams?.slPrice,
        totalAmount,
        filledAmount: 0,
        unit,
        totalMinute,
        priceLimit,
        state: ORDER_STATES.OPENING,
    }
    const exchangeMonitor = getExchangeMonitor(exchange)
    if (!exchangeMonitor) {
        throw new Error(`Exchange ${exchange} not found`)
    }
    exchangeMonitor.updateTWAPOrder(twapState)

    let remainAmount = totalAmount
    let sltpOrder: any = null
    
    process.nextTick(async () => {
        while (remainAmount > 0) {
            const sign = Date.now()
            try {
                const { last: lastPrice } = await exchangeMonitor.awaitTickersUpdate(symbol)

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

                if (side === ORDER_SIDES.BUY && withSLTP) {
                    if (sltpParams.slPrice && lastPrice < sltpParams.slPrice) {
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
                const basePrecision = getPrecisionLength(market.precision.amount)
                const quotePrecision = getPrecisionLength(market.precision.price)

                const stepParams: any = {}
                const realMinQuote = Math.max(
                    market.limits.cost.min,
                    new Decimal(market.limits.amount.min).mul(lastPrice).toDecimalPlaces(quotePrecision, Decimal.ROUND_UP).toNumber(),
                )
                const realMinBase = Math.max(
                    market.limits.amount.min,
                    new Decimal(market.limits.cost.min).div(lastPrice).toDecimalPlaces(basePrecision, Decimal.ROUND_UP).toNumber(),
                )
                if (params.quoteOrderQty) {
                    const amountStep = Math.max(new Decimal(params.quoteOrderQty).div(stepNum).toDecimalPlaces(quotePrecision).toNumber(), realMinQuote)
                    stepParams.quoteOrderQty = (remainAmount < new Decimal(amountStep).mul(2).toNumber()) ? remainAmount : amountStep
                } else {
                    const amountStep = Math.max(new Decimal(params.quantity || 0).div(stepNum).toDecimalPlaces(basePrecision).toNumber(), realMinBase)
                    stepParams.quantity = (remainAmount < new Decimal(amountStep).mul(2).toNumber()) ? remainAmount : amountStep
                }
            
                logger.info(`创建市价单(TWAP) ${exchange} ${symbol} ${side} 数量:${stepParams.quoteOrderQty || stepParams.quantity}(${unitName})`)
                const result = await (exchangeMonitor.exchange as any).createOrderWs(symbol, ORDER_TYPES.MARKET, side, undefined, undefined, stepParams)
                logger.info(`市价单(TWAP)成交 ${exchange} ${symbol} ${side} 成交价格:${result.average} 成交额:${result.cost}(${market.quote}) 成交量:${result.filled}(${market.base})`)

                remainAmount = new Decimal(remainAmount).sub(params.quoteOrderQty ? result.cost : result.filled).toNumber()
                twapState.filledAmount = new Decimal(twapState.totalAmount).sub(remainAmount).toNumber()
                logger.info(`总成交量${twapState.filledAmount} 剩余数量:${remainAmount}(${unitName})`)
                
                if (withSLTP) {
                    if (!sltpOrder) {
                        sltpOrder = await orderWatcher.creatOrder({ ...sltpParams, amount: twapState.filledAmount, unit: ORDER_AMOUNT_TYPES.BASE })
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
                if (
                    (params.quantity && remainAmount < realMinBase)
                    || (params.quoteOrderQty && remainAmount < realMinQuote)
                ) {
                    twapState.state = ORDER_STATES.RESOLVED
                    exchangeMonitor.updateTWAPOrder(twapState)
                    logger.info('TWAP剩余数量不满足最小成交数量, 终止TWAP')
                    break
                }
                
                exchangeMonitor.updateTWAPOrder(twapState)

                await sleep(TWAP_INTERVAL, sign)
            } catch (e) {
                logger.error('createTWAPOrder error: ', e)
                await sleep(TWAP_INTERVAL, sign)
            }
        }
    })
    return {
        _twap: twapState,
    }
}

interface CreateSpotMarketOrderOptions {
    skipSLTPOrderSave?: boolean
}

export default async function createSpotMarketOrder(data: CreateOrderParams, options: CreateSpotMarketOrderOptions = {}): Promise<ccxt.Order | { _twap: any }> {
    const { exchange, symbol, side, amount, unit, usePct, amountPct, withSLTP, slPrice, tpPrice, useTWAP, totalMinute, priceLimit } = data
    const exchangeMonitor = getExchangeMonitor(exchange)
    if (!exchangeMonitor) {
        throw new Error(`Exchange ${exchange} not found`)
    }
    const market = exchangeMonitor.markets.spot.find(mar => mar.symbol === symbol)
    if (!market) {
        throw new Error('错误: 交易对无效')
    }
    const basePrecision = getPrecisionLength(market.precision.amount)
    const quotePrecision = getPrecisionLength(market.precision.price)

    const params: { quantity?: number; quoteOrderQty?: number } = {}
    if (usePct) {
        const cSymbol = checkSymbol(symbol)
        if (side === ORDER_SIDES.SELL) {
            const balance = exchangeMonitor.balance.spot[cSymbol.base]?.free
            if (balance) {
                params.quantity = new Decimal(balance).mul(amountPct || 0).div(100).toDecimalPlaces(basePrecision).toNumber()
            }
        } else {
            const balance = exchangeMonitor.balance.spot[cSymbol.quote]?.free
            if (!balance) {
                throw new Error('错误: 未检测到余额')
            }
            params.quoteOrderQty = new Decimal(balance).mul(amountPct || 0).div(100).toDecimalPlaces(quotePrecision).toNumber()
        }
    } else if (unit === ORDER_AMOUNT_TYPES.QUOTE) {
        params.quoteOrderQty = new Decimal(amount).toDecimalPlaces(quotePrecision).toNumber()
    } else {
        params.quantity = new Decimal(amount).toDecimalPlaces(basePrecision).toNumber()
    }
    const { last: lastPrice } = await exchangeMonitor.awaitTickersUpdate(symbol)
    
    const realMinBase = Math.max(
        market.limits.amount.min,
        new Decimal(market.limits.cost.min).div(lastPrice).toDecimalPlaces(basePrecision, Decimal.ROUND_UP).toNumber(),
    )
    const realMinQuote = Math.max(
        market.limits.cost.min,
        new Decimal(market.limits.amount.min).mul(lastPrice).toDecimalPlaces(quotePrecision, Decimal.ROUND_UP).toNumber(),
    )

    if (params.quantity ? params.quantity < realMinBase : (params.quoteOrderQty || 0) < realMinQuote) {
        throw new Error('下单数量不满足最低成交量')
    }
    const sltpParams: any = {
        exchange,
        symbol,
        type: ORDER_TYPES.SLTP,
    }
    if (withSLTP) {
        if (!slPrice && !tpPrice) {
            throw new Error('无效的止盈止损价格')
        }
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
    console.log(useTWAP)
    if (useTWAP) {
        if (totalMinute && totalMinute < 1) {
            throw new Error('TWAP总时间不能少于1分钟')
        }
        if (withSLTP && priceLimit) {
            if (sltpParams.tpPrice && priceLimit > sltpParams.tpPrice) {
                throw new Error('TWAP限价不能大于止盈价格')
            } else if (sltpParams.slPrice && priceLimit < sltpParams.slPrice) {
                throw new Error('TWAP限价不能小于止盈价格')
            }
        }
        return createTWAPOrder({ exchange, symbol, side, params, withSLTP: withSLTP || false, sltpParams, totalMinute: totalMinute || 0, priceLimit, market })
    }
    
    logger.info(`创建现货市价单 ${exchange} ${symbol} ${side} ${params.quantity || params.quoteOrderQty}(${params.quantity ? market.base : market.quote})`)
    const result = await (exchangeMonitor.exchange as any).createOrderWs(symbol, ORDER_TYPES.MARKET, side, undefined, undefined, params)
    logger.info(`市价单成交 ${exchange} ${symbol} ${side} 成交价格:${result.average} 成交额:${result.cost}(${market.quote}) 成交量:${result.filled}(${market.base})`)

    if (withSLTP) {
        sltpParams.amount = result.filled
        sltpParams.unit = ORDER_AMOUNT_TYPES.BASE
        const sltpOrder = orderWatcher.creatOrder(sltpParams)
        if (!options.skipSLTPOrderSave) {
            (result as any)._sltp = await sltpOrder
        }
    }
    return result
}

