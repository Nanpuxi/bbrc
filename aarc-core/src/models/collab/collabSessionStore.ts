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
import { summarizeSaveDiff } from "aarc-core/models/collab/opSummary";
import { useCollabLogStore } from "aarc-core/models/collab/collabLogStore";
import { bumpSaveDataRevision } from "aarc-core/models/collab/saveDataRevision";
import { applyRemoteCollabLock } from "aarc-core/models/collab/lockApplier";
import { prepareSavePayload, reloadSaveFromSnapshot } from "aarc-core/app/editorSession";
import { SaveDiff, applySaveDiff, diffSave } from "aarc-core/models/save/saveDiff";
import { Save } from "aarc-core/models/save";
import { useUndoStore } from "aarc-core/models/stores/utils/undoStore";
import rfdc from "rfdc";

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
 * 本地 op 提交管线（4.6）：
 * - captureLocalOp（挂在主画布渲染完成钩子）：diffSave(opBaseline, save) 生成 op，
 *   随即把 diff 应用到 opBaseline 推进基线（applySaveDiff 内部 clone，无引用共享），
 *   入未 ack 待发队列后触发 flush；队列上限 maxPendingLocalOps，溢出则退会话
 * - 远程 op 在 applyOpNow 内同步应用到 opBaseline，保证后续 capture 不含他人变更
 * - 快照整档重建后：队列内未 ack 编辑按原序重放到快照底上（之后 flush 会作为
 *   全新 op 重提交，拿到新 seq）；基线重置为新存档
 * - flush 遇提交失败（断线/限流/权限）即停，op 留队，重连补齐后按原序重发
 *
 * 单房间假设：一个编辑器会话同时只在一个协作房间内（saveId 过滤所有事件）。
 *
 * 房主生命周期（backend-plan.md §7.1，2026-09 修订）：
 * - 房主离开即关房：leave 在 isOwner 时改发 closeRoom（主动关房信号），服务器广播 RoomClosed
 * - 收到 RoomClosed（含房主自己的其他连接）：清理本地会话并置 roomClosedNotice（web 弹窗+跳首页）
 * - 房主断连宽限期：onOwnerOffline 置 ownerOffline（canEdit=false → 离线蒙层）；宽限期内
 *   房主重连服务器广播 OwnerReconnected，其他成员以快照整档重建（而非增量补齐——离线期间
 *   状态可能分叉）后解除蒙层
 * - 继任路径（OwnerChanged/ensureOwnerHeartbeat）保留但暂不使用：新流程下不会触发
 */

export type CollabSessionState = 'off' | 'syncing' | 'synced'
export type CollabConnState = 'online' | 'reconnecting' | 'disconnected'

