import { isNumber } from 'lodash-es'

import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import orderWatcher from '../monitor/orderMonitor'
import { orderModel } from '../database/db'
import service from '../service'
import { ORDER_SIDES, ORDER_AMOUNT_TYPES, ORDER_STATES } from '../../../share/const.js'
import { checkSymbol } from '../../../share/utils.js'

export default async function checkSpotSLTPOrder(order, ticker) {
    const { _id, symbol, amount, unit, triggerPrice, exchange, withSLTP, slPrice, tpPrice } = order
    try {
        if (orderWatcher.isOrderDealing(_id)) {
            return
        }
        const lastPrice = ticker.last
        if (!lastPrice) {
            throw new Error('错误：无法获取tick：' + symbol)
        }
        console.log('check order', triggerPrice, lastPrice)
        const cSymbol = checkSymbol(symbol)
        const balance = getExchangeMonitor(exchange).balance.spot[cSymbol[unit]]
        // console.log(getExchangeMonitor(exchange).balance.spot[currency])
        if (lastPrice <= triggerPrice || global.__Force?.v()) {
            console.log(`触发条件委托订单, 交易所:${exchange} 交易对:${symbol} 触发价格:${triggerPrice} 最新价格:${lastPrice} 买入数量:${amount}${cSymbol[unit]}`)
            orderWatcher.markOrderDealing(_id)
            let realAmount = amount
            //判断余额
            if (isNumber(balance?.free)) {
                if (!balance.free) {
                    console.log('委托订单余额为0，已自动取消')
                    await orderWatcher.closeOrder(_id)
                    // orderWatcher.unmarkOrderDealing(_id)
                    return
                }
                if (balance.free < amount) {
                    realAmount = balance.free
                    console.log(`委托订单余额不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 买入数量:${realAmount}${cSymbol[unit]}`)
                }
            } else {
                // throw new Error('止损订单检测错误：无法获取余额');
                console.log('无法获取余额数据，尝试直接下单')
            }
            const result = await service.createSpotMarketOrder({
                exchange,
                symbol,
                amount: realAmount,
                unit,
                side: ORDER_SIDES.BUY,
                withSLTP,
                slPrice,
                tpPrice,
            })
            console.log(`条件委托订单结算成功, 交易所:${exchange} 交易对:${symbol} 成交价格:${result.price} 买入数量:${result.filled}${cSymbol.base}`)
            await orderWatcher.resolveOrder(_id)
            // console.log('order delete success', dOR)
            // orderWatcher.unmarkOrderDealing(_id);

        }
    } catch (e) {
        console.log('条件委托出错, id:' + _id, e)
        // await orderModel.findByIdAndDelete(_id);
        orderWatcher.unmarkOrderDealing(_id)
        // throw e;
    }
}