import Decimal from 'decimal.js'
import { ORDER_SIDES, ORDER_AMOUNT_TYPES } from '../../../share/const.js'
import { checkSymbol, isDev, sleep } from '../../../share/utils.js'
import service from '../service/index.js'
import orderWatcher from '../monitor/orderMonitor.js'
import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import logger from '../logger.js'

function getRealAmount({ balance, lastPrice, _id, amount, unit, exchange, symbol, cSymbol }) {
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
        if (cSymbol.isLinear) {
            if (amount > balance.free) {
                realAmount = balance.free
                console.log(`委托订单余额不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 买入数量:${realAmount}${cSymbol.QUOTE}`)
            }
        } else {
            if (new Decimal(amount).div(lastPrice).toNumber() > balance.free) {
                realAmount = balance.free
                realUnit = ORDER_AMOUNT_TYPES.BASE
                console.log(`委托订单余额不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 买入数量:${realAmount}${cSymbol.BASE}`)
            }
        }
    } else {
        if (cSymbol.isLinear) {
            if (new Decimal(amount).mul(lastPrice).toNumber() > balance.free) {
                realAmount = balance.free
                realUnit = ORDER_AMOUNT_TYPES.QUOTE
                console.log(`止盈止损订单数量不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}${cSymbol.QUOTE}`)
            }
        } else {
            if (amount > balance.free) {
                realAmount = balance.free
                console.log(`委托订单余额不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 买入数量:${realAmount}${cSymbol.BASE}`)
            }
        }
    }
    return { realAmount, realUnit }
}

export default async function checkPerpCondOrder(order, ticker) {
    // console.log('checkLinearPerpOrder', order.symbol, order.slPrice, order.tpPrice)
    const { _id, symbol, side, amount, unit, triggerPrice, exchange, withSLTP, slPrice, tpPrice, leverage } = order
    try {
        // throw new Error('test')
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
            side,
            withSLTP,
            slPrice,
            tpPrice,
            leverage,
        }
        const balance = cSymbol.isLinear
            ? getExchangeMonitor(exchange).balance.linear[cSymbol.quote]
            : getExchangeMonitor(exchange).balance.inverse[cSymbol.base]
        // console.log('global.__Force?.v()', global.__Force?.v())
        if ((side === ORDER_SIDES.BUY ? lastPrice < triggerPrice : lastPrice > triggerPrice) || global.__Force?.v()) {
            // 多单且价格小于触发价，空单且价格大于触发价，触发委托
            // console.log(`触发条件委托, 交易所:${exchange} 交易对:${symbol} 触发价格:${triggerPrice} 最新价格:${lastPrice} 买入数量:${amount}${cSymbol[unit]}`)
            orderWatcher.markOrderDealing(_id)

            const { realAmount, realUnit } = getRealAmount({ balance, _id, lastPrice, amount, unit, exchange, symbol, cSymbol })
            params.amount = realAmount
            params.unit = realUnit
            const options = { skipSLTPOrderSave: true }
            logger.cond({ exchange, symbol, side: params.side, lastPrice, triggerPrice, amount : params.amount, unit: params.unit })
            let result
            if (cSymbol.isLinear) {
                result = await service.createLinearPerpMarketOrder(params, options)
            } else {
                result = await service.createInversePerpMarketOrder(params, options)
            }
            logger.condSucc({ exchange, symbol, side: params.side, cost: result.cost, price: result.price, unit: ORDER_AMOUNT_TYPES.CONTRACT })
            // console.log(`条件委托结算成功, 交易所:${exchange} 交易对:${symbol} 结算价格:${result.price} 买入数量:${result.filled}`)
            await getExchangeMonitor(exchange).awaitPositionsUpdate([symbol])
            await orderWatcher.resolveOrder(_id)
            // console.log('order delete success', dOR)
            // orderWatcher.unmarkOrderDealing(_id);
        }
    } catch (e) {
        // console.log('条件委托出错, id:' + _id, e)
        logger.condErr({ exchange, symbol, e })
        if (isDev()) {
            throw e
        }
        await sleep(5000)
        // await orderModel.findByIdAndDelete(_id);
        orderWatcher.unmarkOrderDealing(_id)
        
    }
}