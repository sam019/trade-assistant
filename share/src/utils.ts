export interface CheckedSymbol {
    isSpot: boolean
    isLinear: boolean
    isInverse: boolean
    base: string
    quote: string
    contractBase?: string
    contractQuote?: string
}

export function getPrecisionLength(decimal: number | string = 0): number {
    return (Number(decimal) + 1).toString().split('.')[1]?.length || 0
}

export function checkSymbol(symbol: string | number): CheckedSymbol {
    const match = /(\w+)\/(\w+):?(\w+)?/.exec(String(symbol || 0))
    if (!match) {
        throw new Error('invalid symbol')
    }
    const cSymbol: CheckedSymbol = {
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

export async function sleep(time: number = 0, signTime: number = 0): Promise<void> {
    const realTime = signTime ? time - (Date.now() - signTime) : time
    return new Promise(resolve => setTimeout(() => resolve(), realTime < 0 ? 0 : realTime))
}

export function isDev(): boolean {
    if (typeof global !== 'undefined') {
        return process.env.NODE_ENV !== 'production'
    }
    // @ts-ignore - import.meta.env is available in Vite
    return import.meta.env.DEV
}

export function formatTimestamp(timestamp: number): string {
    const d = new Date(timestamp)
    const date = d.toISOString().split('T')[0]
    const time = d.toTimeString().split(' ')[0].replace(/:/g, '-')
    return `${date} ${time}`
}

export function isMobileDevice(): boolean {
    if (typeof location === 'undefined') {
        return false
    }
    return location.hostname !== 'localhost'
}

export function withTimeout<T>(
    promise: Promise<T>, 
    ms: number, 
    timeoutError: Error = new Error('Promise timed out')
): Promise<T> {
    const timeout = new Promise<never>((resolve, reject) => {
        setTimeout(() => reject(timeoutError), ms)
    })

    return Promise.race([promise, timeout])
}


