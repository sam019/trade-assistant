import * as ccxt from 'ccxt'
import _ from 'lodash-es'
import { readFileSync } from 'fs'
import orderWatcher from './orderMonitor.js'
import { SUPPORTED_EXCHANGES } from '../config.js'
import { MARKET_TYPES, ORDER_STATES, type Exchange, type MarketType, type OrderState } from 'share/const.js'
import { checkSymbol, sleep, isDev, withTimeout } from 'share/utils.js'
import logger from '../logger.js'
import { isTESTNET } from '../utils.js'
import type { Balance, Market, Ticker, OrdersGroupByExchange } from '../types/index.js'

interface ExchangeConfig {
    enableRateLimit: boolean
    options?: Record<string, any>
    apiKey?: string
    secret?: string
    socksProxy?: string
    wsSocksProxy?: string
    httpsProxy?: string
    wssProxy?: string
}

interface MarketsByType {
    spot: Market[]
    linear: Market[]
    inverse: Market[]
}

interface OrdersByType {
    spot: any[]
    linear: any[]
    inverse: any[]
}

interface TWAPOrder {
    symbol: string
    state: OrderState
    [key: string]: any
}

type TickersCallback = (tickers: Record<string, Ticker>) => void
type PositionsCallback = (positions: ccxt.Position[]) => void
type AccountCallback = (account: {
    balance?: Balance
    positions?: ccxt.Position[]
    orders?: OrdersByType
    twapOrders?: Record<string, TWAPOrder>
    TESTNET?: boolean
}) => void

type TickerPromiseResolve = (tickers: Ticker[]) => void
type TickerPromiseReject = (error: Error) => void
type PositionPromiseResolve = (positions: ccxt.Position[]) => void
type PositionPromiseReject = (error: Error) => void

const exchangeModels: Record<string, ExchangeModel> = {}

class ExchangeModel {
    TESTNET: boolean
    fetchInterval: number
    errRestTime: number
    exchange: ccxt.Exchange
    exchangeName: Exchange
    markets: MarketsByType
    tickers: Record<string, Ticker>
    symbolsNeedWatch: Set<string>
    balance: {
        spot: Balance
        linear: Balance
        inverse: Balance
    }
    positions: (ccxt.Position & { leverage?: number })[]
    positionSymbols: string[]
    leverages: Record<string, number>
    orders: OrdersByType
    twapOrders: Record<string, TWAPOrder>
    tickersCbSymbolMap: Map<TickersCallback, string[]>
    awaitTickersUpdateCb: Map<[TickerPromiseResolve, TickerPromiseReject], string[]>
    awaitPositionsUpdateCb: Map<[PositionPromiseResolve, PositionPromiseReject], string[]>
    accountCbMap: Set<AccountCallback>
    positionsCbMap: Set<PositionsCallback>
    _triggerPositionsCbs: () => void

    constructor(exchange: Exchange) {
        this.TESTNET = isTESTNET()
        this.fetchInterval = 1000
        this.errRestTime = 5000

        const config: ExchangeConfig = {
            enableRateLimit: true,
            options: {},
        }

        if (isDev()) {
            Object.assign(config, {
                apiKey: process.env[`API_KEY_${exchange.toUpperCase()}`] || '',
                secret: process.env[`SECRET_KEY_${exchange.toUpperCase()}`] || '',
            })
            if (process.env.SOCKS_PROXY) {
                config.socksProxy = process.env.SOCKS_PROXY
                config.wsSocksProxy = process.env.SOCKS_PROXY
            } else if (process.env.HTTP_PROXY) {
                config.httpsProxy = process.env.HTTP_PROXY
                config.wssProxy = process.env.HTTP_PROXY
            }
        } else {
            Object.assign(config, {
                apiKey: readFileSync(`/run/secrets/API_KEY_${exchange.toUpperCase()}`, 'utf8').trim(),
                secret: readFileSync(`/run/secrets/SECRET_KEY_${exchange.toUpperCase()}`, 'utf8').trim(),
            })
        }

        this.exchange = new (ccxt.pro as any)[exchange](config) as ccxt.Exchange
        if (this.TESTNET) {
            this.exchange.enableDemoTrading(true)
        }

        this.exchangeName = exchange
        this.markets = {
            spot: [],
            linear: [],
            inverse: [],
        }
        this.tickers = {}
        this.symbolsNeedWatch = new Set()
        this.balance = {
            spot: {},
            linear: {},
            inverse: {},
        }
        this.positions = []
        this.positionSymbols = []
        this.leverages = {}
        this.orders = {
            spot: [],
            linear: [],
            inverse: [],
        }
        this.twapOrders = {}
        this.tickersCbSymbolMap = new Map()
        this.awaitTickersUpdateCb = new Map()
        this.awaitPositionsUpdateCb = new Map()
        this.accountCbMap = new Set()
        this.positionsCbMap = new Set()
        this._triggerPositionsCbs = _.throttle(() => {
            this.positionsCbMap.forEach(cb => cb(this.positions))
        }, 1000)
    }

