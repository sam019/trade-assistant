import Decimal from 'decimal.js'
import { POSITION_SIDES, ORDER_SIDES, ORDER_AMOUNT_TYPES } from '../../../share/const.js'
import { checkSymbol, isDev, sleep } from '../../../share/utils.js'
import service from '../service/index.js'
import orderWatcher from '../monitor/orderMonitor.js'
import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import logger from '../logger.js'

function getRealAmount({ position, amount, unit, exchange, symbol, cSymbol }) {
    let realAmount = amount, realUnit = unit
    //判断仓位
    if (unit === ORDER_AMOUNT_TYPES.CONTRACT) {
        // 按张下单
        if (position.contracts < amount) {
            realAmount = position.contracts
            console.log(`止盈止损订单数量不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}张`)
        }
    } else if (unit === ORDER_AMOUNT_TYPES.BASE) {
        if (cSymbol.isLinear) {
            // U本位按币下单
            if (new Decimal(amount).div(position.contractSize).toNumber() > position.contracts) {
                realAmount = position.contracts
                realUnit = ORDER_AMOUNT_TYPES.CONTRACT
                console.log(`止盈止损订单数量不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}张`)
            }
        } else {
            // 币本位按币下单
            if (new Decimal(amount).mul(position.markPrice).div(position.contractSize).toNumber() > position.contracts) {
                realAmount = position.contracts
                realUnit = ORDER_AMOUNT_TYPES.CONTRACT
                console.log(`止盈止损订单数量不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}张`)
            }
        }
    } else {
        if (cSymbol.isLinear) {
            // U本位按U下单
            if (new Decimal(amount).div(position.markPrice).div(position.contractSize).toNumber() > position.contracts) {
                realAmount = position.contracts
                realUnit = ORDER_AMOUNT_TYPES.CONTRACT
                console.log(`止盈止损订单数量不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}张`)
            }
        } else {
            // 币本位按U下单
            if (new Decimal(amount).div(position.contractSize).toNumber() > position.contracts) {
                realAmount = position.contracts
                realUnit = ORDER_AMOUNT_TYPES.CONTRACT
                console.log(`止盈止损订单数量不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}张`)
            }
        }
    }
    return { realAmount, realUnit }
}

export default async function checPerpSLTPOrder(order, position) {
    // console.log('checkLinearPerpOrder', order.symbol, order.slPrice, order.tpPrice)
    const { _id, symbol, amount, unit, slPrice, tpPrice, exchange } = order
    try {
        if (orderWatcher.isOrderDealing(_id)) {
            return
        }
        // console.log(position)
        // 严谨判断,既有可能没有改仓位,也可能因为网络延迟未获取仓位
        if (!position) {
            throw new Error('错误：无法获取symbol position：' + symbol)
        }
        const cSymbol = checkSymbol(symbol)
        const params = {
            exchange,
            symbol,
            reduceOnly: true,
            side: position.side === POSITION_SIDES.LONG ? ORDER_SIDES.SELL : ORDER_SIDES.BUY,
        }
        const isSlTriggered = position.side === POSITION_SIDES.LONG ? position.markPrice <= slPrice : position.markPrice >= slPrice
        const isTpTriggered = position.side === POSITION_SIDES.LONG ? position.markPrice >= tpPrice : position.markPrice <= tpPrice
        if (slPrice && isSlTriggered || global.__Force?.v()) {
            // 判断是否止损
            // console.log(`触发仓位止损, 交易所:${exchange} 交易对:${symbol} 触发价格:${slPrice} 标记价格:${position.markPrice} 卖出数量:${amount}`)
            orderWatcher.markOrderDealing(_id)

            const { realAmount, realUnit } = getRealAmount({ position, amount, unit, exchange, symbol, cSymbol })
            params.amount = realAmount
            params.unit = realUnit
            logger.sltp({ exchange, symbol, isSL: true, side: params.side, lastPrice: position.markPrice, triggerPrice: slPrice, amount: params.amount, unit: params.unit })
            let result
            if (cSymbol.isLinear) {
                result = await service.createLinearPerpMarketOrder(params)
            } else {
                result = await service.createInversePerpMarketOrder(params)
            }
            logger.sltpSucc({ exchange, symbol, isSL: true, side: params.side, cost: result.cost, price: result.price })
            // console.log(`仓位止损结算成功, 交易所:${exchange} 交易对:${symbol} 结算价格:${result.price} 卖出数量:${result.filled}张`)
            await orderWatcher.resolveOrder(_id)
            // console.log('order delete success', dOR)
            // orderWatcher.unmarkOrderDealing(_id);
        } else if (tpPrice && isTpTriggered) {
            // 判断是否止盈
            // console.log(`触发仓位止盈, 交易所:${exchange} 交易对:${symbol} 触发价格:${tpPrice} 标记价格:${position.markPrice} 卖出数量:${amount}`)
            orderWatcher.markOrderDealing(_id)

            const { realAmount, realUnit } = getRealAmount({ position, amount, unit, exchange, symbol, cSymbol })
            params.amount = realAmount
            params.unit = realUnit
            logger.sltp({ exchange, symbol, isSL: false, side: params.side, lastPrice: position.markPrice, triggerPrice: tpPrice, amount: params.amount, unit: params.unit })
            let result
            if (cSymbol.isLinear) {
                result = await service.createLinearPerpMarketOrder(params)
            } else {
                result = await service.createInversePerpMarketOrder(params)
            }
            logger.sltpSucc({ exchange, symbol, isSL: false, side: params.side, cost: result.cost, price: result.price })
            // console.log(`仓位止盈结算成功, 交易所:${exchange} 交易对:${symbol} 结算价格:${result.price} 卖出数量:${result.filled}张`)
            await getExchangeMonitor(exchange).awaitPositionsUpdate([symbol])
            await orderWatcher.resolveOrder(_id)
            // orderWatcher.unmarkOrderDealing(_id);
        }
    } catch (e) {
        if (isDev()) {
            throw e
        }
        logger.sltpErr({ exchange, symbol, e })
        await sleep(1000)
        // console.log('仓位止盈止损出错, id:' + _id, e)
        // await orderModel.findByIdAndDelete(_id);
        orderWatcher.unmarkOrderDealing(_id)
        
    }
}