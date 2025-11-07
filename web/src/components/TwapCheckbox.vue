<script>
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
    },
    methods: {
        handleUpdate(key, value) {
            // console.log('handleUpdate', key, value)
            this.$emit(`update:${key}`, value)
        },
    },
}
</script>
<template>
    <div class="twap-checkbox">
        <el-checkbox :model-value="checked" @change="handleUpdate('checked', $event)" label="TWAP"></el-checkbox>
        <el-input v-show="checked" :model-value="totalMinute" class="total-minute" size="small" type="number"
            inputmode="numeric" @input="handleUpdate('totalMinute', $event)">
            <template #prepend>分钟</template>
        </el-input>
        <el-input v-show="checked" :model-value="priceLimit" class="price-limit" size="small" type="number"
            inputmode="decimal" @input="handleUpdate('priceLimit', $event)">
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
}
.total-minute {
    flex: 2 0 0;
    margin-left: 10px;
}
.price-limit {
    flex: 3 0 0;
}
</style>