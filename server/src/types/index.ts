import type { 
    MarketType, 
    OrderType, 
    OrderSide, 
    OrderAmountType, 
    OrderState,
    Exchange,
    CheckedSymbol 
} from 'share/const.js'
import type ccxt from 'ccxt'

export interface Order {
    _id: string
    exchange: Exchange
    symbol: string
    type: OrderType
    slPrice?: number
    tpPrice?: number
    triggerPrice?: number
    withSLTP?: boolean
    side: OrderSide
    leverage?: number
    amount: number
    unit: OrderAmountType
    state: OrderState
    useTWAP?: boolean
    totalMinute?: number
    priceLimit?: number
    createdAt?: number
    updatedAt?: number
}

export interface OrdersGroupByExchange {
    [exchange: string]: {
        spot: {
            symbols: Set<string>
            orders: Order[]
        }
        linear: {
            symbols: Set<string>
            orders: Order[]
        }
        inverse: {
            symbols: Set<string>
            orders: Order[]
        }
    }
}

export interface CreateOrderParams {
    exchange: Exchange
    symbol: string
    type: OrderType
    side: OrderSide
    amount: number
    unit: OrderAmountType
    usePct?: boolean
    amountPct?: number
    useTWAP?: boolean
    totalMinute?: number
    priceLimit?: number
    withSLTP?: boolean
    reduceOnly?: boolean
    tpPrice?: number
    slPrice?: number
    triggerPrice?: number
    leverage?: number
    id?: string
    __direct?: boolean
    __params?: any
}

export interface Balance {
    [currency: string]: {
        free: number
        used: number
        total: number
    }
}

export interface ExchangeAccount {
    balance: {
        spot: Balance
        linear: Balance
        inverse: Balance
    }
    positions: ccxt.Position[]
    orders: {
        spot: Order[]
        linear: Order[]
        inverse: Order[]
    }
    twapOrders: {
        [symbol: string]: any
    }
    TESTNET: boolean
}

export interface Ticker extends ccxt.Ticker {
    symbol: string
    last?: number
    timestamp?: number
}

export interface Market extends ccxt.Market {
    symbol: string
}


