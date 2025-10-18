import { Hono } from 'hono'
import Decimal from 'decimal.js';

// import { ORDER_TYPES, ORDER_SIDES, POSITION_SIDES, EXCHANGES } from '../../../const/const.js';
import Const from '../../../const/const.js';

import { getExchangeMonitor } from '../monitor/exchangeMonitor.js';
import orderWatcher from '../monitor/orderMonitor.js';
import { orderModel } from "../database/db";

// console.log(Object.keys(Const));

const { ORDER_TYPES, ORDER_SIDES, ORDER_AMOUNT_TYPES, POSITION_SIDES, ORDER_STATES } = Const;

const app = new Hono();

function getPrecisionLength(decimal) {
    return (Number(decimal) + 1).toString().split('.')[1]?.length || 0;
}

export async function createSpotMarketOrder(data) {
    const { exchange, symbol, side, amount, unit, usePct, amountPct, withSLTP, slPrice, tpPrice, __force } = data;
    /* todo 校验 */
    const market = getExchangeMonitor(exchange).markets.spot.find(mar => mar.symbol === symbol);
    if (!market) {
        throw new Error('错误: 交易对无效');
    }
    const params = {};
    if (usePct) {
        const currencyMatch = symbol.match(/(\w+)\/(\w+)/);
        if (side === ORDER_SIDES.SELL) {
            const balance = getExchangeMonitor(exchange).balance.spot[currencyMatch[1]]?.free;
            params.quantity = new Decimal(balance).mul(amountPct).div(100).toDecimalPlaces(getPrecisionLength(market.precision.amount)).toNumber();
        } else {
            const balance = getExchangeMonitor(exchange).balance.spot[currencyMatch[2]]?.free;
            if (!balance) {
                throw new Error('错误: 未检测到余额')
            }
            params.quoteOrderQty = new Decimal(balance).mul(amountPct).div(100).toDecimalPlaces(getPrecisionLength(market.precision.quote)).toNumber();
        }
    } else if (unit === ORDER_AMOUNT_TYPES.QUOTE) {
        params.quoteOrderQty = new Decimal(amount).toDecimalPlaces(getPrecisionLength(market.precision.quote)).toNumber();
    } else {
        params.quantity = new Decimal(amount).toDecimalPlaces(getPrecisionLength(market.precision.amount)).toNumber();
    }
    const sltpParams = {
        exchange,
        symbol,
        state: ORDER_STATES.OPENING,
    };
    if (withSLTP) {
        if (!slPrice && !tpPrice) {
            throw new Error('无效的止盈止损价格')
        }
        const lastTicker = await getExchangeMonitor(exchange).awaitTickersUpdate([symbol]);
        const lastPrice = lastTicker[0] && lastTicker[0].last || 0;
        if (slPrice) {
            if (slPrice < lastPrice) {
                sltpParams.slPrice = slPrice;
            } else {
                throw new Error('无效的止损价格')
            }
        }
        if (tpPrice) {
            if (tpPrice > lastPrice) {
                sltpParams.tpPrice = tpPrice;
            } else {
                throw new Error('无效的止盈价格')
            }
        }
    }
    console.log('创建市价单', exchange, symbol, side, params.quantity || params.quoteOrderQty, params.quantity ? market.base : market.quote);

    const result = await getExchangeMonitor(exchange).exchange.createOrderWs(symbol, ORDER_TYPES.MARKET, side, undefined, undefined, params);
    // console.log('下单成功', result)
    if (withSLTP) {
        sltpParams.amount = result.filled;
        sltpParams.unit = ORDER_AMOUNT_TYPES.BASE;
        await orderWatcher.creatOrder(sltpParams);
    }
    return result;
}
export async function createSpotMarketSLTPOrder(data) {
    const { exchange, symbol, amount, unit, usePct, amountPct, slPrice, tpPrice, __force } = data;
    if (!slPrice && !tpPrice) {
        throw new Error('止盈止损触发价格设置错误');
    }
    const market = getExchangeMonitor(exchange).markets.spot.find(mar => mar.symbol === symbol);
    if (!market) {
        throw new Error('错误: 交易对无效');
    }
    
    const params = {
        exchange,
        symbol,
        amount,
        unit,
        state: ORDER_STATES.OPENING,
    };
    // usePct为true时，换算为绝对值
    if (usePct) {
        const currencyMatch = symbol.match(/(\w+)\/(\w+)/);
        // console.log('currencyMatch', currencyMatch[1], getExchangeMonitor(exchange).balance.spot['BTC']);
        const balance = getExchangeMonitor(exchange).balance.spot[currencyMatch[1]]?.free;
        if (!balance) {
            throw new Error('止盈止损数量错误：没有余额')
        }
        params.amount = new Decimal(amountPct).mul(balance).div(100).toDecimalPlaces(getPrecisionLength(market.precision.base)).toNumber();
        params.unit = ORDER_AMOUNT_TYPES.BASE;
    }
    
    const lastTicker = await getExchangeMonitor(exchange).awaitTickersUpdate([symbol]);
    const lastPrice = lastTicker[0] && lastTicker[0].last || 0;
    
    if (slPrice) {
        if (slPrice < lastPrice) {
            params.slPrice = slPrice;
        } else {
            throw new Error('止损触发价格设置错误');
        }
    }
    if (tpPrice) {
        if (tpPrice > lastPrice) {
            params.tpPrice = tpPrice;
        } else {
            throw new Error('止盈触发价格设置错误');
        }
    }
    const order = await orderWatcher.creatOrder(params);
    return order;
}

