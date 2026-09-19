import { defineStore } from "pinia";
import { computed, ref } from "vue";
import rfdc from "rfdc";
import { ControlPoint, Line, TextTag } from "../save";

const deepClone = rfdc()

/**
 * 协作对象锁（软锁/advisory lock，见 docs/multiplayer/object-locking.md §2）
 *
 * - 锁键带实体类型前缀：`pt:5`、`line:3`、`tag:7`。
 *   注：存档内 id 本就全局唯一（所有类型共用 idIncre 计数器），
 *   前缀不是为去重，而是让锁键自带类型信息，便于直接定位所属数组
 *   （pruneOtherLocks、红叉渲染），免去遍历三个数组判断归属
 * - 本地乐观加锁：激活对象时立即视为持有，不等服务器仲裁；
 *   仲裁败方通过 applyRemoteLock 的冲突返回值走降级（见 models/collab/lockApplier.ts）
 * - 快照表：加锁时可一并登记对象深拷贝（acquireMine 第二参数），
 *   败方降级时据此把对象恢复回"我开始编辑前"的状态，避免半截改动靠 LWW 覆盖他人；
 *   正常释放（提交/取消）时快照随锁一并丢弃
 * - 本 store 不依赖 envStore/selectionStore（避免循环依赖），
 *   "激活时加锁、收尾时释放"的挂钩由 envStore/selectionStore 侧调用
 */

export type CollabLockType = 'pt' | 'line' | 'tag'

export function collabLockKey(type: CollabLockType, id: number): string {
    return `${type}:${id}`
}

/** 从对象引用生成锁键：线有 pts 数组，点有 dir，其余为文本标签 */
export function collabLockKeyOf(obj: ControlPoint | Line | TextTag): string {
    if ('pts' in obj)
        return collabLockKey('line', obj.id)
    if ('dir' in obj)
        return collabLockKey('pt', obj.id)
    return collabLockKey('tag', obj.id)
}

export function parseCollabLockKey(key: string): { type: CollabLockType, id: number } | undefined {
    const m = /^(pt|line|tag):(-?\d+)$/.exec(key)
    if (!m)
        return undefined
    return { type: m[1] as CollabLockType, id: Number(m[2]) }
}

export const useCollabLockStore = defineStore('collabLock', () => {
    /** 他人持有的锁：锁键 → 持有者标识（用户名或 id，用于“被 XX 编辑中”提示） */
    const otherLocks = ref(new Map<string, string>())
    /** 本人持有的锁（乐观获得，无需等服务器确认） */
    const myLocks = ref(new Set<string>())
    /**
     * 我持有的锁对应的"加锁时对象快照"（深拷贝，非响应式）。
     * 仅在败方降级时由 lockApplier 读取并写回 save；正常释放随锁丢弃。
     * 不做 ref：无渲染依赖，且避免对存档对象再包一层响应式
     */
    const myLockSnapshots = new Map<string, ControlPoint | Line | TextTag>()

    /** 传输层挂钩（步骤四接线）：请求/释放锁时回调；未设置时为纯本地行为 */
    const lockRequestHandler = ref<(key: string) => void>()
    const lockReleaseHandler = ref<(key: string) => void>()

    const hasOtherLocks = computed(() => otherLocks.value.size > 0)

    function isLockedByOther(key: string): boolean {
        return otherLocks.value.has(key)
    }
    function otherLockHolder(key: string): string | undefined {
        return otherLocks.value.get(key)
    }

    /** 乐观加锁：被他人持有则失败（调用方应放弃激活）；否则立即视为持有并通知传输层。
     *  传入 snapshotOf 时登记加锁瞬间的对象快照（深拷贝），供败方降级时恢复原状；
     *  已持有同键锁的重复加锁不覆盖既有快照 */
    function acquireMine(key: string, snapshotOf?: ControlPoint | Line | TextTag): boolean {
        if (isLockedByOther(key))
            return false
        if (!myLocks.value.has(key)) {
            myLocks.value.add(key)
            if (snapshotOf)
                myLockSnapshots.set(key, deepClone(snapshotOf))
            lockRequestHandler.value?.(key)
        }
        return true
    }
    /** 读取某锁的登记快照（只读用途用 deepClone 防改写由调用方负责，这里直接返回引用） */
    function peekSnapshot(key: string): ControlPoint | Line | TextTag | undefined {
        return myLockSnapshots.get(key)
    }
    function releaseMine(key: string) {
        myLockSnapshots.delete(key)
        if (myLocks.value.delete(key))
            lockReleaseHandler.value?.(key)
    }
    /**
     * 释放我持有的、不在 keep 集合中的全部锁。
     * 统一的释放咽喉：调用方传入“当前仍激活/选中的锁键集合”，其余一律释放，
     * 覆盖取消激活、删除（绕过 cancelActive）、选区清空等所有路径
     */
    function releaseMineExcept(keep: ReadonlySet<string>) {
        for (const key of [...myLocks.value]) {
            if (!keep.has(key))
                releaseMine(key)
        }
    }

    /**
     * 他人获得锁（传输层调用）。返回是否与我的锁冲突（true = 我是仲裁败方，
     * 调用方需做本地降级：取消激活/移出选区）
     */
    function applyRemoteLock(key: string, holder: string): boolean {
        const conflict = myLocks.value.has(key)
        otherLocks.value.set(key, holder)
        return conflict
    }
    function applyRemoteUnlock(key: string) {
        otherLocks.value.delete(key)
    }
    /** 某成员断连/离房时，释放其全部锁（挂在服务器的 UserLeft 广播路径上） */
    function clearLocksOfHolder(holder: string) {
        for (const [key, h] of otherLocks.value) {
            if (h === holder)
                otherLocks.value.delete(key)
        }
    }
    /** 清理指向已不存在对象的他人锁（远程删除对象后由 patch 应用侧调用） */
    function pruneOtherLocks(exists: (type: CollabLockType, id: number) => boolean) {
        for (const key of [...otherLocks.value.keys()]) {
            const parsed = parseCollabLockKey(key)
            if (!parsed || !exists(parsed.type, parsed.id))
                otherLocks.value.delete(key)
        }
    }

    /** 退出协作会话/关闭存档时清空全部锁状态 */
    function clearAllLocks() {
        otherLocks.value.clear()
        myLocks.value.clear()
        myLockSnapshots.clear()
    }

    return {
        otherLocks,
        myLocks,
        hasOtherLocks,
        lockRequestHandler,
        lockReleaseHandler,
        isLockedByOther,
        otherLockHolder,
        acquireMine,
        peekSnapshot,
        releaseMine,
        releaseMineExcept,
        applyRemoteLock,
        applyRemoteUnlock,
        clearLocksOfHolder,
        pruneOtherLocks,
        clearAllLocks
    }
})