/** 同步管线的时序参数（单测可调小） */
export const collabSessionTiming = {
    snapshotPollIntervalMs: 1000,
    snapshotPollTimeoutMs: 15000,
    snapshotMaxAttempts: 4,
    bufferDrainMaxRounds: 10,
    /** 本地未 ack op 待发队列上限（防永久失败时内存无限增长；溢出即退会话） */
    maxPendingLocalOps: 1000,
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const genOpId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
const cloneSaveData = rfdc()

// ---- 保存点水位标记（localStorage；§7.1 ③独房重进的重建基准）----
// 语义：该存档"DB 已落库状态"对应的房间水位。仅两个已知准确点会写入——
// 开房（fresh room，DB 即房间基线，水位 0）与 保存成功（DB=当前 lastSeq）。
// 整页刷新/崩溃不触发清理，标记跨刷新存活；正常离房/关房（cleanupLocal）清除。
// 客户端凭它在"仅自己一人的房间重进"时从保存点补齐队列（恢复未保存编辑，
// 又避免把已落库的效果重复应用）；标记缺失（他端保存过等）时保守跳过历史 op。
const savedSeqMarkerKey = (sid: number) => `aarc-collab-saved-seq:${sid}`

function readSavedSeqMarker(sid: number): number | null {
    try {
        if (typeof localStorage === 'undefined')
            return null
        const raw = localStorage.getItem(savedSeqMarkerKey(sid))
        if (raw === null)
            return null
        const v = Number(raw)
        return Number.isFinite(v) && v >= 0 ? v : null
    }
    catch {
        return null
    }
}

function writeSavedSeqMarker(sid: number, seq: number): void {
    try {
        if (typeof localStorage !== 'undefined')
            localStorage.setItem(savedSeqMarkerKey(sid), String(seq))
    }
    catch { /* 隐私模式等场景静默降级：退化为"标记缺失"的保守路径 */ }
}

function clearSavedSeqMarker(sid: number): void {
    try {
        if (typeof localStorage !== 'undefined')
            localStorage.removeItem(savedSeqMarkerKey(sid))
    }
    catch { /* 同上升降级 */ }
}

export const useCollabSessionStore = defineStore('collabSession', () => {
    const state = ref<CollabSessionState>('off')
    const connState = ref<CollabConnState>('online')
    const saveId = ref<number | null>(null)
    const ownerUserId = ref(0)
    const members = ref<CollabMemberInfo[]>([])
    const myUserId = ref(0)

    const isInSession = computed(() => state.value !== 'off')
    const isOwner = computed(() => isInSession.value && ownerUserId.value !== 0 && ownerUserId.value === myUserId.value)
    /** 房主处于断网宽限期（§7.1 ③）：成员显示离线蒙层，等待重连或超时关房 */
    const ownerOffline = ref(false)
    /** RoomClosed 通知计数（web watch 弹窗"所有者已关闭房间"并跳首页；与"已关闭协作"弹窗去重） */
    const roomClosedNotice = ref(0)
    /** 可安全编辑 = 同步完成且连接在线（断线蒙层/禁止编辑的依据，见 4.6） */
    const canEdit = computed(() => state.value === 'synced' && connState.value === 'online' && !ownerOffline.value)

    // ---- 非响应式内部状态（无渲染依赖，避免包装开销）----
    let lastSeq = 0
    /** 已 ack 但序流尚未走到的本人 op 的 seq（本地已乐观应用，序流走到时跳过） */
    const pendingOwnSeqs = new Set<number>()
    /** 同步/追赶期间缓冲的远程 op（按 seq 去重） */
    const opBuffer = new Map<number, CollabOpMsg>()
    let catchingUp = false
    let snapshotUploading = false
    /** 快照整档重建进行中（reloadSaveFromSnapshot 之后、补齐重放完成之前）：
     *  期间本地存档正在被覆盖，禁止作为快照提供方上传（水位与内容不一致） */
    let snapshotRebuilding = false
    let sessionEpoch = 0
    /**
     * 本地 diff 基线（4.6）：始终等于"save 减去尚未捕获的本地编辑"。
     * 本地捕获时随 diff 推进；远程 op 应用时同步应用同一 diff；
     * 快照整档替换时重置。非响应式（整档数据，无渲染依赖）
     */
    let opBaseline: Save | null = null
    /** 本地未 ack op 队列（断线期间累积，重连补齐后按原序重发） */
    const pendingLocalDiffs: SaveDiff[] = []
    let flushingLocal = false
    /** 会话是否曾到达过稳态 synced（区分"进房失败"与"会话异常结束"，Editor 的 isInSession watcher 用） */
    let everSynced = false

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
        // 概括必须在应用之前生成：$rm/$upd 目标的名称应用后就查不到了
        useCollabLogStore().add({ kind: 'op', userName: op.userName, text: summarizeSaveDiff(diff, useSaveStore().save) })
        const p = applyRemoteSaveDiff(diff)
        // 基线同步应用同一 diff：否则下次本地 capture 会把他人变更误算成本地 op
        if (opBaseline)
            applySaveDiff(opBaseline, diff)
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

    /**
     * 房内仅自己一人时的增量追赶（房主独房重连，backend-plan §7.1 ③配套）：
     * 队列被修剪（Gap）时**跳过快照重建**——无人可提供快照，自己的本地状态就是房间内
     * 最完整副本（缺口处的 op 已随修剪对所有人丢失）；未修剪则与常规追赶一致
     */
    async function catchUpWhenAlone(): Promise<void> {
        const t = requireTransport()
        const sync = await t.syncOps(saveId.value!, lastSeq)
        if (sync.gap) {
            console.warn('[协作]队列已修剪且房内仅自己一人，跳过快照重建（本地状态即最完整副本）')
            opBuffer.clear()
            return
        }
        await applyOrdered(sync.ops)
        await drainBuffer()
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
                snapshotRebuilding = true   // 重建期间禁止作为快照提供方（水位与内容不一致）
                try {
                    reloadSaveFromSnapshot(JSON.parse(snap.payload))
                    lastSeq = snap.seq
                    pendingOwnSeqs.clear()
                    // 本地未 ack 编辑随整档替换丢失：按原序重放到快照底上，保持用户可见状态不变
                    // （之后 flush 会把它们作为全新 op 重提交拿到新 seq）；
                    // 重放属"非本地编辑动作"，undo 基线对齐以免误入 undo 栈
                    const reloaded = useSaveStore().save
                    if (reloaded && pendingLocalDiffs.length > 0) {
                        for (const d of pendingLocalDiffs)
                            applySaveDiff(reloaded, d)
                        useUndoStore().syncBaseline(reloaded)
                    }
                    opBaseline = reloaded ? cloneSaveData(reloaded) : null
                    const sync = await t.syncOps(sid, lastSeq)
                    if (sync.gap)
                        break  // 水位之后又被修剪（极端）：外层重试拿更新快照
                    await applyOrdered(sync.ops)
                    await drainBuffer()
                    void flushLocalOps()  // 稳态 Gap 重建路径：重放后的未 ack 本地 op 立即重发
                    return
                }
                finally {
                    snapshotRebuilding = false
                }
            }
            // 本轮轮询超时：房主可能已断连换人（OwnerChanged 已更新 ownerUserId），下轮重新请求
        }
        throw lastError
    }

    /**
     * 独房重进（join 路径，§7.1 ③配套）：刷新/重开页面重进自己独守的房间（CloseRoom 未发出、
     * 房间在宽限期中）时快照无人可提供。以保存点水位标记为基准从房间队列补齐——恢复未保存
     * 编辑，又避免把已落库的效果重复应用；标记缺失（可能在他端保存过，DB 与队列对应关系
     * 不可考）或被修剪时保守续用 DB 加载状态（缺口对所有人生效为丢失），都不请求快照
     */
    async function catchUpAloneJoin(latestSeq: number): Promise<void> {
        const sid = saveId.value!
        const t = requireTransport()
        const marker = readSavedSeqMarker(sid)
        if (marker === null) {
            console.warn('[协作]独房重进：无保存点水位标记（可能在他端保存过），不应用历史 op，以最后保存状态为底继续')
            lastSeq = latestSeq
            opBuffer.clear()
            return
        }
        lastSeq = Math.min(marker, latestSeq)
        const sync = await t.syncOps(sid, lastSeq)
        if (sync.gap) {
            console.warn('[协作]独房重进：保存点之后的 op 已被修剪，未保存编辑丢失（对所有人生效为丢失）')
            lastSeq = latestSeq
            opBuffer.clear()
            return
        }
        await applyOrdered(sync.ops)
        await drainBuffer()
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
        // 自己进房不会收到自己的 UserJoined（初始成员列表由 join 返回值直接赋值），天然不弹自己
        useCollabLogStore().add({ kind: 'join', userName: m.userName, text: '加入了协作' })
        useUniqueComponentsStore().showPop(`${m.userName} 加入了协作`, 'info')
    }

    function onUserLeft(m: CollabMemberInfo): void {
        if (state.value === 'off')
            return
        members.value = members.value.filter(x => x.userId !== m.userId)
        useCollabLockStore().clearLocksOfHolder(m.userName)
        useCollabLogStore().add({ kind: 'leave', userName: m.userName, text: '离开了协作' })
        useUniqueComponentsStore().showPop(`${m.userName} 离开了协作`, 'info')
    }

    function onOwnerChanged(m: CollabMemberInfo): void {
        if (state.value === 'off')
            return
        ownerUserId.value = m.userId
        if (!members.value.some(x => x.userId === m.userId))
            members.value = [...members.value, m]
    }

    /** 收到服务器的快照转发请求时上传本地存档（§7.1 ③：服务器优先转给房主，
     *  房主无存活连接时转给任一成员兜底）。上传前提：本次会话建立过同步（everSynced）、
     *  本地存档未被快照重建覆盖、且不持有未 ack 本地编辑——水位（lastSeq）必须覆盖
     *  快照内容，否则请求方按水位补齐时会把我已含在快照里的编辑作为新 op 再应用一次。
     *  同步中（追赶/等快照）但本地状态完整时也允许上传：这是房主重连时请求方与提供方
     *  同处 syncing 相互拒绝、无人能供快照的死锁（A 修复）的破解点；
     *  在途上传去重（缓存可被覆盖，后到者无害） */
    async function uploadSnapshotOnRequest(sid: number): Promise<void> {
        if (sid !== saveId.value || !everSynced || snapshotRebuilding || pendingLocalDiffs.length > 0 || snapshotUploading)
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
        // 房内仅自己一人（无其他成员）时快照无人可提供：Gap/补齐失败跳过快照兜底，
        // 本地状态即房间内最完整副本（catchUpWhenAlone / 下方 catch 分支）
        let alone = false
        try {
            const res = await t.join(sid)  // 幂等：原前缀、最新锁表快照、现任房主
            if (epoch !== sessionEpoch)
                return
            ownerUserId.value = res.ownerUserId
            members.value = res.members
            ownerOffline.value = !isOwner.value && res.ownerOffline === true
            alone = res.members.every(m => m.userId === myUserId.value)
            if (res.latestSeq > lastSeq) {
                if (alone)
                    await catchUpWhenAlone()
                else
                    await catchUp()
            }
            if (epoch !== sessionEpoch)
                return
            // 锁快照须在数据同步之后应用：否则补齐期间 pruneOtherLocks 会把
            // 指向本地尚未同步到的对象的锁误清
            applyLockSnapshot(res.locks)
            relockLocalHolds()
            applyIdPrefix(res.idPrefix)
            markSynced()
            void flushLocalOps()  // 断线期间累积的本地 op 按原序重发（视作全新提交、获得新 Seq）
        }
        catch (e) {
            console.error('[协作]重连补齐失败', e)
            if (epoch !== sessionEpoch)
                return
            try {
                if (alone) {
                    // 独房：快照无人可提供，续用本地状态（缺口 op 已随修剪对所有人生效为丢失）
                    console.warn('[协作]重连补齐失败且房内仅自己一人，跳过快照兜底')
                    markSynced()
                    void flushLocalOps()
                }
                else {
                    await snapshotFlow()
                    if (epoch !== sessionEpoch)
                        return
                    markSynced()
                    void flushLocalOps()
                }
            }
            catch (e2) {
                console.error('[协作]重连快照兜底也失败，退出协作会话', e2)
                await leave()
                useUniqueComponentsStore().showPop('协作同步失败，已退出协作模式', 'failed')
            }
        }
    }

    /** 房主宽限期内重连（§7.1 ③）：其他成员以房主快照整档重建（离线期间状态可能分叉，
     *  增量补齐不如重建稳），完成后解除离线蒙层；彻底失败退会话 */
    async function resyncAfterOwnerReconnect(): Promise<void> {
        if (state.value === 'off' || saveId.value === null || isOwner.value)
            return
        const epoch = sessionEpoch
        state.value = 'syncing'
        try {
            await snapshotFlow()
            if (epoch !== sessionEpoch)
                return
            ownerOffline.value = false
            markSynced()
            void flushLocalOps()
        }
        catch (e) {
            console.error('[协作]房主重连后的快照重建失败', e)
            await handleSyncExhausted(e)
        }
    }

    /** 房间被房主关闭（CloseRoom/断网超宽限期，§7.1）：清理本地会话；
     *  web watch roomClosedNotice 弹窗"所有者已关闭房间"并跳首页 */
    function onRoomClosed(sid: number): void {
        if (state.value === 'off' || sid !== saveId.value)
            return
        sessionEpoch++
        cleanupLocal()
        roomClosedNotice.value++
    }

    function onOwnerOffline(sid: number): void {
        if (state.value === 'off' || sid !== saveId.value || isOwner.value)
            return
        ownerOffline.value = true
    }

    const handlers: CollabTransportHandlers = {
        onOp,
        onLockAcquired: l => { if (state.value !== 'off') applyRemoteCollabLock(l.key, l.holder) },
        onLockReleased: key => { if (state.value !== 'off') useCollabLockStore().applyRemoteUnlock(key) },
        onUserJoined,
        onUserLeft,
        onOwnerChanged,
        onSnapshotRequested: sid => { void uploadSnapshotOnRequest(sid) },
        onRoomClosed,
        onOwnerOffline,
        onOwnerReconnected: sid => {
            if (state.value !== 'off' && sid === saveId.value)
                void resyncAfterOwnerReconnect()
        },
        onSaved: () => {
            if (state.value !== 'off')
                useUniqueComponentsStore().showPop('房主已保存', 'success')
        },
        onReconnecting: () => { if (state.value !== 'off') connState.value = 'reconnecting' },
        onReconnected: () => {
            if (state.value === 'off')
                return
            connState.value = 'online'
            void resyncAfterReconnect()
        },
        onDisconnected: () => { if (state.value !== 'off') connState.value = 'disconnected' },
    }

    /** 进入稳态：置 everSynced（本次会话真实建立过，Editor 据此区分"进房失败"与"会话异常结束"） */
    function markSynced(): void {
        everSynced = true
        state.value = 'synced'
    }

    // ---- 会话入口 ----

    /**
     * 加入协作房间并完成同步（resolve 时 state === 'synced'）。
     * 全新房间（我独自开的房）跳过快照直接可用；已有房间先试增量补齐（队列被修剪
     * 才走快照兜底）；独房重进按保存点水位从队列重建。失败抛错并清理回 off。
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
        ownerOffline.value = false
        myUserId.value = t.myUserId()
        try {
            t.setHandlers(handlers)
            const res = await t.join(sid)
            if (epoch !== sessionEpoch)
                return
            ownerUserId.value = res.ownerUserId
            members.value = res.members
            ownerOffline.value = !isOwner.value && res.ownerOffline === true
            wireLockHandlers(sid)
            const freshRoom = res.latestSeq === 0 && res.members.length <= 1 && res.ownerUserId === myUserId.value
            if (freshRoom)
                writeSavedSeqMarker(sid, 0)   // 开房：DB 即房间基线（水位 0）
            if (!freshRoom) {
                // 房内仅自己一人（无其他成员、也无自己的其他连接——多标签页/多设备同账号
                // 不算独房，其他连接可提供快照）：快照无人可提供，按保存点水位从队列重建
                const alone = res.members.every(m => m.userId === myUserId.value)
                    && (res.myConnectionCount ?? 1) <= 1
                if (alone)
                    await catchUpAloneJoin(res.latestSeq)
                else
                    // 先试增量补齐（队列未修剪根本不需要快照）；Gap 时 catchUp 内部走快照兜底。
                    // 也避免与成员侧的"房主重连重建"互发快照请求、双方 syncing 互拒无人提供
                    await catchUp()
                if (epoch !== sessionEpoch)
                    return
            }
            // 锁快照须在数据同步之后应用（同 resyncAfterReconnect 的注释）
            applyLockSnapshot(res.locks)
            // 种子扫描必须在同步完成之后（之前的存档可能缺他人刚创建的元素）
            applyIdPrefix(res.idPrefix)
            // 本地 diff 基线（快照路径已在 snapshotFlow 内设置）：以同步完成时的存档为底
            if (!opBaseline && useSaveStore().save)
                opBaseline = cloneSaveData(useSaveStore().save!)
            markSynced()
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

    /** 离开协作会话：作废在途同步、清理本地状态、尽力通知服务器（断连时由服务器兜底）。
     *  房主离开即关房（§7.1 ②）：先尽力发 closeRoom（主动关房信号）再走连接级离房——
     *  整页刷新/关标签页发不出去时，由服务器断网宽限期兜底 */
    async function leave(): Promise<void> {
        if (state.value === 'off')
            return
        const sid = saveId.value
        const wasOwner = isOwner.value
        sessionEpoch++
        cleanupLocal()
        const t = getCollabTransport()
        if (sid !== null && t) {
            if (wasOwner)
                await t.closeRoom(sid).catch(() => { /* 服务器断连/宽限期兜底 */ })
            await t.leave(sid).catch(() => { /* 服务器断连清理兜底 */ })
        }
    }

    function cleanupLocal(): void {
        const sid = saveId.value
        state.value = 'off'
        everSynced = false
        connState.value = 'online'
        snapshotRebuilding = false   // 兜底：作废在途重建（epoch 失效后标志不得悬挂）
        saveId.value = null
        ownerUserId.value = 0
        ownerOffline.value = false
        members.value = []
        opBaseline = null
        pendingLocalDiffs.length = 0
        if (sid !== null)
            clearSavedSeqMarker(sid)   // 正常离房/关房：保存点标记随房间消亡（整页刷新不走这里，标记保留）
        useCollabStore().clearIdPrefix()
        const lockStore = useCollabLockStore()
        lockStore.lockRequestHandler = undefined
        lockStore.lockReleaseHandler = undefined
        lockStore.clearAllLocks()
        useCollabLogStore().clear()   // 日志随会话消亡，重进房间是全新日志
    }

    /**
     * 提交本地 op（4.6 本地提交管线调用）：序列化 SaveDiff → 传输层，ack 的 seq
     * 登记进 pendingOwnSeqs（不直接推进 lastSeq——序号更小的他人广播可能尚未到达）。
     */
    async function submitOp(diff: SaveDiff): Promise<number> {
        if (state.value !== 'synced' || connState.value !== 'online' || ownerOffline.value || saveId.value === null)
            throw Error('协作会话未就绪（同步中/已断线/房主离线），无法提交')
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

    // ---- 本地 op 捕获与提交（4.6）----

    /**
     * 本地变更捕获入口（挂在主画布渲染完成钩子，undo 入栈之后）。
     * diffSave(opBaseline, save) 生成 op 入队并推进基线；无变化不产生 op。
     * 同步期/断线期的捕获（蒙层生效前的在途渲染）也会入队，flush 自行等待时机。
     */
    function captureLocalOp(): void {
        if (state.value === 'off' || ownerOffline.value)
            return
        const save = useSaveStore().save
        if (!save)
            return
        if (!opBaseline) {
            // 防御：基线未建立（如 fresh 房间 join 后首次渲染前就被调用）时以现状为基线
            opBaseline = cloneSaveData(save)
            return
        }
        const diff = diffSave(opBaseline, save)
        if (!diff)
            return
        applySaveDiff(opBaseline, diff)  // 基线推进到当前状态（apply 内部 clone，与 save 无引用共享）
        bumpSaveDataRevision()           // 本地编辑检出变化：递增数据版本（未保存判据，与渲染来源无关）
        pendingLocalDiffs.push(diff)
        if (pendingLocalDiffs.length > collabSessionTiming.maxPendingLocalOps) {
            // 队列溢出：通常是提交被永久拒绝（权限/版本不兼容），同步状态已不可信
            void handleSyncExhausted(Error('本地待发 op 队列溢出'))
            return
        }
        void flushLocalOps()
    }

    /**
     * 按原序提交待发队列：ack 即出队（seq 由 submitOp 登记进 pendingOwnSeqs）。
     * 非稳态（同步中/断线）或提交失败即停，op 留队等下一次触发（捕获/重连补齐完成）。
     */
    async function flushLocalOps(): Promise<void> {
        if (flushingLocal)
            return
        flushingLocal = true
        try {
            while (pendingLocalDiffs.length > 0) {
                if (state.value !== 'synced' || connState.value !== 'online')
                    return
                try {
                    await submitOp(pendingLocalDiffs[0])
                    pendingLocalDiffs.shift()
                }
                catch (e) {
                    console.warn('[协作]op 提交失败，留在待发队列（重连后自动按原序重发）', e)
                    return
                }
            }
        }
        finally {
            flushingLocal = false
        }
    }

    /** 待 ack 的本地 op 数（诊断/测试用） */
    function pendingLocalOpCount(): number {
        return pendingLocalDiffs.length
    }

    /**
     * 房主保存成功后调用：向房间广播"已保存"通知，其他人弹窗提示。
     * 非房主/未入会静默忽略；发送失败仅告警（通知丢了不影响数据正确性）
     */
    function notifySaved(): void {
        if (state.value !== 'synced' || saveId.value === null || !isOwner.value)
            return
        const sid = saveId.value
        // 保存点水位标记：DB 落库状态 = 当前水位（独房重进时据此从队列恢复未保存编辑）
        writeSavedSeqMarker(sid, lastSeq)
        requireTransport().notifySaved(sid)
            .catch(e => console.warn('[协作]保存通知发送失败', e))
    }

    return {
        state, connState, saveId, ownerUserId, members, myUserId,
        isInSession, isOwner, canEdit, ownerOffline, roomClosedNotice,
        hasEverSynced: () => everSynced,
        join, leave, submitOp, currentSeq,
        captureLocalOp, flushLocalOps, pendingLocalOpCount, notifySaved,
    }
})
