import { orderModel } from '../database/db.js'
import { ORDER_STATES } from '../../../share/const.js'
import { checkSymbol } from '../../../share/utils.js'
import logger from '../logger.js'

export class OrderWatcher {
    static STATUS = {
        PENDDING: 'pendding',
        CLOSED: 'closed',
    }

    constructor() {
        this.orders = []
        this.ordersGroupByExchange = {}
        this.cbs = new Set()
        this.orderStatus = new Map()
    }
    async init() {
        this.fetch()
        orderModel.watch().on('change', async (change) => {
            // console.log('change', change);
            // 订单变化时更新
            await this.fetch()
        })
    }
    async fetch() {
        const orders = await this.findOpeningOrders()

        this.orderStatus.keys().forEach(key => {
            if (!orders.some(order => String(order._id) === String(key))) {
                this.orderStatus.delete(key)
            }
        })
        this.orders = orders.filter(order => !this.orderStatus.keys().some(key => String(order._id) === String(key)))
        logger.order(this.orders.length)
        this._groupOrdersByExchange()
        // console.log('orders update', orders.map(o => o._id), this.orders.map(o => o._id), this.orderStatus)
        this.cbs.forEach(cb => cb && cb({ orders: this.orders, ordersGroupByExchange: this.ordersGroupByExchange }))
    }
    _groupOrdersByExchange() {
        const ordersGroupByExchange = {}
        this.orders.forEach((order) => {
            if (!ordersGroupByExchange[order.exchange]) {
                ordersGroupByExchange[order.exchange] = {
                    spot: {
                        symbols: new Set(),
                        orders: [],
                    },
                    linear: {
                        symbols: new Set(),
                        orders: [],
                    },
                    inverse: {
                        symbols: new Set(),
                        orders: [],
                    },
                }
            }
            const cSymbol = checkSymbol(order.symbol)
            if (cSymbol.isSpot) {
                ordersGroupByExchange[order.exchange].spot.symbols.add(order.symbol)
                ordersGroupByExchange[order.exchange].spot.orders.push(order)
            } else if (cSymbol.isLinear) {
                ordersGroupByExchange[order.exchange].linear.symbols.add(order.symbol)
                ordersGroupByExchange[order.exchange].linear.orders.push(order)
            } else {
                ordersGroupByExchange[order.exchange].inverse.symbols.add(order.symbol)
                ordersGroupByExchange[order.exchange].inverse.orders.push(order)
            }
        })
        this.ordersGroupByExchange = ordersGroupByExchange
    }
    onOrdersUpdate(cb) {
        process.nextTick(() => cb(this))
        this.cbs.add(cb)
        return () => {
            this.cbs.delete(cb)
        }
    }

    // setOrderStatus(id, status) {
    //     if (status === OrderWatcher.STATUS.CLOSED) {
    //         this.orderStatus.delete(id);
    //     }
    //     // const order = this.orders.find(order => order.id === id);
    //     this.orderStatus.set(id, status);
    // }

    // getOrderStatus(id) {
    //     return this.orderStatus.get(id);
    // }

    markOrderDealing(id) {
        this.orderStatus.set(id, OrderWatcher.STATUS.PENDDING)
    }

    unmarkOrderDealing(id) {
        this.orderStatus.delete(id)
    }

    isOrderDealing(id) {
        return this.orderStatus.get(id) === OrderWatcher.STATUS.PENDDING
    }

    async findOpeningOrders() {
        return await orderModel.find({ state: ORDER_STATES.OPENING })
    }

    async creatOrder(params = {}) {
        const order = new orderModel({
            ...params,
            state: ORDER_STATES.OPENING,
        })
        await order.save()
        return order
    }

    async updateOrder(id, data) {
        return await orderModel.findByIdAndUpdate(id, data)
    }

    async resolveOrder(id) {
        // return await orderModel.findByIdAndUpdate(_id, { state: ORDER_STATES.RESOLVED })
        return await orderModel.findByIdAndDelete(id)
    }

    async closeOrder(id) {
        // return await orderModel.findByIdAndUpdate(_id, { state: ORDER_STATES.CLOSED })
        return await orderModel.findByIdAndDelete(id)
    }
}
const orderWatcher = new OrderWatcher()

orderWatcher.init()

export default orderWatcher