    async init(): Promise<this> {
        if (isDev() && process.env.SOCKS_PROXY) {
            await this.exchange.loadProxyModules()
        }
        await this.loadmarkets()
        this.startWatchOrders()
        this.startWatchBalance()
        this.startWatchPositions()
        this.startWatchTickers()
        return this
    }

    async loadmarkets(): Promise<void> {
        try {
            await this.exchange.loadMarkets()
        } catch (e) {
            logger.error('loadmarkets error: ', e)
            await sleep(this.errRestTime)
            this.loadmarkets()
        }

        Object.values(this.exchange.markets || {}).forEach((market: ccxt.Market) => {
            if (!market.active) return
            const marketWithSymbol = market as Market
            if (market.spot) {
                this.markets.spot.push(marketWithSymbol)
            } else if (market.swap) {
                if (market.inverse) {
                    this.markets.inverse.push(marketWithSymbol)
                } else {
                    this.markets.linear.push(marketWithSymbol)
                }
            }
        })

        const defaultSorts = ['BTC', 'ETH', 'BNB', 'XRP', 'SOL', 'DOGE', 'TRX', 'ADA', 'HYPE', 'LINK']
        Object.values(this.markets).forEach(typeMarkets => {
            typeMarkets.sort((a, b) => {
                if (!['USDT', 'USD'].includes(b.quote)) return -1
                if (!['USDT', 'USD'].includes(a.quote)) return 1

                const ai = defaultSorts.indexOf(a.base)
                const bi = defaultSorts.indexOf(b.base)
                if (ai === -1 && bi === -1) {
                    return a.base.localeCompare(b.base)
                } else if (ai !== -1 && bi !== -1) {
                    return ai - bi
                } else if (ai !== -1) {
                    return -1
                } else {
                    return 1
                }
            })
        })
    }

    async startWatchBalance(): Promise<void> {
        while (true) {
            try {
                const sign = Date.now()
                const result = await Promise.all([
                    this.watchBalance('spot'),
                    this.watchBalance('future', 'linear'),
                    this.watchBalance('future', 'inverse'),
                ])
                // console.log('watchBalance', result)
                const balance: {
                    spot: Balance
                    linear: Balance
                    inverse: Balance
                } = {
                    spot: {},
                    linear: {},
                    inverse: {},
                }
                Object.values(result).forEach((item, index) => {
                    const type = index === 0 ? 'spot' : index === 1 ? 'linear' : 'inverse'
                    balance[type] = item
                })
                if (!_.isEqual(balance, this.balance)) {
                    this.balance = balance
                    this._triggerAccountCbs('balance')
                }
                await sleep(this.fetchInterval, sign)
            } catch (e) {
                logger.error('WatchBalance error: ', e)
                await sleep(this.errRestTime)
            }
        }
    }

    async watchBalance(type: string = 'spot', subType?: string): Promise<Balance> {
        const method = 'fetchBalance'
        const balance = await (this.exchange as any)[method]({
            type,
            subType,
        }) as ccxt.Balances
        const result: Balance = {}
        for (const [currency, info] of Object.entries(balance)) {
            if (currency === 'timestamp' || currency === 'datetime' || currency === 'info') continue
            if (typeof info === 'object' && info !== null && 'free' in info) {
                result[currency] = {
                    free: (info as any).free || 0,
                    used: (info as any).used || 0,
                    total: (info as any).total || 0,
                }
            }
        }
        return result
    }

