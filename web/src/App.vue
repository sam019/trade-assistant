<script>
// import { ElMessage } from '@hc/element-plus'
import CryptoJS from 'crypto-js'
import { computed } from 'vue'
import _ from 'lodash'
import { ElLoading } from 'element-plus'
import Decimal from 'decimal.js'

import { MARKET_TYPES, ORDER_TYPES, ORDER_SIDES, ORDER_AMOUNT_TYPES, MARGIN_MODES, POSITION_SIDES, STABLE_COINS } from 'share/const'
import { checkSymbol, getPrecisionLength, isDev } from 'share/utils'

import MarketSelectPanel from './components/MarketSelectPanel.vue'
import Balance from './components/Balance.vue'
import Position from './components/Position.vue'
import Order from './components/Order.vue'
import Login from './components/Login.vue'
import TwapCheckbox from './components/TwapCheckbox.vue'
import TwapOrder from './components/TwapOrder.vue'

import * as service from './services/service'
import socket from './services/socket'

export default {
    provide() {
        return {
            tickers: computed(() => this.tickers),
            positions: computed(() => this.positions),
        }
    },
    components: {
        MarketSelectPanel,
        Balance,
        Position,
        Order,
        Login,
        TwapCheckbox,
        TwapOrder,
    },
    data() {
        return {
            showLogin: false,
            exchanges: [], // 支持的交易所列表
            exchange: '',  // 当前选择的交易所
            exchangeAccount: {}, // 当前交易所账户信息
            // defaultMarkets: [], // 当前交易所的交易对列表（默认部分）
            markets: null, // 当前搜索面板展示的交易对
            market: {}, // 当前选择的交易对
            tickers: {}, // 交易对的最新价格
            tickerTime: null, // ticker的获取时间
            tickerTimeAgo: null, // 距离最新ticker过了多久

            marginMode: null, // 仓位模式（全仓，逐仓）
            leverage: null, // 杠杆大小

            orderId: null, // 委托单的id，仅修改委托单时有用
            orderType: ORDER_TYPES.MARKET, // 订单类型
            orderSide: ORDER_SIDES.BUY, // 订单方向

            orderAmount: 0, // 订单数量
            orderAmountUnit: ORDER_AMOUNT_TYPES.QUOTE, // 订单数量计价币种
            orderAmountPct: 0, // 订单数量占可用数量的百分比
            orderUsePct: false, // 使用百分比数量代替绝对数量，适用于数量单位总价值为估算的场景，且拖动slide设定数量时

            orderUseTWAP: false, // 是否用TWAP下单
            twapTotalMinute: 1, // TWAP总时间(分钟)
            twapPriceLimit: null, // TWAP价格限制
            showConfirm: false, // 下单确认框

            orderWithSLTP: false, // 市价单是否带止盈止损
            slPrice: null, // 市价单附带的止损触发价
            tpPrice: null, // 市价单附带的止盈触发价
            // sltpUseTWAP: false, // 止盈止损时是否使用TWAP
            // sltpTwapTotalMinut: 1,
            // sltpTwapPriceLimit: 1,

            triggerPrice: null, // 条件委托的触发价


            showMarketDialog: false, // market搜索框
            isSocketSuspend: false, // socket是否保持连接

            ORDER_TYPES,
            ORDER_SIDES,
            ORDER_AMOUNT_TYPES,
            MARGIN_MODES,
            MARKET_TYPES,
            POSITION_SIDES,
        }
    },
    methods: {
        async init() {
            try {
                // this.showLogin = true
                await socket.connect()
                socket.onConnectStateChange((isConnect) => {
                    // console.log('onConnectStateChange', isConnect)
                    this.isSocketSuspend = !isConnect
                })
                // socket.connect()
                const supportedExhcanges = await service.getSupportedExchanges()
                this.exchanges = supportedExhcanges
                // console.log(this.$router)
                if (this.$router?.query.exchange && supportedExhcanges.includes(this.$route.query.exchange)) {
                    this.initExchangeData(this.$route.query.exchange)
                } else {
                    this.initExchangeData(supportedExhcanges[0])
                }
                this.refreshTickerAgo()
                this.showLogin = false
            } catch (e) {
                console.error(e)
                this.showLogin = true
            }
        },
        async handleLogin(pwd) {
            try {
                await service.login(CryptoJS.SHA256(pwd).toString(CryptoJS.enc.Hex))
                // console.log('login success')
                this.showLogin = false
                this.init()
            } catch (e) {
                console.error(e)

            }
        },
        async initExchangeData(exchange) {
            socket.unsubscribeAccount()
            this.exchange = exchange

            socket.subscribeAccount(exchange, (data) => {
                // console.log('accountUpdate', data)
                // this.$message({ message: `subscribeAccount ${JSON.stringify(data)}` })
                Object.keys(data).forEach(k => this.exchangeAccount[k] = data[k]) // 避免触发太多次account watch
            })
            const setDefaultMarket = () => service
                .searchMarkets(exchange)
                .then(res => {
                    this.changeMarket(res.spot[0])
                })
            const defaultMarketSymbol = new URL(window.location).searchParams.get('market')
            // console.log('defaultMarketSymbol', defaultMarketSymbol)
            if (defaultMarketSymbol) {
                const market = await service.getMarket(this.exchange, defaultMarketSymbol)
                // console.log('defaultMarket', market)
                if (market) {
                    this.changeMarket(market)
                } else {
                    setDefaultMarket()
                }
            } else {
                setDefaultMarket()
            }
        },
        changeMarket(market) {
            // console.log('change market', market)
            this.showMarketDialog = false
            if (market?.symbol === this.market.symbol) return
            this.market = {}
            this.orderSide = ORDER_SIDES.BUY
            if (market) {
                this.market = market
            }
            this.orderType = ORDER_TYPES.MARKET
            this.marginMode = null
            this.leverage = null
            this.resetForm()
            if (!this.isSpotMarket) {
                if (this.curPosition) {
                    this.marginMode = this.curPosition.marginMode
                    this.leverage = this.curPosition.leverage.longLeverage
                } else {
                    // 调整仓位模式（全仓，逐仓)
                    service.getMarginMode(this.exchange, market.symbol).then(r => {
                        // console.log('getMarginMode', r)
                        this.marginMode = r.marginMode
                    })
                    // 获取杠杆
                    service.getLeverage(this.exchange, market.symbol).then(r => {
                        // console.log('getLeverage', r)
                        this.leverage = r.longLeverage
                    })
                }
            }
            const url = new URL(window.location)
            url.searchParams.set('market', this.market.symbol)
            history.pushState(null, '', url)
            // console.log('market', window.location.search)
        },
        closeDialog() {
            this.showMarketDialog = false
            this.markets = null
        },
        async searchMarkets(keywords, refresh) {
            if (!keywords) {
                if (this.defaultMarkets) {
                    this.markets = this.defaultMarkets
                    return
                }
            }
            const res = await service.searchMarkets(this.exchange, keywords, refresh)
            if (!keywords) {
                this.defaultMarkets = res
            }
            // console.log('searchMarkets', res)
            this.markets = res
        },
        async toggleMarketFavorite(market) {
            try {
                if (!market.isFavorite) {
                    await service.addFavouriteMarket(this.exchange, market.symbol)
                    market.isFavorite = true
                } else {
                    await service.deleteFavoriteMarket(this.exchange, market.symbol)
                    market.isFavorite = false
                }
            } catch (e) {
                console.error(e)
                this.$message({
                    message: e.message,
                    type: 'error',
                })
            }
        },
        async handleMarginModeChange(mode) {
            const loading = ElLoading.service()
            try {
                await service.setMarginMode(this.exchange, this.market.symbol, mode)
                this.marginMode = mode
                this.$message({
                    message: '已修改仓位模式为 ' + mode,
                    type: 'success',
                })
            } catch (e) {
                console.error(e)
                this.$message({
                    message: e?.response?.data?.name,
                    type: 'error',
                })
            } finally {
                loading.close()
            }
        },
        async handleLeverageChange(leverage) {
            const loading = ElLoading.service()
            try {
                await service.setLeverage(this.exchange, this.market.symbol, leverage)
                this.leverage = leverage
                this.$message({
                    message: '已修改杠杆为 ' + leverage + 'x',
                    type: 'success',
                })
            } catch (e) {
                console.error(e)
                this.$message({
                    message: e?.response?.data?.name,
                    type: 'error',
                })
            } finally {
                loading.close()
            }
        },
        // 前端不需要做精确校验
        handleAmountChange(amount) {
            // console.log('handleAmountChange', amount);
            if (!amount || amount <= 0) {
                this.orderAmount = null
                this.orderAmountPct = 0
                return
            }
            if (amount > this.avaiableOrderAmount) {
                amount = this.avaiableOrderAmount
            }
            this.orderAmount = new Decimal(amount).toDecimalPlaces(this.getPrecisionByUnit(this.orderAmountUnit)).toNumber()
            this.orderAmountPct = new Decimal(this.orderAmount || 0).div(this.avaiableOrderAmount).mul(100).floor().toNumber()
            // console.log('orderAmount', this.orderAmount, new Decimal(amount).toDecimalPlaces(this.getPrecisionByUnit(this.orderAmountUnit)).toNumber())
        },
        handleAmountPctChange(amountPercent) {
            // console.log('avaiableOrderAmount', this.avaiableOrderAmount)
            if (this.isAvaiableOrderAmountEstimated) {
                this.orderUsePct = true
            }
            this.orderAmountPct = amountPercent
            this.orderAmount = new Decimal(amountPercent).div(100).mul(this.avaiableOrderAmount).toDecimalPlaces(this.getPrecisionByUnit(this.orderAmountUnit)).toNumber()
        },
        async handleCreateOrder() {
            const isFormValid = this.validateForm()
            if (!isFormValid) {
                return
            }
            if (this.marginMode === MARGIN_MODES.CROSS) {
                this.$message({
                    type: 'error',
                    message: '禁止使用全仓合约',
                })
                return
            }
            this.showConfirm = true
        },
        async handleConfirmOrder() {
            this.showConfirm = false
            const loading = ElLoading.service()
            const params = {
                exchange: this.exchange,
                symbol: this.market.symbol,
                type: this.orderType,
                side: this.orderSide,
                amount: this.orderAmount,
                unit: this.orderAmountUnit,
                usePct: this.orderUsePct,
                amountPct: this.orderAmountPct,
                useTWAP: this.orderUseTWAP,
                totalMinute: this.twapTotalMinute,
                priceLimit: this.twapPriceLimit,
                withSLTP: this.orderWithSLTP,
                reduceOnly: this.reduceOnly,
                tpPrice: this.tpPrice,
                slPrice: this.slPrice,
                triggerPrice: this.triggerPrice,
                leverage: this.leverage,
                id: this.orderId,
                // __force: true,
            }
            try {
                const { _sltp } = await service.createOrder(params)
                if (_sltp) {
                    if (!this.exchangeAccount.orders[this.marketType]) {
                        this.exchangeAccount.orders[this.marketType] = []
                    }
                    this.exchangeAccount.orders[this.marketType].push(_sltp)
                }
                this.resetForm(true)
                this.$message({
                    message: '下单成功',
                    type: 'success',
                })
                this.resetForm(true)
            } catch (e) {
                console.error(e)
                this.$message({
                    message: e.response.data,
                    type: 'error',
                })
            } finally {
                loading.close()
            }
        },
        validateForm() {
            if (isDev() && !this.exchangeAccount.TESTNET) {
                // 开发环境调试生产key，防止误下单
                return false
            }
            if (!this.orderAmount) return false
            if (this.orderType === ORDER_TYPES.MARKET) {
                if (this.orderWithSLTP && !this.slPrice && !this.tpPrice) return false
                if (this.orderUsePct) {
                    if (!this.twapTotalMinute) {
                        return false
                    }
                    // if (this.twapPriceLimit) {
                    //     if (this.isSpotMarket) {
                    //         if (this.orderSide === ORDER_SIDES.BUY) {
                    //             return this.twapPriceLimit > this.ticker?.last
                    //         } else {
                    //             return this.twapPriceLimit < this.ticker?.last
                    //         }
                    //     } else {
                    //         if (this.curPosition && this.reduceOnly) {
                    //             if (this.orderSide === ORDER_SIDES.BUY) {
                    //                 // 平空
                    //                 return this.twapPriceLimit > this.curPosition.markPrice
                    //             } else {
                    //                 // 平多
                    //                 return this.twapPriceLimit > this.curPosition.markPrice
                    //             }
                    //         } else {
                    //             if (this.orderSide === ORDER_SIDES.BUY) {
                    //                 // 做多
                    //                 return this.twapPriceLimit > this.ticker?.last
                    //             } else {
                    //                 // 做空
                    //                 return this.twapPriceLimit < this.ticker?.last
                    //             }
                    //         }
                    //     }
                    // }
                }
                return true
            }
            if (this.orderType === ORDER_TYPES.SLTP) {
                if (!this.slPrice && !this.tpPrice) return false
                return true
            }
            if (this.orderType === ORDER_TYPES.CONDITION) {
                if (!this.triggerPrice) return false
                if (this.orderWithSLTP && !this.slPrice && !this.tpPrice) return false
                return true
            }
            return false
        },
        resetForm(notResetUnit = false) {
            this.orderAmount = null
            this.orderAmountPct = 0
            this.orderUsePct = false

            this.orderUseTWAP = false
            this.twapTotalMinute = 1
            this.twapPriceLimit = null

            this.orderWithSLTP = false
            this.tpPrice = null
            this.slPrice = null

            this.triggerPrice = null
            if (!notResetUnit) {
                this.orderAmountUnit = ORDER_AMOUNT_TYPES.QUOTE
            }
            this.orderId = null
        },
        async handleCancelOrder(order) {
            try {
                await service.deleteOrder(order._id)
                this.$message({
                    message: '撤单成功',
                    type: 'success',
                })
            } catch (e) {
                console.error(e)
                this.$message({
                    message: e.message,
                    type: 'error',
                })
            }
        },
        // 买或卖是否禁选，例如，现货止盈止损时不能选买入
        isSideDisabled(side) {
            if (this.orderType === ORDER_TYPES.MARKET) return false
            if (this.orderType === ORDER_TYPES.SLTP) {
                if (this.isSpotMarket) {
                    return side === ORDER_SIDES.BUY
                }
                return this.curPosition && ((this.reduceOnly && side !== this.orderSide) || (!this.reduceOnly && side === this.orderSide))
            }
            if (this.orderType === ORDER_TYPES.CONDITION) {
                if (this.isSpotMarket) {
                    return side === ORDER_SIDES.SELL
                }
                return this.curPosition && ((this.reduceOnly && side === this.orderSide) || (!this.reduceOnly && side !== this.orderSide))
            }
        },
        getPrecisionByUnit(unit) {
            // console.log(this.market?.precision, this.market.precision, unit)
            // console.log(/\d+e-(\d)/.exec('1e-8'))
            if (unit === ORDER_AMOUNT_TYPES.BASE) {
                return getPrecisionLength(this.market?.precision?.amount) || 8
            }
            return parseInt(/1e-(\d+)/.exec((this.market?.precision || {}).quote || '1e-8'))[1]
        },
        async handleClosePosition(position) {
            const loading = ElLoading.service()
            try {
                await service.closePosition(this.exchange, position.symbol)
            } finally {
                loading.close()
            }
        },
        backTop() {
            window.scrollTo(0, 0)
        },
        async setPositionSLTP(position) {
            if (this.market.symbol !== position.symbol) {
                const market = await service.getMarket(this.exchange, position.symbol)
                this.changeMarket(market)
            }
            this.orderType = ORDER_TYPES.SLTP
            this.resetForm()
            if (this.isSideDisabled(this.orderSide)) {
                this.orderSide = this.orderSide === ORDER_SIDES.BUY ? ORDER_SIDES.SELL : ORDER_SIDES.BUY
            }
            this.backTop()
        },
        async handleEditOrder(order) {
            // console.log('handleEditOrder', order)
            if (this.orderId === order.id) return
            if (this.market.symbol !== order.symbol) {
                const market = await service.getMarket(this.exchange, order.symbol)
                this.changeMarket(market)
            }
            this.orderId = order._id
            this.orderType = order.type || ORDER_TYPES.SLTP
            this.slPrice = order.slPrice
            this.tpPrice = order.tpPrice
            this.orderWithSLTP = order.withSLTP
            this.triggerPrice = order.triggerPrice

            if (this.isSpotMarket) {
                this.orderAmountUnit = order.unit
                this.handleAmountChange(order.amount)
            } else {
                if (order.unit === ORDER_AMOUNT_TYPES.CONTRACT) {
                    this.orderAmountUnit = ORDER_AMOUNT_TYPES.QUOTE
                    this.handleAmountChange(order.amount * this.market.contractSize)
                } else {
                    this.orderAmountUnit = order.unit
                    this.handleAmountChange(order.amount)
                }
            }
        },
        handleOrderTypeChange(value) {
            this.orderType = value
            if (this.isSpotMarket) {
                if (this.orderType === ORDER_TYPES.CONDITION) {
                    this.handleSideChange(ORDER_SIDES.BUY)
                } else if (this.orderType === ORDER_TYPES.SLTP) {
                    this.handleSideChange(ORDER_SIDES.SELL)
                } else {
                    this.handleSideChange(ORDER_SIDES.BUY)
                }
            } else {
                // this.handleSideChange(this.reduceOnly ? );
                if (this.orderType === ORDER_TYPES.CONDITION) {
                    this.curPosition && this.reduceOnly && this.handleSideChange(Object.values(ORDER_SIDES).find(s => s !== this.orderSide))
                } else if (this.orderType === ORDER_TYPES.SLTP) {
                    this.curPosition && !this.reduceOnly && this.handleSideChange(Object.values(ORDER_SIDES).find(s => s !== this.orderSide))
                } else {
                    this.handleSideChange(ORDER_SIDES.BUY)
                }
            }
            this.resetForm()
        },
        handleAmountUnitChange(value) {
            this.orderAmountUnit = value
            this.orderAmount = null
            this.orderAmountPct = 0
            this.orderUsePct = false
        },
        handleSideChange(value) {
            this.orderSide = value
            this.resetForm()
        },
        getEvaluateValue(balance) {
            const symbol = `${balance.currency}/${STABLE_COINS.USDT}`
            const ticker = this.tickers[symbol]
            const value = {
                spot: new Decimal(balance.spot || 0).mul(ticker?.last || 0).toDecimalPlaces(2).toNumber(),
                linear: new Decimal(balance.linear || 0).mul(ticker?.last || 0).toDecimalPlaces(2).toNumber(),
                inverse: new Decimal(balance.inverse || 0).mul(ticker?.last || 0).toDecimalPlaces(2).toNumber(),
                lastPrice: ticker?.last || 0,
            }
            value.total = value.spot + value.linear + value.inverse
            return value
        },
        async handleJumpMarket(symbol) {
            if (this.market.symbol === symbol) return
            const market = await service.getMarket(this.exchange, symbol)
            this.changeMarket(market)
            this.backTop()
        },
        refreshTickerAgo() {
            // console.log('tickerTime', new Date(this.tickerTime).toLocaleTimeString())
            if (this.tickerTime) {
                this.tickerTimeAgo = Math.floor((Date.now() - this.tickerTime) / 1000)
                // console.log('this.tickerTimeAgo', this.tickerTimeAgo)
            }
            this.tickerAgoTimer = setTimeout(this.refreshTickerAgo, 1000)
        },
        async handleToggleTWAP(order) {
            try {
                await service.toggleTWAPOrder(this.exchange, order.symbol)
            } catch (e) {
                console.error(e)
                this.$message({
                    message: e.message,
                    type: 'error',
                })
            }
        },
        async handleCloseTWAP(order) {
            try {
                await service.closeTWAPOrder(this.exchange, order.symbol)
            } catch (e) {
                console.error(e)
                this.$message({
                    message: e.message,
                    type: 'error',
                })
            }
        },
    },
    computed: {
        orderTypes() {
            return {
                [ORDER_TYPES.MARKET]: '市价',
                [ORDER_TYPES.SLTP]: '止盈止损',
                [ORDER_TYPES.CONDITION]: '条件委托',
            }
        },
        curSymbol() {
            return this.market?.symbol || '-'
        },
        ticker() {
            // console.log(Object.values(this.tickers).map(t => new Date(t.timestamp).toLocaleString()))
            return this.tickers[this.market.symbol] || {}
        },
        lastPrice() {
            return typeof this.ticker?.close === 'number' ? this.ticker.close.toLocaleString() : '-'
        },
        buyLabel() {
            return this.isSpotMarket ? '买入' : '买入/做多'
        },
        sellLabel() {
            return this.isSpotMarket ? '卖出' : '卖出/做空'
        },
        priceChanged() {
            if (!this.ticker.change) return ''
            const sign = this.ticker.change >= 0 ? '+' : ''
            return `${sign}${this.ticker.change.toLocaleString()}/${sign}${new Decimal(this.ticker.percentage).toDecimalPlaces(2).toNumber()}%`
        },
        isSpotMarket() {
            return this.market?.spot
        },
        isLinearPerpMarket() {
            return this.market.swap && this.market.linear
        },
        isInversePerpMarket() {
            return this.market.swap && this.market.inverse
        },
        balances() {
            // console.log('balance', this.exchangeAccount?.balance)
            const balances = []
            Object.entries(this.exchangeAccount?.balance?.spot || {}).forEach(([currency, amount]) => {
                if (!amount.free) return
                const balance = { currency, spot: amount.free }
                balances.push(balance)
            })

            Object.entries(this.exchangeAccount?.balance?.linear || {}).forEach(([currency, amount]) => {
                if (!amount.free) return
                let balance = balances.find(bal => bal.currency === currency)
                if (balance) {
                    balance.linear = amount.free
                } else {
                    balance = {
                        currency,
                        linear: amount.free,
                    }
                    balances.push(balance)
                }
            })
            Object.entries(this.exchangeAccount?.balance?.inverse || {}).forEach(([currency, amount]) => {
                if (!amount.free) return
                let balance = balances.find(bal => bal.currency === currency)
                if (balance) {
                    balance.inverse = amount.free
                } else {
                    balance = {
                        currency,
                        inverse: amount.free,
                    }
                    balances.push(balance)
                }
            })
            balances.forEach(balance => {
                const evaluateValue = this.getEvaluateValue(balance)
                // console.log('evaluateValue', evaluateValue)
                balance.evaluateValue = evaluateValue
            })
            balances.sort((a, b) => {
                if (this.isSpotMarket || this.isInversePerpMarket) {
                    if (a.currency === this.market.base) {
                        return -1
                    }
                    if (b.currency === this.market.base) {
                        return 1
                    }
                }
                if (a.currency === this.market.quote) {
                    return -1
                }
                if (b.currency === this.market.quote) {
                    return 1
                }
                const stableCoins = Object.values(STABLE_COINS)
                if (stableCoins.includes(a.currency)) {
                    return -1
                }
                if (stableCoins.includes(b.currency)) {
                    return 1
                }
                return b.evaluateValue[this.marketType] - a.evaluateValue[this.marketType]
            })
            return balances
        },
        renderBalances() {
            return this.balances.filter(balance => balance.evaluateValue.total >= 1 || Object.hasOwn(STABLE_COINS, balance.currency))
        },
        symbolsNeedTicker() {
            const symbols = []
            this.balances.filter(balance => {
                if (Object.hasOwn(STABLE_COINS, balance.currency)) {
                    return
                }
                symbols.push(`${balance.currency}/${STABLE_COINS.USDT}`)
            })
            this.market?.symbol && symbols.push(this.market.symbol)
            symbols.sort() // 排序方便比较
            return symbols
        },
        // 可买总数量是否为估算(取决于盘口价格和深度)
        isAvaiableOrderAmountEstimated() {
            if (this.isSpotMarket) {
                if (this.orderSide === ORDER_SIDES.BUY) {
                    return this.orderAmountUnit === ORDER_AMOUNT_TYPES.BASE
                } else {
                    return this.orderAmountUnit === ORDER_AMOUNT_TYPES.QUOTE
                }
            } else if (this.isLinearPerpMarket) {
                if (this.reduceOnly) {
                    return this.orderAmountUnit === ORDER_AMOUNT_TYPES.QUOTE
                } else {
                    return this.orderAmountUnit === ORDER_AMOUNT_TYPES.BASE
                }
            } else {
                if (this.reduceOnly) {
                    return this.orderAmountUnit === ORDER_AMOUNT_TYPES.BASE
                } else {
                    return this.orderAmountUnit === ORDER_AMOUNT_TYPES.QUOTE
                }
            }
        },
        marketType() {
            return this.isSpotMarket ? MARKET_TYPES.SPOT : this.isLinearPerpMarket ? MARKET_TYPES.LINEAR : MARKET_TYPES.INVERSE
        },
        avaiableOrderAmount() {
            const balance = _.get(this.exchangeAccount, ['balance', this.marketType]) || {}
            if (this.isSpotMarket) {
                // 现货
                if (this.orderSide === ORDER_SIDES.BUY) {
                    // 买入
                    if (this.orderAmountUnit === ORDER_AMOUNT_TYPES.BASE) {
                        if (!this.ticker.last) {
                            return 0
                        }
                        return new Decimal(balance[this.market[ORDER_AMOUNT_TYPES.QUOTE]]?.free || 0).div(this.ticker.last || 0).toDecimalPlaces(this.getPrecisionByUnit(this.orderAmountUnit)).toNumber()
                    } else {
                        return balance[this.market[ORDER_AMOUNT_TYPES.QUOTE]]?.free || 0
                    }
                } else {
                    // 卖出
                    if (this.orderAmountUnit === ORDER_AMOUNT_TYPES.BASE) {
                        return balance[this.market[ORDER_AMOUNT_TYPES.BASE]]?.free || 0
                    } else {
                        if (!this.ticker.last) {
                            return 0
                        }
                        return new Decimal(balance[this.market[ORDER_AMOUNT_TYPES.BASE]]?.free || 0).mul(this.ticker.last || 0).toDecimalPlaces(this.getPrecisionByUnit(this.orderAmountUnit)).toNumber()
                    }
                }
            } else if (this.isLinearPerpMarket) {
                // U本位永续
                if (!this.reduceOnly) {
                    // 建仓
                    if (this.orderAmountUnit === ORDER_AMOUNT_TYPES.BASE) {
                        return new Decimal(balance[this.market[ORDER_AMOUNT_TYPES.QUOTE]]?.free || 0).div(this.ticker.last || 0).toDecimalPlaces(this.getPrecisionByUnit(this.orderAmountUnit)).toNumber()
                    } else {
                        return balance[this.market[ORDER_AMOUNT_TYPES.QUOTE]]?.free || 0
                    }
                } else {
                    // 减仓
                    // console.log('LinearPerp pos total amount: ', this.positions, this.market.symbol);
                    if (this.orderAmountUnit === ORDER_AMOUNT_TYPES.BASE) {
                        if (this.curPosition?.contracts) {
                            return new Decimal(this.curPosition.contracts).mul(this.curPosition.contractSize).toNumber()
                        } else {
                            return 0
                        }
                    } else {
                        if (this.curPosition?.contracts) {
                            return this.curPosition.notional
                        } else {
                            return 0
                        }
                    }
                }
            } else {
                // 币本位永续
                if (!this.reduceOnly) {
                    // 建仓
                    if (this.orderAmountUnit === ORDER_AMOUNT_TYPES.BASE) {
                        return balance[this.market[ORDER_AMOUNT_TYPES.BASE]]?.free || 0
                    } else {
                        return new Decimal(balance[this.market[ORDER_AMOUNT_TYPES.BASE]]?.free || 0).mul(this.ticker.last || 0).toDecimalPlaces(this.getPrecisionByUnit(this.orderAmountUnit)).toNumber()
                    }
                } else {
                    // 减仓
                    if (this.orderAmountUnit === ORDER_AMOUNT_TYPES.BASE) {
                        if (this.curPosition?.contracts) {
                            return new Decimal(this.curPosition.contracts).mul(this.curPosition.contractSize).div(this.ticker.last || 0).toDecimalPlaces(this.getPrecisionByUnit(this.orderAmountUnit)).toNumber()
                        } else {
                            return 0
                        }
                    } else {
                        if (this.curPosition?.contracts) {
                            return new Decimal(this.curPosition.contracts).mul(this.curPosition.contractSize).toNumber()
                        } else {
                            return 0
                        }
                    }
                }
            }
        },
        displayAvaiableOrderAmount() {
            // console.log('displayAvaiableOrderAmount', this.avaiableOrderAmount)
            let result
            if (!this.avaiableOrderAmount) {
                return '-'
            }
            if (this.isAvaiableOrderAmountEstimated) {
                // const precision = _.get(this.market, ['precision', this.orderAmountUnit], 1);
                result = new Decimal(this.avaiableOrderAmount || 0).toDecimalPlaces(this.getPrecisionByUnit(this.orderAmountUnit)).toNumber()
            } else {
                result = this.avaiableOrderAmount
            }
            return Number.isNaN(result) ? NaN : (result + ' ' + this.market[this.orderAmountUnit])
        },
        // orderUsePct为true时，使用的另一资产的绝对值
        realCurrencyAmount() {
            if (!this.orderUsePct) return null
            const realUnit = this.orderAmountUnit === ORDER_AMOUNT_TYPES.BASE ? ORDER_AMOUNT_TYPES.QUOTE : ORDER_AMOUNT_TYPES.BASE
            const realCurrency = this.market[realUnit]
            let balance
            if (this.isSpotMarket) {
                balance = this.exchangeAccount.balance.spot[realCurrency]?.free || 0
            } else if (this.isLinearPerpMarket) {
                if (this.reduceOnly) {
                    balance = new Decimal(this.curPosition.contracts).mul(this.curPosition.contractSize).toNumber()
                } else {
                    balance = this.exchangeAccount.balance.linear[realCurrency]?.free || 0
                }
            } else {
                if (this.reduceOnly) {
                    balance = new Decimal(this.curPosition.contracts).mul(this.curPosition.contractSize).div(this.curPosition.markPrice).toNumber()
                } else {
                    balance = this.exchangeAccount.balance.inverse[realCurrency]?.free || 0
                }
            }
            // console.log('recu', realUnit, realCurrency, this.orderAmountPct, this.exchangeAccount.balance[this.marketType][realCurrency].free, )
            return '=' + new Decimal(this.orderAmountPct).div(100).mul(balance).toDecimalPlaces(this.getPrecisionByUnit(realUnit)).toNumber() + realCurrency
        },
        isFormValid() {
            return this.validateForm()
        },
        orders() {
            const displayOrders = []
            Object.values(this.exchangeAccount?.orders || {}).forEach(({ orders = [] }) => {
                orders.forEach(order => {
                    // console.log(order.symbol, this.market.symbol, order.symbol === this.market.symbol)
                    displayOrders.push(order)
                })
            })
            displayOrders.sort((a, b) => b.updatedAt - a.updatedAt)
            // console.log(...displayOrders, 'aa',curMarketOrder)
            return displayOrders
        },
        curOrders() {
            const curOrders = []
            this.orders.forEach(order => {
                if (order.symbol === this.market.symbol) {
                    curOrders.push(order)
                }
            })
            return curOrders
        },
        reduceOnly() {
            if (this.isSpotMarket) return false
            // 判断当前交易对的仓位是多头还是空头还是空仓，多头时卖出显示仅减仓，空头时买入显示仅减仓，空仓都不显示
            if (this.curPosition
                && (
                    (this.orderSide === ORDER_SIDES.BUY && this.curPosition.side === POSITION_SIDES.SHORT)
                    ||
                    (this.orderSide === ORDER_SIDES.SELL && this.curPosition.side === POSITION_SIDES.LONG)
                )) {
                return true
            }
            return false
        },
        curPosition() {
            return this.exchangeAccount?.positions?.find(pos => pos.symbol === this.market.symbol)
        },
        positions() {
            return this.exchangeAccount?.positions?.slice().sort((a, b) => {
                const aValue = checkSymbol(a.symbol).isLinear ? a.notional : a.contracts * a.contractSize

                const bValue = checkSymbol(b.symbol).isLinear ? b.notional : b.contracts * b.contractSize
                return bValue - aValue
            }) || []
        },
        canChangePosition() {
            return !this.curPosition
        },
        // 是否显示止盈止损复选框，仅在建仓时显示
        showWithSLTP() {
            if (this.orderType === ORDER_TYPES.SLTP) {
                return false
            }
            if (this.isSpotMarket) {
                return this.orderSide === ORDER_SIDES.BUY
            }
            // if (this.isLinearPerpMarket || this.isInversePerpMarket) {
            //     return !this.reduceOnly
            // }
            return !this.reduceOnly
        },
    },
    watch: {
        symbolsNeedTicker(newVal, oldVal) {
            // console.log('symbolsNeedTicker', newVal, oldVal)
            if (_.isEqual(newVal, oldVal)) return
            socket.subscribeTickers(this.exchange, this.symbolsNeedTicker, (tickers) => {
                // console.log('tickersUpdate', Object.keys(tickers).length)
                if (Object.keys(tickers).length) {
                    this.tickers = tickers
                    this.tickerTime = Date.now()
                }
            })
        },
    },
    mounted() {
        this.init()
    },
    beforeUnmount() {
        clearTimeout(this.tickerAgoTimer)
    },
}
</script>

