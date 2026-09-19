import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import { ensureDomStub } from '../../helpers/domStub'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useCollabSessionStore, collabSessionTiming } from 'aarc-core/models/collab/collabSessionStore'
import {
    CollabTransport, CollabTransportHandlers, JoinCollabRoomInfo,
    SyncCollabOpsInfo, CollabSnapshotInfo, CollabOpMsg
} from 'aarc-core/models/collab/collabTransport'
import { initCollabTransport } from 'aarc-core/models/collab/collabTransport'
import { SaveDiff, KeyedArrDiff } from 'aarc-core/models/save/saveDiff'
import { Save } from 'aarc-core/models/save'

/** 取 diff 中 points 的 $add 列表（缩窄 PropDiff 联合类型） */
const addedPts = (patch: SaveDiff) => (patch.points as KeyedArrDiff | undefined)?.$add

/**
 * 本地 op 提交管线（4.6）测试：captureLocalOp 捕获 → 未 ack 队列 → flush 提交，
 * 断线留队、重连/快照重建后重发，远程 op 的基线同步。
 */

function createSave(idIncre = 100): Save {
    return {
        idIncre,
        points: [],
        lines: [],
        textTags: [],
        cvsSize: [1000, 1000],
        config: {},
        // 避免 normalizeSave 升级注入默认图标（url 以 '/' 开头，node 环境加载图标需要 window）
        meta: { textTagIconsVersion: 1 },
    } as Save
}

const ptAdd = (id: number): SaveDiff => ({ points: { $add: [{ id, pos: [0, 0], dir: 0, sta: 0 }] } })
const mkOp = (seq: number, diff: SaveDiff, saveId = 1): CollabOpMsg =>
    ({ opId: `op-${seq}`, saveId, seq, userId: 99, userName: 'bob', patch: JSON.stringify(diff), baseSeq: 0 })

class MockTransport implements CollabTransport {
    handlers!: CollabTransportHandlers
    myId = 1
    joinImpl: (saveId: number) => Promise<JoinCollabRoomInfo> =
        async () => ({ latestSeq: 0, idPrefix: 5, ownerUserId: this.myId, members: [{ userId: this.myId, userName: 'me' }], locks: [] })
    submitCalls: { opId: string, patch: string, baseSeq: number }[] = []
    submitImpl: (saveId: number, opId: string, patch: string, baseSeq: number) => Promise<number> =
        async () => { throw Error('未预设 submitImpl') }
    syncOpsImpl: (saveId: number, afterSeq: number) => Promise<SyncCollabOpsInfo> =
        async () => ({ ops: [], latestSeq: 0, gap: false })
    getSnapshotImpl: (saveId: number) => Promise<CollabSnapshotInfo | null> = async () => null
    leaves: number[] = []

    myUserId() { return this.myId }
    setHandlers(h: CollabTransportHandlers) { this.handlers = h }
    async join(saveId: number) { return this.joinImpl(saveId) }
    async leave(saveId: number) { this.leaves.push(saveId) }
    async submitOp(saveId: number, opId: string, patch: string, baseSeq: number) {
        this.submitCalls.push({ opId, patch, baseSeq })
        return this.submitImpl(saveId, opId, patch, baseSeq)
    }
    async syncOps(saveId: number, afterSeq: number) { return this.syncOpsImpl(saveId, afterSeq) }
    async acquireLock() { return true }
    async releaseLock() { /* 无需记录 */ }
    async requestSnapshot() { /* 无需记录 */ }
    async uploadSnapshot() { /* 无需记录 */ }
    async getSnapshot(saveId: number) { return this.getSnapshotImpl(saveId) }
    async notifySaved() { /* 无需记录 */ }
}

const flush = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)) }
async function waitFor(cond: () => boolean, timeoutMs = 2000) {
    const start = Date.now()
    while (!cond()) {
        if (Date.now() - start > timeoutMs)
            throw Error('waitFor 超时')
        await new Promise(r => setTimeout(r, 5))
    }
}

ensureDomStub()

