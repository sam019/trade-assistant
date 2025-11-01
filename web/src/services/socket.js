import { io } from "socket.io-client"
import { ElMessage } from 'element-plus'

import { wsURL } from '../config'

const API_TIMEOUT = 10 * 1000

class Socket {
    constructor() {
        this.connected = false
        this.inited = false
        this.tickerSubCb = null
        this.accountSubCb = null
        this.exchange = null
        this.symbols = null
        this.tickerUpdateCbs = new Map()
        this.accountUpdateCbs = new Set()
        document.addEventListener('visibilitychange', async () => {
            if (document.visibilityState === 'hidden') {
                if (this.socket) {
                    this.socket.close()
                    this.socket = null
                    // this.connected = false
                }
            }
            if (document.visibilityState === 'visible') {
                if (this.inited && !this.connected) {
                    await this.connect()
                    this.recoverSubscribe()
                }
                
            }
        })
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
            console.log('connect')
            this.connected = true
            this.inited = true
            res()
        })
        this.socket.on('disconnect', () => {
            console.log('disconnect')
            this.connected = false
            if (document.visibilityState === 'visible') {
                ElMessage.error('连接已断开')
            }
        })
        this.socket.io.on('reconnection_attempt ', () => {
            console.log('reconnection_attempt')
        })
        this.socket.io.on('reconnect_error', () => {
            console.log('reconnect_error')
        })
        this.socket.io.on('reconnect_failed', () => {
            console.log('reconnect_failed')
        })
        this.socket.io.on('reconnect', () => {
            console.log('reconnect')
            this.connected = true
            this.recoverSubscribe()
        })
        
        return promise
    }

    recoverSubscribe() {
        if (!this.connected) return
        if (this.tickerSubCb) {
            this.subscribeTickers(this.exchange, this.symbols, this.tickerSubCb)
        }
        if (this.accountSubCb) {
            this.subscribeAccount(this.exchange, this.accountSubCb)
        }
        ElMessage.success('连接已恢复')
    }

    post(path, data) {
        let res, rej
        const promise = new Promise((_res, _rej) => {
            res = _res
            rej = _rej
        })
        this.socket.timeout(API_TIMEOUT).emit(path, data, (err, response) => err ? rej(err) : res(response))
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