<script setup lang="ts">
import Prompt from 'aarc-core/components/common/Prompt.vue';

withDefaults(defineProps<{
    stolen?: boolean // true：心跳已被他人接管；false：心跳多次失败（网络问题）
}>(), {
    stolen: false
})
const emit = defineEmits<{
    (e:'ok'):void
}>()
</script>

<template>
<Prompt :close-btn="true" :close-btn-delay="stolen ? 3 : 0" @close="emit('ok')">
    <div class="heartbeatFail">
        <div class="heartbeatFailTitle">警告</div>
        <div v-if="stolen">
            画布已被<b>他人进入编辑</b><br/>
            您未保存的更改将<b>无法保存</b><br/>
            请重新进入画布
        </div>
        <div v-else>
            心跳已<b>多次失败</b>，若持续失败<br/>
            将<b>允许他人进入编辑</b>，您的进度可能丢失<br/>
            请<b>检查网络连接</b>，并立即<b>保存</b>一次
        </div>
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
        color:palevioletred;
    }
}
</style>
