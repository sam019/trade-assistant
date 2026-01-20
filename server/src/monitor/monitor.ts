import { SUPPORTED_EXCHANGES } from '../config.js'
import { initExchangeMonitor, getExchangeMonitor } from './exchangeMonitor.js'
import orderMonitor from './orderMonitor.js'

import checkSpotSLTPOrder from '../checker/checkSpotSLTPOrder.js'
import checkPerpSLTPOrder from '../checker/checkPerpSLTPOrder.js'
import checkSpotCondOrder from '../checker/checkSpotCondOrder.js'
import checkPerpCondOrder from '../checker/checkPerpCondOrder.js'

import { ORDER_TYPES, type Exchange } from 'share/const.js'
import { checkSymbol } from 'share/utils.js'
import logger from '../logger.js'
import type { Order, Ticker } from '../types/index.js'
import type ccxt from 'ccxt'

class Monitor {
    /* 后台监控主函数 */
    async start(): Promise<void> {
        // 初始化委托单监控watchTickers
        await orderMonitor.init()
        // 初始化交易所监控
        await Promise.all(SUPPORTED_EXCHANGES.map(async (exch: Exchange) => {
            const exchange = await initExchangeMonitor(exch)
            return exchange
        }))

        // 保存 取消订阅函数
        let unsubs: (() => void)[] = []
        // 订阅订单更新时，以交易所为粒度，重新订阅相关交易对的行情更新和仓位更新
        orderMonitor.onOrdersUpdate(({ ordersGroupByExchange }) => {
            global.__Force?.c()
            // 先取消之前的订阅
            unsubs.forEach(unsub => unsub && unsub())
            unsubs = []

            SUPPORTED_EXCHANGES.forEach((exchange: Exchange) => {
                const exchangeMonitor = getExchangeMonitor(exchange)
                if (!exchangeMonitor) {
                    return
                }

                const { spot, linear, inverse } = ordersGroupByExchange[exchange] || {
                    spot: { symbols: new Set<string>(), orders: [] },
                    linear: { symbols: new Set<string>(), orders: [] },
                    inverse: { symbols: new Set<string>(), orders: [] },
                }

                const tickOrders: Order[] = [...(spot?.orders || [])]
                const positionOrders: Order[] = []

                const perpOrders = [...(linear?.orders || []), ...(inverse?.orders || [])]
                perpOrders.forEach((order: Order) => {
                    if (order.type === ORDER_TYPES.CONDITION) {
                        tickOrders.push(order)
                    } else {
                        positionOrders.push(order)
                    }
                })

                // 检测现货止盈止损和条件委托 合约条件委托
                const unsubTicker = exchangeMonitor.onTickersUpdate(
                    tickOrders.map(t => t.symbol),
                    (tickers: Record<string, Ticker>) => {
                        logger.ticker({ exchange })
                        tickOrders.forEach((order: Order) => {
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
                    }
                )
                unsubs.push(unsubTicker)

                // 检测合约止盈止损
                const unsubPosition = exchangeMonitor.onPositionsUpdate((positions: ccxt.Position[]) => {
                    logger.position({ exchange })
                    positionOrders.forEach((order: Order) => {
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

const monitor = new Monitor()

export default monitor

