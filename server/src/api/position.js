import { Hono } from 'hono';

import Const from '../../../const/const.js';

import { getExchangeMonitor } from '../monitor/exchangeMonitor.js';
// import { orderModel } from "../database/db";
import { createLinearPerpMarketOrder, createInversePerpMarketOrder } from './order.js';

const { POSITION_SIDES, ORDER_SIDES, ORDER_AMOUNT_TYPES } = Const;

const app = new Hono();

app.post('/list', async function fetchPositions(c) {
    const body = await c.req.json();
    const { exchange, symbols } = body;
    const result = await getExchangeMonitor(exchange).watchPositions(symbols);
    return c.json(result);
});

app.post('/close', async function closePosition(c) {
    const body = await c.req.json();
    const { exchange, symbol } = body;
    const position = getExchangeMonitor(exchange).positions.find(pos => pos.symbol === symbol);
    if (!position) {
        throw new Error('错误：未查询到仓位')
    }
    // const result = await getExchangeMonitor(exchange).exchange.closePosition(symbol);
    const side = position.side === POSITION_SIDES.LONG ? ORDER_SIDES.SELL : ORDER_SIDES.BUY;
    const match = symbol.match(/(\w+)\/(\w+):?(\w+)?/);
    const params = {
        exchange,
        symbol,
        side,
        unit: ORDER_AMOUNT_TYPES.CONTRACT,
        amount: position.contracts,
        reduceOnly: true,
    };
    let result;
    if (match[3] === match[2]) {
        result = await createLinearPerpMarketOrder(params);
    } else {
        result = await createInversePerpMarketOrder(params);
    }
    return c.json(result);
});

export default app;