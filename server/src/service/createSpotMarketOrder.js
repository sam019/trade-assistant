import Decimal from 'decimal.js'

import { ORDER_TYPES, ORDER_SIDES, ORDER_AMOUNT_TYPES, TWAP_INTERVAL, ORDER_STATES } from 'share/const.js'
import { getPrecisionLength, sleep, isDev, checkSymbol } from 'share/utils.js'
import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import orderWatcher from '../monitor/orderMonitor.js'
import logger from '../logger.js'

async function createTWAPOrder({ exchange, symbol, side, params, withSLTP, sltpParams, totalMinute, priceLimit, market }) {
    const stepNum = Math.ceil(totalMinute * 60 * 1000 / TWAP_INTERVAL)
    const totalAmount = params.quoteOrderQty || params.quantity
    const unit = params.quoteOrderQty ? ORDER_AMOUNT_TYPES.QUOTE : ORDER_AMOUNT_TYPES.BASE
    const unitName = market[unit]
    logger.info(`开始 现货TWAP 总数量:${totalAmount}(${unitName}) 总时长:${totalMinute}(分钟) 限价:${priceLimit || '无'}`)

    const twapState = {
        exchange,
        symbol,
        side,
        totalAmount,
        filledAmount: 0,
        unit,
        totalMinute,
        priceLimit,
        state: ORDER_STATES.OPENING,
    }
    const exchangeMonitor = getExchangeMonitor(exchange)
    exchangeMonitor.updateTWAPOrder(twapState)

    let remainAmount = totalAmount
    let sltpOrder
    setTimeout(async () => {
        while (remainAmount > 0) {
            const sign = Date.now()
            try {
                if (!exchangeMonitor.getTWAPOrder(symbol)) {
                    logger.info('TWAP订单已取消, 终止TWAP')
                    break
                }
                
                const lastPrice = (await getExchangeMonitor(exchange).awaitTickersUpdate([symbol]))[0]?.last

                if (withSLTP) {
                // 现货带有sltp的twap订单只能是买单，因为卖单不支持sltp
                    if (side === ORDER_SIDES.BUY) {
                        if (sltpParams.slPrice && lastPrice < sltpParams.slPrice) {
                            // 跌破止损价，停止twap
                            logger.info('止损已触发, 终止TWAP')
                            break
                        }
                    }
                }
                if (priceLimit) {
                    let isPriceTooVolatile = false
                    if (side === ORDER_SIDES.BUY) {
                        if (lastPrice > priceLimit) {
                            isPriceTooVolatile = true
                        } else if (lastPrice < priceLimit) {
                            isPriceTooVolatile = true
                        }
                    }
                    if (isPriceTooVolatile) {
                        logger.info(`价格(${lastPrice})超过TWAP限价(${priceLimit}), 暂停TWAP`)
                        twapState.state = ORDER_STATES.SUSPEND
                        exchangeMonitor.updateTWAPOrder(twapState)
                        await sleep(TWAP_INTERVAL, sign)
                        continue
                    }
                }
                const basePrecision = getPrecisionLength(market.precision.amount)
                const quotePrecision = getPrecisionLength(market.precision.price)

                const stepParmas = {}
                if (params.quoteOrderQty) {
                    const realMinQuote = Math.max(
                        market.limits.cost.min,
                        new Decimal(market.limits.amount.min).mul(lastPrice).toDecimalPlaces(quotePrecision, Decimal.ROUND_UP).toNumber(),
                    )
                    const amountStep = Math.max(new Decimal(params.quoteOrderQty).div(stepNum).toDecimalPlaces(quotePrecision).toNumber(), realMinQuote)
                    stepParmas.quoteOrderQty = (remainAmount < new Decimal(amountStep).mul(2).toNumber()) ? remainAmount : amountStep
                    // console.log('realMinQuote', realMinQuote, amountStep)
                } else {
                    const realMinBase = Math.max(
                        market.limits.amount.min,
                        new Decimal(market.limits.cost.min).div(lastPrice).toDecimalPlaces(basePrecision, Decimal.ROUND_UP).toNumber(),
                    )
                    const amountStep = Math.max(new Decimal(params.quantity).div(stepNum).toDecimalPlaces(basePrecision).toNumber(), realMinBase)
                    stepParmas.quantity = (remainAmount < new Decimal(amountStep).mul(2).toNumber()) ? remainAmount : amountStep
                    // console.log('realMinBase', realMinBase, amountStep)
                }
            
                logger.info(`创建市价单(TWAP) ${exchange} ${symbol} ${side} 数量:${stepParmas.quoteOrderQty || stepParmas.quantity}(${unitName})`)
                const result = await getExchangeMonitor(exchange).exchange.createOrderWs(symbol, ORDER_TYPES.MARKET, side, undefined, undefined, stepParmas)
                // logger.info('result', result)
                logger.info(`市价单(TWAP)成交 ${exchange} ${symbol} ${side} 成交价格:${result.average} 成交额:${result.cost}(${market.quote}) 成交量:${result.filled}(${market.base})`)

                remainAmount = new Decimal(remainAmount).sub(params.quoteOrderQty ? result.cost : result.filled).toNumber()
                logger.info(`剩余数量:${remainAmount}(${unitName})`)
                twapState.filledAmount = twapState.totalAmount - remainAmount
                
                if (withSLTP) {
                    if (!sltpOrder) {
                        sltpOrder = await orderWatcher.creatOrder({ ...sltpParams, amount: result.filled, unit: ORDER_AMOUNT_TYPES.BASE })
                    } else {
                        sltpOrder = await orderWatcher.updateOrder(sltpOrder._id, { amount: sltpOrder.amount + result.filled })
                    }
                }

                if (!remainAmount) {
                    twapState.state = ORDER_STATES.RESOLVED
                    exchangeMonitor.updateTWAPOrder(twapState)
                    logger.info('TWAP已完成')
                    break
                }
                if (
                    (params.quantity && remainAmount < market.limits.amount.min)
                    || (params.quoteOrderQty && remainAmount < market.limits.cost.min)
                ) {
                    twapState.state = ORDER_STATES.RESOLVED
                    exchangeMonitor.updateTWAPOrder(twapState)
                    logger.info('TWAP剩余数量不满足最小成交数量, 终止TWAP')
                    break
                }
                
                exchangeMonitor.updateTWAPOrder(twapState)

                await sleep(TWAP_INTERVAL, sign)
            } catch (e) {
                if (isDev()) {
                    throw e
                }
                logger.error('createTWAPOrder error: ', e.message)
                await sleep(TWAP_INTERVAL, sign)
            }
        }
    })
    return {
        _twap: twapState,
    }
}

