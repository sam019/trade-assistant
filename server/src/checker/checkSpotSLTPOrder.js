import Decimal from 'decimal.js'

import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import orderWatcher from '../monitor/orderMonitor.js'
// import { orderModel } from '../database/db.js'
import service from '../service/index.js'
import { ORDER_SIDES, ORDER_AMOUNT_TYPES, ORDER_STATES } from '../../../share/const.js'
import { checkSymbol, isDev, sleep } from '../../../share/utils.js'
import logger from '../logger.js'

function getRealAmount({ balance, lastPrice, amount, unit, _id, exchange, symbol, cSymbol }) {
    let realAmount = amount, realUnit = unit
    //判断余额
    if (!balance) {
        // throw new Error('止损订单检测错误：无法获取余额');
        console.log('无法获取余额数据，尝试直接下单')
    } else if (!balance.free) {
        console.log('止盈止损订单余额为0，已自动取消')
        orderWatcher.closeOrder(_id)
        // orderWatcher.unmarkOrderDealing(_id)
        return
    } else if (unit === ORDER_AMOUNT_TYPES.BASE) {
        if (amount > balance.free) {
            realAmount = balance.free
            console.log(`止盈止损订单数量不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}${cSymbol[realUnit]}`)
        }
    } else {
        if (new Decimal(amount).div(lastPrice).toNumber() > balance.free) {
            realAmount = balance.free
            realUnit = ORDER_AMOUNT_TYPES.BASE
            console.log(`止盈止损订单数量不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}${cSymbol[realUnit]}`)
        }
    }
    return { realAmount, realUnit }
}

export default async function checkSpotSLTPrder(order, ticker) {
    const { _id, symbol, amount, unit, slPrice, tpPrice, exchange } = order
    try {
        // if (status === 'closed') return;
        if (orderWatcher.isOrderDealing(_id)) {
            return
        }
        const lastPrice = ticker.last
        if (!lastPrice) {
            throw new Error('错误：无法获取tick：' + symbol)
        }
        // console.log('check order', order.slPrice, order.tpPrice, lastPrice)
        const cSymbol = checkSymbol(symbol)
        const balance = getExchangeMonitor(exchange).balance.spot[cSymbol.base]
        // const balance = unit === ORDER_AMOUNT_TYPES.BASE ? getExchangeMonitor(exchange).balance.spot[cSymbol[unit]] : new Decimal(amount).div(lastPrice)
        // console.log('balance', balance)
        if (slPrice && lastPrice <= slPrice || global.__Force?.v()) {
            // 判断是否止损
            orderWatcher.markOrderDealing(_id)
            // console.log(`触发止损订单, 交易所:${exchange} 交易对:${symbol} 触发价格:${slPrice} 最新价格:${lastPrice} 卖出数量:${amount}${cSymbol[unit]}`)
            const { realAmount, realUnit } = getRealAmount({ balance, lastPrice, amount, unit, _id, exchange, symbol, cSymbol })
            const params = {
                exchange,
                symbol,
                amount: realAmount,
                unit: realUnit,
                side: ORDER_SIDES.SELL,
            }
            logger.sltp({ exchange, symbol, isSL: true, side: params.side, lastPrice, triggerPrice: slPrice, amount: params.amount, unit: params.unit })
            const result = await service.createSpotMarketOrder(params)
            // console.log(`止损订单结算成功, 交易所:${exchange} 交易对:${symbol} 成交价格:${result.price} 卖出数量:${result.filled}${cSymbol.base}`)
            logger.sltpSucc({ exchange, symbol, isSL: true, side:params.side, cost: result.cost, price: result.price })
            await orderWatcher.resolveOrder(_id)
            // orderWatcher.unmarkOrderDealing(_id);
        } else if (tpPrice && lastPrice >= tpPrice) {
            // 判断是否止盈
            orderWatcher.markOrderDealing(_id)
            const { realAmount, realUnit } = getRealAmount({ balance, lastPrice, amount, unit, _id, exchange, symbol, cSymbol })
            const params = {
                exchange,
                symbol,
                amount: realAmount,
                unit: realUnit,
                side: ORDER_SIDES.SELL,
            }
            logger.sltp({ exchange, symbol, isSL: false, side: params.side, lastPrice, triggerPrice: tpPrice, amount: params.amount, unit: params.unit })
            const result = await service.createSpotMarketOrder(params)
            logger.sltpSucc({ exchange, symbol, isSL: false, side: params.side, cost: result.cost, price: result.price })
            await orderWatcher.resolveOrder(_id)
            // orderWatcher.unmarkOrderDealing(_id);
        }
    } catch (e) {
        logger.sltpErr({ exchange, symbol, e })
        if (isDev()) {
            throw e
        }
        await sleep(1000)
        // await orderModel.findByIdAndDelete(_id);
        orderWatcher.unmarkOrderDealing(_id)
        
        // console.log('止盈止损订单出错, id:' + _id, e)
        // throw e;
    }
}