    async startWatchPositions(): Promise<void> {
        while (true) {
            try {
                const sign = Date.now()
                this.positions = await this.watchPositions()
                const positionSymbols = this.positions.map(pos => pos.symbol).sort()
                if (!_.isEqual(positionSymbols, this.positionSymbols)) {
                    this.positionSymbols = positionSymbols
                    this.leverages = await this.fetchLeverages(positionSymbols)
                }
                this.positions.forEach(pos => {
                    pos.leverage = this.leverages[pos.symbol]
                })
                this.awaitPositionsUpdateCb.entries().forEach(([callbacks, symbols]) => {
                    const [resolve, reject] = callbacks
                    const r = this.positions.filter(pos => symbols.includes(pos.symbol))
                    resolve(r)
                    this.awaitPositionsUpdateCb.delete(callbacks)
                })
                this._triggerPositionsCbs()
                this._triggerAccountCbs('positions')
                await sleep(this.fetchInterval, sign)
            } catch (e) {
                this.awaitPositionsUpdateCb.entries().forEach(([callbacks, symbols]) => {
                    const [resolve, reject] = callbacks
                    reject(e as Error)
                    this.awaitPositionsUpdateCb.delete(callbacks)
                })
                logger.error('WatchPositions error: ', e)
                await sleep(this.errRestTime)
            }
        }
    }

    async watchPositions(symbols: string[] = []): Promise<(ccxt.Position & { leverage?: number })[]> {
        const method = 'fetchPositions'
        const linearSymbols: string[] = []
        const inverseSymbols: string[] = []
        new Set(symbols).forEach(symbol => {
            const cSymbol = checkSymbol(symbol)
            if (cSymbol.isLinear) {
                linearSymbols.push(symbol)
            } else {
                inverseSymbols.push(symbol)
            }
        })

        const requests: Promise<ccxt.Position[]>[] = []
        if (!symbols.length) {
            requests.push(
                (this.exchange as any)[method](undefined, { subType: MARKET_TYPES.LINEAR }) as Promise<ccxt.Position[]>,
                (this.exchange as any)[method](undefined, { subType: MARKET_TYPES.INVERSE }) as Promise<ccxt.Position[]>,
            )
        } else {
            if (linearSymbols.length) {
                requests.push(
                    (this.exchange as any)[method](linearSymbols, { subType: MARKET_TYPES.LINEAR }) as Promise<ccxt.Position[]>,
                )
            }
            if (inverseSymbols.length) {
                requests.push(
                    (this.exchange as any)[method](inverseSymbols, { subType: MARKET_TYPES.INVERSE }) as Promise<ccxt.Position[]>,
                )
            }
        }
        const result = await Promise.all(requests)
        return [...(result[0] || []), ...(result[1] || [])] as (ccxt.Position & { leverage?: number })[]
    }

    async fetchLeverages(_symbols: string | string[] = []): Promise<Record<string, number>> {
        const symbols = Array.isArray(_symbols) ? _symbols : [_symbols]
        const linearSymbols: string[] = []
        const inverseSymbols: string[] = []
        new Set(symbols).forEach(symbol => {
            const cSymbol = checkSymbol(symbol)
            if (cSymbol.isLinear) {
                linearSymbols.push(symbol)
            } else {
                inverseSymbols.push(symbol)
            }
        })
        const result = await Promise.all([
            linearSymbols.length ? (this.exchange as any).fetchLeverages(linearSymbols, { subType: MARKET_TYPES.LINEAR }) as Promise<Record<string, number>> : Promise.resolve({}),
            inverseSymbols.length ? (this.exchange as any).fetchLeverages(inverseSymbols, { subType: MARKET_TYPES.INVERSE }) as Promise<Record<string, number>> : Promise.resolve({}),
        ])
        const leverages = result.reduce((a, b) => ({ ...a, ...b }), {})
        // if (!Array.isArray(_symbols)) {
        //     return { [_symbols]: leverages[_symbols] || 0 }
        // }
        return leverages
    }

