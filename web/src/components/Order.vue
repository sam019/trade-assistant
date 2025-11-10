<script>
import Decimal from 'decimal.js'
import { ORDER_AMOUNT_TYPES, ORDER_SIDES, ORDER_TYPES, POSITION_SIDES } from 'share/const'
import { checkSymbol } from 'share/utils'

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
        cSymbol() {
            return checkSymbol(this.order.symbol)
        },
        isConditionOrder() {
            return this.order.type === ORDER_TYPES.CONDITION
        },
        marketLabel() {
            if (this.cSymbol.isSpot) {
                return ''
            }
            if (this.cSymbol.isLinear) {
                return 'U永续'
            }
            return '币永续'
        },
        position() {
            return !this.cSymbol.isSpot && this.positions.find(pos => pos.symbol === this.order.symbol)
        },
        tagType() {
            const danger = 'danger'
            const success = 'success'
            if (this.isConditionOrder) {
                if (this.cSymbol.isSpot) return success
                return this.order.side === ORDER_SIDES.SELL ? danger : success
            }
            if (this.cSymbol.isSpot) return danger
            return this.position.side === POSITION_SIDES.LONG ? danger : success
        },
        orderTypeLabel() {
            if (this.isConditionOrder) {
                return '条件委托'
            }
            return '止盈止损'
        },
        orderSideLabel() {
            if (this.isConditionOrder) {
                if (this.cSymbol.isSpot) {
                    return '买入'
                }
                if (this.order.side === ORDER_SIDES.BUY) {
                    return '开多'
                }
                return '开空'
            }
            if (this.cSymbol.isSpot) {
                return '卖出'
            }
            if (this.position?.side === POSITION_SIDES.SHORT) {
                return '平空'
            }
            return '平多'
        },
        orderAmountAsQuote() {
            if (this.cSymbol.isSpot || this.isConditionOrder) {
                return this.order.amount
            }
            if (this.cSymbol.isLinear) {
                const amountValue = new Decimal(this.order.amount).div(this.position?.contracts || 0).mul(this.position?.notional || 0).toNumber()
                return this.order.amount + `/${amountValue}`
            }
            const amountValue = new Decimal(this.order.amount).div(this.position?.contracts || 0).mul(this.position?.notional || 0).toNumber()
            return this.order.amount + `/${amountValue}`
        },
        quoteCurrency() {
            if (this.cSymbol.isSpot || this.isConditionOrder) {
                return this.cSymbol[this.order.unit]
            }
            return this.cSymbol.isLinear ? this.cSymbol.quote : this.cSymbol.base
        },
    },
}
</script>
<template>
    <div class="order">
        <div class="row1">
            <div style="display: flex; gap: 5px; align-items: center;">
                <template v-if="cSymbol.isSpot || isConditionOrder">
                    <el-tag :type="cSymbol.isSpot ? 'info' : cSymbol.isLinear ? 'primary' : 'warning'" effect="dark"
                        size="small" @click="$emit('jumpMarket', order.symbol)">{{ order.symbol }}</el-tag>
                    <div class="tags">
                        <el-tag :type="tagType" size="small">{{ orderTypeLabel }}</el-tag>
                        <el-tag :type="tagType" size="small">{{ orderSideLabel }}</el-tag>
                        <span v-if="order.leverage">{{ order.leverage }}x</span>
                    </div>
                </template>
                <template v-else-if="position">
                    <el-tag :type="cSymbol.isLinear ? 'primary' : 'warning'" effect="dark"
                        @click="$emit('jumpMarket', order.symbol)">{{ order.symbol }}</el-tag>
                    <div class="tags">
                        <el-tag :type="tagType" size="small">{{ orderTypeLabel }}</el-tag>
                        <el-tag :type="tagType" size="small">{{ orderSideLabel }}</el-tag>
                        <span v-if="order.leverage">{{ order.leverage }}x</span>
                    </div>
                </template>
                <div v-else style="padding: 5px 0;">
                    <el-tag :type="cSymbol.isLinear ? 'primary' : 'warning'" effect="dark">{{ order.symbol }}</el-tag>
                    <span style="margin-left: 5px; color: gray">未检测到仓位</span>
                </div>
            </div>
            <div>
                <el-button plain type="" size="small" style="width: 40px;" @click="$emit('edit', order)">编辑</el-button>
                <el-button plain type="primary" size="small" style="width: 40px;"
                    @click="$emit('cancel', order)">撤销</el-button>
            </div>
        </div>
        <template v-if="isConditionOrder">
            <div class="row2">
                <div>
                    <div class="label">触发价格</div>
                    <div class="value">{{ order.triggerPrice || '-' }}</div>
                </div>
                <div>
                    <div class="label">委托数量({{ quoteCurrency }})</div>
                    <div class="value">{{ orderAmountAsQuote }}</div>
                </div>
            </div>
            <div class="row2" v-if="order.withSLTP">
                <div>
                    <div class="label">止盈价格({{ cSymbol.quote }})</div>
                    <div class="value">{{ order.tpPrice || '-' }}</div>
                </div>
                <div>
                    <div class="label">止损价格({{ cSymbol.quote }})</div>
                    <div class="value">{{ order.slPrice || '-' }}</div>
                </div>
            </div>
        </template>
        <div class="row2" v-else>
            <div>
                <div class="label">止盈触发价(标记)</div>
                <div class="value">{{ order.tpPrice || '-' }}</div>
            </div>
            <div :style="{ visibility: order.slPrice ? '' : 'hidden' }">
                <div class="label">止损触发价(标记)</div>
                <div class="value">{{ order.slPrice || '-' }}</div>
            </div>
            <div>
                <div class="label">委托数量
                    (<template v-if="!cSymbol.isSpot">{{ cSymbol.contractBase }}/</template>{{ quoteCurrency }})
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
    padding: 5px 0;
}

.symbol {
    font-weight: bold;
}

.row1 {
    display: flex;
    justify-content: space-between;
    align-items: stretch;
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.value {
    overflow: hidden;
    text-overflow: ellipsis;
}
.tags {
    display: inline-flex;
    align-items: center;
    gap: 5px
}
</style>