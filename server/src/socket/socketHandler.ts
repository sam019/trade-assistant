import { getExchangeMonitor } from "../monitor/exchangeMonitor.js"
import logger from "../logger.js"
import type { Socket } from 'socket.io'
import type { ExchangeAccount, Ticker } from '../types/index.js'
import type ccxt from 'ccxt'

class SubscriptionManager {
    [key: string]: any

    get(...params: (string | number)[]): any {
        return params.reduce((a: any, b) => a && a[b], this)
    }
    
    set(...params: (string | number | (() => void))[]): this {
        const value = params.pop() as (() => void) | null
        const keys = params as (string | number)[]
        return keys.reduce((a: any, b, i) => {
            if (i === keys.length - 1) {
                a[b] = value
                return this
            }
            if (!a[b]) {
                a[b] = {}
            }
            return a[b]
        }, this)
    }
    
    unsubscribeAll(): void {
        Object.values(this).forEach(subscription => {
            if (typeof subscription === 'function') {
                subscription()
            } else if (typeof subscription === 'object' && subscription !== null) {
                Object.values(subscription).forEach((fn: any) => fn && fn())
            }
        })
        Object.keys(this).forEach(key => delete this[key])
    }
}

interface SubscribeAccountData {
    exchange: string
}

interface SubscribeTickersData {
    exchange: string
    symbols: string[]
}

export default function socketHandler(socket: Socket): void {
    const createTime = Date.now()
    const subscriptionManager = new SubscriptionManager()

    socket.on('subscribeAccount', (data: SubscribeAccountData) => {
        const unsubscribeAccount = subscriptionManager.get(data?.exchange, 'unsubscribeAccount')
        if (unsubscribeAccount) {
            unsubscribeAccount()
        }
        logger.info(`Client ${socket.id} subscribe ACCOUNT on ${data.exchange.toUpperCase()}`)
        const exchangeMonitor = getExchangeMonitor(data.exchange)
        if (exchangeMonitor) {
            const unsubscribeAccount = exchangeMonitor.onAccountUpdate((accountData: ExchangeAccount) => {
                socket.emit('accountUpdate', accountData)
            })
            subscriptionManager.set(data.exchange, 'unsubscribeAccount', unsubscribeAccount)
        }
    })
    
    socket.on('unsubscribeAccount', (data: SubscribeAccountData) => {
        const unsubscribeAccount = subscriptionManager.get(data?.exchange, 'unsubscribeAccount')
        if (unsubscribeAccount) {
            unsubscribeAccount()
            subscriptionManager.set(data.exchange, 'unsubscribeAccount', null)
        }
    })
    
    socket.on('subscribeTickers', (data: SubscribeTickersData) => {
        const unsubscribeTickers = subscriptionManager.get(data.exchange, 'unsubscribeTickers')
        if (unsubscribeTickers) {
            logger.info(`Unsubscribe previous ${data.exchange}, symbols: ${data.symbols}`)
            unsubscribeTickers()
            subscriptionManager.set(data.exchange, 'unsubscribeTickers', null)
        }
        logger.info(`Client ${socket.id} subscribe TICKERS on ${data.exchange}, symbol amount ${data.symbols.length}`)
        const exchangeMonitor = getExchangeMonitor(data.exchange)
        if (exchangeMonitor) {
            const unsubscribeTickers = exchangeMonitor.onTickersUpdate(data.symbols, (tickers: Record<string, Ticker>) => {
                socket.emit('tickersUpdate', tickers)
            })
            subscriptionManager.set(data.exchange, 'unsubscribeTickers', unsubscribeTickers)
        }
    })
    
    socket.on('unsubscribeTickers', (data: SubscribeTickersData) => {
        const unsubscribeTickers = subscriptionManager.get(data?.exchange, 'unsubscribeTickers')
        if (unsubscribeTickers) {
            unsubscribeTickers()
            subscriptionManager.set(data.exchange, 'unsubscribeTickers', null)
        }
    })
    
    socket.on('disconnect', () => {
        subscriptionManager.unsubscribeAll()
        logger.info(`Client ${socket.id} disconnected, cleaning up subscriptions, connect duration ${(Date.now() - createTime) / 1000}s`)
    })
}

