import Const from '../../../const/const.js'
import { createLinearPerpMarketOrder, createInversePerpMarketOrder } from '../api/order.js';
import orderWatcher from '../monitor/orderMonitor';
import { orderModel } from '../database/db.js';

const { POSITION_SIDES, ORDER_SIDES, ORDER_STATES } = Const;

export default async function checPerpOrder(order, position) {
    // console.log('checkLinearPerpOrder', order.symbol, order.slPrice, order.tpPrice)
    const { _id, symbol, amount, unit, slPrice, tpPrice, exchange } = order;
    try {
        if (orderWatcher.isOrderDealing(_id)) {
            return;
        }
        // const position = positions.find(pos => pos.symbol === symbol);
        // console.log(position)
        // 严谨判断,既有可能没有改仓位,也可能因为网络延迟未获取仓位
        if (!position) {
            throw new Error('错误：无法获取symbol position：' + symbol)
        }
        const match = symbol.match(/(\w+)\/(\w+):?(\w+)?/);
        const params = {
            exchange,
            symbol,
            amount,
            unit,
            reduceOnly: true,
            side: position.side === POSITION_SIDES.LONG ? ORDER_SIDES.SELL : ORDER_SIDES.BUY,
        };
        const isSlTriggered = position.side === POSITION_SIDES.LONG ? position.markPrice <= slPrice : position.markPrice >= slPrice;
        const isTpTriggered = position.side === POSITION_SIDES.LONG ? position.markPrice >= tpPrice : position.markPrice <= tpPrice;
        if (slPrice && isSlTriggered) {
            // 判断是否止损
            console.log(`触发仓位止损, 交易所:${exchange} 交易对:${symbol} 触发价格:${slPrice} 标记价格:${position.markPrice} 卖出数量:${amount}`);
            orderWatcher.markOrderDealing(_id);
            let result;
            if (match[3] === match[2]) {
                result = await createLinearPerpMarketOrder(params);
            } else {
                result = await createInversePerpMarketOrder(params);
            }
            
            console.log(`仓位止损结算成功, 交易所:${exchange} 交易对:${symbol} 结算价格:${result.price} 卖出数量:${result.amount}`);
            await orderWatcher.resolveOrder(_id);
            // console.log('order delete success', dOR)
            // orderWatcher.unmarkOrderDealing(_id);
        } else if (tpPrice && isTpTriggered) {
            // 判断是否止盈
            console.log(`触发仓位止盈, 交易所:${exchange} 交易对:${symbol} 触发价格:${tpPrice} 标记价格:${position.markPrice} 卖出数量:${amount}`);
            orderWatcher.markOrderDealing(_id);
            let result;
            if (match[3] === match[2]) {
                result = await createLinearPerpMarketOrder(params);
            } else {
                result = await createInversePerpMarketOrder(params);
            }
            console.log(`仓位止盈结算成功, 交易所:${exchange} 交易对:${symbol} 结算价格:${result.price} 卖出数量:${result.amount}`);
            await orderWatcher.resolveOrder(_id);
            // orderWatcher.unmarkOrderDealing(_id);
        }
    } catch (e) {
        console.log('仓位止盈止损出错, id:' + _id, e);
        // await orderModel.findByIdAndDelete(_id);
        orderWatcher.unmarkOrderDealing(_id);
    }
}