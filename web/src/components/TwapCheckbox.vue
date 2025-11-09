<script>
import { ORDER_SIDES } from 'share/const'
export default {
    props: {
        checked: {
            type: Boolean,
            required: true,
        },
        totalMinute: {
            type: Number,
            required: false,
        },
        priceLimit: {
            type: Number,
            required: false,
        },
        side: {
            type: String,
            required: true,
        },
    },
    methods: {
        handleUpdate(key, value) {
            // console.log('handleUpdate', key, typeof value)
            this.$emit(`update:${key}`, value ? Number(value) : null)
        },
    },
    computed: {
        priceLimitPlaceholder() {
            return this.side === ORDER_SIDES.BUY ? '不高于' : '不低于'
        },
    },
}
</script>
<template>
    <div class="twap-checkbox">
        <el-checkbox :model-value="checked" @change="$emit('update:checked', $event)" label="TWAP"></el-checkbox>
        <el-input v-show="checked" :model-value="totalMinute" class="total-minute" size="small" type="number"
            inputmode="numeric" @input="handleUpdate('totalMinute', $event)">
            <template #prepend>分钟</template>
        </el-input>
        <el-input v-show="checked" :model-value="priceLimit" class="price-limit" size="small" type="number"
            inputmode="decimal" :placeholder="priceLimitPlaceholder" @input="handleUpdate('priceLimit', $event)">
            <template #prepend>限价</template>
        </el-input>
    </div>
</template>
<style scoped>
.twap-checkbox {
    display: flex;
    align-items: center;
    margin: 0 10px 0;
    :deep(.el-input-group__prepend) {
        padding: 0 6px;
    }
    :deep(.el-input-group__prepend) {
        color: white;
    }
}
.total-minute {
    flex: 2 0 0;
    margin-left: 10px;
}
.price-limit {
    flex: 3 0 0;
}
</style>