export function getPrecisionLength(decimal = 0) {
    return (Number(decimal) + 1).toString().split('.')[1]?.length || 0
}

export function checkSymbol(symbol) {
    const match = /(\w+)\/(\w+):?(\w+)?/.exec(symbol || 0)
    if (!match) {
        throw new Error('invalid symbol')
    }
    const cSymbol = {
        isSpot: !match[3],
        isLinear: match[3] === match[2],
        isInverse: match[3] === match[1],
        base: match[1],
        quote: match[2],
    }
    if (cSymbol.isLinear) {
        cSymbol.contractBase = cSymbol.base
        cSymbol.contractQuote = cSymbol.quote
    } else if (cSymbol.isInverse) {
        cSymbol.contractBase = cSymbol.quote
        cSymbol.contractQuote = cSymbol.base
    }
    return cSymbol
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

export function withTimeout(promise, ms, timeoutError = new Error('Promise timed out')) {
    const timeout = new Promise((resolve, reject) => {
        setTimeout(() => reject(timeoutError), ms)
    })

    return Promise.race([promise, timeout])
}