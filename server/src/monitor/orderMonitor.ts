import { orderModel } from '../database/db.js'
import { ORDER_STATES } from 'share/const.js'
import { checkSymbol } from 'share/utils.js'
import logger from '../logger.js'
import type { Order, OrdersGroupByExchange } from '../types/index.js'

type OrderStatus = 'pendding' | 'closed'

interface OrdersUpdateCallback {
    (data: { orders: Order[]; ordersGroupByExchange: OrdersGroupByExchange }): void
}

export class OrderMonitor {
    static readonly STATUS = {
        PENDDING: 'pendding' as const,
        CLOSED: 'closed' as const,
    } as const

    orders: Order[] = []
    ordersGroupByExchange: OrdersGroupByExchange = {}
    private cbs = new Set<OrdersUpdateCallback>()
    private orderStatus = new Map<string, OrderStatus>()

    async init(): Promise<void> {
        await this.fetch()
        orderModel.onUpdate(async () => {
            await this.fetch()
        })
    }

    async fetch(): Promise<void> {
        const orders = await this.findOpeningOrders()

        // 清理已不存在的订单状态
        this.orderStatus.forEach((status, key) => {
            if (!orders.some(order => String(order._id) === String(key))) {
                this.orderStatus.delete(key)
            }
        })

        // 过滤掉正在处理中的订单
        this.orders = orders.filter(order => {
            const orderId = String(order._id)
            return !Array.from(this.orderStatus.keys()).some(key => key === orderId)
        })

        logger.order(this.orders.length)
        this._groupOrdersByExchange()

        // 通知所有订阅者
        this.cbs.forEach(cb => {
            if (cb) {
                cb({ 
                    orders: this.orders, 
                    ordersGroupByExchange: this.ordersGroupByExchange 
                })
            }
        })
    }

    private _groupOrdersByExchange(): void {
        const ordersGroupByExchange: OrdersGroupByExchange = {}
        
        this.orders.forEach((order) => {
            if (!ordersGroupByExchange[order.exchange]) {
                ordersGroupByExchange[order.exchange] = {
                    spot: {
                        symbols: new Set<string>(),
                        orders: [],
                    },
                    linear: {
                        symbols: new Set<string>(),
                        orders: [],
                    },
                    inverse: {
                        symbols: new Set<string>(),
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

    onOrdersUpdate(cb: OrdersUpdateCallback): () => void {
        process.nextTick(() => cb({ 
            orders: this.orders, 
            ordersGroupByExchange: this.ordersGroupByExchange 
        }))
        this.cbs.add(cb)
        return () => {
            this.cbs.delete(cb)
        }
    }

    markOrderDealing(id: string): void {
        this.orderStatus.set(id, OrderMonitor.STATUS.PENDDING)
    }

    unmarkOrderDealing(id: string): void {
        this.orderStatus.delete(id)
    }

    isOrderDealing(id: string): boolean {
        return this.orderStatus.get(id) === OrderMonitor.STATUS.PENDDING
    }

    async findOpeningOrders(): Promise<Order[]> {
        return await orderModel.find({ state: ORDER_STATES.OPENING })
    }

    async creatOrder(params: Partial<Order> = {}): Promise<Order> {
        const order = await orderModel.create({
            ...params,
            state: ORDER_STATES.OPENING,
        })
        return order
    }

    async updateOrder(id: string, data: Partial<Order>): Promise<Order> {
        return await orderModel.findByIdAndUpdate(id, data)
    }

    async resolveOrder(id: string): Promise<void> {
        await orderModel.findByIdAndDelete(id)
    }

    async closeOrder(id: string): Promise<void> {
        await orderModel.findByIdAndDelete(id)
    }
}

const orderMonitor = new OrderMonitor()

export default orderMonitor


