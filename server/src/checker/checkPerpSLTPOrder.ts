import Decimal from 'decimal.js'
import { POSITION_SIDES, ORDER_SIDES, ORDER_AMOUNT_TYPES } from 'share/const.js'
import { checkSymbol, sleep } from 'share/utils.js'
import service from '../service/index.js'
import orderWatcher from '../monitor/orderMonitor.js'
import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import logger from '../logger.js'
import type { Order } from '../types/index.js'
import type ccxt from 'ccxt'

interface GetRealAmountParams {
    position: ccxt.Position
    amount: number
    unit: string
    exchange: string
    symbol: string
    cSymbol: ReturnType<typeof checkSymbol>
}

function getRealAmount({ position, amount, unit, exchange, symbol, cSymbol }: GetRealAmountParams): { realAmount: number; realUnit: string } {
    let realAmount = amount
    let realUnit = unit
    
    if (unit === ORDER_AMOUNT_TYPES.CONTRACT) {
        if (position.contracts < amount) {
            realAmount = position.contracts
            console.log(`止盈止损订单数量不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}张`)
        }
    } else if (unit === ORDER_AMOUNT_TYPES.BASE) {
        if (cSymbol.isLinear) {
            if (new Decimal(amount).div(position.contractSize).toNumber() > position.contracts) {
                realAmount = position.contracts
                realUnit = ORDER_AMOUNT_TYPES.CONTRACT
                console.log(`止盈止损订单数量不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}张`)
            }
        } else {
            if (new Decimal(amount).mul(position.markPrice).div(position.contractSize).toNumber() > position.contracts) {
                realAmount = position.contracts
                realUnit = ORDER_AMOUNT_TYPES.CONTRACT
                console.log(`止盈止损订单数量不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}张`)
            }
        }
    } else {
        if (cSymbol.isLinear) {
            if (new Decimal(amount).div(position.markPrice).div(position.contractSize).toNumber() > position.contracts) {
                realAmount = position.contracts
                realUnit = ORDER_AMOUNT_TYPES.CONTRACT
                console.log(`止盈止损订单数量不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}张`)
            }
        } else {
            if (new Decimal(amount).div(position.contractSize).toNumber() > position.contracts) {
                realAmount = position.contracts
                realUnit = ORDER_AMOUNT_TYPES.CONTRACT
                console.log(`止盈止损订单数量不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}张`)
            }
        }
    }
    return { realAmount, realUnit }
}

export default async function checkPerpSLTPOrder(order: Order, position: ccxt.Position): Promise<void> {
    const { _id, symbol, amount, unit, slPrice, tpPrice, exchange, useTWAP, totalMinute, priceLimit } = order
    try {
        if (orderWatcher.isOrderDealing(_id)) {
            return
        }
        
        if (!position) {
            throw new Error('错误: 无法获取symbol position: ' + symbol)
        }
        
        const isSlTriggered = (slPrice && (position.side === POSITION_SIDES.LONG ? position.markPrice <= slPrice : position.markPrice >= slPrice)) || (global.__Force?.sl() ?? false)
        const isTpTriggered = (tpPrice && (position.side === POSITION_SIDES.LONG ? position.markPrice >= tpPrice : position.markPrice <= tpPrice)) || (global.__Force?.tp() ?? false)
        
        if (isSlTriggered || isTpTriggered) {
            orderWatcher.markOrderDealing(_id)

            const exchangeMonitor = getExchangeMonitor(exchange)
            if (!exchangeMonitor) {
                throw new Error(`Exchange ${exchange} not found`)
            }

            const twapOrder = exchangeMonitor.getTWAPOrder(symbol)
            if (twapOrder) {
                logger.info('止损触发, 终止TWAP')
                exchangeMonitor.closeTWAPOrder(symbol)
            }

            const cSymbol = checkSymbol(symbol)
            const { realAmount, realUnit } = getRealAmount({ position, amount, unit, exchange, symbol, cSymbol })
            const params = {
                exchange,
                symbol,
                reduceOnly: true,
                side: position.side === POSITION_SIDES.LONG ? ORDER_SIDES.SELL : ORDER_SIDES.BUY,
                amount: realAmount,
                unit: realUnit,
                useTWAP,
                totalMinute,
                priceLimit,
            }

            const triggerPrice = isTpTriggered ? tpPrice : slPrice

            logger.sltp({ 
                exchange, 
                symbol, 
                isSL: !isTpTriggered, 
                side: params.side, 
                lastPrice: position.markPrice, 
                triggerPrice: triggerPrice!, 
                amount: params.amount, 
                unit: params.unit 
            })

            let result
            if (cSymbol.isLinear) {
                result = await service.createLinearPerpMarketOrder(params)
            } else {
                result = await service.createInversePerpMarketOrder(params)
            }

            logger.sltpSucc({ 
                exchange, 
                symbol, 
                isSL: !isTpTriggered, 
                side: params.side, 
                cost: result.cost, 
                price: result.price, 
                useTWAP, 
                totalMinute, 
                priceLimit 
            })
            await orderWatcher.resolveOrder(_id)
        }
    } catch (e) {
        logger.sltpErr({ exchange, symbol, e: e as Error })
        await sleep(1000)
        orderWatcher.unmarkOrderDealing(_id)
    }
}