    async startWatchOrders(): Promise<void> {
        orderWatcher.onOrdersUpdate(({ ordersGroupByExchange }) => {
            const ordersData = ordersGroupByExchange[this.exchangeName]
            this.orders = ordersData ? {
                spot: ordersData.spot.orders || [],
                linear: ordersData.linear.orders || [],
                inverse: ordersData.inverse.orders || [],
            } : {
                spot: [],
                linear: [],
                inverse: [],
            }
            this._triggerAccountCbs('orders')
        })
    }

    _triggerAccountCbs(key: 'balance' | 'positions' | 'orders' | 'twapOrders'): void {
        if (!key) return
        this.accountCbMap.forEach(cb => cb({ [key]: this[key] as any }))
    }

    async startWatchTickers(): Promise<void> {
        while (true) {
            try {
                const sign = Date.now()
                const symbols = [
                    ...Array.from(this.tickersCbSymbolMap.values()),
                    ...Array.from(this.awaitTickersUpdateCb.values())
                ].flat()
                // console.log('ticker symbols', symbols)
                const tickers = await this.watchTickers(symbols)
                this.tickers = tickers
                // console.log('watchTickers', new Date().toLocaleTimeString(), Object.entries(tickers).length)
                this.tickersCbSymbolMap.forEach((cbSymbols, cb) => {
                    const r = cbSymbols.reduce((a, b) => Object.assign(a, { [b]: tickers[b] }), {} as Record<string, Ticker>)
                    cb(r)
                })
                this.awaitTickersUpdateCb.entries().forEach(([callbacks, symbols]) => {
                    const [resolve, reject] = callbacks
                    const r = symbols.reduce((a, b) => tickers[b] ? a.concat(tickers[b]) : a, [] as Ticker[])
                    // console.log('awaitTickersUpdateCb', symbols, r)
                    if (r.length !== symbols.length) {
                        // 不完整，等待下次更新
                    } else {
                        resolve(r)
                        this.awaitTickersUpdateCb.delete(callbacks)
                    }
                })
                await sleep(this.fetchInterval, sign)
            } catch (e) {
                this.awaitTickersUpdateCb.entries().forEach(([callbacks, symbols]) => {
                    const [resolve, reject] = callbacks
                    reject(e as Error)
                    this.awaitTickersUpdateCb.delete(callbacks)
                })
                logger.error('WatchTickers error: ', e)
                await sleep(this.errRestTime)
            }
        }
    }

    async watchTickers(symbols: (string | string[])[]): Promise<Record<string, Ticker>> {
        const method = 'fetchTickers'
        const symbolsNeedWatch = {
            spot: new Set<string>(),
            linear: new Set<string>(),
            inverse: new Set<string>(),
        }

        symbols.forEach((cbSymbols) => {
            (Array.isArray(cbSymbols) ? cbSymbols : [cbSymbols]).forEach((symbol) => {
                if (!this.exchange.markets[symbol]) return
                const cSymbol = checkSymbol(symbol)
                if (cSymbol.isSpot) {
                    symbolsNeedWatch.spot.add(symbol)
                } else if (cSymbol.isLinear) {
                    symbolsNeedWatch.linear.add(symbol)
                } else {
                    symbolsNeedWatch.inverse.add(symbol)
                }
            })
        })

        const sign = Date.now()
        const typedTickers = await Promise.all(Object.entries(symbolsNeedWatch).map(async ([key, value]) => {
            const symbolArray = Array.from(value)
            if (!symbolArray.length) {
                await sleep(this.fetchInterval, sign)
                return {}
            }
            return await (this.exchange as any)[method](symbolArray, {
                type: key === 'spot' ? key : undefined,
                subType: key !== 'spot' ? key : undefined,
            }) as Record<string, Ticker>
        }))
        const result = typedTickers.reduce((a, b) => ({ ...a, ...b }), {})
        return result
    }

    onTickersUpdate(symbols: string[] = [], cb: TickersCallback): () => void {
        this.tickersCbSymbolMap.set(cb, Array.from(new Set(symbols)))
        return () => {
            this.tickersCbSymbolMap.delete(cb)
        }
    }

