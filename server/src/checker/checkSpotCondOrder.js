import Decimal from 'decimal.js'

import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import orderWatcher from '../monitor/orderMonitor.js'
// import { orderModel } from '../database/db.js'
import service from '../service/index.js'
import { ORDER_SIDES, ORDER_AMOUNT_TYPES, ORDER_STATES } from 'share/const.js'
import { checkSymbol, isDev, sleep } from 'share/utils.js'
import logger from '../logger.js'

function getRealAmount({ balance, _id, unit, lastPrice, amount, exchange, symbol, cSymbol }) {
    let realAmount = amount, realUnit = unit
    //判断余额
    if (!balance) {
        console.log('无法获取余额数据，尝试直接下单')
    } else if (!balance.free) {
        console.log('委托订单余额为0，已自动取消')
        orderWatcher.closeOrder(_id)
        // orderWatcher.unmarkOrderDealing(_id)
        return
    } else if (unit === ORDER_AMOUNT_TYPES.QUOTE) {
        if (amount > balance.free) {
            realAmount = balance.free
            console.log(`委托订单余额不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 买入数量:${realAmount}${cSymbol[realUnit]}`)
        }
    } else {
        if (new Decimal(amount).div(lastPrice).toNumber() > balance.free) {
            realAmount = balance.free
            realUnit = ORDER_AMOUNT_TYPES.QUOTE
            console.log(`止盈止损订单数量不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}${cSymbol[realUnit]}`)
        }
    }
    return { realAmount, realUnit }
}

export default async function checkSpotSLTPOrder(order, ticker) {
    const { _id, symbol, amount, unit, triggerPrice, exchange, withSLTP, slPrice, tpPrice, useTWAP, totalMinute, priceLimit  } = order
    try {
        if (orderWatcher.isOrderDealing(_id)) {
            return
        }
        const lastPrice = ticker.last
        if (!lastPrice) {
            throw new Error('错误：无法获取tick：' + symbol)
        }
        // console.log('check order', triggerPrice, lastPrice)
        const cSymbol = checkSymbol(symbol)
        const balance = getExchangeMonitor(exchange).balance.spot[cSymbol.quote]
        // console.log(getExchangeMonitor(exchange).balance.spot[currency])
        if (lastPrice <= triggerPrice || global.__Force?.v()) {
            orderWatcher.markOrderDealing(_id)

            const { realAmount, realUnit } = getRealAmount({ balance, lastPrice, amount, unit, _id, exchange, symbol, cSymbol })
            const params = {
                exchange,
                symbol,
                amount: realAmount,
                unit: realUnit,
                side: ORDER_SIDES.BUY,
                withSLTP,
                slPrice,
                tpPrice,
                useTWAP,
                totalMinute,
                priceLimit,
            }

            const options = { skipSLTPOrderSave: true }

            logger.cond({ exchange, symbol, side: params.side, lastPrice, triggerPrice, amount: params.amount, unit: params.unit })
            // console.log(`触发条件委托订单, 交易所:${exchange} 交易对:${symbol} 触发价格:${triggerPrice} 最新价格:${lastPrice} 买入数量:${amount}${cSymbol[unit]}`)
            const result = await service.createSpotMarketOrder(params, options)

            if (!useTWAP) {
                logger.condSucc({ exchange, symbol, side: params.side, cost: result.cost, price: result.price, unit: cSymbol.base })
            }
            // console.log(`条件委托订单结算成功, 交易所:${exchange} 交易对:${symbol} 成交价格:${result.price} 买入数量:${result.filled}${cSymbol.base}`)
            await orderWatcher.resolveOrder(_id)
            // orderWatcher.unmarkOrderDealing(_id);
        }
    } catch (e) {
        // if (isDev()) {
        //     throw e
        // }
        logger.condErr({ exchange, symbol, e })
        await sleep(1000)
        // await orderModel.findByIdAndDelete(_id);
        orderWatcher.unmarkOrderDealing(_id)
        
    }
}