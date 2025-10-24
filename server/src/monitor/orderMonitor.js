import { orderModel } from '../database/db'
import { ORDER_STATES } from '../../../share/const'

export class OrderWatcher {
    static STATUS = {
        PENDDING: 'pendding',
        CLOSED: 'closed',
    }

    constructor() {
        this.orders = []
        this.ordersGroupByExchange = {}
        this.cbs = new Set()
        this.orderStaus = new Map()
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
        this.orders = await this.findOpeningOrders()
        this._groupOrdersByExchange()
        console.log('orders update', this.orders.map(o => o.id))
        Object.keys(this.orderStaus).forEach(key => {
            if (!this.orders.some(order => order._id === key)) {
                this.orderStaus.delete(key)
            }
        })
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
            const match = order.symbol.match(/(\w+)\/(\w+):?(\w+)?/)
            if (!match[3]) {
                ordersGroupByExchange[order.exchange].spot.symbols.add(order.symbol)
                ordersGroupByExchange[order.exchange].spot.orders.push(order)
            } else if (match[3] === match[2]) {
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
    //         this.orderStaus.delete(id);
    //     }
    //     // const order = this.orders.find(order => order.id === id);
    //     this.orderStaus.set(id, status);
    // }

    // getOrderStatus(id) {
    //     return this.orderStaus.get(id);
    // }

    markOrderDealing(id) {
        this.orderStaus.set(id, OrderWatcher.STATUS.PENDDING)
    }

    unmarkOrderDealing(id) {
        this.orderStaus.delete(id)
    }

    isOrderDealing(id) {
        return this.orderStaus.get(id) === OrderWatcher.STATUS.PENDDING
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

    async resolveOrder(_id) {
        // return await orderModel.findByIdAndUpdate(_id, { state: ORDER_STATES.RESOLVED })
        return await orderModel.findByIdAndDelete(_id)
    }

    async closeOrder(_id) {
        // return await orderModel.findByIdAndUpdate(_id, { state: ORDER_STATES.CLOSED })
        return await orderModel.findByIdAndDelete(_id)
    }
}
const orderWatcher = new OrderWatcher()

orderWatcher.init()

export default orderWatcher