export async function createLinearPerpMarketOrder(data) {
    const { exchange, symbol, side, amount, leverage, amountPct, usePct, unit, withSLTP, slPrice, tpPrice, reduceOnly = false, __force } = data;
    const market = getExchangeMonitor(exchange).exchange.markets[symbol];
    const position = getExchangeMonitor(exchange).positions.find(pos => pos.symbol === symbol);
    // 如果当前有仓位并且仓位方向和下单放下相反，判断为减仓单
    const isReduce = !!position && ((side === ORDER_SIDES.BUY && position.side === POSITION_SIDES.SHORT) || (side === ORDER_SIDES.SELL && position.side === POSITION_SIDES.LONG));

    let { longLeverage: realLeverage } = Object.values(await getExchangeMonitor(exchange).fetchLeverages([symbol]))[0];
    if (leverage) {
        if (leverage !== realLeverage) {
            await getExchangeMonitor(exchange).exchange.setLeverage(leverage, symbol);
            realLeverage = leverage;
        }
    }
    // console.log('balance keys', getExchangeMonitor(exchange).balance, market.swap ? market.subType : market.type, market.quote)
    if (reduceOnly && !position) {
        throw new Error('错误：未检测到仓位')
    }
    // console.log('isReduce', isReduce)
    if (reduceOnly !== isReduce) {
        throw new Error('错误：前后端增减仓逻辑协调错误');
    }
    const tickers = await getExchangeMonitor(exchange).awaitTickersUpdate([symbol]);
    // console.log('ticker', tickers[0])
    const last = tickers[0] && tickers[0].last || 0;
    const sltpParams = {
        exchange,
        symbol,
        slPrice,
        tpPrice,
        state: ORDER_STATES.OPENING,
    };
    if (withSLTP) {
        if (!slPrice && !tpPrice) {
            throw new Error('无效的止盈止损价格')
        }
        if (slPrice) {
            if (side === ORDER_SIDES.BUY) {
                if (slPrice < last) {
                    sltpParams.slPrice = slPrice;
                } else {
                    throw new Error(`无效的止损价格 sl:${slPrice} last:${last}`)
                }
            } else {
                if (slPrice > last) {
                    sltpParams.slPrice = slPrice;
                } else {
                    throw new Error(`无效的止损价格 sl:${slPrice} last:${last}`)
                }
            }
        }
        if (tpPrice) {
            if (side === ORDER_SIDES.BUY) {
                if (tpPrice > last) {
                    sltpParams.tpPrice = tpPrice;
                } else {
                    throw new Error(`无效的止盈价格 tp:${slPrice} last:${last}`)
                }
            } else {
                if (tpPrice < last) {
                    sltpParams.tpPrice = tpPrice;
                } else {
                    throw new Error(`无效的止盈价格 tp:${slPrice} last:${last}`)
                }
            }
        }
    }
    // console.log('last', last)
    // const precisionLength = (Number(market.precision.amount) + 1).toString().split('.')[1].length;
    
    
    
    const precisionLength = getPrecisionLength(market.precision.amount);
    const params = {};

    if (unit === ORDER_AMOUNT_TYPES.CONTRACT) {
        // 按张下单，目前只有止盈止损单会触发
        params.quantity = new Decimal(amount).toDecimalPlaces(precisionLength).toNumber();
    } else if (isReduce) {
        if (usePct) {
            // 百分比减仓
            params.quantity = new Decimal(position.contracts).mul(amountPct).div(100).toDecimalPlaces(precisionLength).toNumber();
            // console.log('params.quantity', params.quantity)
        } else if (unit === ORDER_AMOUNT_TYPES.QUOTE) {
            // U本位绝对数量减仓
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount).mul(last);
            const quantity = new Decimal(amount).div(qtoAmountStep).floor().mul(qtoAmountStep).div(market.contractSize).div(last).toDecimalPlaces(precisionLength).toNumber();
            params.quantity = quantity;
        } else {
            // 币本位绝对数量减仓
            const baseAmountStep = new Decimal(market.contractSize).mul(market.precision.amount);
            const quantity = new Decimal(amount).div(baseAmountStep).floor().mul(baseAmountStep).toDecimalPlaces(precisionLength).toNumber();
            params.quantity = quantity;
        }
    } else {
        // 建仓
        if (unit === ORDER_AMOUNT_TYPES.BASE) {
            // 币本位绝对数量建仓
            const baseAmountStep = new Decimal(market.contractSize).mul(market.precision.amount);
            const quantity = new Decimal(amount).div(baseAmountStep).floor().mul(baseAmountStep).mul(realLeverage).toDecimalPlaces(precisionLength).toNumber();
            params.quantity = quantity;
        } else {
            // 可开仓位按quote计价的数量的最小粒度
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount).mul(last);
            // console.log('qtoAmountStep', market.contractSize, market.precision.amount, last, qtoAmountStep.toNumber())
            let maxStepAmount; // 最小粒度的数量
            if (usePct) {
                // 百分比数量建仓
                const balance = getExchangeMonitor(exchange).balance[market.subType][market.quote].free;
                // console.log('maxStepAmount', getExchangeMonitor(exchange).balance, balance, amountPct, qtoAmountStep.toNumber())
                maxStepAmount = new Decimal(balance).mul(amountPct).div(100).div(qtoAmountStep).floor();
            } else {
                // U本位绝对数量建仓
                // console.log(new Decimal(amount).div(qtoAmountStep).toNumber())
                maxStepAmount = new Decimal(amount).div(qtoAmountStep).floor();
            }
            // console.log('quantity', maxStepAmount.toNumber(), qtoAmountStep.toNumber(), market.contractSize, last)
            // 逻辑正确，quantity参数是计算杠杆后的开仓数量，所以要把要开的保证金乘以杠杆
            const quantity = maxStepAmount.mul(qtoAmountStep).div(market.contractSize).div(last).mul(realLeverage).toDecimalPlaces(precisionLength).toNumber();
            // console.log('quantity', quantity)
            params.quantity = quantity;
        }
    }
    // console.log('createLinearPerpMarketOrder quantity', params.quantity, precisionLength); 

    console.log('创建市价单', exchange, symbol, params.quantity, realLeverage);
    const result = await getExchangeMonitor(exchange).exchange.createOrderWs(symbol, ORDER_TYPES.MARKET, side, undefined, undefined, params);
    console.log('下单成功', result.amount, result.cost, result.leverage);
    if (withSLTP) {
        sltpParams.amount = result.amount;
        sltpParams.unit = ORDER_AMOUNT_TYPES.CONTRACT;
        await orderWatcher.creatOrder(sltpParams);
    }
    return result;
}

