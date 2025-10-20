import * as ccxt from 'ccxt'
import _ from 'lodash-es'

import orderWatcher from './orderMonitor'
import { SUPPORTED_EXCHANGES } from '../config.js'
import { MARKET_TYPES } from '../../../share/const.js'

const exchangeModels = {}

class ExchangeModel {
    constructor(exchange) {
        // console.log('process.env.NODE_ENV', process.env.NODE_ENV)
        this._test = process.env.TESTNET
        this.fetchInterval = 500

        if (this._test) {
            // console.log('new ExchangeModel', exchange)
            this.exchange = new ccxt.pro[exchange]({
                enableRateLimit: true,
                httpsProxy: process.env.HTTP_PROXY,
                wssProxy: process.env.WS_PROXY,
                apiKey: process.env[`API_KEY_${exchange.toUpperCase()}`] || '',
                secret: process.env[`SECRET_KEY_${exchange.toUpperCase()}`] || '',
                // verbose: true,
                options: {
                    // defaultType: 'future'
                },
            })
            this.exchange.enableDemoTrading(true)
            // console.log(this.exchange.has['amountToPrecision '])
            // this.exchange.setSandboxMode(true)
            // console.log('setSandboxMode', exchange)
            // console.log(process.env[`SECRET_KEY_${exchange.toUpperCase()}`])

        } else {
            this.exchange = new ccxt.pro[exchange]({
                apiKey: process.env[`API_KEY_${exchange.toUpperCase()}`] || '',
                secret: process.env[`SECRET_KEY_${exchange.toUpperCase()}`] || '',
            })
        }
        // console.log('unWatchTickers', this.exchange.has['unWatchTickers'])
        this.exchangeName = exchange
        this.markets = {
            spot: [],
            linear: [],
            inverse: [],
        }
        // this.latestOriginTickers = [];
        this.tickersNeedWatch = new Set()
        this.balance = {
            spot: {},
            linear: {},
            inverse: {},
        }
        this.positions = []
        this.positionSymbols = []
        this.leverages = []
        this.orders = []
        // this.tickersWatcherRunning = false;
        this.tickersCbSymbolMap = new Map() // 保存onTickersUpdate接收的订阅函数，key为回调函数，value为订阅的symbols
        this.awaitTickersUpdateCb = new Map() // 保存awaitTickersUpdate方法调用产生的promise，key为promise的[resolve，reject], value为symbols
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
        this.startWatchBalance()
        // console.log(this.exchange.markets)
        this.startWatchPositions()
        this.startWatchOrders()
        this.startWatchTickers()
        return this
    }
    async loadmarkets() {
        try {
            await this.exchange.loadMarkets()
        } catch (e) {
            console.log(e)
            await new Promise((res) => setTimeout(res, 5000))
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
        this.watchBalance('spot')
        this.watchBalance('future', 'linear')
        this.watchBalance('future', 'inverse')
        // this.watchBalance('inverse');
    }

    async watchBalance(type = 'spot', subType = undefined) {
        const method = this._test ? 'fetchBalance' : 'startWatchBalance'
        // const method = 'startWatchBalance';
        // const method = 'watchAccount';
        if (this.exchange.has[method]) {
            while (true) {
                try {
                    // console.log('startWatchBalance', 'start')
                    const balance = await this.exchange[method]({
                        type,
                        subType,
                    })
                    delete balance.timestamp
                    delete balance.datetime
                    delete balance.info
                    const typeKey = subType ? subType : type
                    if (this._test) {
                        const isChanged = !_.isEqual(this.balance[typeKey], balance) // isChange一定会变，因为时间戳不一样
                        // console.log('isChanged', isChanged, Object.keys((this.balance || {})[subType ? subType : type] || {}), Object.keys(balance))
                        if (isChanged) {
                            this.balance[typeKey] = balance
                            // console.log(`watch balance ${typeKey}`)
                            this._triggerAccountCbs('balance')
                        }
                        await new Promise(r => setTimeout(r, this.fetchInterval))
                    } else {
                        this.balance[typeKey] = balance
                        this._triggerAccountCbs('balance')
                    }
                    // console.log('startWatchBalance', this.balance.BTC)
                    // await new Promise(r => setTimeout(r, 1000))
                    // this._triggerAccountCbs();
                } catch (e) {
                    // throw e;
                    console.error('startWatchBalance error', subType ? subType : type, e.message)
                    await new Promise(r => setTimeout(r, 5000))
                }
            }
        } else {
            console.log('exchange not support startWatchBalance', this.exchange.id)
        }
    }

    async startWatchPositions() {
        const method = this._test ? 'fetchPositions' : 'startWatchPositions'

        if (this.exchange.has[method]) {
            while (true) {
                try {
                    this.positions = await this.watchPositions()
                    // console.log('startWatchPositions', this.positions)
                    const positionSymbols = this.positions.map(pos => pos.symbol)
                    if (!_.isEqual(positionSymbols, this.positionSymbols)) {
                        this.positionSymbols = positionSymbols
                        this.leverages = await this.fetchLeverages(positionSymbols)
                    }
                    this.positions.forEach(pos => {
                        pos.leverage = this.leverages[pos.symbol]
                    })
                    this._triggerPositionsCbs()
                    this._triggerAccountCbs('positions')
                        
                    if (this._test) {
                        await new Promise(r => setTimeout(r, this.fetchInterval))
                    }
                } catch (e) {
                    // throw e;
                    console.log('startWatchPositions error', e.message)
                    await new Promise(r => setTimeout(r, 5000))
                }
            }
        } else {
            console.log('exchange not support startWatchPositions', this.exchange.id)
        }
    }

    async watchPositions(symbols = []) {
        const method = this._test ? 'fetchPositions' : 'watchPositions'
        const linearSymbols = []
        const inverseSymbols = []
        new Set(symbols).forEach(symbol => {
            const match = symbol.match(/(\w+)\/(\w+):?(\w+)?/)
            if (match[3] === match[2]) {
                linearSymbols.push(symbol)
            } else if (match[3] === match[1]) {
                inverseSymbols.push(symbol)
            }
        })
        const result = await Promise.all([linearSymbols, inverseSymbols].map((symbols, index) => this.exchange[method](!linearSymbols.length && !inverseSymbols.length ? undefined : symbols, { subType: index ? MARKET_TYPES.INVERSE : MARKET_TYPES.LINEAR })))
        // console.log('fetchPositions', result)
        return [...result[0], ...result[1]]
    }

    async fetchLeverages(symbols = []) {
        const linearSymbols = []
        const inverseSymbols = []
        new Set(symbols).forEach(symbol => {
            const match = symbol.match(/(\w+)\/(\w+):?(\w+)?/)
            if (match[3] === match[2]) {
                linearSymbols.push(symbol)
            } else if (match[3] === match[1]) {
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
            // console.log('ordersGroupByExchange[this.exchangeName]', ordersGroupByExchange, this.exchangeName);
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
                const tickers = await this.watchTickers([...this.tickersCbSymbolMap.values(), ...this.awaitTickersUpdateCb.values()])
                // console.log('tickers', Object.keys(tickers))
                console.log('tickers update', new Date().toLocaleTimeString(), this.exchange.id, Object.entries(tickers).map(([k, t]) => [k, t.last]).length)
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
                if (this._test) {
                    await new Promise(res => setTimeout(() => res(), this.fetchInterval))
                }
            } catch (e) {
                this.awaitTickersUpdateCb.entries().forEach(([cb]) => {
                    console.log('awaitTickersUpdateCb error', cb[1])
                    cb[1](e)
                    this.awaitTickersUpdateCb.delete(cb)
                })
                if (e instanceof ccxt.NetworkError) {
                    console.log(this.exchange.id, 'watchTickers failed due to a network error:', e.message)
                    // retry or whatever
                } else if (e instanceof ccxt.ExchangeError) {
                    console.log(this.exchange.id, 'watchTickers failed due to exchange error:', e.message)
                    // retry or whatever
                } else {
                    console.log(this.exchange.id, 'watchTickers failed with:', e.message)
                    // retry or whatever
                }
                await new Promise(rej => setTimeout(rej, 5000))
            }
        }
    }
    async watchTickers(symbols) {
        const method = this._test ? 'fetchTickers' : 'watchTickers'
        // console.log('check tickers for: ', symbols)
        const tickersNeedWatch = {
            spot: new Set(),
            linear: new Set(),
            inverse: new Set(),
        }
        // console.log('tickersCbSymbolMap', this.tickersCbSymbolMap, this.tickersCbSymbolMap.values())

        symbols.forEach((cbSymbols) => {
            (Array.isArray(cbSymbols) ? cbSymbols : [cbSymbols]).forEach((symbol) => {
                const match = symbol.match(/(\w+)\/(\w+):?(\w+)?/)
                if (!match[3]) {
                    tickersNeedWatch.spot.add(symbol)
                } else if (match[3] === match[2]) {
                    tickersNeedWatch.linear.add(symbol)
                } else {
                    tickersNeedWatch.inverse.add(symbol)
                }
            })
        })
        const typedTickers = await Promise.all(Object.entries(tickersNeedWatch).map(async ([key, value]) => {
            const symbols = Array.from(value)
            // console.log('typedTickers', key, symbols)

            if (!symbols.length) {
                return new Promise(res => setTimeout(() => res({}), this.fetchInterval))
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
    // async watchTickers(symbols = []) {
    //     this.tickersNeedWatch = symbols.reduce((a, b) => a.add(b), this.tickersNeedWatch);
    // }
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

    async awaitTickersUpdate(symbols = []) {
        let res, rej
        const promise = new Promise((_res, _rej) => {
            res = _res
            rej = _rej
        })
        this.awaitTickersUpdateCb.set([res, rej], symbols)
        return promise
    }

    // async awaitAccountUpdate() {}
}

function getExchangeMonitor(exchange) {
    if (!exchangeModels[exchange]) {
        if (!SUPPORTED_EXCHANGES.includes(exchange)) {
            throw new Error(`Exchange ${exchange} not supported yet!!!`)
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