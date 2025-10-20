<script>
// import { ElMessage } from '@hc/element-plus'
import { computed } from 'vue'
import _, { reduce } from 'lodash'
import { ElLoading } from 'element-plus'
import Decimal from 'decimal.js'

import { MARKET_TYPES, ORDER_TYPES, ORDER_SIDES, ORDER_AMOUNT_TYPES, MARGIN_MODES, POSITION_SIDES, STABLE_COINS } from '../../share/const'

import MarketSelectPanel from './components/MarketSelectPanel.vue'
import Balance from './components/Balance.vue'
import Position from './components/Position.vue'
import Order from './components/Order.vue'

import * as service from './services/service'
import socket from './services/socket'

function strip(num, precision = 15) {
    return +parseFloat(num.toPrecision(precision))
}

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
    },
    data() {
        return {
            exchanges: [], // 支持的交易所列表
            exchange: '',  // 当前选择的交易所
            exchangeAccount: {}, // 当前交易所账户信息
            // defaultMarkets: [], // 当前交易所的交易对列表（默认部分）
            markets: null, // 当前搜索面板展示的交易对
            market: {}, // 当前选择的交易对
            tickers: {}, // 交易对的最新价格

            orderType: ORDER_TYPES.MARKET, // 订单类型
            orderSide: ORDER_SIDES.BUY, // 订单方向
            orderAmount: 0, // 订单数量
            orderAmountUnit: ORDER_AMOUNT_TYPES.QUOTE, // 订单数量计价币种
            orderAmountPct: 0, // 订单数量占可用数量的百分比
            orderUsePct: false, // 使用百分比数量代替绝对数量，适用于数量单位总价值为估算的场景，且拖动slide设定数量时
            orderId: null, // 委托单的id，仅修改委托单时有用
            marginMode: null, // 仓位模式（全仓，逐仓）
            leverage: null, // 杠杆大小
            orderWithSLTP: false, // 市价单是否带止盈止损
            slPrice: null, // 市价单附带的止损触发价
            tpPrice: null, // 市价单附带的止盈触发价

            ORDER_TYPES,
            ORDER_SIDES,
            ORDER_AMOUNT_TYPES,
            MARGIN_MODES,
            MARKET_TYPES,
            POSITION_SIDES,
            dialogVisible: false,
        }
    },
    methods: {
        async initExchanges() {
            const supportedExhcanges = await service.getSupportedExchanges()
            this.exchanges = supportedExhcanges
            // console.log(this.$router)
            if (this.$router?.query.exchange && supportedExhcanges.includes(this.$route.query.exchange)) {
                this.initExchangeData(this.$route.query.exchange)
            } else {
                this.initExchangeData(supportedExhcanges[0])
            }
        },
        async initExchangeData(exchange) {
            socket.unsubscribeAccount()
            this.exchange = exchange

            socket.subscribeAccount(exchange, (data) => {
                // console.log('accountUpdate', data)
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
            this.dialogVisible = false
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
            this.dialogVisible = false
            this.markets = null
        },
        async searchMarkets(keywords) {
            // console.log('searchMarkets', keywords)
            const res = await service.searchMarkets(this.exchange, keywords)
            // console.log('searchMarkets', res)
            this.markets = res
        },
        async changeMarketFavorite(market) {
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
            // todo 禁止改成cross
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
            }
        },
        async handleLeverageChange(leverage) {
            // todo 币本位和u本位参数不一样
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
            const loading = ElLoading.service()
            // TODO 弹框确认
            try {
                const result = await service.createOrder({
                    exchange: this.exchange,
                    symbol: this.market.symbol,
                    type: this.orderType,
                    side: this.orderSide,
                    amount: this.orderAmount,
                    unit: this.orderAmountUnit,
                    usePct: this.orderUsePct,
                    amountPct: this.orderAmountPct,
                    withSLTP: this.orderWithSLTP,
                    reduceOnly: this.reduceOnly,
                    tpPrice: this.tpPrice,
                    slPrice: this.slPrice,
                    id: this.orderId,
                    // __force: true,
                })
                this.resetForm(true)
                this.$message({
                    message: '下单成功',
                    type: 'success',
                })
            } catch (e) {
                console.log(e)
                this.$message({
                    message: e.response.data,
                    type: 'error',
                })
            } finally {
                loading.close()
            }
        },
        validateForm() {
            if (this.orderType === ORDER_TYPES.MARKET) {
                if (!this.orderAmount) return false
                if (this.orderWithSLTP && !this.slPrice && !this.tpPrice) return false
                return true
            }
            if (this.orderType === ORDER_TYPES.SLTP) {
                if (!this.orderAmount) return false
                if (!this.slPrice && !this.tpPrice) return false
                return true
            }
        },
        resetForm(onlyResetValue = false) {
            this.orderAmount = null
            this.orderAmountPct = 0
            this.orderUsePct = false
            this.orderWithSLTP = false
            this.tpPrice = null
            this.slPrice = null
            if (!onlyResetValue) {
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
                console.log(e)
                this.$message({
                    message: e.message,
                    type: 'error',
                })
            }
        },
        isSideDisabled(side) {
            if (this.orderType !== ORDER_TYPES.SLTP) return false
            if (this.isSpotMarket) {
                return side === ORDER_SIDES.BUY
            }
            return this.curPosition && ((this.reduceOnly && side !== this.orderSide) || (!this.reduceOnly && side === this.orderSide))
        },
        getPrecisionByUnit(unit) {
            // console.log(this.market?.precision, this.market.precision, unit)
            // console.log(/\d+e-(\d)/.exec('1e-8'))
            return parseInt(/\d+e-(\d)/.exec(this.market?.precision && this.market.precision[unit] || '1e-8')[1])
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
        async handleSLTPPosition(position) {
            if (this.market.symbol !== position.symbol) {
                const market = await service.getMarket(this.exchange, position.symbol)
                this.changeMarket(market)
            }
            this.orderType = ORDER_TYPES.SLTP
            this.resetForm()
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
            this.orderType = ORDER_TYPES.SLTP
            this.slPrice = order.slPrice
            this.tpPrice = order.tpPrice
            
            if (this.isSpotMarket) {
                this.orderAmountUnit = order.unit
                this.handleAmountChange(order.amount)
            } else {
                if (order.unit === ORDER_AMOUNT_TYPES.CONTRACT) {
                    this.orderAmountUnit = this.isLinearPerpMarket ? this.market.base : this.market.quote
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
                if (this.orderType === ORDER_TYPES.SLTP) {
                    this.handleSideChange(ORDER_SIDES.SELL)
                } else {
                    this.handleSideChange(ORDER_SIDES.BUY)
                }
            } else {
                // this.handleSideChange(this.reduceOnly ? );
                this.curPosition && !this.reduceOnly && this.handleSideChange(Object.values(ORDER_SIDES).find(s => s !== this.orderSide))
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
            return value
        },
        async handleJumpMarket(symbol) {
            if (this.market.symbol === symbol) return
            const market = await service.getMarket(this.exchange, symbol)
            this.changeMarket(market)
            this.backTop()
        },
    },
    computed: {
        orderTypesLabel() {
            return {
                [ORDER_TYPES.MARKET]: '市价',
                [ORDER_TYPES.SLTP]: '止盈止损',
            }
        },
        curSymbol() {
            return this.market?.symbol || '-'
        },
        ticker() {
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
        // 当前unit可下单数量的最小粒度(严格判断在后端做)
        // amountStep() {
        //     const precision = this.market?.precision?.amount || 0;
        //     if (this.isSpotMarket) {
        //         // return this.orderAmountUnit === ORDER_AMOUNT_TYPES.BASE ? precision : (precision * this.ticker?.last);
        //         return this.orderAmountUnit === ORDER_AMOUNT_TYPES.BASE ? precision : new Decimal(precision).mul(this.ticker.last || 0).toNumber();
        //     }
        //     if (this.isLinearPerpMarket) {
        //         const contractAmountStep = this.orderAmountUnit === ORDER_AMOUNT_TYPES.BASE ? precision : new Decimal(precision).mul(this.ticker.last || 0).toNumber();
        //         // return contractAmountStep * this.market?.contractSize;
        //         return new Decimal(contractAmountStep).mul(this.market.contractSize).toNumber();
        //     }
        // },
        priceChanged() {
            if (!this.ticker.change) return ''
            const sign = this.ticker.change >= 0 ? '+' : ''
            // return `${sign}${this.ticker.change.toLocaleString()}/${sign}${Math.round(this.ticker.percentage * 1000) / 1000}%`;
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
                balance.evaluateValue = this.getEvaluateValue(balance)
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
                    _
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
        symbolsNeedTicker() {
            const symbols = []
            this.balances.filter(balance => {
                if (Object.hasOwn(STABLE_COINS, balance.currency)) {
                    return
                }
                symbols.push(`${balance.currency}/${STABLE_COINS.USDT}`)
            })
            this.market?.symbol && symbols.push(this.market.symbol)
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
            // const currencyName = this.market[this.orderAmountUnit];
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
                        // return Math.floor((balance[this.market[ORDER_AMOUNT_TYPES.QUOTE]]?.free || 0) / this.contractQuoteAmountStep) * this.minAmountOnBase;
                        // return new Decimal(balance[this.market[ORDER_AMOUNT_TYPES.QUOTE]]?.free || 0).div(this.contractQuoteAmountStep).floor().mul(this.minAmountOnBase).toDecimalPlaces(this.getPrecisionByUnit(this.orderAmountUnit)).toNumber();
                        return new Decimal(balance[this.market[ORDER_AMOUNT_TYPES.QUOTE]]?.free || 0).div(this.ticker.last || 0).toDecimalPlaces(this.getPrecisionByUnit(this.orderAmountUnit)).toNumber()
                    } else {
                        // return Math.floor((balance[this.market[ORDER_AMOUNT_TYPES.QUOTE]]?.free || 0) / this.contractQuoteAmountStep) * this.contractQuoteAmountStep;
                        // return new Decimal(balance[this.market[ORDER_AMOUNT_TYPES.QUOTE]]?.free || 0).div(this.contractQuoteAmountStep).floor().mul(this.contractQuoteAmountStep).toNumber();
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
                // result = Math.floor(this.avaiableOrderAmount * 100) / 100;
                result = new Decimal(this.avaiableOrderAmount || 0).toDecimalPlaces(this.getPrecisionByUnit(this.orderAmountUnit)).toNumber()
            } else {
                result = this.avaiableOrderAmount
            }
            return Number.isNaN(result) ? NaN : (result + ' ' + this.market[this.orderAmountUnit])
        },
        // minAmountOnBase() {
        //     return this.market?.limits?.amount?.min || 1;
        // },
        // contractQuoteAmountStep() {
        //     // return this.ticker.last * this.market.contractSize * this.minAmountOnBase;
        //     return new Decimal(this.ticker.last || 0).mul(this.market.contractSize).mul(this.market.precision.amount).toNumber();
        // },
        // orderUsePct为true时，使用的另一资产的绝对值
        realCurrencyAmount() {
            if (!this.orderUsePct) return null
            const realUnit = this.orderAmountUnit === ORDER_AMOUNT_TYPES.BASE ? ORDER_AMOUNT_TYPES.QUOTE : ORDER_AMOUNT_TYPES.BASE
            const realCurrency = this.market[realUnit]
            // console.log('recu', realUnit, realCurrency, this.orderAmountPct, this.exchangeAccount.balance[this.marketType][realCurrency].free, )
            return '=' + new Decimal(this.orderAmountPct).div(100).mul(this.exchangeAccount.balance[this.marketType][realCurrency]?.free || 0).toDecimalPlaces(this.getPrecisionByUnit(this.orderAmountUnit)).toNumber() + realCurrency
        },
        isFormValid() {
            return this.validateForm()
        },
        orders() {
            const displayOrders = []
            Object.values(this.exchangeAccount?.orders || {}).forEach(({ orders }) => {
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
                const matchReg = /(\w+)\/(\w+):?(\w+)?/
                const aMatch = matchReg.exec(a.symbol)
                const aValue = aMatch[3] === aMatch[2] ? a.notional : a.contracts * a.contractSize

                const bMatch = matchReg.exec(b.symbol)
                const bValue = bMatch[3] === bMatch[2] ? b.notional : b.contracts * b.contractSize
                return bValue - aValue
            }) || []
        },
        canChangeLeverage() {
            return !!this.curPosition
        },
        showWithSLTP() {
            if (this.orderType === ORDER_TYPES.SLTP) {
                return false
            }
            if (this.isSpotMarket) {
                return this.orderSide === ORDER_SIDES.BUY
            }
            if (this.isLinearPerpMarket || this.isInversePerpMarket) {
                return !this.reduceOnly
            }
            return !this.reduceOnly
        },
    },
    watch: {
        symbolsNeedTicker(newVal, oldVal) {
            // console.log('symbolsNeedTicker', newVal, oldVal)
            if (_.isEqual(newVal, oldVal)) return
            socket.subscribeTickers(this.exchange, this.symbolsNeedTicker, (tickers) => {
                // console.log('tickersUpdate', this.symbolsNeedTicker, this.market.symbol, tickers);
                this.tickers = tickers
            })
        },
    },
    mounted() {
        this.initExchanges()
    },
}
</script>

<template>
    <MarketSelectPanel :visible="dialogVisible" @close="closeDialog" @search="searchMarkets"
        @favorite="changeMarketFavorite" :markets="markets" @change-market="changeMarket"></MarketSelectPanel>
    <el-row align="middle" style="height: 60px; border-bottom: 2px solid gray; padding: 0 10px;">
        <!-- 选择交易所 -->
        <el-col style="flex-basis: 200px">
            <el-select v-model="exchange">
                <el-option v-for="item in exchanges" :key="item" :label="item" :value="item"></el-option>
            </el-select>
        </el-col>
    </el-row>
    <el-row align="middle" justify="space-between"
        style="height: 60px; border-bottom: 2px solid gray; position: sticky; top: 0; z-index: 999; background: black !important;"
        @click="backTop">
        <!-- 选择交易对，并显示最新收盘价 -->
        <el-col style="flex-basis: 50%;">
            <el-button text @click="dialogVisible = true">{{ curSymbol }}<el-icon style="margin-left: 10px;">
                    <ArrowDownBold />
                </el-icon></el-button>
        </el-col>
        <el-col style="flex-basis: 50%;">
            <div>{{ lastPrice }}</div>
            <div v-show="priceChanged" :style="{ color: ticker.change >= 0 ? 'green' : 'red' }">{{ priceChanged }}</div>
        </el-col>
    </el-row>
    <el-row align="middle" justify="space-between" style="height: 40px; padding: 10px 10px;">
        <!-- 选择订单类型，市价/止盈止损等 -->
        <el-col style="flex-basis: 100px;">
            <el-select :model-value="orderType" placeholder="Select" style="width: 100px;"
                @change="handleOrderTypeChange">
                <el-option v-for="item in ORDER_TYPES" :key="item" :label="orderTypesLabel[item]"
                    :value="item"></el-option>
            </el-select>
        </el-col>
        <!-- 合约仓位类型，只支持逐仓 -->
        <el-col v-if="!isSpotMarket" style="flex-basis: 100px;">
            <el-select :model-value="marginMode" @change="handleMarginModeChange">
                <el-option v-for="item in MARGIN_MODES" :key="item" :label="item === MARGIN_MODES.CROSS ? '全仓' : '逐仓'"
                    :value="item" :disabled="item === MARGIN_MODES.CROSS"></el-option>
            </el-select>
        </el-col>
        <!-- 合约杠杆倍数 -->
        <el-col v-if="!isSpotMarket" style="flex-basis: 100px;">
            <el-select :model-value="leverage" @change="handleLeverageChange" :disabled="this.canChangeLeverage">
                <el-option v-for="item in [1, 2, 3, 4, 5]" :key="item" :label="item+'x'" :value="item"></el-option>
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
                :disabled="isSideDisabled(ORDER_SIDES.SELL)" @click="handleSideChange(ORDER_SIDES.SELL)">{{ sellLabel
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
    <!-- 止盈止损触发价格 -->
    <div v-show="orderType === ORDER_TYPES.SLTP" style="display: flex; flex-direction: column; padding: 0 10px;">
        <el-input v-model="tpPrice" type="number" clearable :controls="false" :min="0"
            :placeholder="`止盈触发价(${market[ORDER_AMOUNT_TYPES.QUOTE]})`" style="width: 100%;"></el-input>
        <el-input v-model="slPrice" type="number" clearable :controls="false" :min="0"
            :placeholder="`止损触发价(${market[ORDER_AMOUNT_TYPES.QUOTE]})`"
            style="width: 100%; margin-top: 5px;"></el-input>
    </div>
    <!-- 下单仓位数量 -->
    <div style="position: relative; padding: 10px 10px;">
        <el-input type="number" clearable v-model="orderAmount" @change="handleAmountChange"
            @focus="orderUsePct = false" :controls="false" :placeholder="isSpotMarket ? '数量' : '数量(保证金)'"
            :class="{ 'is-estimate-amount': orderUsePct, 'order-amount-input': true }">
            <template #prefix>
                <span v-show="orderUsePct">预估</span>
            </template>
            <template #append>
                <el-select style="width: 100px;" :model-value="orderAmountUnit" :disabled="false"
                    @change="handleAmountUnitChange">
                    <el-option :label="market[ORDER_AMOUNT_TYPES.BASE]" :value="ORDER_AMOUNT_TYPES.BASE"></el-option>
                    <el-option :label="market[ORDER_AMOUNT_TYPES.QUOTE]" :value="ORDER_AMOUNT_TYPES.QUOTE"></el-option>
                </el-select>
            </template>
        </el-input>
        <!-- 可下单总数为预估且百分比下单时使用的真实资产数量 -->
        <span v-show="orderUsePct"
            style="position: absolute; top: 45px; color: white; font-size: 12px; left: 45%; transform: translateX(-50%);">{{
            realCurrencyAmount }}</span>
    </div>
    <!-- 下单仓位数量百分比 -->
    <div style="padding: 10px 10px 10px 20px;">
        <el-slider v-model="orderAmountPct" @change="handleAmountPctChange"
            :marks="{ 0: '0', 25: '25', 50: '50', 75: '75', 100: '100' }" show-input size="small"
            :show-tooltip="true" />
    </div>
    <!-- 下单是否附带止盈止损 -->
    <div v-show="showWithSLTP" style="display: flex; align-items: center; padding: 10px 10px 0 10px;">
        <el-checkbox v-model="orderWithSLTP" label="止盈止损" />
    </div>
    <!-- 合约只减仓 -->
    <div v-show="reduceOnly" style="display: flex; align-items: center; padding: 10px 10px 0 10px;">
        <el-checkbox :model-value="true" label="只减仓" disabled />
    </div>
    <!-- 下单附带止盈止损设置 -->
    <div v-show="orderWithSLTP" style="padding: 0 10px;">
        <div style="display: flex; align-items: center; margin-bottom: 5px;">
            <el-input v-model="tpPrice" type="number" clearable :controls="false" :min="0"
                :placeholder="`止盈触发价(${market[ORDER_AMOUNT_TYPES.QUOTE]})`" style="flex-grow: 1;"></el-input>
        </div>
        <div style="display: flex; align-items: center;">
            <el-input v-model="slPrice" type="number" clearable :controls="false" :min="0"
                :placeholder="`止损触发价(${market[ORDER_AMOUNT_TYPES.QUOTE]})`" style="flex-grow: 1;"></el-input>
        </div>
    </div>
    <!-- 下单 -->
    <div style="display: flex; padding: 20px 10px;">
        <el-button :type="isFormValid ? 'primary' : 'info'" size="large" style="flex-grow: 1;" :disabled="!isFormValid"
            @click="handleCreateOrder">{{ this.orderId ? `改单(${this.orderId})` : '下单' }}</el-button>
    </div>
    <!-- 余额/仓位/委托... -->
    <el-tabs type="card" style="flex: 0 1 auto; padding: 10px; overflow: hidden;" class="account-tabs">
        <el-tab-pane label="总览">
            <template v-if="curOrders.length">
                <Order v-for="item in curOrders" :key="item._id" :order="item" @cancel="handleCancelOrder"
                    @edit="handleEditOrder" @jump-market="handleJumpMarket">
                </Order>
            </template>
            <Position v-if="curPosition" :position="curPosition" @close-position="handleClosePosition"
                @sltp="handleSLTPPosition" @jump-market="handleJumpMarket">
            </Position>
            <Balance v-for="item in balances" :key="item.currency" :balance="item"
                :isCurQuote="item.currency === market.quote" @jump-market="handleJumpMarket">
            </Balance>
        </el-tab-pane>
        <el-tab-pane :label="`仓位(${positions?.length})`">
            <Position v-for="item in positions" :key="item.symbol" :position="item"
                @close-position="handleClosePosition" @sltp="handleSLTPPosition" @jump-market="handleJumpMarket">
            </Position>
        </el-tab-pane>
        <el-tab-pane :label="`委托(${orders.length})`">
            <Order v-for="item in orders" :key="item._id" :order="item" @cancel="handleCancelOrder"
                @edit="handleEditOrder" @jump-market="handleJumpMarket">
            </Order>
        </el-tab-pane>
    </el-tabs>
</template>

<style scoped>
/* .order-amount-input {
} */

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
</style>
