<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import SideBar from 'aarc-core/components/common/SideBar.vue'
import Prompt from 'aarc-core/components/common/Prompt.vue'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useCollabSessionStore } from 'aarc-core/models/collab/collabSessionStore'
import { useCollabLogStore } from 'aarc-core/models/collab/collabLogStore'
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents'
import collabIcon from '@/assets/ui/collab.svg'

// 多人协作面板（参考 ChatRoom.vue）：展开按钮在聊天按钮左侧，
// 内部有功能开关（存档所有者可编辑，其他人仅能看到启用状态）、房间内成员列表、
// 以及协作事件日志（他人进/出房、他人的编辑概括；日志由 core collabLogStore 产生）。
// 开关存于 save.meta.collabEnabled；启用时才加入协作房间（SignalR）。
// 两种关闭提示（backend-plan.md §7.1 ②）：
// - "所有者已关闭协作"：房主在面板里关协作开关（collabEnabled=false 经 op 广播），Editor 调 notifyCollabClosed
// - "所有者已关闭房间"：房主关房/断网超宽限期（RoomClosed），Editor 调 notifyRoomClosed
// 均只能按钮关闭（bgClickClose=false）；非房主关闭后立即跳首页，
// 房主不被强制踢出（仍可继续编辑/保存），仅关闭弹窗
const props = defineProps<{
    /** 当前用户是否存档所有者（仅所有者可编辑开关） */
    isOwner: boolean
    viewOnly: boolean
}>()
const emit = defineEmits<{
    enable: []
    disable: []
}>()

const router = useRouter()
const saveStore = useSaveStore()
const collabSession = useCollabSessionStore()
const collabLog = useCollabLogStore()
const { showPop } = useUniqueComponentsStore()
const sidebar = useTemplateRef('sidebar')
const logRef = useTemplateRef('log')
const closedNoticeKind = ref<'collab' | 'room' | null>(null)
let closedNoticeShown = false // 两种关闭提示只弹一次（先到的为准）
const atBottom = ref(true)

const enabled = computed(() => saveStore.save?.meta.collabEnabled === true)
const canEdit = computed(() => props.isOwner && !props.viewOnly)
const sessionStatus = computed(() => {
    if (!enabled.value)
        return ''
    if (!collabSession.isInSession)
        return '未连接'
    if (collabSession.state === 'syncing')
        return '正在同步'
    if (collabSession.ownerOffline)
        return '所有者已离线，等待重连'
    if (collabSession.connState !== 'online')
        return '连接已断开'
    return '协作中'
})

// 新日志到达且原本贴在底部时跟随滚底；用户上翻查看历史时不打断
watch(() => collabLog.entries.length, async () => {
    if (atBottom.value) {
        await nextTick()
        scrollToBottom()
    }
})

function isScrolledToBottom(el: HTMLElement | null): boolean {
    if (!el)
        return true
    return el.scrollHeight <= el.clientHeight + el.scrollTop + 2
}
function scrollToBottom() {
    const el = logRef.value as HTMLElement | null
    if (!el)
        return
    el.scrollTop = el.scrollHeight
    atBottom.value = true
}
function checkAtBottom() {
    atBottom.value = isScrolledToBottom(logRef.value as HTMLElement | null)
}
function formatTime(time: number): string {
    return new Date(time).toLocaleTimeString()
}

function open() {
    sidebar.value?.extend()
}
// 启用协作前的知情确认（仅房主在未启用时可见）：四项全部勾选后才允许开启
const ackItems = [
    '我明白：协作开启后他人的更改是无法追踪记录的，所以仅在完全信任“允许编辑的人”的情况下，才能开启本功能，绝对不应在允许陌生人编辑的存档中开启',
    '我明白：房主必须时刻保持在线，不能断网或是离开浏览器，否则会打断他人编辑',
    '我明白：保存由房主负责，完成后房主应点击左下角离开按钮而非直接关闭浏览器',
    '我明白：凌晨1点后（或紧急情况）需要更新服务端时，可能造成协作房间短时间中断',
    '我清楚如何反馈问题，我能清晰描述问题产生条件和时机。',
]
const ackChecks = ref<boolean[]>(ackItems.map(() => false))
const allAcked = computed(() => ackChecks.value.every(c => c))
function onToggle() {
    if (!canEdit.value)
        return
    if (enabled.value) {
        if (!window.confirm('关闭会立即触发一次保存，并将其他人踢出，确定关闭吗？'))
            return
        emit('disable')
    }
    else {
        if (!allAcked.value) {
            showPop('请将项目全部勾选', 'failed')
            return
        }
        if (!window.confirm('启用会立即触发一次保存，并允许其他人进入，确定启用吗？'))
            return
        emit('enable')
    }
}
/** 供外部（Editor.vue）在"所有者已关闭协作"时调用，弹出提示 */
function notifyCollabClosed() {
    showClosedNotice('collab')
}
/** 供外部（Editor.vue）在 RoomClosed（房主关房/断网超时）时调用，弹出提示 */
function notifyRoomClosed() {
    showClosedNotice('room')
}
function showClosedNotice(kind: 'collab' | 'room') {
    if (closedNoticeShown)
        return
    closedNoticeShown = true
    closedNoticeKind.value = kind
}
/** 关闭弹窗：非房主跳转首页（协作已无从保存，留在页面无意义）；房主仅关闭弹窗，不被强制踢出 */
function onClosedNoticeClose() {
    closedNoticeKind.value = null
    if (!props.isOwner)
        void router.push('/')
}
defineExpose({ notifyCollabClosed, notifyRoomClosed })
</script>