// 创建合约止盈止损委托
export async function createPerpMarketSLTPOrder(data) {
    const { exchange, symbol, amount, unit, usePct, amountPct, slPrice, tpPrice, __force } = data;
    const { linear, inverse } = getExchangeMonitor(exchange).markets;
    const market = [...linear, ...inverse].find(mar => mar.symbol === symbol);
    const position = getExchangeMonitor(exchange).positions?.find(pos => pos.symbol === symbol);
    console.log('sltp', slPrice, tpPrice, position?.markPrice);
    if (!market) {
        throw new Error('错误: 交易对无效');
    }
    if (!position) {
        throw new Error(`错误: 未检测到仓位: ${symbol}`);
    }
    
    if (!slPrice && !tpPrice) {
        throw new Error('无效的止盈止损价格')
    }
    if (position.side === POSITION_SIDES.LONG) {
        if (slPrice && slPrice >= position.markPrice) {
            throw new Error(`无效的止损价格 sl:${slPrice} mark:${position.markPrice}`)
        }
        if (tpPrice && tpPrice <= position.markPrice) {
            throw new Error(`无效的止盈价格 tp:${tpPrice} mark:${position.markPrice}`)
        }
    } else {
        if (slPrice && slPrice <= position.markPrice) {
            throw new Error(`无效的止损价格 sl:${slPrice} mark:${position.markPrice}`)
        }
        if (tpPrice && tpPrice >= position.markPrice) {
            throw new Error(`无效的止盈价格 tp:${tpPrice} mark:${position.markPrice}`)
        }
    }
    
    const params = {
        exchange,
        symbol,
        amount,
        unit,
        slPrice,
        tpPrice,
        state: ORDER_STATES.OPENING,
    };
    if (usePct) {
        params.amount = new Decimal(amountPct).div(100).mul(position.contracts).toDecimalPlaces(getPrecisionLength(market.precision.amount)).toNumber();
        params.unit = ORDER_AMOUNT_TYPES.CONTRACT;
    }
    
    const order = await orderWatcher.creatOrder(params);
    return order;
}

