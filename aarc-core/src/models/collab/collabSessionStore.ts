import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
    CollabMemberInfo, CollabOpMsg, CollabSnapshotInfo, CollabTransport, CollabTransportHandlers,
    getCollabTransport
} from "aarc-core/models/collab/collabTransport";
import { scanCollabIdSeed, useCollabStore } from "aarc-core/models/stores/collabStore";
import { collabLockKeyOf, useCollabLockStore } from "aarc-core/models/stores/collabLockStore";
import { useSaveStore } from "aarc-core/models/stores/saveStore";
import { useEnvStore } from "aarc-core/models/stores/envStore";
import { useSelectionStore } from "aarc-core/models/stores/selectionStore";
import { useUniqueComponentsStore } from "aarc-core/app/globalStores/uniqueComponents";
import { applyRemoteSaveDiff } from "aarc-core/models/collab/remoteOpApplier";
import { applyRemoteCollabLock } from "aarc-core/models/collab/lockApplier";
import { prepareSavePayload, reloadSaveFromSnapshot } from "aarc-core/app/editorSession";
import { SaveDiff } from "aarc-core/models/save/saveDiff";

/**
 * 协作会话编排（步骤四 4.5.1/4.5.2）：状态机 + 事件分发 + 同步管线。
 *
 * 状态机：off → syncing →（同步完成）→ synced；重连时 synced → syncing → synced。
 * 鲁棒性设计（协议见 docs/multiplayer/backend-plan.md §9/§10）：
 * - lastSeq 只随"已应用的 op"前进；submitOp 的 ack 不直接推进（ack 可能先于
 *   序号更小的他人广播到达），而是登记到 pendingOwnSeqs，在序流中跳过自己的 op
 * - 同步期/追赶期的 ReceiveOp 一律按 seq 缓冲去重，snapshot/SyncOps 之后统一重放
 * - 稳态下收到 seq 跳号的 op（乱序/丢失）→ 触发 catchUp（SyncOps 增量补齐）
 * - SyncOps 报 Gap（队列被修剪）→ 快照整档重建（reloadSaveFromSnapshot）
 * - 快照轮询超时 → 重新 RequestSnapshot（此时房主可能已继任换人），多轮失败则退会话
 * - 前缀种子在同步完成后扫描（seed 只增不减：同前缀重连用 max(本地, 扫描)，
 *   防止复用已删除元素的 id）
 * - sessionEpoch 作废离开/重进前的在途异步流程
 *
 * 单房间假设：一个编辑器会话同时只在一个协作房间内（saveId 过滤所有事件）。
 */

export type CollabSessionState = 'off' | 'syncing' | 'synced'
export type CollabConnState = 'online' | 'reconnecting' | 'disconnected'

