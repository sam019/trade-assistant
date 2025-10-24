<script>
export default {
    data() {
        return {
            password: ''
        }
    }
}
</script>
<template>
    <div class="login">
        <div>
            <el-input v-model="password" clearable @keyup.enter="$emit('submit', password)"></el-input>
            <el-button type="primary" @click="$emit('submit', password)">提交</el-button>
        </div>
    </div>
</template>
<style scoped>
.login {
    position: fixed;
    z-index: 999;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    /* right: 0;
    bottom: 0; */
    background-color: white;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: #666;
    & > div {
        box-shadow: 10px 10px 5px 0px rgba(0, 0, 0, 0.3);
        padding: 16px;
        border-radius: 5px;
        background-color: white;
        width: 300px;
    }

    .el-button {
        width: 100%;
        margin-top: 5px;
    }
}
</style>