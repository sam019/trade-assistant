<script>
import { debounce } from "lodash"

import { MARKET_TYPES } from '../../../share/const'

export default {
    props: {
        visible: {
            type: Boolean,
            required: true,
        },
        markets: {
            type: Object,
            // required: true,
        },
    },
    data() {
        return {
            keywords: "",
            curTab: "spot",
        }
    },
    methods: {
        onClosed() {
            this.$emit('close')
            this.keywords = ""
        },
        onOpen() {
            // console.log('onOpened')
            this.$emit('search')
            this.$nextTick(() => {
                this.$refs.input?.focus()
            })
        },
        handleKeywordsChange: debounce(function () {
            console.log(this.keywords)
            this.$emit('search', this.keywords)
        }, 500),
    },
    computed: {
        tabs() {
            return [
                { label: '现货', name: MARKET_TYPES.SPOT, markets: this.markets?.spot || [] },
                { label: 'U本位永续', name: MARKET_TYPES.LINEAR, markets: this.markets?.linear || [] },
                { label: '币本位永续', name: MARKET_TYPES.INVERSE, markets: this.markets?.inverse || [] },
            ]
        },
    },
}
</script>
<template>
    <el-dialog :model-value="visible" @closed="onClosed" @open="onOpen" style="width: 100vw; max-width: 720px">
        <!-- 交易对搜索 -->
        <div style="display: flex; align-items: center; padding: 10px">
            <el-input ref="input" v-model="keywords" @input="handleKeywordsChange" prefix-icon="Search"
                size="large"></el-input>
        </div>
        <!-- 可用交易对 -->
        <el-tabs v-model="curTab" type="border-card" style="margin: 0 10px" class="tabs">
            <el-tab-pane v-for="tab in tabs" :key="tab.name" :label="tab.label" :name="tab.name">
                <el-row v-for="market in tab.markets" :key="market.id" align="middle" class="market"
                    @click="$emit('changeMarket', market)">
                    <el-col style="flex-basis: auto; padding: 3px 10px 0 0;" @click.stop="$emit('favorite', market)">
                        <el-icon v-if="!market.isFavorite">
                            <star />
                        </el-icon>
                        <el-icon v-else><star-filled style="color: orange" /></el-icon></el-col>
                    <el-col style="flex-basis: auto">{{ market.symbol }}</el-col>
                </el-row>
                <el-row v-if="!tab.markets.length" align="middle" justify="center" class="market"
                    style="color: gray; border-bottom: none">无数据</el-row>
            </el-tab-pane>
        </el-tabs>
    </el-dialog>
</template>
<style scoped>
.tabs :deep(.el-tabs__content) {
    max-height: 60vh;
    overflow-y: auto;
}

.market {
    height: 50px;
    border-bottom: 1px solid gray;
    cursor: pointer;
}
</style>