// 创建币本位合约市价单
export async function createInversePerpMarketOrder(data) {
    const { exchange, symbol, side, amount, leverage, amountPct, usePct, unit, withSLTP, slPrice, tpPrice, reduceOnly = false, __force } = data;
    const market = getExchangeMonitor(exchange).exchange.markets[symbol];
    const position = getExchangeMonitor(exchange).positions.find(pos => pos.symbol === symbol);
    // 如果当前有仓位并且仓位方向和下单放下相反，判断为减仓单
    const isReduce = !!position && ((side === ORDER_SIDES.BUY && position.side === POSITION_SIDES.SHORT) || (side === ORDER_SIDES.SELL && position.side === POSITION_SIDES.LONG));

    let { longLeverage: realLeverage } = Object.values(await getExchangeMonitor(exchange).fetchLeverages([symbol]))[0];
    if (leverage) {
        if (leverage !== realLeverage) {
            await getExchangeMonitor(exchange).exchange.setLeverage(leverage, symbol);
            realLeverage = leverage;
        }
    }
    if (reduceOnly && !position) {
        throw new Error('错误：未检测到仓位')
    }
    // console.log('isReduce', isReduce)
    if (reduceOnly !== isReduce) {
        throw new Error('错误：前后端增减仓逻辑协调错误');
    }
    const tickers = await getExchangeMonitor(exchange).awaitTickersUpdate([symbol]);
    // console.log('ticker', tickers[0])
    const last = tickers[0] && tickers[0].last || 0;
    const sltpParams = {
        exchange,
        symbol,
        slPrice,
        tpPrice,
        state: ORDER_STATES.OPENING,
    };
    if (withSLTP) {
        if (!slPrice && !tpPrice) {
            throw new Error('无效的止盈止损价格')
        }
        if (slPrice) {
            if (side === ORDER_SIDES.BUY) {
                if (slPrice < last) {
                    sltpParams.slPrice = slPrice;
                } else {
                    throw new Error(`无效的止损价格 sl:${slPrice} last:${last}`)
                }
            } else {
                if (slPrice > last) {
                    sltpParams.slPrice = slPrice;
                } else {
                    throw new Error(`无效的止损价格 sl:${slPrice} last:${last}`)
                }
            }
        }
        if (tpPrice) {
            if (side === ORDER_SIDES.BUY) {
                if (tpPrice > last) {
                    sltpParams.tpPrice = tpPrice;
                } else {
                    throw new Error(`无效的止盈价格 tp:${slPrice} last:${last}`)
                }
            } else {
                if (tpPrice < last) {
                    sltpParams.tpPrice = tpPrice;
                } else {
                    throw new Error(`无效的止盈价格 tp:${slPrice} last:${last}`)
                }
            }
        }
    }
    const precisionLength = getPrecisionLength(market.precision.amount);
    const params = {};
    // console.log('unit', unit, amount, side)
    // 币本位合约一张代表张数*contractSize的USD，比如btcusd，一张代表100usd
    if (unit === ORDER_AMOUNT_TYPES.CONTRACT) {
        // 按张下单，目前只有止盈止损单会触发
        params.quantity = new Decimal(amount).toDecimalPlaces(precisionLength).toNumber();
    } else if (isReduce) {
        if (usePct) {
            // 百分比减仓
            params.quantity = new Decimal(position.contracts).mul(amountPct).div(100).toDecimalPlaces(precisionLength).toNumber();
            // console.log('params.quantity', params.quantity)
        } else if (unit === ORDER_AMOUNT_TYPES.BASE) {
            // 币本位绝对值减仓
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount);
            const quantity = new Decimal(amount).mul(last).div(qtoAmountStep).floor().mul(qtoAmountStep).div(market.contractSize).toDecimalPlaces(precisionLength).toNumber();
            params.quantity = quantity;
        } else {
            // U本位绝对值减仓
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount);
            const quantity = new Decimal(amount).div(qtoAmountStep).floor().mul(qtoAmountStep).div(market.contractSize).toDecimalPlaces(precisionLength).toNumber();
            params.quantity = quantity;
        }
    } else {
        // 建仓
        if (unit === ORDER_AMOUNT_TYPES.QUOTE) {
            // U本位绝对值建仓
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount);
            const quantity = new Decimal(amount).div(qtoAmountStep).floor().mul(qtoAmountStep).mul(realLeverage).div(market.contractSize).toDecimalPlaces(precisionLength).toNumber();
            params.quantity = quantity;
        } else {
            // 可开仓位按quote计价的数量的最小粒度
            const qtoAmountStep = new Decimal(market.contractSize).mul(market.precision.amount);
            // console.log('qtoAmountStep', market.contractSize, market.precision.amount, last, qtoAmountStep.toNumber())
            let maxStepAmount; // 最小粒度的最大数量
            if (usePct) {
                // 百分比建仓
                const balance = getExchangeMonitor(exchange).balance[market.subType][market.base].free || 0;
                // console.log('maxStepAmount', getExchangeMonitor(exchange).balance, balance, amountPct, qtoAmountStep.toNumber())
                maxStepAmount = new Decimal(balance).mul(amountPct).div(100).mul(last).div(qtoAmountStep).floor();
            } else {
                // 币本位绝对值建仓
                // console.log(new Decimal(amount).div(qtoAmountStep).toNumber())
                maxStepAmount = new Decimal(amount).mul(last).div(qtoAmountStep).floor();
            }
            console.log('quantity', maxStepAmount.toNumber(), qtoAmountStep.toNumber(), market.contractSize, last)
            // 逻辑正确，quantity参数是计算杠杆后的开仓数量，所以要把要开的保证金乘以杠杆
            const quantity = maxStepAmount.mul(qtoAmountStep).div(market.contractSize).mul(realLeverage).toDecimalPlaces(precisionLength).toNumber();
            // console.log('quantity', quantity)
            params.quantity = quantity;
        }
    }
    // console.log('createLinearPerpMarketOrder quantity', params.quantity, precisionLength); 

    console.log('创建市价单', exchange, symbol, params.quantity, realLeverage);
    const result = await getExchangeMonitor(exchange).exchange.createOrderWs(symbol, ORDER_TYPES.MARKET, side, undefined, undefined, params);
    console.log('下单成功', result.amount, result.cost, result.leverage);
    if (withSLTP) {
        sltpParams.amount = result.amount;
        sltpParams.unit = ORDER_AMOUNT_TYPES.CONTRACT;
        await orderWatcher.creatOrder(sltpParams);
    }
    return result;
}

