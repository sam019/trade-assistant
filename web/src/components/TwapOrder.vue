<script>
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
        sideLabel() {
            if (this.cSymbol.isSpot) {
                return this.order.side === ORDER_SIDES.BUY ? '买' : '卖'
            } else {
                return this.order.side === ORDER_SIDES.BUY ? '多' : '空'
                // if (this.position) {
                //     if (this.position.side === POSITION_SIDES.LONG) {
                //         return this.order.side === ORDER_SIDES.BUY ? '做多' : '卖多'
                //     } else {
                //         return this.order.side === ORDER_SIDES.SELL ? '做空' : '卖空'
                //     }
                // } else {
                //     return this.order.side === ORDER_SIDES.BUY ? '做多' : '做空'
                // }
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
        // allowToggle() {
        //     return this.order.state !== ORDER_STATES.SUSPEND
        // },
    },
}
</script>
<template>
    <div class="twap-order">
        <div class="row1">
            <div>
                <el-tag :type="isBuy ? 'success' : 'danger'" effect="dark" size="small">TWAP({{ sideLabel }})</el-tag>
                <el-tag :type="cSymbol.isSpot ? 'info' : cSymbol.isLinear ? 'primary' : 'warning'" effect="dark"
                    size="small">{{ order.symbol }}</el-tag>
                <div class="settings">{{ order.totalMinute }}分钟</div>
                <div class="settings">限价: {{ order.priceLimit || '-' }}</div>
            </div>
            <div>
                <el-button v-if="!isResovled" plain size="small" type="info" style="color: white"
                    @click="$emit('toggle', order)">{{ toggleLabel }}</el-button>
                <el-button plain size="small" type="primary" @click="$emit('close', order)">关闭</el-button>
            </div>
        </div>
        <div class="row2">
            <el-progress :text-inside="true" :show-text="false" :stroke-width="20" :percentage="percentage"
                :status="status" :striped="isOpening" :striped-flow="isOpening" :duration="3" color="#909399">
            </el-progress>
            <div class="content">
                <span>{{ statusLabel || '' }}</span>
                <span>{{ order.filledAmount }}/{{ order.totalAmount }}({{ unitName }})</span>
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
}

.row2 {
    position: relative;
    margin: 5px 0;
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
</style>