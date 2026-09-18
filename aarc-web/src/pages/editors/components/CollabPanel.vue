<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import SideBar from 'aarc-core/components/common/SideBar.vue'
import Prompt from 'aarc-core/components/common/Prompt.vue'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useCollabSessionStore } from 'aarc-core/models/collab/collabSessionStore'
import collabIcon from '@/assets/ui/collab.svg'

// 多人协作面板（参考 ChatRoom.vue）：展开按钮在聊天按钮左侧，
// 内部只有功能开关——存档所有者可编辑，其他人仅能看到启用状态。
// 开关存于 save.meta.collabEnabled；启用时才加入协作房间（SignalR），
// 关闭时所有人断开并收到"所有者已关闭协作"弹窗（由 Editor.vue 编排，notifyCollabClosed 触发）。
const props = defineProps<{
    /** 当前用户是否存档所有者（仅所有者可编辑开关） */
    isOwner: boolean
    viewOnly: boolean
}>()
const emit = defineEmits<{
    enable: []
    disable: []
}>()

const saveStore = useSaveStore()
const collabSession = useCollabSessionStore()
const sidebar = useTemplateRef('sidebar')
const showClosedPrompt = ref(false)

const enabled = computed(() => saveStore.save?.meta.collabEnabled === true)
const canEdit = computed(() => props.isOwner && !props.viewOnly)
const sessionStatus = computed(() => {
    if (!enabled.value)
        return ''
    if (!collabSession.isInSession)
        return '未连接'
    if (collabSession.state === 'syncing')
        return '正在同步'
    if (collabSession.connState !== 'online')
        return '连接已断开'
    return `协作中（${collabSession.members.length} 人在线）`
})

function open() {
    sidebar.value?.extend()
}
function onToggle() {
    if (!canEdit.value)
        return
    if (enabled.value)
        emit('disable')
    else
        emit('enable')
}
/** 供外部（Editor.vue）在协作被关闭时调用，弹出提示 */
function notifyCollabClosed() {
    showClosedPrompt.value = true
}
defineExpose({ notifyCollabClosed })
</script>

<template>
<Prompt v-if="showClosedPrompt" :bgClickClose="false" closeBtn="我知道了" @close="showClosedPrompt=false">
    <div class="closedPrompt">
        <p>所有者已关闭协作</p>
    </div>
</Prompt>
<div class="collabOuter">
    <div class="collabBtn" @click="open" title="多人协作">
        <img :src="collabIcon" alt="协作"/>
    </div>
    <SideBar ref="sidebar" :shrink-way="'v-show'">
        <div class="collabPanel">
            <div class="header">多人协作</div>
            <div class="row">
                <span class="label">功能开关</span>
                <button v-if="canEdit" class="toggleBtn" :class="{ on: enabled }" @click="onToggle">
                    {{ enabled ? '已启用' : '已关闭' }}
                </button>
                <span v-else class="stateText" :class="{ on: enabled }">
                    {{ enabled ? '已启用' : '未启用' }}
                </span>
            </div>
            <div v-if="sessionStatus" class="sessionStatus">{{ sessionStatus }}</div>
            <div class="tips">
                启用后，多名用户可同时编辑本存档并实时同步；仅存档所有者可修改此开关。
            </div>
        </div>
    </SideBar>
</div>
</template>

<style scoped lang="scss">
.collabOuter {
    display: inline-block;
}
.closedPrompt {
    text-align: center;
    p {
        font-size: 18px;
        font-weight: bold;
        margin: 0;
    }
}
.collabBtn {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 6px;
    background-color: white;
    transition: background-color 0.2s;
    box-shadow: 0px 0px 5px 0px rgba(0,0,0,0.3);
    &:hover {
        background-color: #e0e0e0;
    }
    img {
        width: 22px;
        height: 22px;
    }
}
.collabPanel {
    padding: 20px 10px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    .header {
        font-size: 18px;
        font-weight: bold;
    }
    .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        .label {
            font-size: 15px;
        }
        .toggleBtn {
            border: none;
            border-radius: 6px;
            background-color: #aaa;
            color: white;
            cursor: pointer;
            padding-left: 16px;
            padding-right: 16px;
            &.on {
                background-color: #4a90e2;
            }
        }
        .stateText {
            font-size: 15px;
            color: #999;
            &.on {
                color: #4a90e2;
            }
        }
    }
    .sessionStatus {
        font-size: 14px;
        color: #666;
        text-align: center;
    }
    .tips {
        font-size: 13px;
        color: #999;
        line-height: 1.6;
    }
}
</style>
