export function getPrecisionLength(decimal) {
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
    return import.meta.env.NODE_ENV  !== 'production'
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