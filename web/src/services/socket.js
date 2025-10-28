import { io } from "socket.io-client"
import { wsURL } from '../config'

// const socket = io(apiURL);

const TIMEOUT = 10 * 1000

class Socket {
    constructor() {
        this.connected = false
        this.tickerSubCb = null
        this.accountSubCb = null
        this.exchange = null
        this.symbols = null
        this.tickerUpdateCbs = new Map()
        this.accountUpdateCbs = new Set()
        // this.socket.io.on('reconnect', () => {
        //     console.log('socket reconnect')
        //     if (this.tickerSubCb) {
        //         this.subscribeTickers(this.exchange, this.symbols, this.tickerSubCb)
        //     }
        //     if (this.accountSubCb) {
        //         this.subscribeAccount(this.exchange, this.accountSubCb)
        //     }
        // })
        
    }

    connect() {
        let res, rej
        const promise = new Promise((_res, _rej) => {
            res = _res
            rej = _rej
        })
        // console.log('connect apiURL: ', apiURL)
        this.socket = io(wsURL, {
            reconnectionDelayMax: 5000,
            withCredentials: true,
            // transports: ['websocket'],
        })
        this.socket.on('connect_error', (err) => rej(err))
        this.socket.on('connect', () => {
            console.log('connected')
            this.connected = true
            res()
        })
        return promise
    }

    post(path, data) {
        let res, rej
        const promise = new Promise((_res, _rej) => {
            res = _res
            rej = _rej
        })
        this.socket.timeout(TIMEOUT).emit(path, data, (err, response) => err ? rej(err) : res(response))
        return promise
    }

    subscribeTickers(exchange, symbols, cb) {
        if (!this.connected) return
        if (this.tickerSubCb) {
            this.socket.off('tickersUpdate')
        }
        this.tickerSubCb = cb
        this.exchange = exchange
        this.symbols = symbols
        // this.lastTickerParams = { exchange, symbols };
        this.socket.emit('subscribeTickers', { exchange, symbols })
        this.socket.on('tickersUpdate', cb)
    }
    unsubscribeTickers() {
        if (!this.connected) return
        this.socket.emit('unsubscribeTickers', { exchange: this.exchange })
        this.socket.off('tickersUpdate')
        this.tickerSubCb = null
        this.symbols = null
    }
    subscribeAccount(exchange, cb) {
        if (!this.connected) return
        if (this.accountSubCb) {
            this.socket.off('accountUpdate')
        }
        this.accountSubCb = cb
        this.exchange = exchange
        this.socket.emit('subscribeAccount', { exchange })
        this.socket.on('accountUpdate', cb)
    }
    unsubscribeAccount() {
        if (!this.connected) return
        this.socket.emit('unsubscribeAccount', { exchange: this.exchange })
        this.socket.off('accountUpdate')
        this.accountSubCb = null
    }
    // unsubscribe
}

const socket = new Socket()

export default socket