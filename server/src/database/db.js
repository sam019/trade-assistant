
import mongoose from 'mongoose';

/* 委托订单 */
const orderSchema = new mongoose.Schema({
    exchange: String,
    symbol: String,
    slPrice: Number,
    tpPrice: Number,
    amount: Number,
    unit: String,
    state: String,
});
const orderModel = mongoose.model('order', orderSchema);

const favoriteMarkets = new mongoose.Schema({
    exchange: String,
    symbol: String,
});
const favouriteMarketsModel = mongoose.model('favoriteMarkets', favoriteMarkets);

/* 连接数据库 */
const connectDB = async () => {
    try {
        await mongoose.connect('mongodb://localhost:27017/trade-assistant', {});

        console.log('MongoDB connected successfully');
    } catch (err) {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    }
};

export default connectDB;
export {
    orderModel,
    favouriteMarketsModel
}