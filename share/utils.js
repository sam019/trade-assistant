export function getPrecisionLength(decimal) {
    return (Number(decimal) + 1).toString().split('.')[1]?.length || 0
}

export function checkSymbol(symbol) {
    const match = /(\w+)\/(\w+):?(\w+)?/.exec(symbol || 0)
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
    return new Promise(res => setTimeout(() => res(), signTime ? time - (Date.now() - signTime) : time))
}