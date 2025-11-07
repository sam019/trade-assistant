<script>
export default {
    props: {
        order: {
            type: Object,
            required: true,
        },
    },
}
</script>
<template>
    <div class="twap-order">
        <div>{{ order.symbol }}</div>
        <div>{{ order.filledAmount }}/{{ order.totalAmount }}({{ order.unit }})</div>
        <div>总时长: {{ order.totalMinute }}分钟</div>
        <div>限价: {{ order.priceLimit || '无' }}</div>
        <el-button size="small" type="info">关闭</el-button>
    </div>
</template>
<style scoped>
.twap-order {
    display: flex;
    align-items: center;
}
</style>