import { POSITION_SIDES, ORDER_SIDES, ORDER_STATES } from '../../../share/const.js'
import { checkSymbol } from '../../../share/utils.js'
import service from '../service'
import orderWatcher from '../monitor/orderMonitor'
import { orderModel } from '../database/db.js'

export default async function checkPerpCondOrder(order, ticker) {
    // console.log('checkLinearPerpOrder', order.symbol, order.slPrice, order.tpPrice)
    const { _id, symbol, side, amount, unit, triggerPrice, exchange, withSLTP, slPrice, tpPrice } = order
    try {
        if (orderWatcher.isOrderDealing(_id)) {
            return
        }
        const lastPrice = ticker.last
        if (!lastPrice) {
            throw new Error('错误：无法获取tick：' + symbol)
        }
        const cSymbol = checkSymbol(symbol)
        const params = {
            exchange,
            symbol,
            amount,
            unit,
            side,
            withSLTP,
            slPrice,
            tpPrice,
        }
        console.log('global.__Force?.v()', global.__Force?.v())
        if ((side === ORDER_SIDES.BUY ? lastPrice < triggerPrice : lastPrice > triggerPrice) || global.__Force?.v()) {
            // 多单且价格小于触发价，空单且价格大于触发价，触发委托
            console.log(`触发条件委托, 交易所:${exchange} 交易对:${symbol} 触发价格:${triggerPrice} 最新价格:${lastPrice} 买入数量:${amount}${cSymbol[unit]}`)
            orderWatcher.markOrderDealing(_id)
            let result
            if (cSymbol.isLinear) {
                result = await service.createLinearPerpMarketOrder(params)
            } else {
                result = await service.createInversePerpMarketOrder(params)
            }
            
            console.log(`条件委托结算成功, 交易所:${exchange} 交易对:${symbol} 结算价格:${result.price} 买入数量:${result.amount}`)
            await orderWatcher.resolveOrder(_id)
            // console.log('order delete success', dOR)
            // orderWatcher.unmarkOrderDealing(_id);
        }
    } catch (e) {
        console.log('条件委托出错, id:' + _id, e)
        // await orderModel.findByIdAndDelete(_id);
        orderWatcher.unmarkOrderDealing(_id)
    }
}