import { getExchangeMonitor } from "../monitor/exchangeMonitor"

class SubscribtionManager {
    get(...params) {
        return params.reduce((a, b) => a && a[b], this)
    }
    set(...params) {
        const value = params.pop()
        return params.reduce((a, b, i) => {
            if (i === params.length - 1) {
                a[b] = value
                return this
            }
            if (!a[b]) {
                a[b] = {}
            }
            return a[b]
        }, this)
    }
    unsubscribeAll() {
        Object.values(this).forEach(subscribtion => {
            if (typeof subscribtion === 'function') {
                subscribtion()
            } else if (typeof subscribtion === 'object') {
                Object.values(subscribtion).forEach(fn => fn && fn())
            }
        })
        Object.keys(this).forEach(key => delete this[key])
    }
}

// websocket处理
export default function socketHandler(socket) {
    // 对每个socket连接，维护一个订阅管理器
    const subscribtionManager = new SubscribtionManager()

    socket.on('subscribeAccount', (data, cb) => {
        const unsubscribeAccount = subscribtionManager.get(data?.exchange, 'unsubscribeAccount')
        if (unsubscribeAccount) {
            unsubscribeAccount()
        }
        // console.log(`Client subscribed to account updates for exchange: ${data.exchange}`)
        const exchangeMonitor = getExchangeMonitor(data.exchange)
        if (exchangeMonitor) {
            // 向交易所订阅账户更新
            const unsubscribeAccount = exchangeMonitor.onAccountUpdate((accountData) => {
                // console.log('onAccountUpdate');
                socket.emit('accountUpdate', accountData)
            })
            subscribtionManager.set(data.exchange, 'unsubscribeAccount', unsubscribeAccount)
        }
    })
    socket.on('unsubscribeAccount', (data) => {
        const unsubscribeAccount = subscribtionManager.get(data?.exchange, 'unsubscribeAccount')
        if (unsubscribeAccount) {
            // console.log(`Client unsubscribed from account updates for exchange: ${data.exchange}`)
            unsubscribeAccount()
            subscribtionManager.set(data.exchange, 'unsubscribeAccount', null)
        }
    })
    socket.on('subscribeTickers', (data) => {
        const  unsubscribeTickers = subscribtionManager.get(data.exchange, 'unsubscribeTickers')
        if (unsubscribeTickers) {
            // console.log(`Already subscribed to tickers updates for exchange: ${data.exchange}, symbols: ${data.symbols}`);
            unsubscribeTickers()
            subscribtionManager.set(data.exchange, 'unsubscribeTickers', null)
        }
        // console.log(`Client subscribed to tickers updates for exchange: ${data.exchange}, symbols: ${data.symbols}`)
        const exchangeMonitor = getExchangeMonitor(data.exchange)
        if (exchangeMonitor) {
            const unsubscribeTickers = exchangeMonitor.onTickersUpdate(data.symbols, (tickers) => {
                // console.log('onTickersUpdate', data.symbols, tickers);
                socket.emit('tickersUpdate', tickers)
            })
            subscribtionManager.set(data.exchange, 'unsubscribeTickers', unsubscribeTickers)
        }
    })
    socket.on('unsubscribeTickers', (data) => {
        const unsubscribeTickers = subscribtionManager.get(data?.exchange, 'unsubscribeTickers')
        if (unsubscribeTickers) {
            // console.log(`Client unsubscribed from tickers updates for exchange: ${data.exchange}`)
            unsubscribeTickers()
            subscribtionManager.set(data.exchange, 'unsubscribeTickers', null)
        }
    })
    socket.on('disconnect', () => {
        subscribtionManager.unsubscribeAll()
        // console.log('Client disconnected, cleaning up subscriptions')
    })
}