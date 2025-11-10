<script>
import Decimal from 'decimal.js'

import { ORDER_SIDES, ORDER_STATES, POSITION_SIDES } from 'share/const'
import { checkSymbol } from 'share/utils'

export default {
    inject: ['positions'],
    props: {
        order: {
            type: Object,
            required: true,
        },
    },
    computed: {
        cSymbol() {
            return checkSymbol(this.order.symbol)
        },
        unitName() {
            return this.cSymbol.isSpot ? this.cSymbol[this.order.unit] : this.cSymbol.contractBase
        },
        position() {
            return !this.cSymbol.isSpot && this.positions.find(pos => pos.symbol === this.order.symbol)
        },
        positionSide(_, previous) {
            return this.position?.side || previous
        },
        sideLabel() {
            if (this.cSymbol.isSpot) {
                return this.order.side === ORDER_SIDES.BUY ? '买' : '卖'
            } else {
                // return this.order.side === ORDER_SIDES.BUY ? '多' : '空'
                if (this.positionSide) {
                    if (this.positionSide === POSITION_SIDES.LONG) {
                        return this.order.side === ORDER_SIDES.BUY ? '做多' : '卖多'
                    } else {
                        return this.order.side === ORDER_SIDES.SELL ? '做空' : '卖空'
                    }
                } else {
                    return this.order.side === ORDER_SIDES.BUY ? '做多' : '做空'
                }
            }
        },
        isBuy() {
            return this.order.side === ORDER_SIDES.BUY
        },
        percentage() {
            return parseInt(this.order.filledAmount / this.order.totalAmount * 100)
        },
        status() {
            const statusMap = {
                [ORDER_STATES.STOPED]: 'exception',
                [ORDER_STATES.SUSPEND]: 'warning',
                [ORDER_STATES.RESOLVED]: '',
                [ORDER_STATES.OPENING]: '',
            }
            return statusMap[this.order.state]
        },
        statusLabel() {
            const labelMap = {
                [ORDER_STATES.STOPED]: '已暂停',
                [ORDER_STATES.SUSPEND]: '价格超过限价',
            }
            return labelMap[this.order.state]
        },
        isOpening() {
            return this.order.state === ORDER_STATES.OPENING
        },
        isResovled() {
            return this.order.state === ORDER_STATES.RESOLVED
        },
        toggleLabel() {
            return this.order.state === ORDER_STATES.STOPED ? '开启' : '暂停'
        },
        contractSize(_, previous) {
            return this.position?.contractSize || previous
        },
    },
    methods: {
        getContractBaseAmount(amount = 0) {
            return new Decimal(amount).mul(this.contractSize || 1).toNumber()
        },
    },
}
</script>
<template>
    <div class="twap-order">
        <div class="row1">
            <div>
                <el-tag :type="isBuy ? 'success' : 'danger'" effect="dark" size="small">TWAP({{ sideLabel }})</el-tag>
                <el-tag :type="cSymbol.isSpot ? 'info' : cSymbol.isLinear ? 'primary' : 'warning'" effect="dark"
                    size="small" @click="$emit('jumpMarket', order.symbol)">{{ order.symbol }}</el-tag>
                <div class="settings" style="color: white">{{ order.leverage }}x</div>
                <div class="settings"><span>{{ order.totalMinute }}</span><span>分钟</span></div>
                <div v-if="order.priceLimit" class="settings"><span>限价:</span><span>{{ order.priceLimit }}</span></div>
                <div v-if="order.slPrice" class="settings"><span>止损:</span><span>{{ order.slPrice }}</span></div>
            </div>

        </div>
        <div class="row2">
            <div class="progress">
                <el-progress :text-inside="true" :show-text="false" :stroke-width="20" :percentage="percentage"
                    :status="status" :striped="isOpening" :striped-flow="isOpening" :duration="3" color="#909399">
                </el-progress>
                <div class="content">
                    <span>{{ statusLabel || '' }}</span>
                    <span>{{ getContractBaseAmount(order.filledAmount) }}/{{ getContractBaseAmount(order.totalAmount)
                        }}({{ unitName }})</span>
                </div>
            </div>
            <div class="control">
                <el-button v-if="!isResovled" plain size="small" type="info" style="color: white"
                    @click="$emit('toggle', order)">{{ toggleLabel }}</el-button>
                <el-button plain size="small" type="primary" @click="$emit('close', order)">关闭</el-button>
            </div>
        </div>
    </div>

</template>
<style scoped>
.twap-order {
    font-size: 12px;
    border-bottom: 1px solid gray;
    margin: 5px 0;
}

.row1 {
    display: flex;
    justify-content: space-between;
    align-items: center;

    &>div:first-child {
        display: flex;
        align-items: center;
        gap: 5px;
    }

    .el-button {
        width: 40px;
    }
}

.settings {
    color: gray;
    & > span {
        display: inline-block;
    }
}

.row2 {
    display: flex;
    align-items: center;
    margin: 5px 0;
}
.progress {
    position: relative;
    flex: 1 1 0;
}
.content {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    &>span:first-child {
        margin-left: 5px;
    }
    &>span:last-child {
        position: relative;
        right: 50%;
        transform: translateX(50%);
    }
}
.control {
    flex: 0 0 auto;
    margin-left: 5px;
    .el-button {
        width: 40px;
    }
}
</style>