import * as ccxt from 'ccxt'
import _ from 'lodash-es'
import fs from 'fs'

import orderWatcher from './orderMonitor.js'
import { SUPPORTED_EXCHANGES } from '../config.js'
import { MARKET_TYPES } from '../../../share/const.js'
import { checkSymbol, sleep, isDev } from '../../../share/utils.js'
import logger from '../logger.js'

const exchangeModels = {}

class ExchangeModel {
    constructor(exchange) {
        // console.log('process.env.NODE_ENV', process.env.NODE_ENV)
        this.TESTNET = !!process.env.TESTNET
        this.fetchInterval = 1000
        this.errRestTime = 5000

        const config = {
            enableRateLimit: true,
            options: {
                // defaultType: 'future'
            },
        }
        if (isDev()) {
            Object.assign(config, {
                // verbose: true,
                httpsProxy: process.env.HTTP_PROXY,
                wssProxy: process.env.WS_PROXY,
                apiKey: process.env[`API_KEY_${exchange.toUpperCase()}`] || '',
                secret: process.env[`SECRET_KEY_${exchange.toUpperCase()}`] || '',
            })
        } else {
            Object.assign(config, {
                apiKey: fs.readFileSync(`/run/secrets/API_KEY_${exchange.toUpperCase()}`),
                secret: fs.readFileSync(`/run/secrets/SECRET_KEY_${exchange.toUpperCase()}`),
            })
        }
        // console.log(process.env[`SECRET_KEY_${exchange.toUpperCase()}`])
        this.exchange = new ccxt.pro[exchange](config)
        if (this.TESTNET) {
            // this.exchange.setSandboxMode(true)
            this.exchange.enableDemoTrading(true)
        }

        this.exchangeName = exchange
        this.markets = {
            spot: [],
            linear: [],
            inverse: [],
        }
        this.tickers = {}
        // this.latestOriginTickers = [];
        this.symbolsNeedWatch = new Set()
        this.balance = {
            spot: {},
            linear: {},
            inverse: {},
        }
        this.positions = []
        this.positionSymbols = []
        this.leverages = []
        this.orders = []
        this.tickersCbSymbolMap = new Map() // 保存onTickersUpdate接收的订阅函数，key为回调函数，value为订阅的symbols
        this.awaitTickersUpdateCb = new Map() // 保存awaitTickersUpdate方法调用产生的promise，key为promise的[resolve，reject], value为symbols
        this.awaitPositionsUpdateCb = new Map() // 保存awaitPositionsUpdate方法调用产生的promise，key为promise的[resolve，reject], value为symbols
        this.accountCbMap = new Set() // 保存onAccountUpdate接收的订阅函数，item为回调函数
        this.positionsCbMap = new Set() // 保存onPositionsUpdate接收的订阅函数，item为回调函数
        // this.awaitAccountUpdateCb = new Set(); // 保存awaitAccountUpdate方法调用产生的promise，item为promise的[resolve，reject]
    }
    async init() {
        await this.loadmarkets()
        // console.log('accountsByType', this.exchange.options['accountsByType'])
        // console.log('exhcange options', this.exchange.options)
        // this.exchange.verbose = true; // for debug purpose set it to true
        // this.exchange.fetchAccounts().then(r => console.log(r))
        // console.log(1)
        this.startWatchOrders()
        // console.log(2)
        this.startWatchBalance()
        // console.log(this.exchange.markets)
        // console.log(3)
        this.startWatchPositions()
        // console.log(4)
        this.startWatchTickers()
        return this
    }
    async loadmarkets() {
        try {
            await this.exchange.loadMarkets()
        } catch (e) {
            logger.error('loadmarkets error: ', e.message)
            await sleep(this.errRestTime)
            this.loadmarkets()
        }
        
        // console.log(this.exchange.markets)

        Object.values(this.exchange.markets || {}).forEach(market => {
            // console.log(market.info.contractType)
            // if (market.info.contractType === 'PERPETUAL') {
            //     console.log(market)
            // }
            if (!market.active) return
            if (market.spot) {
                this.markets.spot.push(market)
            } else if (market.swap) {
                // console.log(market.expiry ? 'not perp'  : 'perp', market)
                if (market.inverse) {
                    this.markets.inverse.push(market)
                } else {
                    this.markets.linear.push(market)
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
        // console.log(this.markets)
    }

    async startWatchBalance() {
        // this.watchBalance('spot')
        // this.watchBalance('future')
        // this.watchBalance('future', 'linear')
        // this.watchBalance('future', 'inverse')
        while (true) {
            try {
                const sign = Date.now()
                const result = await Promise.all([this.watchBalance('spot'), this.watchBalance('future', 'linear'), this.watchBalance('future', 'inverse')])
                const balance = {}
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
                logger.error('startWatchBalance error: ', e.message)
                await sleep(this.errRestTime)
            }
        }
    }

    async watchBalance(type = 'spot', subType = undefined) {
        // const method = this.TESTNET ? 'fetchBalance' : 'startWatchBalance'
        // const method = 'watchBalance'
        // const method = 'fetchBalanceWs'
        const method = 'fetchBalance'
        // console.log('watchBalance', 'start')
        // const sign = Date.now()
        const balance = await this.exchange[method]({
            type,
            subType,
        })
        // console.log('watchBalance', balance)
        delete balance.timestamp
        delete balance.datetime
        delete balance.info
        return balance
    }

    async startWatchPositions() {
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
                // console.log('startWatchPositions', this.positions)
                this.awaitPositionsUpdateCb.entries().forEach(([cb, symbols]) => {
                    const r = this.positions.filter(pos => symbols.includes(pos.symbol))
                    // console.log('awaitPositionsUpdateCb', symbols, r)
                    cb[0](r)
                    this.awaitPositionsUpdateCb.delete(cb)
                })
                this._triggerPositionsCbs()
                this._triggerAccountCbs('positions')
                // console.log('watch pos sleep', sign)
                await sleep(this.fetchInterval, sign)
                // if (this.TESTNET) {
                //     await sleep(this.fetchInterval, sign)
                // }
            } catch (e) {
                this.awaitPositionsUpdateCb.entries().forEach(([cb]) => {
                    // console.log('awaitTickersUpdateCb error', cb[1])
                    cb[1](e)
                    this.awaitPositionsUpdateCb.delete(cb)
                })
                // throw e;
                logger.error('startWatchPositions error: ', e.message)
                await sleep(this.errRestTime)
            }
        }
    }

    async watchPositions(symbols = []) {
        // const method = this.TESTNET ? 'fetchPositions' : 'watchPositions'
        const method = 'fetchPositions'
        const linearSymbols = []
        const inverseSymbols = []
        new Set(symbols).forEach(symbol => {
            const cSymbol = checkSymbol(symbol)
            if (cSymbol.isLinear) {
                linearSymbols.push(symbol)
            } {
                inverseSymbols.push(symbol)
            }
        })
        // return this.exchange[method]()
        let requests = []
        if (!symbols.length) {
            requests = [
                this.exchange[method](undefined, { subType: MARKET_TYPES.LINEAR }), // 传undefined查所有U本位仓位
                this.exchange[method](undefined, { subType: MARKET_TYPES.INVERSE }), // 传undefined查所有币本位仓位
            ]
        } else {
            if (linearSymbols.length) {
                requests.push(
                    this.exchange[method](linearSymbols, { subType: MARKET_TYPES.LINEAR }),
                )
            }
            if (inverseSymbols.length) {
                requests.push(
                    this.exchange[method](inverseSymbols, { subType: MARKET_TYPES.INVERSE }),
                )
            }
        }
        const result = await Promise.all(requests)
        // console.log('fetchPositions', result)
        return [...result[0], ...result[1]]
    }

    async fetchLeverages(symbols = []) {
        const linearSymbols = []
        const inverseSymbols = []
        new Set(symbols).forEach(symbol => {
            const cSymbol = checkSymbol(symbol)
            if (cSymbol.isLinear) {
                linearSymbols.push(symbol)
            } else {
                inverseSymbols.push(symbol)
            }
        })
        const result = await Promise.all([
            linearSymbols.length && this.exchange.fetchLeverages(linearSymbols, { subType: MARKET_TYPES.LINEAR }),
            inverseSymbols.length && this.exchange.fetchLeverages(inverseSymbols, { subType: MARKET_TYPES.INVERSE }),
        ])
        const leverages = result.reduce((a, b) => ({ ...a, ...b }), {})
        // console.log('fetchLeverages', leverages);
        return leverages
    }

    async startWatchOrders() {
        orderWatcher.onOrdersUpdate(({ ordersGroupByExchange }) => {
            // console.log('WatchOrders', ordersGroupByExchange[this.exchangeName])
            this.orders = ordersGroupByExchange[this.exchangeName] || {}
            this._triggerAccountCbs('orders')
        })
    }

    _triggerAccountCbs = _.throttle(function (key) {
        // console.log('_triggerAccountCbs', key, Object.keys(this[key]))
        this.accountCbMap.forEach(cb => cb({ [key]: this[key] }))
    }, 100)

    _triggerPositionsCbs = _.throttle(function () {
        // console.log('_triggerPositionsCbs', this.positionsCbMap)
        this.positionsCbMap.forEach(cb => cb(this.positions))
    }, 1000)
    
    async startWatchTickers() {
        while (true) {
            try {
                const sign = Date.now()
                const tickers = await this.watchTickers([...this.tickersCbSymbolMap.values(), ...this.awaitTickersUpdateCb.values()])
                this.tickers = tickers
                // console.log('tickers', Object.keys(tickers))
                // console.log('tickers update', new Date().toLocaleTimeString(), this.exchange.id, Object.entries(tickers).map(([k, t]) => [k, t.last]).length)
                // console.log(this.tickersCbSymbolMap)
                this.tickersCbSymbolMap.entries().forEach(([cb, cbSymbols]) => {
                    const r = cbSymbols.reduce((a, b) => Object.assign(a, { [b]: tickers[b] }), {})
                    // console.log('tickers cb', cbSymbols, Object.keys(r));
                    cb(r)
                })
                this.awaitTickersUpdateCb.entries().forEach(([cb, symbols]) => {
                    const r = symbols.reduce((a, b) => tickers[b] ? a.concat(tickers[b]) : a, [])
                    // console.log('awaitTickersUpdateCb', symbols, r)
                    if (r.length !== symbols.length) {
                        // cb[1](r);
                    } else {
                        cb[0](r)
                        this.awaitTickersUpdateCb.delete(cb)
                    }
                })
                await sleep(this.fetchInterval, sign)
            } catch (e) {
                this.awaitTickersUpdateCb.entries().forEach(([cb]) => {
                    // console.log('awaitTickersUpdateCb error', cb[1])
                    cb[1](e)
                    this.awaitTickersUpdateCb.delete(cb)
                })
                // if (e instanceof ccxt.NetworkError) {
                //     console.log(this.exchange.id, 'watchTickers failed due to a network error:', e.message)
                //     // retry or whatever
                // } else if (e instanceof ccxt.ExchangeError) {
                //     console.log(this.exchange.id, 'watchTickers failed due to exchange error:', e.message)
                //     // retry or whatever
                // } else {
                //     console.log(this.exchange.id, 'watchTickers failed with:', e.message)
                //     // retry or whatever
                // }
                logger.error('startWatchTickers error: ', e.message)
                await sleep(this.errRestTime)
            }
        }
    }
    async watchTickers(symbols) {
        // const method = this.TESTNET ? 'fetchTickers' : 'watchTickers'
        const method = 'fetchTickers'
        // console.log('check tickers for: ', symbols)
        const symbolsNeedWatch = {
            spot: new Set(),
            linear: new Set(),
            inverse: new Set(),
        }
        // console.log('tickersCbSymbolMap', this.tickersCbSymbolMap, this.tickersCbSymbolMap.values())

        symbols.forEach((cbSymbols) => {
            (Array.isArray(cbSymbols) ? cbSymbols : [cbSymbols]).forEach((symbol) => {
                const match = symbol.match(/(\w+)\/(\w+):?(\w+)?/)
                if (!match[3]) {
                    symbolsNeedWatch.spot.add(symbol)
                } else if (match[3] === match[2]) {
                    symbolsNeedWatch.linear.add(symbol)
                } else {
                    symbolsNeedWatch.inverse.add(symbol)
                }
            })
        })
        const sign = Date.now()
        const typedTickers = await Promise.all(Object.entries(symbolsNeedWatch).map(async ([key, value]) => {
            const symbols = Array.from(value)
            // console.log('typedTickers', key, symbols)

            if (!symbols.length) {
                await sleep(this.fetchInterval, sign)
                return {}
            }
            return await this.exchange[method](symbols, {
                type: key === 'spot' ? key : undefined,
                subType: key !== 'spot' ? key : undefined,
            })
        }))
        // console.log('result', typedTickers)
        const result = typedTickers.reduce((a, b) => ({ ...a, ...b }), {})
        // const result = typedTickers.reduce((a, b) => Object.assign(a, b), {});
        return result
    }

    onTickersUpdate(symbols = [], cb) {
        this.tickersCbSymbolMap.set(cb, Array.from(new Set(symbols)))
        return () => {
            this.tickersCbSymbolMap.delete(cb)
        }
    }
    onPositionsUpdate(cb) {
        process.nextTick(() => this.positions && cb(this.positions))
        this.positionsCbMap.add(cb)
        return () => {
            this.positionsCbMap.delete(cb)
        }
    }
    onAccountUpdate(cb) {
        process.nextTick(() => cb({
            balance: this.balance,
            positions: this.positions,
            orders: this.orders,
        }))
        this.accountCbMap.add(cb)
        return () => {
            this.accountCbMap.delete(cb)
        }
    }

    async awaitTickersUpdate(symbols = [], needRefresh = false) {
        if (!needRefresh) {
            const r = symbols.reduce((a, b) => this.tickers[b] ? a.concat(this.tickers[b]) : a, [])
            // console.log('awaitTickersUpdate', symbols, r)
            if (r.length === symbols.length && (Date.now() - (r[0]?.timestamp || Infinity)) < 1000) {
                return r
            }
        }
        
        let res, rej
        const promise = new Promise((_res, _rej) => {
            res = _res
            rej = _rej
        })
        this.awaitTickersUpdateCb.set([res, rej], symbols)
        return promise
    }

    async awaitPositionsUpdate(symbols = [], needRresh = false) {
        if (!needRresh) {
            const r = this.positions.filter(pos => symbols.includes(pos.symbol))
            // console.log('awaitTickersUpdate', symbols, r)
            if (r.length === symbols.length && (Date.now() - (r[0]?.timestamp || Infinity)) < 1000) {
                return r
            }
        }
        
        let res, rej
        const promise = new Promise((_res, _rej) => {
            res = _res
            rej = _rej
        })
        this.awaitPositionsUpdateCb.set([res, rej], symbols)
        return promise
    }

    // async awaitAccountUpdate() {}
}

function getExchangeMonitor(exchange) {
    if (!exchangeModels[exchange]) {
        if (!SUPPORTED_EXCHANGES.includes(exchange)) {
            console.error(`Exchange ${exchange} not supported yet!!!`)
            return
        }
        exchangeModels[exchange] = new ExchangeModel(exchange)
        // console.log(exchangeModels[exchange].exchange.has['fetchPositions'])
        // exchangeModels[exchange].exchange.fetchPositions().then(r => console.log(r))
    }
    return exchangeModels[exchange]
}

function initExchangeMonitor(exchange) {
    const exchangeMonitor = getExchangeMonitor(exchange)
    return exchangeMonitor.init()
}

export {
    initExchangeMonitor,
    getExchangeMonitor,
}