import os from 'os'

import ccxt from 'ccxt'

import { EXCHANGES } from 'share/const.js'

// export function getPrecisionAndLimit(market, lastPrice) {
//     const basePrecision = getPrecisionLength(market.precision.amount)
//     const quotePrecision = getPrecisionLength(market.precision.price)
//     const minBase = Math.min(market.limits.amount.min, new Decimal(market.limits.cost.min).div(lastPrice).toDecimalPlaces(basePrecision).toNumber())
//     const minQuote = Math.min(market.limits.cost.min, new Decimal(market.limits.amount.min).mul(lastPrice).toDecimalPlaces(quotePrecision).toNumber())
//     return {
//         basePrecision,
//         quotePrecision,
//         minBase,
//         minQuote,
//     }
// }

export function getLocalIpAddress() {
    const networkInterfaces = os.networkInterfaces()
    let localIpAddress = null

    for (const interfaceName in networkInterfaces) {
        const networkInterface = networkInterfaces[interfaceName]
        for (const details of networkInterface) {
            // Look for an IPv4 address that is not internal (loopback)
            if (details.family === 'IPv4' && !details.internal) {
                localIpAddress = details.address
                break // Found the address, no need to check further
            }
        }
        if (localIpAddress) {
            break // Found the address, no need to check other interfaces
        }
    }
    return localIpAddress
}

export function isTESTNET() {
    return (process.env.TESTNET || '').toUpperCase() === 'TRUE'
}

export function parseError(e) {
    // e.message: binance { "code": -2019, "message": "Margin is insuffcient" }
    const blankIndex = e.message.indexOf(' ') // ccxt返回的错误格式，第一个空格前是交易所名，后面是交易所返回的错误对象string
    const exchange = e.message.substr(0, blankIndex)
    const info = JSON.parse(e.message.substr(blankIndex + 1))
    return {
        exchange,
        ...info,
    }
}

export function isMarginInsufficientErr(e) {
    if (!(e instanceof ccxt.ExchangeError)) {
        return false
    }
    const data = parseError(e)
    if (data.exchange === EXCHANGES.BINANCE) {
        return data.code === -2019
    }
    return false
}