// import Decimal from 'decimal.js'

export function getPrecisionLength(decimal = 0) {
    return (Number(decimal) + 1).toString().split('.')[1]?.length || 0
}

export function checkSymbol(symbol) {
    const match = /(\w+)\/(\w+):?(\w+)?/.exec(symbol || 0)
    if (!match) {
        throw new Error('invalid symbol')
    }
    return {
        isSpot: !match[3],
        isLinear: match[3] === match[2],
        isInverse: match[3] === match[1],
        base: match[1],
        quote: match[2],
        contract: match[3],
    }
}

export async function sleep(time = 0, signTime = 0) {
    // console.log('sleep', signTime ? time - (Date.now() - signTime) : time)
    const realTime = signTime ? time - (Date.now() - signTime) : time
    return new Promise(res => setTimeout(() => res(), realTime < 0 ? 0 : realTime))
}

export function isDev() {
    if (typeof global !== 'undefined') {
        return process.env.NODE_ENV !== 'production'
    }
    // console.log(import.meta.env.DEV)
    return import.meta.env.DEV
}

export function formatTimestamp(timestamp) {
    const d = new Date(timestamp)
    const date = d.toISOString().split('T')[0]
    const time = d.toTimeString().split(' ')[0].replace(/:/g, '-')
    return `${date} ${time}`
}

// export function isMobileDevice() {
//     const userAgentInfo = navigator.userAgent
//     // console.log(userAgentInfo)
//     const mobileKeywords = ["Mobi", "Android", "iPhone", "iPad", "iPod", "Windows Phone"]
//     for (let i = 0; i < mobileKeywords.length; i++) {
//         if (userAgentInfo.indexOf(mobileKeywords[i]) > -1) {
//             return true
//         }
//     }
//     return false
// }

export function isMobileDevice() {
    return location.hostname !== 'localhost'
}

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