    onPositionsUpdate(cb: PositionsCallback): () => void {
        if (this.positions?.length) {
            process.nextTick(() => cb(this.positions))
        }
        this.positionsCbMap.add(cb)
        return () => {
            this.positionsCbMap.delete(cb)
        }
    }

    onAccountUpdate(cb: AccountCallback): () => void {
        process.nextTick(() => cb({
            balance: this.balance as any,
            positions: this.positions,
            orders: this.orders,
            twapOrders: this.twapOrders,
            TESTNET: this.TESTNET,
        }))
        // console.log(this.orders)
        this.accountCbMap.add(cb)
        return () => {
            this.accountCbMap.delete(cb)
        }
    }

    async awaitTickersUpdate(_symbols: string | string[] = [], needRefresh: boolean = false): Promise<Ticker | Ticker[]> {
        return withTimeout(new Promise<Ticker | Ticker[]>((_res, rej) => {
            const symbols = Array.isArray(_symbols) ? _symbols : [_symbols]
            const res = (r: Ticker[]) => {
                if (!Array.isArray(_symbols)) {
                    _res(r[0])
                } else {
                    _res(r)
                }
            }
            if (!needRefresh) {
                // console.log(Object.keys(this.tickers))
                const r = symbols.reduce((a, b) => this.tickers[b] ? a.concat(this.tickers[b]) : a, [] as Ticker[])
                if (r.length === symbols.length && (Date.now() - (r[0]?.timestamp || Infinity)) < (this.fetchInterval * 1.5)) {
                    res(r)
                    return
                }
            }
            this.awaitTickersUpdateCb.set([res, rej], symbols)
        }), 1000 * 10)
    }

    async awaitPositionsUpdate(_symbols: string | string[] = [], needRefresh: boolean = false): Promise<ccxt.Position | ccxt.Position[]> {
        return withTimeout(new Promise<ccxt.Position | ccxt.Position[]>((_res, rej) => {
            const symbols = Array.isArray(_symbols) ? _symbols : [_symbols]
            const res = (r: ccxt.Position[]) => {
                if (!Array.isArray(_symbols)) {
                    _res(r[0])
                } else {
                    _res(r)
                }
            }
            if (!needRefresh) {
                const r = this.positions.filter(pos => symbols.includes(pos.symbol))
                if (r.length === symbols.length && (Date.now() - (r[0]?.timestamp || Infinity)) < (this.fetchInterval * 1.5)) {
                    res(r)
                    return
                }
            }
            this.awaitPositionsUpdateCb.set([res, rej], symbols)
        }), 1000 * 10)
    }

    updateTWAPOrder(order: TWAPOrder): void {
        this.twapOrders[order.symbol] = order
        this._triggerAccountCbs('twapOrders')
    }

    getTWAPOrder(symbol: string): TWAPOrder | undefined {
        return this.twapOrders[symbol]
    }

    closeTWAPOrder(symbol: string): void {
        delete this.twapOrders[symbol]
        this._triggerAccountCbs('twapOrders')
    }

    toggleTWAPOrder(symbol: string): void {
        if (!this.twapOrders[symbol]) {
            throw new Error('TWAP订单不存在!')
        }
        if (this.twapOrders[symbol].state === ORDER_STATES.OPENING) {
            this.twapOrders[symbol].state = ORDER_STATES.STOPED
        } else {
            this.twapOrders[symbol].state = ORDER_STATES.OPENING
        }
        this._triggerAccountCbs('twapOrders')
    }
}

function getExchangeMonitor(exchange: Exchange): ExchangeModel | undefined {
    if (!exchangeModels[exchange]) {
        if (!SUPPORTED_EXCHANGES.includes(exchange)) {
            console.error(`Exchange ${exchange} not supported yet!!!`)
            return undefined
        }
        exchangeModels[exchange] = new ExchangeModel(exchange)
    }
    return exchangeModels[exchange]
}

async function initExchangeMonitor(exchange: Exchange): Promise<ExchangeModel> {
    const exchangeMonitor = getExchangeMonitor(exchange)
    if (!exchangeMonitor) {
        throw new Error(`Exchange ${exchange} not supported`)
    }
    return exchangeMonitor.init()
}

export {
    initExchangeMonitor,
    getExchangeMonitor,
}

