import { Hono } from 'hono'

import { favouriteMarketsModel } from "../database/db.js"
import { getExchangeMonitor  } from '../monitor/exchangeMonitor.js'
import { sleep } from 'share/utils.js'

const app = new Hono()

class FavoriteMarketsMonitor {
    async init() {
        this.markets = await favouriteMarketsModel.find()
        favouriteMarketsModel.watch().on('change', async (change) => {
            // console.log('favouriteMarkets change', change);
            // 订单变化时更新
            this.markets = await favouriteMarketsModel.find()
        })
    }
}

const favoriteMarketsMonitor = new FavoriteMarketsMonitor()
favoriteMarketsMonitor.init()

/**
 * 
 * @param {*} c body: { exchange: 'binance', keywords: 'BTC' }
 * @returns 
 */
app.post('/search', async function searchMarkets(c) {
    const body = await c.req.json()
    let { exchange, keywords = '', refreshMarket = false } = body
    keywords = keywords.trim().toLowerCase()
    // console.log(exchange, keywords, refreshMarket)
    const exchangeMonitor = getExchangeMonitor(exchange)
    if (refreshMarket) {
        await exchangeMonitor.loadmarkets()
    }
    const markets = exchangeMonitor.markets
    const limit = 10
    const matchMarket = {}
    const favMarkets = favoriteMarketsMonitor.markets
    // console.log('favMarkets', favMarkets)

    if (!keywords) {
        // 如果没传关键字，就返回收藏的交易对
        // favMarkets.map(favMarket)
        Object.entries(markets).forEach(([type, typeMarkets]) => {
            matchMarket[type] = []
            for (const market of typeMarkets) {
                if (favMarkets.some(favMarket => favMarket.symbol === market.symbol)) {
                    matchMarket[type].push({ ...market, isFavorite: true })
                }
            }
            if (matchMarket[type].length < limit) {
                // 收藏交易对不足10个，就补齐
                for (const market of typeMarkets) {
                    if (matchMarket[type].every(m => m.symbol !== market.symbol)) {
                        matchMarket[type].push({ ...market })
                        if (matchMarket[type].length === limit) break
                    }
                }
            }
        })
    } else {
        Object.entries(markets).forEach(([type, typeMarkets]) => {
            matchMarket[type] = []
            for (const market of typeMarkets) {
                if (market.symbol.toLowerCase().includes(keywords)) {
                    market.isFavorite = favMarkets.some(favMarket => favMarket.symbol === market.symbol)
                    matchMarket[type].push(market)
                    if (matchMarket[type].length === limit) break
                }
            }
        })
    }

    // console.log(markets);
    // Object.values(markets).filter(market => market.symbol.includes(keywords))
    return c.json(matchMarket)
})

app.post('/get', async function getrMarket(c) {
    const body = await c.req.json()
    const { exchange, symbol } = body
    while (true) {
        const markets = getExchangeMonitor(exchange).exchange?.markets
        const market = markets && markets[symbol]
        if (market) {
            // console.log('get market', market)
            return c.json(market)
        }
        await sleep(1000)
    }
})

app.post('/addFavorite', async function addFavoriteMarket(c) {
    const body = await c.req.json()
    const { exchange, symbol } = body
    const existing = await favouriteMarketsModel.findOne({ exchange, symbol })
    if (existing) {
        return c.json({ error: 'Market already in favourites' }, 500)
    }
    const favMarket = new favouriteMarketsModel({ exchange, symbol })
    const result = await favMarket.save()
    return c.json(result)
})

app.post('/deleteFavorite', async function deleteFavoriteMarket(c) {
    const body = await c.req.json()
    const { exchange, symbol } = body
    const result = await favouriteMarketsModel.findOneAndDelete({ exchange, symbol })
    return c.json(result)
})

app.post('/listFavorite', async function listFavoriteMarkets(c) {
    const favMarkets = await favouriteMarketsModel.find()
    return c.json(favMarkets)
})

app.post('/getLeverage', async function getLeverage(c) {
    const body = await c.req.json()
    const { exchange, symbol } = body
    const exchangeMonitor = getExchangeMonitor(exchange)
    const result = await exchangeMonitor.fetchLeverages([symbol])
    // console.log('getLeverage', result)
    return c.json(Object.values(result)[0])
})

app.post('/setLeverage', async function getLeverage(c) {
    const body = await c.req.json()
    const { exchange, symbol, leverage } = body
    const exchangeMonitor = getExchangeMonitor(exchange)
    const result = await exchangeMonitor.exchange.setLeverage(leverage, symbol)
    // console.log('setLeverage', result)
    return c.json(result)
})

app.post('/getMarginMode', async function getMarginMode(c) {
    const body = await c.req.json()
    const { exchange, symbol } = body
    const exchangeMonitor = getExchangeMonitor(exchange)
    // console.log(exchangeMonitor.exchange.fetchMarginMode)
    const result = await exchangeMonitor.exchange.fetchMarginMode(symbol)
    // console.log('getMarginMode', result)
    return c.json(result)
})

app.post('/setMarginMode', async function setMarginMode(c) {
    const body = await c.req.json()
    const { exchange, symbol, mode } = body
    const exchangeMonitor = getExchangeMonitor(exchange)
    // console.log(exchangeMonitor.exchange.fetchMarginMode)
    const result = await exchangeMonitor.exchange.setMarginMode(mode, symbol)
    // console.log('setMarginMode', result)
    return c.json(result)
})

export default app