<script>
import Decimal from 'decimal.js';
import { STABLE_COINS } from '../../../const/const';
// TODO 用tickers获取last，并计算价值

export default {
    inject: ['tickers'],
    props: {
        balance: {
            type: Object,
            required: true
        },
        isCurQuote: {
            type: Boolean,
            default: false
        },
    },
    data() {
        return {
            STABLE_COINS
        }
    },
    methods: {
        formatValue(value) {
            return value ? `\$${value}` : '';
        }
    },
    computed: {
        isStableCoin() {
            return Object.values(STABLE_COINS).includes(this.balance.currency);
        },
        evaluateValue() {
            return this.balance.evaluateValue;
        }
    }
}
</script>
<template>
    <div class="balance" :style="{ border: isStableCoin && isCurQuote ? '' : '' }">
        <div class="row1">
            <el-tag type="info" style="color: white;" @click="!isStableCoin && $emit('jumpMarket', `${balance.currency}/${STABLE_COINS.USDT}`)">
                {{ balance.currency }}</el-tag>
            <div v-if="!isStableCoin">
                <div>{{ evaluateValue.lastPrice }}</div>
            </div>
        </div>
        <div class="row2">
            <div>
                <div class="label">资产余额(现货)</div>
                <div class="amount">{{ balance.spot || '-' }}</div>
                <div class="value" v-if="!isStableCoin">{{ formatValue(evaluateValue.spot) }}</div>
            </div>
            <div>
                <div class="label">资产余额(U永续)</div>
                <div class="amount">{{ balance.linear || '-' }}</div>
                <div class="value" v-if="!isStableCoin">{{ formatValue(evaluateValue.linear) }}</div>
            </div>
            <div>
                <div class="label">资产余额(币永续)</div>
                <div class="amount">{{ balance.inverse || '-' }}</div>
                <div class="value" v-if="!isStableCoin">{{ formatValue(evaluateValue.inverse) }}</div>
            </div>
        </div>
    </div>
</template>
<style scoped>
.balance {
    margin: 5px;
    text-align: left;
    border-top: 1px solid grey;
    &:nth-child(1 of .balance) {
        border: none;
    }
    &>div {
        margin: 5px 0;
    }
}

.row1 {
    display: flex;
    justify-content: space-between;
    font-size: 14px;
}
.row2 {
    display: flex;
    text-align: left;
    font-size: 12px;
    gap: 5px;
    & > div {
        flex: 1 1 0;
    }
}
.label {
    color: gray;
}
.amount {
    margin: 5px 0 0 0;
}
.value {
    color: gray;
}
</style>