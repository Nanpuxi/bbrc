<script setup lang="ts">
import Prompt from '@/components/common/Prompt.vue';

const emit = defineEmits<{
    (e:'ok'):void
}>()
</script>

<template>
<Prompt>
    <div class="heartbeatFail">
        <div class="heartbeatFailTitle">警告</div>
        <div>
            心跳已<b>多次失败</b>，若持续失败<br/>
            将<b>允许他人进入编辑</b>，您的进度可能丢失<br/>
            请<b>检查网络连接</b>，并立即<b>保存</b>一次
        </div>
        <button @click="emit('ok')">我知道了</button>
    </div>
</Prompt>
</template>

<style scoped lang="scss">
.heartbeatFail{
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 10px;
    color:#666;
    text-align: center;
    .heartbeatFailTitle{
        color:black;
        font-size: 22px;
    }
    b{
        color:plum
    }
}
</style>
