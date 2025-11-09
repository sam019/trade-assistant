import { Hono } from 'hono'
// import { ORDER_TYPES, ORDER_SIDES, POSITION_SIDES, EXCHANGES } from 'share/const.js';
import { ORDER_TYPES } from 'share/const.js'
import { checkSymbol } from 'share/utils.js'

import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import orderWatcher from '../monitor/orderMonitor.js'
import { orderModel } from "../database/db.js"

import service from '../service/index.js'



// console.log(Object.keys(Const));

const app = new Hono()


app.post('/create', async function(c) {
    // console.log(context.req.params);
    const body = await c.req.json()
    const { exchange, symbol, side, type, __direct, __params } = body
    if (!exchange || !symbol || !side || !type) {
        throw new Error('参数错误')
    }
    if (__direct) {
        const result = await getExchangeMonitor(exchange).exchange.createOrderWs(symbol, type, side, undefined, undefined, __params)
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
    const body = await c.req.json()
    const { _id, _refresh } = body
    let result = await orderModel.findByIdAndDelete(_id)
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
    const body = await c.req.json()
    const { exchange, symbol } = body
    getExchangeMonitor(exchange).closeTWAPOrder(symbol)
    return c.text('ok')
})

app.post('/twap/toggle', async function closeTWAP(c) {
    const body = await c.req.json()
    const { exchange, symbol } = body
    getExchangeMonitor(exchange).toggleTWAPOrder(symbol)
    return c.text('ok')
})

app.post('/__forceT', async function __forceT(c) {
    if (process.env.TESTNET) {
        if (!global.__Force) {
            global.__Force = (() => {
                let force
                return {
                    v: () => force,
                    f: () => {
                        force = true
                    },
                    c: () => {
                        force = false
                    },
                }
            })()
        }
        global.__Force.f()
        setTimeout(() => global.__Force?.c(), 5000)
    }
    return c.json({ __force: global.__Force?.v() })
})

export default app