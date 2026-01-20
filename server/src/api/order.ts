import { Hono } from 'hono'
import { ORDER_TYPES } from 'share/const.js'
import { checkSymbol } from 'share/utils.js'

import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import orderWatcher from '../monitor/orderMonitor.js'
import { orderModel } from "../database/db.js"
import service from '../service/index.js'
import type { CreateOrderParams } from '../types/index.js'

const app = new Hono()

app.post('/create', async function(c) {
    const body = await c.req.json() as CreateOrderParams & { __direct?: boolean; __params?: any }
    const { exchange, symbol, side, type, __direct, __params } = body
    if (!exchange || !symbol || !side || !type) {
        throw new Error('参数错误')
    }
    if (__direct) {
        const exchangeMonitor = getExchangeMonitor(exchange)
        if (!exchangeMonitor) {
            throw new Error(`Exchange ${exchange} not found`)
        }
        const result = await (exchangeMonitor.exchange as any).createOrderWs(symbol, type, side, undefined, undefined, __params)
        return c.json(result)
    }

    const cSymbol = checkSymbol(symbol)

    if (cSymbol.isSpot) {
        if (type === ORDER_TYPES.MARKET) {
            const result = await service.createSpotMarketOrder(body)
            return c.json(result)
        }
        if (type === ORDER_TYPES.SLTP) {
            const result = await service.createSpotSLTPOrder(body)
            return c.json(result)
        }
        if (type === ORDER_TYPES.CONDITION) {
            const result = await service.createSpotConditionOrder(body)
            return c.json(result)
        }
    }
    if (cSymbol.isLinear) {
        if (type === ORDER_TYPES.MARKET) {
            const result = await service.createLinearPerpMarketOrder(body)
            return c.json(result)
        }
        if (type === ORDER_TYPES.SLTP) {
            const result = await service.createPerpSLTPOrder(body)
            return c.json(result)
        }
        if (type === ORDER_TYPES.CONDITION) {
            const result = await service.createPerpConditionOrder(body)
            return c.json(result)
        }
    }
    if (cSymbol.isInverse) {
        if (type === ORDER_TYPES.MARKET) {
            const result = await service.createInversePerpMarketOrder(body)
            return c.json(result)
        }
        if (type === ORDER_TYPES.SLTP) {
            const result = await service.createPerpSLTPOrder(body)
            return c.json(result)
        }
        if (type === ORDER_TYPES.CONDITION) {
            const result = await service.createPerpConditionOrder(body)
            return c.json(result)
        }
    }
})

app.post('/delete', async function deleteOrder(c) {
    const body = await c.req.json() as { _id: string; _refresh?: boolean }
    const { _id, _refresh } = body
    await orderModel.findByIdAndDelete(_id)
    let result: any = null
    if (_refresh) {
        result = await orderModel.find()
    }
    return c.json(result)
})

app.post('/list', async function listOrder(c) {
    const result = await orderWatcher.findOpeningOrders()
    return c.json(result)
})

app.post('/twap/close', async function closeTWAP(c) {
    const body = await c.req.json() as { exchange: string; symbol: string }
    const { exchange, symbol } = body
    const exchangeMonitor = getExchangeMonitor(exchange)
    if (!exchangeMonitor) {
        throw new Error(`Exchange ${exchange} not found`)
    }
    exchangeMonitor.closeTWAPOrder(symbol)
    return c.text('ok')
})

app.post('/twap/toggle', async function toggleTWAP(c) {
    const body = await c.req.json() as { exchange: string; symbol: string }
    const { exchange, symbol } = body
    const exchangeMonitor = getExchangeMonitor(exchange)
    if (!exchangeMonitor) {
        throw new Error(`Exchange ${exchange} not found`)
    }
    exchangeMonitor.toggleTWAPOrder(symbol)
    return c.text('ok')
})

app.post('/__forceT', async function __forceT(c) {
    const body = await c.req.json() as { sl?: boolean }
    const { sl } = body

    if (process.env.TESTNET) {
        if (!global.__Force) {
            global.__Force = (() => {
                let forceSL = false
                let forceTP = false
                return {
                    v: () => forceSL,
                    sl: () => forceSL,
                    tp: () => forceTP,
                    f: (sl: boolean = true) => {
                        if (sl) {
                            forceSL = true
                        } else {
                            forceTP = true
                        }
                    },
                    c: () => {
                        forceSL = false
                        forceTP = false
                    },
                }
            })()
        }
        
        global.__Force.f(sl ?? true)
        setTimeout(() => global.__Force?.c(), 5000)
    }
    return c.json({ __force: global.__Force && global.__Force[sl ? 'sl': 'tp']() })
})

export default app

