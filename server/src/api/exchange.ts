import { Hono } from 'hono'
import { SUPPORTED_EXCHANGES } from '../config.js'

const app = new Hono()

app.post('/supported', async function getSupportedExchanges(c) {
    return c.json(SUPPORTED_EXCHANGES)
})

export default app