<template>
    <MarketSelectPanel :visible="showMarketDialog" @close="closeDialog" @search="searchMarkets"
        @favorite="toggleMarketFavorite" :markets="markets" @change-market="changeMarket"></MarketSelectPanel>
    <Login v-if="showLogin" @submit="handleLogin"></Login>
    <div v-else>
        <el-row align="middle"
            style="height: 60px; border-bottom: 2px solid gray; padding: 0 10px; position: relative;">
            <!-- 选择交易所 -->
            <el-col style="flex-basis: 200px">
                <el-select v-model="exchange">
                    <el-option v-for="item in exchanges" :key="item" :label="item" :value="item"></el-option>
                </el-select>
            </el-col>
            <div v-if="exchangeAccount.TESTNET" class="TESTNET">TESTNET</div>
        </el-row>
        <el-row align="middle" justify="space-between"
            style="height: 60px; border-bottom: 2px solid gray; position: sticky; top: 0; z-index: 99; background: black !important;"
            @click="backTop">
            <!-- 选择交易对，并显示最新收盘价 -->
            <el-col style="flex-basis: 50%;">
                <el-button text @click="showMarketDialog = true">{{ curSymbol }}<el-icon style="margin-left: 10px;">
                        <ArrowDownBold />
                    </el-icon></el-button>
            </el-col>
            <el-col style="flex-basis: 50%; position: relative;">
                <div>{{ lastPrice }}</div>
                <div v-show="priceChanged" :style="{ color: ticker.change >= 0 ? 'green' : 'red' }">{{ priceChanged }}
                </div>
                <div class="socket-indicator" :class="[isSocketSuspend ? 'red' : 'green']">
                    <span v-show="tickerTimeAgo">{{ tickerTimeAgo }}</span>
                </div>
            </el-col>
        </el-row>
        <el-row align="middle" justify="space-between" style="height: 40px; padding: 10px 10px;">
            <!-- 选择订单类型，市价/止盈止损等 -->
            <el-col style="flex-basis: 100px;">
                <el-select :model-value="orderType" placeholder="Select" style="width: 100px;"
                    @change="handleOrderTypeChange">
                    <el-option v-for="(value, key) in orderTypes" :key="key" :label="value" :value="key"></el-option>
                </el-select>
            </el-col>
            <!-- 合约仓位类型，只支持逐仓 -->
            <el-col v-if="!isSpotMarket" style="flex-basis: 100px;">
                <el-select :model-value="marginMode" :disabled="!canChangePosition" @change="handleMarginModeChange">
                    <el-option v-for="item in MARGIN_MODES" :key="item"
                        :label="item === MARGIN_MODES.CROSS ? '全仓' : '逐仓'" :value="item"
                        :disabled="item === MARGIN_MODES.CROSS"></el-option>
                </el-select>
            </el-col>
            <!-- 合约杠杆倍数 -->
            <el-col v-if="!isSpotMarket" style="flex-basis: 100px;">
                <el-select :model-value="leverage" @change="handleLeverageChange" :disabled="!canChangePosition">
                    <el-option v-for="item in [1, 2, 3, 4, 5]" :key="item" :label="item + 'x'"
                        :value="item"></el-option>
                </el-select>
            </el-col>
        </el-row>
        <!-- 买单或卖单 -->
        <el-row align="middle" justify="space-between" style="height: 40px; padding: 10px 10px;">
            <el-col style="flex-basis: 50%">
                <el-button :type="orderSide === ORDER_SIDES.BUY ? 'success' : ''"
                    :disabled="isSideDisabled(ORDER_SIDES.BUY)" style="width: 100%; outline: none;"
                    @click="handleSideChange(ORDER_SIDES.BUY)">{{ buyLabel
                    }}</el-button>
            </el-col>
            <el-col style="flex-basis: 50%;">
                <el-button :type="orderSide === ORDER_SIDES.SELL ? 'danger' : ''" style="width: 100%; outline: none;"
                    :disabled="isSideDisabled(ORDER_SIDES.SELL)" @click="handleSideChange(ORDER_SIDES.SELL)">{{
                        sellLabel
                    }}</el-button>
            </el-col>
        </el-row>
        <!-- 可用余额 -->
        <el-row align="middle" justify="space-between" style="height: 40px; padding: 10px;">
            <el-col style="flex-basis: auto; height: 100%;">可用</el-col>
            <el-col style="flex-basis: auto; height: 100%;">
                <template v-if="!Number.isNaN(displayAvaiableOrderAmount)">
                    {{ displayAvaiableOrderAmount }}{{
                        isAvaiableOrderAmountEstimated ? '(预估)' : '' }}
                </template>
            </el-col>
        </el-row>
        <!-- 条件委托触发价格 -->
        <div v-show="orderType === ORDER_TYPES.CONDITION"
            style="display: flex; flex-direction: column; padding: 0 10px;">
            <el-input v-model="triggerPrice" type="number" inputmode="decimal" clearable :controls="false" :min="0"
                :placeholder="`触发价(${market[ORDER_AMOUNT_TYPES.QUOTE]})`" style="width: 100%;"></el-input>
        </div>
        <!-- 止盈止损触发价格 -->
        <div v-show="orderType === ORDER_TYPES.SLTP" style="display: flex; flex-direction: column; padding: 0 10px;">
            <el-input v-model="tpPrice" type="number" inputmode="decimal" clearable :controls="false" :min="0"
                :placeholder="`止盈触发价(${market[ORDER_AMOUNT_TYPES.QUOTE]})`" style="width: 100%;"></el-input>
            <el-input v-model="slPrice" type="number" inputmode="decimal" clearable :controls="false" :min="0"
                :placeholder="`止损触发价(${market[ORDER_AMOUNT_TYPES.QUOTE]})`"
                style="width: 100%; margin-top: 5px;"></el-input>
        </div>
        <!-- 下单仓位数量 -->
        <div style="position: relative; padding: 10px 10px;">
            <el-input type="number" inputmode="decimal" clearable v-model="orderAmount" @change="handleAmountChange"
                @focus="orderUsePct = false" :controls="false" :placeholder="isSpotMarket ? '数量' : '数量(保证金)'"
                :class="{ 'is-estimate-amount': orderUsePct, 'order-amount-input': true }">
                <template #prefix>
                    <span v-show="orderUsePct">预估</span>
                </template>
                <template #append>
                    <el-select style="width: 100px;" :model-value="orderAmountUnit" :disabled="false"
                        @change="handleAmountUnitChange">
                        <el-option :label="market[ORDER_AMOUNT_TYPES.BASE]"
                            :value="ORDER_AMOUNT_TYPES.BASE"></el-option>
                        <el-option :label="market[ORDER_AMOUNT_TYPES.QUOTE]"
                            :value="ORDER_AMOUNT_TYPES.QUOTE"></el-option>
                    </el-select>
                </template>
            </el-input>
            <!-- 可下单总数为预估且百分比下单时使用的真实资产数量 -->
            <span v-show="orderUsePct"
                style="position: absolute; top: 45px; color: white; font-size: 12px; left: 45%; transform: translateX(-50%);">
                {{ realCurrencyAmount }}</span>
        </div>
        <!-- 下单仓位数量百分比 -->
        <div class="slide-input">
            <el-slider v-model="orderAmountPct" @change="handleAmountPctChange"
                :marks="{ 0: '0', 25: '25', 50: '50', 75: '75', 100: '100' }" show-input size="small"
                :show-tooltip="false" />
        </div>
        <!-- 下单是否使用TWAP -->
        <TwapCheckbox v-show="orderType === ORDER_TYPES.MARKET" style="width: 70%;" v-model:checked="orderUseTWAP"
            v-model:totalMinute="twapTotalMinute" v-model:priceLimit="twapPriceLimit" :side="orderSide"></TwapCheckbox>
        <!-- 下单是否附带止盈止损 -->
        <div v-show="showWithSLTP" style="display: flex; align-items: center; padding: 0 10px 0 10px;">
            <el-checkbox v-model="orderWithSLTP" label="止盈止损" />
        </div>
        <!-- 合约只减仓 -->
        <div v-show="reduceOnly" style="display: flex; align-items: center; padding: 10px 10px 0 10px;">
            <el-checkbox :model-value="true" label="只减仓" disabled />
        </div>
        <!-- 下单附带止盈止损设置 -->
        <div v-show="orderWithSLTP" style="padding: 0 10px;">
            <div style="display: flex; align-items: center; margin-bottom: 5px;">
                <el-input v-model="tpPrice" type="number" inputmode="decimal" clearable :controls="false" :min="0"
                    :placeholder="`止盈触发价(${market[ORDER_AMOUNT_TYPES.QUOTE]})`" style="flex-grow: 1;"></el-input>
            </div>
            <div style="display: flex; align-items: center;">
                <el-input v-model="slPrice" type="number" inputmode="decimal" clearable :controls="false" :min="0"
                    :placeholder="`止损触发价(${market[ORDER_AMOUNT_TYPES.QUOTE]})`" style="flex-grow: 1;"></el-input>
            </div>
        </div>
        <!-- 下单 -->
        <div style="display: flex; padding: 20px 10px;">
            <el-button :type="isFormValid ? 'primary' : 'info'" size="large" style="flex-grow: 1;"
                :disabled="!isFormValid" @click="handleCreateOrder">{{ this.orderId ? `改单(${this.orderId})` : '下单'
                }}</el-button>
        </div>
        <!-- 余额/仓位/委托... -->
        <el-tabs type="card" style="flex: 0 1 auto; padding: 10px; overflow: hidden;" class="account-tabs">
            <el-tab-pane label="总览">
                <TwapOrder v-for="item in exchangeAccount.twapOrders" :key="item.symbol" :order="item" @toggle="handleToggleTWAP" @close="handleCloseTWAP"></TwapOrder>
                <template v-if="curOrders.length">
                    <Order v-for="item in curOrders" :key="item._id" :order="item" @cancel="handleCancelOrder"
                        @edit="handleEditOrder" @jump-market="handleJumpMarket">
                    </Order>
                </template>
                <Position v-if="curPosition" :position="curPosition" @close-position="handleClosePosition"
                    @sltp="setPositionSLTP" @jump-market="handleJumpMarket">
                </Position>
                <Balance v-for="item in renderBalances" :key="item.currency" :balance="item"
                    :isCurQuote="item.currency === market.quote" @jump-market="handleJumpMarket">
                </Balance>
            </el-tab-pane>
            <el-tab-pane :label="`仓位(${positions?.length})`">
                <Position v-for="item in positions" :key="item.symbol" :position="item"
                    @close-position="handleClosePosition" @sltp="setPositionSLTP" @jump-market="handleJumpMarket">
                </Position>
            </el-tab-pane>
            <el-tab-pane :label="`委托(${orders.length})`">
                <Order v-for="item in orders" :key="item._id" :order="item" @cancel="handleCancelOrder"
                    @edit="handleEditOrder" @jump-market="handleJumpMarket">
                </Order>
            </el-tab-pane>
        </el-tabs>
        <el-drawer :model-value="showConfirm" direction="btt" :show-close="false" :with-header="false" :modal="true"
            @closed="showConfirm = false">
            <div>确认下单吗？</div>
            <template #footer>
                <div style="display: flex; justify-content: space-between;">
                    <el-button @click="showConfirm = false" style="width: 150px;">取消</el-button>
                    <el-button type="primary" style="width: 150px;" @click="handleConfirmOrder">确认</el-button>
                </div>
            </template>
        </el-drawer>
    </div>
</template>

<style scoped>
.slide-input {
    padding: 10px 10px 20px 20px;

    :deep(.el-slider__input) {
        width: 84px;
    }
    :deep(.el-slider__runway.show-input) {
        margin-right: 24px;
    }
}

.el-input :deep(.el-input__inner) {
    text-align: center;
}

.is-estimate-amount :deep(.el-input__inner) {
    color: gray;
}

.account-tabs {
    flex: 0 1 auto;
    padding: 10px;
    overflow: hidden;

    :deep(.el-tabs__content) {
        overflow-y: auto;
    }
}

.socket-indicator {
    position: absolute;
    right: 15px;
    top: 0px;
    height: 10px;
    line-height: 10px;
    /* display: flex; */
    /* align-items: center; */
    font-size: 12px;
    color: gray;

    &::after {
        content: '';
        position: absolute;
        top: 2px;
        right: -10px;
        width: 8px;
        height: 8px;
        border-radius: 4px;
    }

    &.red::after {
        background-color: red;
    }

    &.green::after {
        background-color: green;
    }
}

.TESTNET {
    position: absolute;
    right: 0;
    top: 0;
    color: orange;
}
</style>