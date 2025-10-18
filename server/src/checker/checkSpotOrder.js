import { isNumber } from 'lodash-es';

import { getExchangeMonitor } from '../monitor/exchangeMonitor.js';
import orderWatcher from '../monitor/orderMonitor';
import { orderModel } from '../database/db';
import { createSpotMarketOrder } from '../api/order.js';
import Const from '../../../const/const.js';

const { ORDER_SIDES, ORDER_AMOUNT_TYPES, ORDER_STATES } = Const;

export default async function checkSpotOrder(order, ticker) {
    const { _id, symbol, amount, unit, slPrice, tpPrice, exchange } = order;
    try {
        // if (status === 'closed') return;
        if (orderWatcher.isOrderDealing(_id)) {
            return;
        }
        const lastPrice = ticker.last;
        if (!lastPrice) {
            throw new Error('错误：无法获取tick：' + symbol)
        }
        console.log('check order', order.slPrice, order.tpPrice, lastPrice)
        const currency = symbol.match(/(\w+)\/(\w+)/)[unit === ORDER_AMOUNT_TYPES.BASE ? 1 : 2];
        const balance = getExchangeMonitor(exchange).balance.spot[currency];
        // console.log(getExchangeMonitor(exchange).balance.spot[currency])
        if (slPrice && lastPrice <= slPrice) {
            // 判断是否止损
            console.log(`触发止损订单, 交易所:${exchange} 交易对:${symbol} 触发价格:${slPrice} 最新价格:${lastPrice} 卖出数量:${amount}${currency}`);
            orderWatcher.markOrderDealing(_id);
            let realAmount = amount;
            //判断余额
            if (isNumber(balance?.free)) {
                if (!balance.free) {
                    console.log('止损订单余额为0，已自动取消');
                    await orderWatcher.closeOrder(_id);
                    // orderWatcher.unmarkOrderDealing(_id)
                    return;
                }
                if (balance.free < amount) {
                    realAmount = balance.free
                    console.log(`止损订单数量不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}${currency}`)
                }
            } else {
                // throw new Error('止损订单检测错误：无法获取余额');
                console.log('无法获取余额数据，尝试直接下单')
            }
            const result = await createSpotMarketOrder({
                exchange,
                symbol,
                amount: realAmount,
                unit,
                side: ORDER_SIDES.SELL,
            });
            console.log(`止损订单结算成功, 交易所:${exchange} 交易对:${symbol} 成交价格:${result.price} 卖出数量:${result.filled}${currency}`);
            await orderWatcher.resolveOrder(_id)
            // console.log('order delete success', dOR)
            // orderWatcher.unmarkOrderDealing(_id);

        } else if (tpPrice && lastPrice >= tpPrice) {
            // 判断是否止盈
            console.log(`触发止盈订单, 交易所:${exchange} 交易对:${symbol} 触发价格:${tpPrice} 最新价格:${lastPrice} 卖出数量:${amount}${currency}`);
            orderWatcher.markOrderDealing(_id);

            let realAmount = amount;
            if (isNumber(balance?.free)) {
                if (!balance.free) {
                    console.log('止盈订单余额为0，已自动取消');
                    await orderWatcher.closeOrder(_id);
                    // orderWatcher.unmarkOrderDealing(_id);
                    return;
                }
                if (balance.free < amount) {
                    realAmount = balance.free
                    console.log(`止盈订单数量不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}`)
                }
            } else {
                // throw new Error('止盈订单检测错误：无法获取余额');
                console.log('无法获取余额数据，尝试直接下单')
            }
            const result = await createSpotMarketOrder({
                exchange,
                symbol,
                amount: realAmount,
                unit: ORDER_AMOUNT_TYPES.BASE,
                side: ORDER_SIDES.SELL,
            });
            console.log(`止盈订单结算成功, 交易所:${exchange} 交易对:${symbol} 成交价格:${result.price} 卖出数量:${result.filled}${currency}`);
            await orderWatcher.resolveOrder(_id)
            // orderWatcher.unmarkOrderDealing(_id);
        }
    } catch (e) {
        console.log('止盈止损订单出错, id:' + _id, e);
        // await orderModel.findByIdAndDelete(_id);
        orderWatcher.unmarkOrderDealing(_id)
        // throw e;
    }
}