app.post('/create', async function(c) {
    // console.log(context.req.params);
    const body = await c.req.json();
    const { exchange, symbol, side, type, __direct, __params } = body;
    if (!exchange || !symbol || !side || !type) {
        throw new Error('参数错误');
    }
    if (__direct) {
        const result = await getExchangeMonitor(exchange).exchange.createOrderWs(symbol, type, side, undefined, undefined, __params);
        return c.json(result);
    }
    console.log('create order', symbol, type)

    const match = symbol.match(/(\w+)\/(\w+):?(\w+)?/);
    const isSpot = !match[3];
    const isLinearPerp = match[3] === match[2];
    const isInversePerp = match[3] === match[1];

    if (isSpot) {
        if (type === ORDER_TYPES.MARKET) {
            const result = await createSpotMarketOrder(body);
            return c.json(result);
        }
        if (type === ORDER_TYPES.SLTP) {
            const result = await createSpotMarketSLTPOrder(body);
            return c.json(result);
        }
    }
    if (isLinearPerp) {
        if (type === ORDER_TYPES.MARKET) {
            const result = await createLinearPerpMarketOrder(body);
            return c.json(result);
        }
        if (type === ORDER_TYPES.SLTP) {
            const result = await createPerpMarketSLTPOrder(body);
            return c.json(result);
        }
    }
    if (isInversePerp) {
        if (type === ORDER_TYPES.MARKET) {
            const result = await createInversePerpMarketOrder(body);
            return c.json(result);
        }
        if (type === ORDER_TYPES.SLTP) {
            const result = await createPerpMarketSLTPOrder(body);
            return c.json(result);
        }
    }
});

app.post('/delete', async function deleteOrder(c) {
    const body = await c.req.json();
    const { _id, _refresh } = body;
    let result = await orderModel.findByIdAndDelete(_id);
    if (_refresh) {
        result = await orderModel.find();
    }
    return c.json(result)
    
})

app.post('/list', async function listOrder(c) {
    const result = await orderModel.find();
    return c.json(result)
})

export default app;