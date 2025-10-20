import Decimal from 'decimal.js'

import { ORDER_TYPES, ORDER_SIDES, ORDER_AMOUNT_TYPES, POSITION_SIDES } from '../../../share/const.js'
import { getPrecisionLength } from '../../../share/utils.js'

import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import orderWatcher from '../monitor/orderMonitor.js'

export default async function createInversePerpMarketOrder(data) {
    const { exchange, symbol, side, amount, leverage, amountPct, usePct, unit, withSLTP, slPrice, tpPrice, reduceOnly = false, __force } = data
    const market = getExchangeMonitor(exchange).exchange.markets[symbol]
    const position = getExchangeMonitor(exchange).positions.find(pos => pos.symbol === symbol)
    // 如果当前有仓位并且仓位方向和下单放下相反，判断为减仓单
    const isReduce = !!position && ((side === ORDER_SIDES.BUY && position.side === POSITION_SIDES.SHORT) || (side === ORDER_SIDES.SELL && position.side === POSITION_SIDES.LONG))

    let { longLeverage: realLeverage } = Object.values(await getExchangeMonitor(exchange).fetchLeverages([symbol]))[0]
    if (leverage) {
        if (leverage !== realLeverage) {
            await getExchangeMonitor(exchange).exchange.setLeverage(leverage, symbol)
            realLeverage = leverage
        }
    }
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
        slPrice,
        tpPrice,
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
    const precisionLength = getPrecisionLength(market.precision.amount)
    const params = {}
    // console.log('unit', unit, amount, side)
    // 币本位合约一张代表张数*contractSize的USD，比如btcusd，一张代表100usd
    if (unit === ORDER_AMOUNT_TYPES.CONTRACT) {
        // 按张下单，目前只有止盈止损单会触发
        params.quantity = new Decimal(amount).toDecimalPlaces(precisionLength).toNumber()
    } else if (isReduce) {
        if (usePct) {
            // 百分比减仓
            params.quantity = new Decimal(position.contracts).mul(amountPct).div(100).toDecimalPlaces(precisionLength).toNumber()
            // console.log('params.quantity', params.quantity)
        } else if (unit === ORDER_AMOUNT_TYPES.BASE) {
            // 币本位绝对值减仓
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount)
            const quantity = new Decimal(amount).mul(last).div(qtoAmountStep).floor().mul(qtoAmountStep).div(market.contractSize).toDecimalPlaces(precisionLength).toNumber()
            params.quantity = quantity
        } else {
            // U本位绝对值减仓
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount)
            const quantity = new Decimal(amount).div(qtoAmountStep).floor().mul(qtoAmountStep).div(market.contractSize).toDecimalPlaces(precisionLength).toNumber()
            params.quantity = quantity
        }
    } else {
        // 建仓
        if (unit === ORDER_AMOUNT_TYPES.QUOTE) {
            // U本位绝对值建仓
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount)
            const quantity = new Decimal(amount).div(qtoAmountStep).floor().mul(qtoAmountStep).mul(realLeverage).div(market.contractSize).toDecimalPlaces(precisionLength).toNumber()
            params.quantity = quantity
        } else {
            // 可开仓位按quote计价的数量的最小粒度
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount)
            // console.log('qtoAmountStep', market.contractSize, market.precision.amount, last, qtoAmountStep.toNumber())
            let maxStepAmount // 最小粒度的最大数量
            if (usePct) {
                // 百分比建仓
                const balance = getExchangeMonitor(exchange).balance[market.subType][market.base].free || 0
                // console.log('maxStepAmount', getExchangeMonitor(exchange).balance, balance, amountPct, qtoAmountStep.toNumber())
                maxStepAmount = new Decimal(balance).mul(amountPct).div(100).mul(last).div(qtoAmountStep).floor()
            } else {
                // 币本位绝对值建仓
                // console.log(new Decimal(amount).div(qtoAmountStep).toNumber())
                maxStepAmount = new Decimal(amount).mul(last).div(qtoAmountStep).floor()
            }
            console.log('quantity', maxStepAmount.toNumber(), qtoAmountStep.toNumber(), market.contractSize, last)
            // 逻辑正确，quantity参数是计算杠杆后的开仓数量，所以要把要开的保证金乘以杠杆
            const quantity = maxStepAmount.mul(qtoAmountStep).div(market.contractSize).mul(realLeverage).toDecimalPlaces(precisionLength).toNumber()
            // console.log('quantity', quantity)
            params.quantity = quantity
        }
    }
    // console.log('createLinearPerpMarketOrder quantity', params.quantity, precisionLength); 

    console.log('创建市价单', exchange, symbol, params.quantity, realLeverage)
    const result = await getExchangeMonitor(exchange).exchange.createOrderWs(symbol, ORDER_TYPES.MARKET, side, undefined, undefined, params)
    console.log('下单成功', result.amount, result.cost, result.leverage)
    if (withSLTP) {
        sltpParams.amount = result.amount
        sltpParams.unit = ORDER_AMOUNT_TYPES.CONTRACT
        await orderWatcher.creatOrder(sltpParams)
    }
    return result
}