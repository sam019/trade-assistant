
import { Sequelize, DataTypes } from 'sequelize'
// import { isDev } from 'share/utils.js'

import logger from '../logger.js'


const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: '../../../database.sqlite',
    logging: false,
})

class Model {
    constructor(SeqModel) {
        this._Model = SeqModel;
        // 绑定更新事件
        [
            'afterCreate',
            'afterDestroy',
            'afterUpdate',
            'afterBulkCreate',
            'afterBulkDestroy',
            'afterBulkUpdate',
        ].forEach(event => {
            SeqModel.addHook(event, (model) => this._triggerUpdateCbs(model))
        })
    }

    updateCbs = new Set()
    onUpdate(cb) {
        if (typeof cb !== 'function') {
            throw new Error('wrong param')
        }
        this.updateCbs.add(cb)
        return () => {
            this.updateCbs.delete(cb)
        }
    }
    async _triggerUpdateCbs() {
        const orders = await this.find()
        this.updateCbs.forEach(cb => cb(orders))
    }

    async find(options = {}) {
        return await this._Model.findAll({
            where: options,
        })
    }

    async findOne(options = {}) {
        return await this._Model.findOne({
            where: options,
        })
    }

    async findByIdAndDelete(id) {
        const model = await this._Model.findByPk(id)
        if (!model) {
            throw new Error('model not find')
        }
        return await model.destroy()
    }

    async findOneAndDelete(options = {}) {
        const model = await this.findOne(options)
        // console.log('model', model)
        if (!model) {
            throw new Error('model not find')
        }
        return await model.destroy()
    }
    
    async findByIdAndUpdate(id, data) {
        const model = await this._Model.findByPk(id)
        if (!model) {
            throw new Error('model not find')
        }
        return await model.update(data)
    }

    async findOneAndUpdate(options = {}, data) {
        const model = await this.findOne(options)
        if (!model) {
            throw new Error('model not find')
        }
        return await model.update(data)
    }

    async create(data) {
        return await this._Model.create(data)
    }
}

/* 委托订单 */
const Order = sequelize.define('Order', {
    _id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
    },
    exchange: DataTypes.STRING, // 交易所
    symbol: DataTypes.STRING, // 交易对
    type: DataTypes.STRING, // 类型：SLTP CONDITION
    slPrice: DataTypes.NUMBER, // 止损价（sltp, condition）
    tpPrice: DataTypes.NUMBER, // 止盈价（sltp, condition）
    triggerPrice: DataTypes.NUMBER, // 触发价（condition）
    withSLTP: DataTypes.BOOLEAN, // 是否带止盈止损（condition）
    side: DataTypes.STRING, // 方向 buy sell （perp condition）
    leverage: DataTypes.NUMBER, // 杠杆 (perp condition)
    amount: DataTypes.NUMBER, // 数量
    unit: DataTypes.STRING, // 单位 base quote
    state: DataTypes.STRING, // 状态 opening resovled closed
    useTWAP: DataTypes.BOOLEAN, // 是否使用TWAP下单 (condition, sltp)
    totalMinute: DataTypes.NUMBER, // TWAP总时长 (condition, sltp)
    priceLimit: DataTypes.NUMBER, // TWAP限价 (condition, sltp)
    
})

const orderModel = new Model(Order)


const FavouriteMarkets = sequelize.define('favoriteMarkets', {
    _id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
    },
    exchange: DataTypes.STRING,
    symbol: DataTypes.STRING,
})
const favouriteMarketsModel = new Model(FavouriteMarkets)

/* 连接数据库 */
const connectDB = async () => {
    // const dbHost = isDev() ? 'localhost' : 'mongo'
    // try {
    //     await mongoose.connect(`mongodb://${dbHost}:27017/${process.env.TESTNET ? 'trade-assistant' : 'ta-db-prod'}`, {})
    //     console.log('MongoDB connected successfully')
    // } catch (err) {
    //     console.error('MongoDB connection error:', err)
    //     process.exit(1)
    // }
    try {
        await sequelize.authenticate()
        logger.info('Connection has been established successfully.')
        await sequelize.sync({ alter: true })
    } catch (error) {
        logger.error('Unable to connect to the database:', error)
    }
}

export default connectDB
export {
    orderModel,
    favouriteMarketsModel,
}