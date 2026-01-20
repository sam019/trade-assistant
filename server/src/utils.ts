import os from 'os'
import ccxt from 'ccxt'
import { EXCHANGES, type Exchange } from 'share/const.js'

export function getLocalIpAddress(): string | null {
    const networkInterfaces = os.networkInterfaces()
    let localIpAddress: string | null = null

    for (const interfaceName in networkInterfaces) {
        const networkInterface = networkInterfaces[interfaceName]
        if (!networkInterface) continue
        for (const details of networkInterface) {
            if (details.family === 'IPv4' && !details.internal) {
                localIpAddress = details.address
                break
            }
        }
        if (localIpAddress) {
            break
        }
    }
    return localIpAddress
}

export function isTESTNET(): boolean {
    return (process.env.TESTNET || '').toUpperCase() === 'TRUE'
}

export interface ParsedError {
    exchange: Exchange
    code?: number
    message?: string
    [key: string]: any
}

export function parseError(e: Error): ParsedError {
    const blankIndex = e.message.indexOf(' ')
    const exchange = e.message.substr(0, blankIndex) as Exchange
    const info = JSON.parse(e.message.substr(blankIndex + 1))
    return {
        exchange,
        ...info,
    }
}

export function isMarginInsufficientErr(e: unknown): boolean {
    if (!(e instanceof ccxt.ExchangeError)) {
        return false
    }
    const data = parseError(e)
    if (data.exchange === EXCHANGES.BINANCE) {
        return data.code === -2019
    }
    return false
}


