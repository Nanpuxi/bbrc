<script setup lang="ts">
import { computed } from 'vue'
import { useCollabSessionStore } from 'aarc-core/models/collab/collabSessionStore'

// 协作断线/同步蒙层（步骤四 4.6）：会话进行中但不可安全编辑时盖住画布，
// 阻止继续操作（补齐后 diff 基线变动、本地锁已被服务器释放，继续编辑意义不大）。
// SignalR 检测断连有延迟，蒙层出现前产生的编辑会落入会话层的未 ack 待发队列，不会丢失。
const emit = defineEmits<{ leave: [] }>()
const session = useCollabSessionStore()
const show = computed(() => session.isInSession && !session.canEdit)
const msg = computed(() => {
    if (session.state === 'syncing')
        return '正在同步协作内容…'
    if (session.connState === 'reconnecting')
        return '连接已断开，正在尝试重连…'
    return '连接已断开，协作已暂停'
})
</script>

<template>
<div v-if="show" class="collabOverlay">
    <div class="box">
        <div class="msg">{{ msg }}</div>
        <button class="minor" @click="emit('leave')">离开编辑器</button>
    </div>
</div>
</template>

<style scoped lang="scss">
.collabOverlay{
    position: fixed;
    left: 0; top: 0;
    width: 100vw; height: 100vh;
    background-color: rgba(255, 255, 255, 0.75);
    z-index: 400; // 低于聊天窗(499)，断线时聊天仍可用
    display: flex;
    justify-content: center;
    align-items: center;
    .box{
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        .msg{
            font-size: 20px;
            color: #666;
        }
    }
}
</style>
