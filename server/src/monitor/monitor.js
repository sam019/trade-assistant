

import { SUPPORTED_EXCHANGES } from '../config.js'
import { initExchangeMonitor, getExchangeMonitor } from './exchangeMonitor.js'
import orderWatcher from './orderMonitor'

import checkSpotSLTPOrder from '../checker/checkSpotSLTPOrder.js'
import checkPerpSLTPOrder from '../checker/checkPerpSLTPOrder.js'
import checkSpotCondOrder from '../checker/checkSpotCondOrder.js'
import checkPerpCondOrder from '../checker/checkPerpCondOrder.js'

import { ORDER_TYPES } from '../../../share/const.js'
import { checkSymbol } from '../../../share/utils.js'

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
            global.__Force?.c()
            // console.log('orders update', orders);
            // 先取消之前的订阅
            unsubs.forEach(unsub => unsub && unsub())
            unsubs = []
            Object.entries(ordersGroupByExchange).forEach(([exchange, { spot, linear, inverse }]) => {
                // console.log('ordersGroupByExchange', exchange, spot, linear);
                const tickOrders = [...spot.orders]
                const positionOrders = [];
                [...linear.orders, ...inverse.orders].forEach(order => {
                    if (order.type === ORDER_TYPES.CONDITION) {
                        tickOrders.push(order)
                    } else {
                        positionOrders.push(order)
                    }
                })
                // 检测现货止盈止损和条件委托 合约条件委托
                const unsubTicker = getExchangeMonitor(exchange).onTickersUpdate(tickOrders.map(t => t.symbol), (tickers) => {
                    // console.log(orders)
                    tickOrders.forEach((order) => {
                        // console.log(order.symbol)
                        const ticker = tickers[order.symbol]
                        if (ticker) {
                            const cSymbol = checkSymbol(order.symbol)
                            if (cSymbol.isSpot) {
                                if (order.type === ORDER_TYPES.CONDITION) {
                                    checkSpotCondOrder(order, ticker)
                                } else {
                                    checkSpotSLTPOrder(order, ticker)
                                }
                            } else {
                                if (order.type === ORDER_TYPES.CONDITION) {
                                    checkPerpCondOrder(order, ticker)
                                }
                            }
                        }
                    })
                })
                unsubs.push(unsubTicker)
                // 检测合约止盈止损
                const unsubPosition = getExchangeMonitor(exchange).onPositionsUpdate((positions) => {
                    // console.log(positions);
                    positionOrders.forEach((order) => {
                        // console.log(order.symbol, match)
                        const position = positions.find(pos => pos.symbol === order.symbol)
                        if (position) {
                            checkPerpSLTPOrder(order, position)
                        }
                    })
                })
                unsubs.push(unsubPosition)
            })
        })
    }
}

export default new Monitor()
