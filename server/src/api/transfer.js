import { Hono } from 'hono'

import { getExchangeMonitor  } from '../monitor/exchangeMonitor.js'
import { sleep } from '../../../share/utils.js'

const app = new Hono()

app.post('/', async function transfer(c) {
    const body = await c.req.json()
    const { exchange, currency, amount, from, to } = body
    const typeMap = {
        spot: 'MAIN',
        linear: 'UMFUTURE',
        inverse: 'CMFUTURE',
    }
    const type = `${typeMap[from]}_${typeMap[to]}`
    const result = await getExchangeMonitor(exchange).exchange.transfer(currency, amount, from, to, { type })
    console.log('transfer', result)
    return c.json(result)
})

export default app