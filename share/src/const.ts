export const MARKET_TYPES = {
    SPOT: 'spot',
    LINEAR: 'linear',
    INVERSE: 'inverse',
} as const

export const ORDER_TYPES = {
    MARKET: 'market',
    SLTP: 'sltp',
    CONDITION: 'condition',
    TWAP: 'twap',
} as const

export const MARGIN_MODES = {
    CROSS: 'cross',
    ISOLATED: 'isolated',
} as const

export const ORDER_SIDES = {
    BUY: 'buy',
    SELL: 'sell',
} as const

export const ORDER_AMOUNT_TYPES = {
    BASE: 'base',
    QUOTE: 'quote',
    CONTRACT: 'contract',
} as const

export const POSITION_SIDES = {
    LONG: 'long',
    SHORT: 'short',
} as const

export const EXCHANGES = {
    BINANCE: 'binance',
} as const

export const STABLE_COINS = {
    USDT: 'USDT',
    USDC: 'USDC',
} as const

export const ORDER_STATES = {
    OPENING: 'opening',
    RESOLVED: 'resolved',
    CLOSED: 'closed',
    SUSPEND: 'suspend',
    STOPED: 'stoped',
} as const

export const TWAP_INTERVAL = 6000

export type MarketType = typeof MARKET_TYPES[keyof typeof MARKET_TYPES]
export type OrderType = typeof ORDER_TYPES[keyof typeof ORDER_TYPES]
export type MarginMode = typeof MARGIN_MODES[keyof typeof MARGIN_MODES]
export type OrderSide = typeof ORDER_SIDES[keyof typeof ORDER_SIDES]
export type OrderAmountType = typeof ORDER_AMOUNT_TYPES[keyof typeof ORDER_AMOUNT_TYPES]
export type PositionSide = typeof POSITION_SIDES[keyof typeof POSITION_SIDES]
export type Exchange = typeof EXCHANGES[keyof typeof EXCHANGES]
export type StableCoin = typeof STABLE_COINS[keyof typeof STABLE_COINS]
export type OrderState = typeof ORDER_STATES[keyof typeof ORDER_STATES]

const Const = Object.freeze({ 
    MARKET_TYPES, 
    ORDER_TYPES, 
    MARGIN_MODES, 
    ORDER_SIDES, 
    ORDER_AMOUNT_TYPES, 
    POSITION_SIDES, 
    EXCHANGES, 
    STABLE_COINS, 
    ORDER_STATES 
})

export default Const


