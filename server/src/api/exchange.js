import { Hono } from 'hono'

import { SUPPORTED_EXCHANGES } from '../config.js';

const app = new Hono();

app.post('/supported', async function getSupportedExchanges(c) {
    // console.log('SUPPORTED_EXCHANGES', SUPPORTED_EXCHANGES);
    return c.json(SUPPORTED_EXCHANGES);
});

export default app