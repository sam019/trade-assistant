import { isNumber } from 'lodash-es'
import Decimal from 'decimal.js'

import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import orderWatcher from '../monitor/orderMonitor'
import { orderModel } from '../database/db'
import service from '../service'
import { ORDER_SIDES, ORDER_AMOUNT_TYPES, ORDER_STATES } from '../../../share/const.js'
import { checkSymbol, getPrecisionLength } from '../../../share/utils.js'

export default async function checkSpotOSLTPrder(order, ticker) {
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
        console.log('check order', order.slPrice, order.tpPrice, lastPrice)
        const cSymbol = checkSymbol(symbol)
        const currency = cSymbol[unit]
        let realAmount = amount
        let realUnit = unit
        const balance = getExchangeMonitor(exchange).balance.spot[currency]
        // const balance = unit === ORDER_AMOUNT_TYPES.BASE ? getExchangeMonitor(exchange).balance.spot[currency] : new Decimal(amount).div(lastPrice)
        console.log('balance', balance)
        //判断余额
        if (!balance) {
            // throw new Error('止损订单检测错误：无法获取余额');
            console.log('无法获取余额数据，尝试直接下单')
        } else if (!balance.free) {
            console.log('止盈止损订单余额为0，已自动取消')
            await orderWatcher.closeOrder(_id)
            // orderWatcher.unmarkOrderDealing(_id)
            return
        }
        if (unit === ORDER_AMOUNT_TYPES.BASE) {
            if (balance.free < amount) {
                realAmount = balance.free
                console.log(`止盈止损订单数量不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}${currency}`)
            }
        } else {
            if (new Decimal(amount).div(lastPrice).toNumber() > balance) {
                realAmount = balance.free
                realUnit = ORDER_AMOUNT_TYPES.BASE
                console.log(`止盈止损订单数量不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}${currency}`)
            }
        }
        if (slPrice && lastPrice <= slPrice || global.__Force?.v()) {
            // 判断是否止损
            console.log(`触发止损订单, 交易所:${exchange} 交易对:${symbol} 触发价格:${slPrice} 最新价格:${lastPrice} 卖出数量:${amount}${currency}`)
            orderWatcher.markOrderDealing(_id)
            
            const result = await service.createSpotMarketOrder({
                exchange,
                symbol,
                amount: realAmount,
                unit: realUnit,
                side: ORDER_SIDES.SELL,
            })
            console.log(`止损订单结算成功, 交易所:${exchange} 交易对:${symbol} 成交价格:${result.price} 卖出数量:${result.filled}${currency}`)
            await orderWatcher.resolveOrder(_id)
            // console.log('order delete success', dOR)
            // orderWatcher.unmarkOrderDealing(_id);

        } else if (tpPrice && lastPrice >= tpPrice) {
            // 判断是否止盈
            console.log(`触发止盈订单, 交易所:${exchange} 交易对:${symbol} 触发价格:${tpPrice} 最新价格:${lastPrice} 卖出数量:${amount}${currency}`)
            orderWatcher.markOrderDealing(_id)

            const result = await service.createSpotMarketOrder({
                exchange,
                symbol,
                amount: realAmount,
                unit: realUnit,
                side: ORDER_SIDES.SELL,
            })
            console.log(`止盈订单结算成功, 交易所:${exchange} 交易对:${symbol} 成交价格:${result.price} 卖出数量:${result.filled}${currency}`)
            await orderWatcher.resolveOrder(_id)
            // orderWatcher.unmarkOrderDealing(_id);
        }
    } catch (e) {
        // await orderModel.findByIdAndDelete(_id);
        orderWatcher.unmarkOrderDealing(_id)
        if (global.isDev) {
            throw e
        }
        console.log('止盈止损订单出错, id:' + _id, e)
        // throw e;
    }
}