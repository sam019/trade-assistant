import { Hono } from 'hono'
import { POSITION_SIDES, ORDER_SIDES, ORDER_AMOUNT_TYPES } from 'share/const.js'
import { checkSymbol } from 'share/utils.js'
import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import service from '../service/index.js'

const app = new Hono()

app.post('/list', async function fetchPositions(c) {
    const body = await c.req.json() as { exchange: string; symbols?: string[] }
    const { exchange, symbols } = body
    const exchangeMonitor = getExchangeMonitor(exchange)
    if (!exchangeMonitor) {
        throw new Error(`Exchange ${exchange} not found`)
    }
    const result = await exchangeMonitor.watchPositions(symbols || [])
    return c.json(result)
})

app.post('/close', async function closePosition(c) {
    const body = await c.req.json() as { exchange: string; symbol: string }
    const { exchange, symbol } = body
    const exchangeMonitor = getExchangeMonitor(exchange)
    if (!exchangeMonitor) {
        throw new Error(`Exchange ${exchange} not found`)
    }
    
    const position = exchangeMonitor.positions.find(pos => pos.symbol === symbol)
    if (!position) {
        throw new Error('错误: 未查询到仓位')
    }
    
    const side = position.side === POSITION_SIDES.LONG ? ORDER_SIDES.SELL : ORDER_SIDES.BUY
    const cSymbol = checkSymbol(symbol)
    const params = {
        exchange,
        symbol,
        side,
        unit: ORDER_AMOUNT_TYPES.CONTRACT,
        amount: position.contracts,
        reduceOnly: true,
    }
    let result
    if (cSymbol.isLinear) {
        result = await service.createLinearPerpMarketOrder(params)
    } else {
        result = await service.createInversePerpMarketOrder(params)
    }
    return c.json(result)
})

export default app

