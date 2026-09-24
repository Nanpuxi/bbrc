import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * 协作事件日志（会话级，纯数据）：他人进/出房与他人的编辑概括。
 *
 * 数据来源全部在 collabSessionStore 的事件处理里挂钩写入，本 store 不做任何副作用
 * （气泡提示由会话层发，见 activity-log.md §3.2）。环形上限 100 条，超出从头丢弃；
 * 离房（cleanupLocal）清空——日志随会话消亡，重进房间是全新日志。
 */

/** 日志条数上限（协作会话级别的日志无持久化需求） */
export const COLLAB_LOG_MAX_ENTRIES = 100

export type CollabLogKind = 'join' | 'leave' | 'op'

export interface CollabLogEntry {
    id: number
    /** Date.now()，面板里 toLocaleTimeString() */
    time: number
    kind: CollabLogKind
    userName: string
    /** join/leave 为 "加入了协作" 等；op 为概括文本 */
    text: string
}

export const useCollabLogStore = defineStore('collabLog', () => {
    const entries = ref<CollabLogEntry[]>([])
    let idSeq = 0

    function add(entry: { kind: CollabLogKind, userName: string, text: string }): void {
        entries.value.push({ ...entry, id: ++idSeq, time: Date.now() })
        while (entries.value.length > COLLAB_LOG_MAX_ENTRIES)
            entries.value.shift()
    }

    function clear(): void {
        entries.value = []
    }

    return { entries, add, clear }
})