<template>
<Prompt v-if="closedNoticeKind === 'collab'" :bgClickClose="false" closeBtn="我知道了" @close="onClosedNoticeClose">
    <div class="closedPrompt">
        <p>所有者已关闭协作</p>
    </div>
</Prompt>
<Prompt v-else-if="closedNoticeKind === 'room'" :bgClickClose="false" closeBtn="我知道了" @close="onClosedNoticeClose">
    <div class="closedPrompt">
        <p>所有者已关闭房间</p>
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
                    {{ enabled ? '已启用' : '点击启用' }}
                </button>
                <span v-else class="stateText" :class="{ on: enabled }">
                    {{ enabled ? '已启用' : '未启用' }}
                </span>
            </div>
            <div v-if="!enabled && isOwner" class="ackList">
                <label v-for="(item, i) in ackItems" :key="i" class="ackItem">
                    <input type="checkbox" v-model="ackChecks[i]"/>
                    <span>{{ item }}</span>
                </label>
            </div>
            <div v-if="sessionStatus" class="sessionStatus">{{ sessionStatus }}</div>
            <div v-if="collabSession.isInSession" class="members">
                <div class="sectionTitle">在线成员</div>
                <div v-for="m in collabSession.members" :key="m.userId" class="member">
                    <span class="memberName">{{ m.userName }}</span>
                    <span v-if="m.userId === collabSession.ownerUserId" class="badge owner">房主</span>
                    <span v-if="m.userId === collabSession.myUserId" class="badge me">我</span>
                </div>
            </div>
            <div v-if="collabSession.isInSession" class="logWrap">
                <div class="sectionTitle">事件日志</div>
                <div ref="log" class="log" @scroll="checkAtBottom">
                    <div v-for="e in collabLog.entries" :key="e.id" class="logEntry" :class="e.kind">
                        <span class="time">{{ formatTime(e.time) }}</span>
                        <span class="userName">{{ e.userName }}</span>
                        <span class="text">{{ e.text }}</span>
                    </div>
                    <div v-if="collabLog.entries.length === 0" class="emptyTip">暂无事件</div>
                </div>
            </div>
            <div v-else class="tips">
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
    height: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 16px;
    .header {
        font-size: 18px;
        font-weight: bold;
    }
    .sectionTitle {
        font-size: 13px;
        color: #999;
        margin-bottom: 6px;
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
    .ackList {
        display: flex;
        flex-direction: column;
        gap: 8px;
        .ackItem {
            display: flex;
            align-items: flex-start;
            gap: 6px;
            font-size: 13px;
            line-height: 1.5;
            color: #666;
            cursor: pointer;
            input {
                flex-shrink: 0;
                margin-top: 3px;
                cursor: pointer;
            }
        }
    }
    .sessionStatus {
        font-size: 14px;
        color: #666;
        text-align: center;
    }
    .members {
        .member {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 14px;
            line-height: 1.9;
            .memberName {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .badge {
                flex-shrink: 0;
                font-size: 12px;
                border-radius: 4px;
                padding: 0 5px;
                color: white;
                &.owner {
                    background-color: #e8a33d;
                }
                &.me {
                    background-color: #4a90e2;
                }
            }
        }
    }
    .logWrap {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        .log {
            flex: 1;
            min-height: 120px;
            overflow-y: auto;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 8px;
            background-color: #f9f9f9;
            display: flex;
            flex-direction: column;
            gap: 4px;
            .logEntry {
                font-size: 13px;
                line-height: 1.5;
                word-break: break-word;
                .time {
                    color: #999;
                    margin-right: 6px;
                }
                .userName {
                    font-weight: bold;
                    margin-right: 4px;
                }
                // 进/出房属系统事件，弱化为居中浅色斜体（对应 ChatRoom 的 system 变体）
                &.join,
                &.leave {
                    text-align: center;
                    color: #856404;
                    font-style: italic;
                    .userName {
                        font-weight: normal;
                    }
                }
            }
            .emptyTip {
                align-self: center;
                color: #999;
                margin-top: auto;
                margin-bottom: auto;
            }
        }
    }
    .tips {
        font-size: 13px;
        color: #999;
        line-height: 1.6;
    }
}
</style>