/** 同步管线的时序参数（单测可调小） */
export const collabSessionTiming = {
    snapshotPollIntervalMs: 1000,
    snapshotPollTimeoutMs: 15000,
    snapshotMaxAttempts: 4,
    bufferDrainMaxRounds: 10,
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const genOpId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export const useCollabSessionStore = defineStore('collabSession', () => {
    const state = ref<CollabSessionState>('off')
    const connState = ref<CollabConnState>('online')
    const saveId = ref<number | null>(null)
    const ownerUserId = ref(0)
    const members = ref<CollabMemberInfo[]>([])
    const myUserId = ref(0)

    const isInSession = computed(() => state.value !== 'off')
    const isOwner = computed(() => isInSession.value && ownerUserId.value !== 0 && ownerUserId.value === myUserId.value)
    /** 可安全编辑 = 同步完成且连接在线（断线蒙层/禁止编辑的依据，见 4.6） */
    const canEdit = computed(() => state.value === 'synced' && connState.value === 'online')

    // ---- 非响应式内部状态（无渲染依赖，避免包装开销）----
    let lastSeq = 0
    /** 已 ack 但序流尚未走到的本人 op 的 seq（本地已乐观应用，序流走到时跳过） */
    const pendingOwnSeqs = new Set<number>()
    /** 同步/追赶期间缓冲的远程 op（按 seq 去重） */
    const opBuffer = new Map<number, CollabOpMsg>()
    let catchingUp = false
    let snapshotUploading = false
    let sessionEpoch = 0

    function requireTransport(): CollabTransport {
        const t = getCollabTransport()
        if (!t)
            throw Error('未注入协作传输实现（initCollabTransport）')
        return t
    }

    // ---- 序流推进 ----

    /** 跳过已 ack 的本人 op（其效果早已乐观应用在本地） */
    function advanceThroughOwnAcked() {
        while (pendingOwnSeqs.delete(lastSeq + 1))
            lastSeq++
    }

    /**
     * 应用一条远程 op 并推进 lastSeq。
     * 依赖 applyRemoteSaveDiff 的数据应用（applySaveDiff/syncBaseline）在首个 await 前同步完成，
     * 因此 lastSeq 在调用返回后立即推进，后续事件看到的就是新序号。
     */
    function applyOpNow(op: CollabOpMsg): Promise<void> {
        const diff = JSON.parse(op.patch) as SaveDiff
        const p = applyRemoteSaveDiff(diff)
        lastSeq = op.seq
        return p
    }

    /** 按 seq 升序应用一批 op：跳过已应用的与本人已 ack 的；仍有缺口时快照兜底 */
    async function applyOrdered(ops: CollabOpMsg[]): Promise<void> {
        const sorted = [...ops].sort((a, b) => a.seq - b.seq)
        for (const op of sorted) {
            if (op.seq <= lastSeq)
                continue
            if (pendingOwnSeqs.delete(op.seq)) {
                lastSeq = op.seq
                continue
            }
            advanceThroughOwnAcked()
            if (op.seq !== lastSeq + 1) {
                console.warn(`[协作]补齐数据仍有缺口（期望 ${lastSeq + 1}，实际 ${op.seq}），走快照重建`)
                opBuffer.set(op.seq, op)
                await snapshotFlow()
                return
            }
            await applyOpNow(op)
        }
        advanceThroughOwnAcked()
    }

    /** 排空缓冲（应用期间新到的 op 会继续入缓冲，逐轮排干；超限则快照兜底） */
    async function drainBuffer(): Promise<void> {
        for (let round = 0; opBuffer.size > 0; round++) {
            if (round >= collabSessionTiming.bufferDrainMaxRounds) {
                console.warn('[协作]缓冲重放超限，走快照重建')
                await snapshotFlow()
                return
            }
            const ops = [...opBuffer.values()]
            opBuffer.clear()
            await applyOrdered(ops)
        }
    }

    /** 增量追赶：SyncOps 补齐 + 缓冲重放；Gap 时快照重建 */
    async function catchUp(): Promise<void> {
        if (catchingUp)
            return
        catchingUp = true
        try {
            const t = requireTransport()
            const sync = await t.syncOps(saveId.value!, lastSeq)
            if (sync.gap) {
                await snapshotFlow()
                return
            }
            await applyOrdered(sync.ops)
            await drainBuffer()
        }
        finally {
            catchingUp = false
        }
    }

    /** 快照整档重建：请求房主 → 轮询 → 以快照为底 → SyncOps(水位) → 缓冲重放 */
    async function snapshotFlow(): Promise<void> {
        const t = requireTransport()
        const sid = saveId.value!
        const epoch = sessionEpoch
        let lastError: unknown = Error('协作快照同步超时')
        for (let attempt = 0; attempt < collabSessionTiming.snapshotMaxAttempts; attempt++) {
            if (epoch !== sessionEpoch)
                return  // 已离房/重进，放弃在途流程
            try {
                await t.requestSnapshot(sid)
            }
            catch (e) {
                // 房主不在线等：快照缓存可能仍在 TTL 内，继续轮询；轮询不到则下轮重试
                console.warn('[协作]转发快照请求失败，继续轮询缓存', e)
            }
            const deadline = Date.now() + collabSessionTiming.snapshotPollTimeoutMs
            while (Date.now() < deadline) {
                await sleep(collabSessionTiming.snapshotPollIntervalMs)
                if (epoch !== sessionEpoch)
                    return
                let snap: CollabSnapshotInfo | null = null
                try {
                    snap = await t.getSnapshot(sid)
                }
                catch { continue }
                if (!snap)
                    continue
                reloadSaveFromSnapshot(JSON.parse(snap.payload))
                lastSeq = snap.seq
                pendingOwnSeqs.clear()
                const sync = await t.syncOps(sid, lastSeq)
                if (sync.gap)
                    break  // 水位之后又被修剪（极端）：外层重试拿更新快照
                await applyOrdered(sync.ops)
                await drainBuffer()
                return
            }
            // 本轮轮询超时：房主可能已断连换人（OwnerChanged 已更新 ownerUserId），下轮重新请求
        }
        throw lastError
    }

    /** 前缀应用：换前缀则 setIdPrefix(seed)；同前缀（重连）则种子只增不减 */
    function applyIdPrefix(prefix: number): void {
        const collab = useCollabStore()
        const save = useSaveStore().save
        const seed = save ? scanCollabIdSeed(save, prefix) : 0
        if (collab.idPrefix === prefix)
            collab.reseedIdCounter(seed)
        else
            collab.setIdPrefix(prefix, seed)
    }

    /** 锁表快照覆盖他人锁；我的锁服务器已清（断连）或本就没有（新进房），一并清空 */
    function applyLockSnapshot(locks: { key: string, holder: string }[]): void {
        const lockStore = useCollabLockStore()
        lockStore.clearAllLocks()
        for (const l of locks)
            lockStore.applyRemoteLock(l.key, l.holder)
    }

    /** 重连后重新评估本地激活/选中对象：尝试重新加锁（被他人抢走则保持无锁，冲突走既有降级/LWW） */
    function relockLocalHolds(): void {
        const env = useEnvStore()
        const sel = useSelectionStore()
        const lockStore = useCollabLockStore()
        const objs = [env.activePt, env.activeLine, env.activeTextTag, ...sel.selected]
        for (const o of objs) {
            if (o)
                lockStore.acquireMine(collabLockKeyOf(o), o)
        }
    }

    function wireLockHandlers(sid: number): void {
        const lockStore = useCollabLockStore()
        // 乐观加锁语义：本地已视为持有，传输失败（断线）仅告警——重连后 myLocks 本就清空重建
        lockStore.lockRequestHandler = key => {
            getCollabTransport()?.acquireLock(sid, key)
                .catch(e => console.warn('[协作]加锁通知失败', e))
        }
        lockStore.lockReleaseHandler = key => {
            getCollabTransport()?.releaseLock(sid, key)
                .catch(e => console.warn('[协作]释放锁通知失败', e))
        }
    }

    // ---- 事件处理器 ----

    function onOp(op: CollabOpMsg): void {
        if (state.value === 'off' || op.saveId !== saveId.value)
            return
        if (state.value !== 'synced' || catchingUp) {
            opBuffer.set(op.seq, op)
            return
        }
        if (op.seq <= lastSeq)
            return  // 重复（广播与补齐竞态）
        advanceThroughOwnAcked()
        if (op.seq !== lastSeq + 1) {
            // 乱序/丢失：缓冲并追赶
            opBuffer.set(op.seq, op)
            void catchUp().catch(handleSyncExhausted)
            return
        }
        try {
            void applyOpNow(op)
            advanceThroughOwnAcked()  // 应用后可能紧挨着已 ack 的本人 seq，级联跳过
        }
        catch (e) {
            console.error('[协作]op 解析失败，走快照重建', e)
            state.value = 'syncing'
            void snapshotFlow().then(() => {
                if (state.value !== 'off')
                    state.value = 'synced'
            }).catch(handleSyncExhausted)
        }
    }

    /** 追赶与快照兜底都彻底失败：同步状态已不可信，退出协作会话 */
    async function handleSyncExhausted(e: unknown): Promise<void> {
        console.error('[协作]同步兜底失败，退出协作会话', e)
        await leave()
        useUniqueComponentsStore().showPop('协作同步失败，已退出协作模式', 'failed')
    }

    function onUserJoined(m: CollabMemberInfo): void {
        if (state.value === 'off')
            return
        if (!members.value.some(x => x.userId === m.userId))
            members.value = [...members.value, m]
    }

    function onUserLeft(m: CollabMemberInfo): void {
        if (state.value === 'off')
            return
        members.value = members.value.filter(x => x.userId !== m.userId)
        useCollabLockStore().clearLocksOfHolder(m.userName)
    }

    function onOwnerChanged(m: CollabMemberInfo): void {
        if (state.value === 'off')
            return
        ownerUserId.value = m.userId
        if (!members.value.some(x => x.userId === m.userId))
            members.value = [...members.value, m]
    }

    async function uploadSnapshotAsOwner(sid: number): Promise<void> {
        // 服务器只转发给房主，这里仍防御；在途上传去重（服务器有 TTL 缓存，新请求者可复用）
        if (sid !== saveId.value || state.value !== 'synced' || !isOwner.value || snapshotUploading)
            return
        snapshotUploading = true
        try {
            const payload = prepareSavePayload()
            if (!payload)
                return
            await requireTransport().uploadSnapshot(sid, lastSeq, JSON.stringify(payload))
        }
        catch (e) {
            console.warn('[协作]快照上传失败', e)
        }
        finally {
            snapshotUploading = false
        }
    }

    async function resyncAfterReconnect(): Promise<void> {
        if (state.value === 'off' || saveId.value === null)
            return
        const t = requireTransport()
        const sid = saveId.value
        const epoch = sessionEpoch
        state.value = 'syncing'
        try {
            const res = await t.join(sid)  // 幂等：原前缀、最新锁表快照、现任房主
            if (epoch !== sessionEpoch)
                return
            ownerUserId.value = res.ownerUserId
            members.value = res.members
            if (res.latestSeq > lastSeq)
                await catchUp()
            if (epoch !== sessionEpoch)
                return
            // 锁快照须在数据同步之后应用：否则补齐期间 pruneOtherLocks 会把
            // 指向本地尚未同步到的对象的锁误清
            applyLockSnapshot(res.locks)
            relockLocalHolds()
            applyIdPrefix(res.idPrefix)
            state.value = 'synced'
        }
        catch (e) {
            console.error('[协作]重连补齐失败', e)
            if (epoch !== sessionEpoch)
                return
            try {
                await snapshotFlow()
                if (epoch !== sessionEpoch)
                    return
                state.value = 'synced'
            }
            catch (e2) {
                console.error('[协作]重连快照兜底也失败，退出协作会话', e2)
                await leave()
                useUniqueComponentsStore().showPop('协作同步失败，已退出协作模式', 'failed')
            }
        }
    }

    const handlers: CollabTransportHandlers = {
        onOp,
        onLockAcquired: l => { if (state.value !== 'off') applyRemoteCollabLock(l.key, l.holder) },
        onLockReleased: key => { if (state.value !== 'off') useCollabLockStore().applyRemoteUnlock(key) },
        onUserJoined,
        onUserLeft,
        onOwnerChanged,
        onSnapshotRequested: sid => { void uploadSnapshotAsOwner(sid) },
        onReconnecting: () => { if (state.value !== 'off') connState.value = 'reconnecting' },
        onReconnected: () => {
            if (state.value === 'off')
                return
            connState.value = 'online'
            void resyncAfterReconnect()
        },
        onDisconnected: () => { if (state.value !== 'off') connState.value = 'disconnected' },
    }

    // ---- 会话入口 ----

    /**
     * 加入协作房间并完成同步（resolve 时 state === 'synced'）。
     * 全新房间（我独自开的房）跳过快照直接可用；已有房间走快照初始化管线。
     * 失败抛错并清理回 off。
     */
    async function join(sid: number): Promise<void> {
        const t = requireTransport()
        if (state.value !== 'off') {
            if (saveId.value === sid && state.value === 'synced')
                return
            throw Error('已在协作会话中，请先 leave')
        }
        sessionEpoch++
        const epoch = sessionEpoch
        state.value = 'syncing'
        saveId.value = sid
        lastSeq = 0
        pendingOwnSeqs.clear()
        opBuffer.clear()
        members.value = []
        ownerUserId.value = 0
        myUserId.value = t.myUserId()
        try {
            t.setHandlers(handlers)
            const res = await t.join(sid)
            if (epoch !== sessionEpoch)
                return
            ownerUserId.value = res.ownerUserId
            members.value = res.members
            wireLockHandlers(sid)
            const freshRoom = res.latestSeq === 0 && res.members.length <= 1 && res.ownerUserId === myUserId.value
            if (!freshRoom) {
                await snapshotFlow()
                if (epoch !== sessionEpoch)
                    return
            }
            // 锁快照须在数据同步之后应用（同 resyncAfterReconnect 的注释）
            applyLockSnapshot(res.locks)
            // 种子扫描必须在同步完成之后（之前的存档可能缺他人刚创建的元素）
            applyIdPrefix(res.idPrefix)
            state.value = 'synced'
        }
        catch (e) {
            if (epoch === sessionEpoch) {
                cleanupLocal()
                // 传输层 join 可能已成功（快照同步失败）：通知服务器离房，避免成员悬挂到断连
                await t.leave(sid).catch(() => { /* 服务器断连清理兜底 */ })
            }
            throw e
        }
    }

    /** 离开协作会话：作废在途同步、清理本地状态、尽力通知服务器（断连时由服务器兜底） */
    async function leave(): Promise<void> {
        if (state.value === 'off')
            return
        const sid = saveId.value
        sessionEpoch++
        cleanupLocal()
        if (sid !== null)
            await getCollabTransport()?.leave(sid).catch(() => { /* 服务器断连清理兜底 */ })
    }

    function cleanupLocal(): void {
        state.value = 'off'
        connState.value = 'online'
        saveId.value = null
        ownerUserId.value = 0
        members.value = []
        useCollabStore().clearIdPrefix()
        const lockStore = useCollabLockStore()
        lockStore.lockRequestHandler = undefined
        lockStore.lockReleaseHandler = undefined
        lockStore.clearAllLocks()
    }

    /**
     * 提交本地 op（4.6 本地提交管线调用）：序列化 SaveDiff → 传输层，ack 的 seq
     * 登记进 pendingOwnSeqs（不直接推进 lastSeq——序号更小的他人广播可能尚未到达）。
     */
    async function submitOp(diff: SaveDiff): Promise<number> {
        if (state.value !== 'synced' || connState.value !== 'online' || saveId.value === null)
            throw Error('协作会话未就绪（同步中或已断线），无法提交')
        const t = requireTransport()
        const seq = await t.submitOp(saveId.value, genOpId(), JSON.stringify(diff), lastSeq)
        pendingOwnSeqs.add(seq)
        advanceThroughOwnAcked()
        return seq
    }

    /** 当前已应用水位（诊断/4.6 用） */
    function currentSeq(): number {
        return lastSeq
    }

    return {
        state, connState, saveId, ownerUserId, members, myUserId,
        isInSession, isOwner, canEdit,
        join, leave, submitOp, currentSeq,
    }
})