describe('collabSessionStore 本地 op 提交管线（4.6）', () => {
    let mock: MockTransport
    const timingBackup = { ...collabSessionTiming }

    beforeEach(() => {
        createTestPinia()
        mock = new MockTransport()
        initCollabTransport(mock)
        collabSessionTiming.snapshotPollIntervalMs = 5
        collabSessionTiming.snapshotPollTimeoutMs = 30
        collabSessionTiming.snapshotMaxAttempts = 4
    })
    afterEach(() => {
        Object.assign(collabSessionTiming, timingBackup)
    })

    /** 在存档里加一个点并捕获（模拟一次本地编辑后的渲染完成钩子） */
    function localEditAddPt(id: number) {
        const save = useSaveStore().save!
        save.points.push({ id, pos: [0, 0], dir: 0, sta: 0 } as Save['points'][number])
        useCollabSessionStore().captureLocalOp()
    }

    it('稳态：本地编辑被捕获为 op 提交，ack 后出队；无变化不重复提交', async () => {
        const save = createSave()
        save.points = [{ id: 1, pos: [5, 5], dir: 0, sta: 0 }] as Save['points']  // 非空数组才是 keyed（空数组新增会退化为 $set 整组替换）
        useSaveStore().save = save
        const session = useCollabSessionStore()
        await session.join(1)
        mock.submitImpl = async () => 1

        localEditAddPt(801)
        await flush()

        expect(mock.submitCalls.length).toBe(1)
        const patch = JSON.parse(mock.submitCalls[0].patch) as SaveDiff
        expect(addedPts(patch)?.[0]).toMatchObject({ id: 801 })
        expect(session.pendingLocalOpCount()).toBe(0)  // ack 即出队

        useCollabSessionStore().captureLocalOp()  // 无新变化：基线已推进，不产生 op
        await flush()
        expect(mock.submitCalls.length).toBe(1)

        // 序流走到自己的 seq：跳过不重复应用（效果已在本地）
        mock.handlers.onOp(mkOp(1, ptAdd(801)))
        await flush()
        expect(useSaveStore().save!.points.filter(p => p.id === 801).length).toBe(1)
        expect(session.currentSeq()).toBe(1)
    })

    it('远程 op 同步进基线：随后的 capture 不会把他人变更误算成本地 op', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        await session.join(1)

        mock.handlers.onOp(mkOp(1, ptAdd(900)))  // 他人加了一个点
        await flush()
        expect(useSaveStore().save!.points.map(p => p.id)).toContain(900)

        session.captureLocalOp()  // 远程变更引起的渲染完成：不应产生本地 op
        await flush()
        expect(mock.submitCalls.length).toBe(0)

        mock.submitImpl = async () => 2
        localEditAddPt(801)  // 真正的本地编辑只含自己的变化
        await flush()
        expect(mock.submitCalls.length).toBe(1)
        const patch = JSON.parse(mock.submitCalls[0].patch) as SaveDiff
        expect(addedPts(patch)?.map(x => (x as { id: number }).id)).toEqual([801])
    })

    it('断线期间捕获留队，重连补齐后按原序重发（获得新 seq）', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        await session.join(1)
        mock.submitImpl = async () => 1
        localEditAddPt(801)
        await flush()
        expect(session.currentSeq()).toBe(1)  // ack 的 seq 恰为 lastSeq+1：级联跳过立即推进
        mock.handlers.onOp(mkOp(1, ptAdd(801)))  // 自己的回声：重复 seq 忽略
        await flush()
        expect(session.currentSeq()).toBe(1)
        expect(useSaveStore().save!.points.filter(p => p.id === 801).length).toBe(1)

        // 断线：蒙层生效前的在途编辑落入待发队列
        mock.handlers.onReconnecting()
        localEditAddPt(802)
        localEditAddPt(803)
        await flush()
        expect(session.pendingLocalOpCount()).toBe(2)
        expect(mock.submitCalls.length).toBe(1)  // 断线期间不再调用传输层

        // 重连：服务器侧无新 op（latestSeq=1），补齐后自动重发
        mock.joinImpl = async () => ({
            latestSeq: 1, idPrefix: 5, ownerUserId: 1,
            members: [{ userId: 1, userName: 'me' }], locks: [],
        })
        let nextSeq = 1
        mock.submitImpl = async () => ++nextSeq
        mock.handlers.onReconnected()
        await waitFor(() => session.state === 'synced' && session.pendingLocalOpCount() === 0)

        expect(mock.submitCalls.length).toBe(3)  // 802、803 按原序重发
        const resubmitted = mock.submitCalls.slice(1).map(c => addedPts(JSON.parse(c.patch) as SaveDiff)?.[0])
        expect(resubmitted).toEqual([expect.objectContaining({ id: 802 }), expect.objectContaining({ id: 803 })])

        // 序流走到重发的两个 seq：跳过不重复应用
        mock.handlers.onOp(mkOp(2, ptAdd(802)))
        mock.handlers.onOp(mkOp(3, ptAdd(803)))
        await flush()
        expect(session.currentSeq()).toBe(3)
        expect(useSaveStore().save!.points.map(p => p.id).sort()).toEqual([801, 802, 803])
    })

    it('快照重建后本地未 ack 编辑重放到快照底上，并自动重发', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        await session.join(1)

        // 本地编辑提交失败（如网络抖动）：留在队列
        mock.submitImpl = async () => { throw Error('网络异常') }
        localEditAddPt(801)
        await flush()
        expect(session.pendingLocalOpCount()).toBe(1)

        // 稳态收到跳号 op → SyncOps 报 Gap（只在第一次报）→ 快照重建
        let syncCalls = 0
        mock.syncOpsImpl = async () => {
            syncCalls++
            return syncCalls === 1
                ? { ops: [], latestSeq: 3, gap: true }
                : { ops: [], latestSeq: 3, gap: false }
        }
        const snapSave = createSave()
        snapSave.points = [{ id: 900, pos: [1, 1], dir: 0, sta: 0 }] as Save['points']
        mock.getSnapshotImpl = async () => ({ seq: 3, payload: JSON.stringify(snapSave), fromUserName: 'boss' })

        mock.submitImpl = async () => 4  // 重建后重发成功
        mock.handlers.onOp(mkOp(3, ptAdd(901)))  // 触发追赶；该 op 在快照水位内
        // 队列清空即说明快照重建 + 重发完成（ack 4 后水位随即推进到 4）
        await waitFor(() => session.pendingLocalOpCount() === 0)
        await flush()  // 等快照流程收尾，避免泄漏到后续用例

        const ids = useSaveStore().save!.points.map(p => p.id).sort()
        expect(ids).toEqual([801, 900])  // 快照底 + 本地未 ack 编辑重放（乱序 op 被快照覆盖）
        // 队列中的编辑已作为全新 op 重发
        expect(mock.submitCalls.length).toBe(2)
        const resent = JSON.parse(mock.submitCalls[1].patch) as SaveDiff
        expect(addedPts(resent)?.[0]).toMatchObject({ id: 801 })
        expect(session.currentSeq()).toBe(4)  // ack 4 后序流推进
    })

    it('队列溢出（提交持续失败）退会话并通知离房', async () => {
        useSaveStore().save = createSave()
        collabSessionTiming.maxPendingLocalOps = 3
        const session = useCollabSessionStore()
        await session.join(1)
        // submitImpl 默认抛错：所有 op 留队
        localEditAddPt(801)
        localEditAddPt(802)
        localEditAddPt(803)
        expect(session.state).toBe('synced')
        localEditAddPt(804)  // 第 4 条：溢出
        await flush()

        expect(session.state).toBe('off')
        expect(mock.leaves).toEqual([1])
    })

    it('leave 清空待发队列与基线；离会后捕获不生效', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        await session.join(1)
        localEditAddPt(801)  // submitImpl 默认抛错 → 留队
        await flush()
        expect(session.pendingLocalOpCount()).toBe(1)

        await session.leave()
        expect(session.pendingLocalOpCount()).toBe(0)

        localEditAddPt(802)
        await flush()
        expect(mock.submitCalls.length).toBe(1)  // 不再捕获（仅留队时的那次失败调用）
    })
})
