import { io } from "socket.io-client";
import { apiURL } from '../config';

// const socket = io(apiURL);

class Socket {
    constructor() {
        this.socket = io(apiURL);
        this.tickerSubCb = null;
        this.accountSubCb = null;
        this.exchange = null;
        this.symbols = null;

        this.socket.io.on('reconnect', () => {
            console.log('socket reconnect');
            if (this.tickerSubCb) {
                this.subscribeTickers(this.exchange, this.symbols, this.tickerSubCb);
            }
            if (this.accountSubCb) {
                this.subscribeAccount(this.exchange, this.accountSubCb);
            }
        });
        // this.tickerUpdateCbs = new Map();
        // this.accountUpdateCbs = new Set();
    }

    subscribeTickers(exchange, symbols, cb) {
        if (this.tickerSubCb) {
            this.socket.off('tickersUpdate');
        }
        this.tickerSubCb = cb;
        this.exchange = exchange;
        this.symbols = symbols;
        // this.lastTickerParams = { exchange, symbols };
        this.socket.emit('subscribeTickers', { exchange, symbols });
        this.socket.on('tickersUpdate', cb);
    }
    unsubscribeTickers() {
        this.socket.emit('unsubscribeTickers', { exchange: this.exchange });
        this.socket.off('tickersUpdate');
        this.tickerSubCb = null;
        this.symbols = null;
    }
    subscribeAccount(exchange, cb) {
        if (this.accountSubCb) {
            this.socket.off('accountUpdate');
        }
        this.accountSubCb = cb;
        this.exchange = exchange;
        this.socket.emit('subscribeAccount', { exchange });
        this.socket.on('accountUpdate', cb);
    }
    unsubscribeAccount() {
        this.socket.emit('unsubscribeAccount', { exchange: this.exchange });
        this.socket.off('accountUpdate');
        this.accountSubCb = null;
    }
    // unsubscribe
}

const socket = new Socket();

export default socket;