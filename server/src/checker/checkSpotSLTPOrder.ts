import Decimal from 'decimal.js'
import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import orderWatcher from '../monitor/orderMonitor.js'
import service from '../service/index.js'
import { ORDER_SIDES, ORDER_AMOUNT_TYPES } from 'share/const.js'
import { checkSymbol, sleep } from 'share/utils.js'
import logger from '../logger.js'
import type { Order } from '../types/index.js'
import type { Ticker } from '../types/index.js'

interface GetRealAmountParams {
    balance?: { free: number; used: number; total: number } | null
    lastPrice: number
    amount: number
    unit: string
    _id: string
    exchange: string
    symbol: string
    cSymbol: ReturnType<typeof checkSymbol>
}

function getRealAmount({ balance, lastPrice, amount, unit, _id, exchange, symbol, cSymbol }: GetRealAmountParams): { realAmount: number; realUnit: string } | undefined {
    let realAmount = amount
    let realUnit = unit
    if (!balance) {
        console.log('无法获取余额数据，尝试直接下单')
    } else if (!balance.free) {
        console.log('止盈止损订单余额为0，已自动取消')
        orderWatcher.closeOrder(_id)
        return
    } else if (unit === ORDER_AMOUNT_TYPES.BASE) {
        if (amount > balance.free) {
            realAmount = balance.free
            console.log(`止盈止损订单数量不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}${cSymbol[realUnit as keyof typeof cSymbol]}`)
        }
    } else {
        if (new Decimal(amount).div(lastPrice).toNumber() > balance.free) {
            realAmount = balance.free
            realUnit = ORDER_AMOUNT_TYPES.BASE
            console.log(`止盈止损订单数量不足, 仅设置部分成交。交易所:${exchange} 交易对:${symbol} 卖出数量:${realAmount}${cSymbol[realUnit as keyof typeof cSymbol]}`)
        }
    }
    return { realAmount, realUnit }
}

export default async function checkSpotSLTPOrder(order: Order, ticker: Ticker): Promise<void> {
    const { _id, symbol, amount, unit, slPrice, tpPrice, exchange, useTWAP, totalMinute, priceLimit } = order
    try {
        if (orderWatcher.isOrderDealing(_id)) {
            return
        }
        const lastPrice = ticker.last
        if (!lastPrice) {
            throw new Error('错误: 无法获取tick: ' + symbol)
        }

        const isSlTriggered = (slPrice && (lastPrice <= slPrice)) || (global.__Force?.sl() ?? false)
        const isTpTriggered = (tpPrice && (lastPrice >= tpPrice)) || (global.__Force?.tp() ?? false)
        
        if (isSlTriggered || isTpTriggered) {
            orderWatcher.markOrderDealing(_id)

            // 止损止盈时有可能正在twap建仓，需要立即停止
            const twapOrder = getExchangeMonitor(exchange).getTWAPOrder(symbol)
            if (twapOrder) {
                getExchangeMonitor(exchange).closeTWAPOrder(symbol)
                logger.info('止损触发, 终止TWAP')
            }

            const cSymbol = checkSymbol(symbol)
            const balance = getExchangeMonitor(exchange).balance.spot[cSymbol.base]
            const realAmountResult = getRealAmount({ balance, lastPrice, amount, unit, _id, exchange, symbol, cSymbol })
            
            if (!realAmountResult) {
                return
            }

            const { realAmount, realUnit } = realAmountResult
            const params = {
                exchange,
                symbol,
                amount: realAmount,
                unit: realUnit,
                side: ORDER_SIDES.SELL,
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
                lastPrice, 
                triggerPrice,
                amount: params.amount,
                unit: params.unit 
            })

            const result = await service.createSpotMarketOrder(params)
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