// 创建现货市价单
export default async function createSpotMarketOrder(data, options = {}) {
    const { exchange, symbol, side, amount, unit, usePct, amountPct, withSLTP, slPrice, tpPrice, useTWAP, totalMinute, priceLimit } = data
    const market = getExchangeMonitor(exchange).markets.spot.find(mar => mar.symbol === symbol)
    if (!market) {
        throw new Error('错误: 交易对无效')
    }
    const basePrecision = getPrecisionLength(market.precision.amount)
    const quotePrecision = getPrecisionLength(market.precision.price)

    const params = {}
    if (usePct) {
        const cSymbol = checkSymbol(symbol)
        if (side === ORDER_SIDES.SELL) {
            const balance = getExchangeMonitor(exchange).balance.spot[cSymbol.base]?.free
            params.quantity = new Decimal(balance).mul(amountPct).div(100).toDecimalPlaces(basePrecision).toNumber()
        } else {
            const balance = getExchangeMonitor(exchange).balance.spot[cSymbol.quote]?.free
            if (!balance) {
                throw new Error('错误: 未检测到余额')
            }
            params.quoteOrderQty = new Decimal(balance).mul(amountPct).div(100).toDecimalPlaces(quotePrecision).toNumber()
        }
    } else if (unit === ORDER_AMOUNT_TYPES.QUOTE) {
        params.quoteOrderQty = new Decimal(amount).toDecimalPlaces(quotePrecision).toNumber()
    } else {
        params.quantity = new Decimal(amount).toDecimalPlaces(basePrecision).toNumber()
    }
    const lastPrice = (await getExchangeMonitor(exchange).awaitTickersUpdate([symbol]))[0]?.last
    
    const realMinBase = Math.max(
        market.limits.amount.min,
        new Decimal(market.limits.cost.min).div(lastPrice).toDecimalPlaces(basePrecision, Decimal.ROUND_UP).toNumber(),
    )
    const realMinQuote = Math.max(
        market.limits.cost.min,
        new Decimal(market.limits.amount.min).mul(lastPrice).toDecimalPlaces(quotePrecision, Decimal.ROUND_UP).toNumber(),
    )

    if (params.quantity ? params.quantity < realMinBase : params.quoteOrderQty < realMinQuote) {
        throw new Error('下单数量不满足最低成交量')
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
    if (useTWAP) {
        if (totalMinute < 1) {
            throw new Error('TWAP总时间不能少于1分钟')
        }
        if (withSLTP) {
            // 现货带止损的twap只有买入订单, 卖出订单没有止盈止损选项
            if (side === ORDER_SIDES.BUY) {
                if (sltpParams.tpPrice && priceLimit && sltpParams.tpPrice < priceLimit) {
                    throw new Error('TWAP限价不能大于止盈价格')
                }
            }
        }
        return createTWAPOrder({ exchange, symbol, side, params, withSLTP, sltpParams, totalMinute, priceLimit, market })
    }
    
    logger.info(`创建现货市价单 ${exchange} ${symbol} ${side} ${params.quantity || params.quoteOrderQty}(${params.quantity ? market.base : market.quote})`)
    // logger.createMarketOrder({ exchange, symbol, side, amount: params.quantity || params.quoteOrderQty, unitName: params.quantity ? market.base : market.quote })
    const result = await getExchangeMonitor(exchange).exchange.createOrderWs(symbol, ORDER_TYPES.MARKET, side, undefined, undefined, params)
    logger.info(`市价单成交 ${side} 成交价格:${result.averagePrice} 成交额:${result.cost}(${market.quote}) 成交量:${result.filled}(${market.base})`)
    // logger.markOrderSucc({ exchange, symbol, side, result, market })

    if (withSLTP) {
        sltpParams.amount = result.filled
        sltpParams.unit = ORDER_AMOUNT_TYPES.BASE
        const sltpOrder = orderWatcher.creatOrder(sltpParams)
        if (!options.skipSLTPOrderSave) {
            result._sltp = await sltpOrder
        }
    }
    return result
}