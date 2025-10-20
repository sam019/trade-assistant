import { Hono } from 'hono'
// import { ORDER_TYPES, ORDER_SIDES, POSITION_SIDES, EXCHANGES } from '../../../share/const.js';
import { ORDER_TYPES } from '../../../share/const.js'

import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
// import orderWatcher from '../monitor/orderMonitor.js'
import { orderModel } from "../database/db"

import service from '../service'



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
    console.log('create order', symbol, type)

    const match = symbol.match(/(\w+)\/(\w+):?(\w+)?/)
    const isSpot = !match[3]
    const isLinearPerp = match[3] === match[2]
    const isInversePerp = match[3] === match[1]

    if (isSpot) {
        if (type === ORDER_TYPES.MARKET) {
            const result = await service.createSpotMarketOrder(body)
            return c.json(result)
        }
        if (type === ORDER_TYPES.SLTP) {
            const result = await service.createSpotMarketSLTPOrder(body)
            return c.json(result)
        }
        if (type === ORDER_TYPES.CONDITION) {
            const result = await service.createSpotMarketConditionOrder(body)
            return c.json(result)
        }
    }
    if (isLinearPerp) {
        if (type === ORDER_TYPES.MARKET) {
            const result = await service.createLinearPerpMarketOrder(body)
            return c.json(result)
        }
        if (type === ORDER_TYPES.SLTP) {
            const result = await service.createPerpMarketSLTPOrder(body)
            return c.json(result)
        }
    }
    if (isInversePerp) {
        if (type === ORDER_TYPES.MARKET) {
            const result = await service.createInversePerpMarketOrder(body)
            return c.json(result)
        }
        if (type === ORDER_TYPES.SLTP) {
            const result = await service.createPerpMarketSLTPOrder(body)
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
    const result = await orderModel.find()
    return c.json(result)
})

export default app