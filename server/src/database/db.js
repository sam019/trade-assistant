
import mongoose from 'mongoose'

/* 委托订单 */
const orderSchema = new mongoose.Schema({
    exchange: String, // 交易所
    symbol: String, // 交易对
    type: String, // 类型：SLTP CONDITION
    slPrice: Number, // 止损价（sltp, condition）
    tpPrice: Number, // 止盈价（sltp, condition）
    triggerPrice: Number, // 触发价（condition）
    withSLTP: Boolean, // 是否带止盈止损（condition）
    side: String, // 方向 buy sell （perp condition）
    leverage: Number, // 杠杆 (perp condition)
    amount: Number, // 数量
    unit: String, // 单位 base quote
    state: String, // 状态 opening resovled closed
}, { timestamps: true })
const orderModel = mongoose.model('order', orderSchema)

const favoriteMarkets = new mongoose.Schema({
    exchange: String,
    symbol: String,
})
const favouriteMarketsModel = mongoose.model('favoriteMarkets', favoriteMarkets)

/* 连接数据库 */
const connectDB = async () => {
    try {
        await mongoose.connect('mongodb://localhost:27017/trade-assistant', {})

        console.log('MongoDB connected successfully')
    } catch (err) {
        console.error('MongoDB connection error:', err)
        process.exit(1)
    }
}

export default connectDB
export {
    orderModel,
    favouriteMarketsModel,
}