import { Hono } from 'hono'
import { favouriteMarketsModel } from "../database/db.js"
import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import { sleep } from 'share/utils.js'
import type { Market } from '../types/index.js'

const app = new Hono()

interface FavoriteMarket {
    _id: string
    exchange: string
    symbol: string
}

class FavoriteMarketsMonitor {
    inited = false
    markets: FavoriteMarket[] = []

    async init(): Promise<void> {
        this.markets = await favouriteMarketsModel.find()
        favouriteMarketsModel.onUpdate(async () => {
            this.markets = await favouriteMarketsModel.find()
        })
        this.inited = true
    }
    
    async getMarkets(): Promise<FavoriteMarket[]> {
        if (!this.inited) {
            await this.init()
        }
        return this.markets
    }
}

const favoriteMarketsMonitor = new FavoriteMarketsMonitor()

interface SearchMarketsBody {
    exchange: string
    keywords?: string
    refreshMarket?: boolean
}

interface MarketWithFavorite extends Market {
    isFavorite?: boolean
}

interface MatchMarket {
    spot: MarketWithFavorite[]
    linear: MarketWithFavorite[]
    inverse: MarketWithFavorite[]
}

app.post('/search', async function searchMarkets(c) {
    const body = await c.req.json() as SearchMarketsBody
    let { exchange, keywords = '', refreshMarket = false } = body
    keywords = keywords.trim().toLowerCase()
    
    const exchangeMonitor = getExchangeMonitor(exchange)
    if (!exchangeMonitor) {
        throw new Error(`Exchange ${exchange} not found`)
    }
    
    if (refreshMarket) {
        await exchangeMonitor.loadmarkets()
    }
    const markets = exchangeMonitor.markets
    const limit = 10
    const matchMarket: MatchMarket = {
        spot: [],
        linear: [],
        inverse: [],
    }
    const favMarkets = await favoriteMarketsMonitor.getMarkets()

    if (!keywords) {
        Object.entries(markets).forEach(([type, typeMarkets]) => {
            const typedMarkets = typeMarkets as Market[]
            const matchType = type as keyof MatchMarket
            matchMarket[matchType] = []
            
            for (const market of typedMarkets) {
                if (favMarkets.some(favMarket => favMarket.symbol === market.symbol)) {
                    matchMarket[matchType].push({ ...market, isFavorite: true })
                }
            }
            if (matchMarket[matchType].length < limit) {
                for (const market of typedMarkets) {
                    if (matchMarket[matchType].every(m => m.symbol !== market.symbol)) {
                        matchMarket[matchType].push({ ...market })
                        if (matchMarket[matchType].length === limit) break
                    }
                }
            }
        })
    } else {
        Object.entries(markets).forEach(([type, typeMarkets]) => {
            const typedMarkets = typeMarkets as Market[]
            const matchType = type as keyof MatchMarket
            matchMarket[matchType] = []
            
            for (const market of typedMarkets) {
                if (market.symbol.toLowerCase().includes(keywords)) {
                    const marketWithFavorite: MarketWithFavorite = {
                        ...market,
                        isFavorite: favMarkets.some(favMarket => favMarket.symbol === market.symbol)
                    }
                    matchMarket[matchType].push(marketWithFavorite)
                    if (matchMarket[matchType].length === limit) break
                }
            }
        })
    }

    return c.json(matchMarket)
})

app.post('/get', async function getMarket(c) {
    const body = await c.req.json() as { exchange: string; symbol: string }
    const { exchange, symbol } = body
    const exchangeMonitor = getExchangeMonitor(exchange)
    if (!exchangeMonitor) {
        throw new Error(`Exchange ${exchange} not found`)
    }
    
    while (true) {
        const markets = exchangeMonitor.exchange?.markets
        const market = markets && markets[symbol]
        if (market) {
            return c.json(market)
        }
        await sleep(1000)
    }
})

app.post('/addFavorite', async function addFavoriteMarket(c) {
    const body = await c.req.json() as { exchange: string; symbol: string }
    const { exchange, symbol } = body
    const existing = await favouriteMarketsModel.findOne({ exchange, symbol })
    if (existing) {
        return c.json({ error: 'Market already in favourites' }, 500)
    }
    const favMarket = await favouriteMarketsModel.create({ exchange, symbol })
    return c.json(favMarket)
})

app.post('/deleteFavorite', async function deleteFavoriteMarket(c) {
    const body = await c.req.json() as { exchange: string; symbol: string }
    const { exchange, symbol } = body
    await favouriteMarketsModel.findOneAndDelete({ exchange, symbol })
    return c.json({ success: true })
})

app.post('/listFavorite', async function listFavoriteMarkets(c) {
    const favMarkets = await favouriteMarketsModel.find()
    return c.json(favMarkets)
})

app.post('/getLeverage', async function getLeverage(c) {
    const body = await c.req.json() as { exchange: string; symbol: string }
    const { exchange, symbol } = body
    const exchangeMonitor = getExchangeMonitor(exchange)
    if (!exchangeMonitor) {
        throw new Error(`Exchange ${exchange} not found`)
    }
    const result = await exchangeMonitor.fetchLeverages(symbol)
    return c.json(result[symbol])
})

app.post('/setLeverage', async function setLeverage(c) {
    const body = await c.req.json() as { exchange: string; symbol: string; leverage: number }
    const { exchange, symbol, leverage } = body
    const exchangeMonitor = getExchangeMonitor(exchange)
    if (!exchangeMonitor) {
        throw new Error(`Exchange ${exchange} not found`)
    }
    const result = await (exchangeMonitor.exchange as any).setLeverage(leverage, symbol)
    return c.json(result)
})

app.post('/getMarginMode', async function getMarginMode(c) {
    const body = await c.req.json() as { exchange: string; symbol: string }
    const { exchange, symbol } = body
    const exchangeMonitor = getExchangeMonitor(exchange)
    if (!exchangeMonitor) {
        throw new Error(`Exchange ${exchange} not found`)
    }
    const result = await (exchangeMonitor.exchange as any).fetchMarginMode(symbol)
    return c.json(result)
})

app.post('/setMarginMode', async function setMarginMode(c) {
    const body = await c.req.json() as { exchange: string; symbol: string; mode: string }
    const { exchange, symbol, mode } = body
    const exchangeMonitor = getExchangeMonitor(exchange)
    if (!exchangeMonitor) {
        throw new Error(`Exchange ${exchange} not found`)
    }
    const result = await (exchangeMonitor.exchange as any).setMarginMode(mode, symbol)
    return c.json(result)
})

export default app

