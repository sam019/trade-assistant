<script>
import Decimal from 'decimal.js'

import { POSITION_SIDES, MARGIN_MODES } from 'share/const'
import { checkSymbol } from 'share/utils'

export default {
    props: {
        position: {
            type: Object,
            required: true,
        },
        // market: {
        //     type: Object,
        //     required: true
        // }
    },
    data() {
        return {
            POSITION_SIDES,
        }
    },
    computed: {
        sideLabel() {
            return this.position.side === POSITION_SIDES.LONG ? '多' : '空'
        },
        marginModeLabel() {
            return this.position.marginType === MARGIN_MODES.CROSS ? '全仓' : '逐仓'
        },
        // typeLabel() {
        //     return this.cSymbol.isLinear ? 'U本位' : '币本位'
        // },
        cSymbol() {
            return checkSymbol(this.position.symbol)
        },
        marginRatio() {
            return new Decimal(this.position.marginRatio).mul(100).toNumber()
        },
        contractAmount() {
            return new Decimal(this.position.contracts).mul(this.position.contractSize).toNumber()
        },
    },
}
</script>
<template>
    <div class="position">
        <div class="summary">
            <el-tag size="small" :type="position.side === POSITION_SIDES.LONG ? 'success' : 'danger'"
                style="margin-right: 5px;">
                {{ sideLabel }}
            </el-tag>
            <el-tag size="" style="font-size: 14px;" :type="cSymbol.isLinear ? 'primary' : 'warning'"
                @click="$emit('jumpMarket', position.symbol)">{{ position.symbol }}</el-tag>
            <!-- <el-tag size="small" :style="{ color: isLinear ? '' : 'warning' }">{{ typeLabel }}</el-tag> -->
            <span style="color: gray;">{{ marginModeLabel }}</span>
            <span style="">{{ position.leverage.longLeverage }}x</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
                <div class="label">未实现盈亏 ({{ cSymbol.quote }})</div>
                <div :class="['pnl', position.unrealizedPnl > 0 ? 'profit' : 'loss']">{{ position.unrealizedPnl }}</div>
            </div>
            <div>
                <div class="label">投资回报率</div>
                <div :class="['pnl', position.unrealizedPnl > 0 ? 'profit' : 'loss']">{{ position.percentage > 0 ? '+' :
                    '' }}{{ position.percentage }}%</div>
            </div>
        </div>
        <div class="row">
            <div>
                <div class="label">持仓数量({{ cSymbol.contractBase }}/{{ cSymbol.contractQuote }})</div>
                <div class="value">{{ contractAmount }}/{{ position.notional }}</div>
            </div>
            <div>
                <div class="label">保证金({{ cSymbol.contractQuote }})</div>
                <div class="value">{{ position.initialMargin }}</div>
            </div>
            <div>
                <div class="label">保证金比率</div>
                <div class="value">{{ marginRatio }}%</div>
            </div>
        </div>
        <div class="row">
            <div>
                <div class="label">开仓价格({{ cSymbol.quote }})</div>
                <div class="value">{{ position.entryPrice }}</div>
            </div>
            <div>
                <div class="label">标记价格({{ cSymbol.quote }})</div>
                <div class="value">{{ position.markPrice }}</div>
            </div>
            <div>
                <div class="label">强平价格({{ cSymbol.quote }})</div>
                <div class="value">{{ position.liquidationPrice }}</div>
            </div>
        </div>
        <div class="control">
            <el-button plain type="primary" size="small" @click="$emit('sltp', position)">止盈止损</el-button>
            <el-popconfirm class="box-item" title="确认平仓吗" confirm-button-text="确认" cancel-button-text="取消"
                placement="top-end" @confirm="$emit('closePosition', position)">
                <template #reference>
                    <el-button plain type="primary" size="small">平仓</el-button>
                </template>
            </el-popconfirm>
        </div>
    </div>
</template>
<style scoped>
.position {
    padding: 5px 0;
    border-bottom: 1px solid gray;
    text-align: left;
    font-size: 12px;
}

.summary {
    display: flex;
    align-items: center;
    margin-bottom: 5px;
    gap: 5px;
}

.pnl {
    font-size: 14px;
}

.profit {
    color: green;
}

.loss {
    color: red;
}

.row {
    display: flex;
    align-items: stretch;
    justify-content: space-between;
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

.control {
    display: flex;

    /* align-items: center; */
    /* justify-content: space-around; */
    &>button {
        flex: 1 1 0;
    }
}
</style>