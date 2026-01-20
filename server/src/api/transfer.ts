import { Hono } from 'hono'
import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'

const app = new Hono()

interface TransferBody {
    exchange: string
    currency: string
    amount: number
    from: 'spot' | 'linear' | 'inverse'
    to: 'spot' | 'linear' | 'inverse'
}

const typeMap: Record<string, string> = {
    spot: 'MAIN',
    linear: 'UMFUTURE',
    inverse: 'CMFUTURE',
}

app.post('/', async function transfer(c) {
    const body = await c.req.json() as TransferBody
    const { exchange, currency, amount, from, to } = body
    const type = `${typeMap[from]}_${typeMap[to]}`
    
    const exchangeMonitor = getExchangeMonitor(exchange)
    if (!exchangeMonitor) {
        throw new Error(`Exchange ${exchange} not found`)
    }
    
    const result = await (exchangeMonitor.exchange as any).transfer(currency, amount, from, to, { type })
    console.log('transfer', result)
    return c.json(result)
})

export default app

