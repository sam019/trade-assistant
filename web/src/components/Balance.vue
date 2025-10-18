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
        }
    },
    methods: {
        getEvaluateValue(amount) {
            const value = new Decimal(amount || 0).mul(this.ticker?.last || 0).toDecimalPlaces(2).toNumber();
            return value ? `\$${value}` : '';
        }
    },
    computed: {
        isStableCoin() {
            return Object.values(STABLE_COINS).includes(this.balance.currency);
        },
        ticker() {
            const symbol = `${this.balance.currency}/${STABLE_COINS.USDT}`;
            return this.tickers[symbol];
        },
        lastPrice() {
            if (!this.ticker?.last) return '-';
            return `${Math.round(this.ticker.last * 100) / 100}(${this.ticker.percentage < 0 ? '' : '+'}${this.ticker.percentage.toFixed(2)}%)`;
        }
    }
}
</script>
<template>
    <div class="balance" :style="{ border: isStableCoin && isCurQuote ? '' : '' }">
        <div class="row1">
            <div @click="$emit('jumpMarket', balance.currency)">{{ balance.currency }}</div>
            <div v-if="!isStableCoin">
                <!-- <div>最新价格</div> -->
                <div>{{ lastPrice }}</div>
            </div>
        </div>
        <div class="row2">
            <div>
                <div class="label">资产余额(现货)</div>
                <div class="amount">{{ balance.spot || '-' }}</div>
                <div class="value" v-if="!isStableCoin">{{ getEvaluateValue(balance.spot) }}</div>
            </div>
            <div>
                <div class="label">资产余额(U永续)</div>
                <div class="amount">{{ balance.linear || '-' }}</div>
                <div class="value" v-if="!isStableCoin">{{ getEvaluateValue(balance.linear) }}</div>
            </div>
            <div>
                <div class="label">资产余额(币永续)</div>
                <div class="amount">{{ balance.inverse || '-' }}</div>
                <div class="value" v-if="!isStableCoin">{{ getEvaluateValue(balance.inverse) }}</div>
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