<script>
import Decimal from 'decimal.js'
import { ORDER_AMOUNT_TYPES, POSITION_SIDES } from '../../../share/const'

export default {
    inject: ['positions'],
    props: {
        order: {
            type: Object,
            required: true,
        },
    },
    data() {
        return {
            ORDER_AMOUNT_TYPES, POSITION_SIDES,
        }
    },
    computed: {
        baseQuote() {
            const match = this.order.symbol.match(/(\w+)\/(\w+):?(\w+)?/)
            // console.log('baseQuoteLinear', match);
            return match.slice(1)
        },
        isSpot() {
            return !this.baseQuote[2]
        },
        isLinearPerp() {
            return this.baseQuote[2] === this.baseQuote[1]
        },
        marketLabel() {
            if (this.isSpot) {
                return ''
            }
            if (this.baseQuote[2] === this.baseQuote[1]) {
                return 'U永续'
            }
            return '币永续'
        },
        position() {
            return this.positions.find(pos => pos.symbol === this.order.symbol)
        },
        // 是否平空
        isSellShort() {
            return this.position?.side === POSITION_SIDES.SHORT
        },
        orderSideLabel() {
            if (this.isSpot) {
                return '卖出'
            }
            if (this.isSellShort) {
                return '平空'
            }
            return '平多'
        },
        orderAmountAsQuote() {
            if (this.isSpot) {
                return this.order.amount

            }
            if (this.isLinearPerp) {
                const amountValue = new Decimal(this.order.amount).div(this.position?.contracts || 0).mul(this.position?.notional || 0).toNumber()
                return this.order.amount + `/${amountValue}`
            }
            const amountValue = new Decimal(this.order.amount).div(this.position?.contracts || 0).mul(this.position?.notional || 0).toNumber()
            return this.order.amount + `/${amountValue}`
        },
        quoteCurrency() {
            if (this.isSpot) {
                return this.baseQuote[this.order.unit === ORDER_AMOUNT_TYPES.BASE ? 0 : 1]
            }
            return this.isLinearPerp ? this.baseQuote[1] : this.baseQuote[0]
        },
        contractCurrency() {
            return this.isLinearPerp ? this.baseQuote[0] : this.baseQuote[1]
        },
    },
}
</script>
<template>
    <div class="order">
        <div class="row1">
            <div style="display: flex; gap: 5px; align-items: center;">
                <template v-if="isSpot">
                    <el-tag type="info" style="color: white" effect="plain" size="small" @click="$emit('jumpMarket', order.symbol)">{{
                        order.symbol
                        }}</el-tag>
                    <el-tag type="danger" size="small">{{ orderSideLabel }}</el-tag>
                </template>
                <template v-else-if="position">
                    <el-tag :type="isLinearPerp ? 'primary' : 'warning'" @click="$emit('jumpMarket', order.symbol)">{{
                        order.symbol }}</el-tag>
                    <div class="tags">
                        <el-tag :type="isSellShort ? 'success' : 'danger'" size="small">止盈止损</el-tag>
                        <el-tag :type="isSellShort ? 'success' : 'danger'" size="small">{{ orderSideLabel }}</el-tag>
                    </div>
                </template>
                <div v-else style="padding: 5px 0;">
                    <el-tag :type="isLinearPerp ? 'primary' : 'warning'">{{ order.symbol }}</el-tag>
                    <span style="margin-left: 5px;">未检测到仓位</span>
                </div>
            </div>
            <div>
                <el-button plain type="" size="small" style="width: 60px;" @click="$emit('edit', order)">编辑</el-button>
                <el-button plain type="primary" size="small" style="width: 60px;"
                    @click="$emit('cancel', order)">撤单</el-button>
            </div>
        </div>
        <div class="row2" v-if="isSpot || position">
            <div>
                <div class="label">止盈触发价(标记)</div>
                <div class="value">{{ order.tpPrice || '-' }}</div>
            </div>
            <div :style="{ visibility: order.slPrice ? '' : 'hidden' }">
                <div class="label">止损触发价(标记)</div>
                <div class="value">{{ order.slPrice || '-' }}</div>
            </div>
            <div>
                <div class="label">委托数量(<template v-if="!isSpot">{{ contractCurrency }}/</template>{{ quoteCurrency }})
                </div>
                <div class="value">{{ orderAmountAsQuote }}</div>
            </div>
        </div>
    </div>
</template>
<style scoped>
.order {
    font-size: 12px;
    border-bottom: 1px solid gray;
    text-align: left;
    margin: 5px;
}

.symbol {
    font-weight: bold;
}

.row1 {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 5px;
}

.row2 {
    display: flex;
    margin: 5px 0;
    gap: 5px;
    &>div {
        flex: 1 1 0;
        overflow: hidden;
    }
}

.label {
    color: gray;
}

.value {
    overflow: hidden;
    text-overflow: ellipsis;
}
</style>