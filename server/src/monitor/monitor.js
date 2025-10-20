

import { SUPPORTED_EXCHANGES } from '../config.js'
import { initExchangeMonitor, getExchangeMonitor } from './exchangeMonitor.js'
import orderWatcher from './orderMonitor'

import checkSpotOrder from '../checker/checkSpotOrder.js'
import checkPerpOrder from '../checker/checkPerpOrder.js'

class Monitor {
    /* 后台监控主函数 */
    async start() {
        // 初始化交易所监控
        await Promise.all(SUPPORTED_EXCHANGES.map(async (exch) => {
            const exchange = await initExchangeMonitor(exch)
            // exchange.onAccountUpdate(async (data) => {
            //     this.orderWatcher.ordersGroupByExchange[exch]
            // });
            return exchange
        }))

        // 保存 取消订阅函数
        let unsubs = []
        // 订阅订单更新时，以交易所为粒度，重新订阅相关交易对的行情更新和仓位更新
        orderWatcher.onOrdersUpdate(({ ordersGroupByExchange }) => {
            // console.log('orders update', orders);
            // 先取消之前的订阅
            unsubs.forEach(unsub => unsub && unsub())
            unsubs = []
            Object.entries(ordersGroupByExchange).forEach(([exchange, { spot, linear, inverse }]) => {
                // console.log('ordersGroupByExchange', exchange, spot, linear);
                // 检测现货仓位
                const unsubTicker = getExchangeMonitor(exchange).onTickersUpdate(spot.symbols, (tickers) => {
                    // console.log(orders)
                    spot.orders.forEach((order) => {
                        // console.log(order.symbol)
                        if (tickers[order.symbol]) {
                            checkSpotOrder(order, tickers[order.symbol])
                        }
                    })
                })
                unsubs.push(unsubTicker)
                // 检测合约仓位
                const unsubPosition = getExchangeMonitor(exchange).onPositionsUpdate((positions) => {
                    // console.log(positions);
                    [...linear.orders, ...inverse.orders].forEach((order) => {
                        // console.log(order.symbol, match)
                        const position = positions.find(pos => pos.symbol === order.symbol)
                        if (position) {
                            checkPerpOrder(order, position)
                        }
                    })
                    inverse.orders.forEach((order) => order)
                })
                unsubs.push(unsubPosition)
            })
        })
    }
}

export default new Monitor()
