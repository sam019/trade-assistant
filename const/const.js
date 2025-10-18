export const MARKET_TYPES = {
    SPOT: 'spot',
    LINEAR: 'linear',
    INVERSE: 'inverse'
}

export const ORDER_TYPES = {
    MARKET: 'market',
    SLTP: 'sltp'
};

export const MARGIN_MODES = {
    CROSS: 'cross',
    ISOLATED: 'isolated'
};

export const ORDER_SIDES = {
    BUY: 'buy',
    SELL: 'sell'
};

export const ORDER_AMOUNT_TYPES = {
    BASE: 'base',
    QUOTE: 'quote',
    CONTRACT: 'contract'
};

export const POSITION_SIDES = {
    LONG: 'long',
    SHORT: 'short'
};

export const EXCHANGES = {
    BINANCE: 'binance'
};

export const STABLE_COINS = {
    USDT: 'USDT',
    USDC: 'USDC'
};

export const ORDER_STATES = {
    OPENING: 'opening',
    RESOLVED: 'resolved',
    CLOSED: 'closed',
};

// [MARKET_TYPES, ORDER_TYPES, MARGIN_MODES, ORDER_SIDES, ORDER_AMOUNT_TYPES, POSITION_SIDES, EXCHANGES].forEach(item => Object.freeze(item));

export default Object.freeze({ MARKET_TYPES, ORDER_TYPES, MARGIN_MODES, ORDER_SIDES, ORDER_AMOUNT_TYPES, POSITION_SIDES, EXCHANGES, STABLE_COINS, ORDER_STATES });