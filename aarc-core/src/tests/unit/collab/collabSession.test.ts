import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import { ensureDomStub } from '../../helpers/domStub'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents'
import { useCollabStore, collabIdCounterCap } from 'aarc-core/models/stores/collabStore'
import { useCollabLockStore } from 'aarc-core/models/stores/collabLockStore'
import { useCollabSessionStore, collabSessionTiming } from 'aarc-core/models/collab/collabSessionStore'
import {
    CollabTransport, CollabTransportHandlers, JoinCollabRoomInfo,
    SyncCollabOpsInfo, CollabSnapshotInfo, CollabOpMsg
} from 'aarc-core/models/collab/collabTransport'
import { initCollabTransport } from 'aarc-core/models/collab/collabTransport'
import { SaveDiff } from 'aarc-core/models/save/saveDiff'
import { Save } from 'aarc-core/models/save'

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

const cap = collabIdCounterCap
const pid = (prefix: number, counter: number) => -(prefix * cap + counter)
const ptAdd = (id: number): SaveDiff => ({ points: { $add: [{ id, pos: [0, 0], dir: 0, sta: 0 }] } })
const mkOp = (seq: number, diff: SaveDiff, saveId = 1): CollabOpMsg =>
    ({ opId: `op-${seq}`, saveId, seq, userId: 99, userName: 'bob', patch: JSON.stringify(diff), baseSeq: 0 })

class MockTransport implements CollabTransport {
    handlers!: CollabTransportHandlers
    myId = 1
    joinCalls: number[] = []
    joinImpl: (saveId: number) => Promise<JoinCollabRoomInfo> =
        async () => ({ latestSeq: 0, idPrefix: 5, ownerUserId: this.myId, members: [{ userId: this.myId, userName: 'me' }], locks: [] })
    submitCalls: { opId: string, patch: string, baseSeq: number }[] = []
    submitImpl: (saveId: number, opId: string, patch: string, baseSeq: number) => Promise<number> =
        async () => { throw Error('未预设 submitImpl') }
    syncOpsCalls: number[] = []
    syncOpsImpl: (saveId: number, afterSeq: number) => Promise<SyncCollabOpsInfo> =
        async () => ({ ops: [], latestSeq: 0, gap: false })
    requestSnapshotCalls = 0
    getSnapshotImpl: (saveId: number) => Promise<CollabSnapshotInfo | null> = async () => null
    uploads: { saveId: number, seq: number, payload: string }[] = []
    leaves: number[] = []
    locksAcquired: string[] = []
    locksReleased: string[] = []
    savedNotices: number[] = []

    myUserId() { return this.myId }
    setHandlers(h: CollabTransportHandlers) { this.handlers = h }
    async join(saveId: number) { this.joinCalls.push(saveId); return this.joinImpl(saveId) }
    async leave(saveId: number) { this.leaves.push(saveId) }
    async submitOp(saveId: number, opId: string, patch: string, baseSeq: number) {
        this.submitCalls.push({ opId, patch, baseSeq })
        return this.submitImpl(saveId, opId, patch, baseSeq)
    }
    async syncOps(saveId: number, afterSeq: number) { this.syncOpsCalls.push(afterSeq); return this.syncOpsImpl(saveId, afterSeq) }
    async acquireLock(_saveId: number, key: string) { this.locksAcquired.push(key); return true }
    async releaseLock(_saveId: number, key: string) { this.locksReleased.push(key) }
    async requestSnapshot() { this.requestSnapshotCalls++ }
    async uploadSnapshot(saveId: number, seq: number, payload: string) { this.uploads.push({ saveId, seq, payload }) }
    async getSnapshot() { return this.getSnapshotImpl(0) }
    async notifySaved(saveId: number) { this.savedNotices.push(saveId) }
}

const flush = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)) }
async function waitFor(cond: () => boolean, timeoutMs = 2000) {
    const start = Date.now()
    while (!cond()) {
        if (Date.now() - start > timeoutMs)
            throw Error('waitFor 超时')
        await new Promise(r => setTimeout(r, 5))
    }
}

ensureDomStub()

describe('collabSessionStore 协作会话编排', () => {
    let mock: MockTransport
    const timingBackup = { ...collabSessionTiming }

    beforeEach(() => {
        createTestPinia()
        mock = new MockTransport()
        initCollabTransport(mock)
        // 单测用短时序
        collabSessionTiming.snapshotPollIntervalMs = 5
        collabSessionTiming.snapshotPollTimeoutMs = 30
        collabSessionTiming.snapshotMaxAttempts = 4
    })
    afterEach(() => {
        Object.assign(collabSessionTiming, timingBackup)
    })

    it('全新房间（我是房主）跳过快照，前缀按本地存档扫描设种子', async () => {
        const saveStore = useSaveStore()
        const save = createSave()
        save.points = [{ id: pid(5, 41) }] as Save['points']
        saveStore.save = save

        const session = useCollabSessionStore()
        await session.join(1)

        expect(session.state).toBe('synced')
        expect(session.isOwner).toBe(true)
        expect(mock.requestSnapshotCalls).toBe(0)
        const collab = useCollabStore()
        expect(collab.idPrefix).toBe(5)
        expect(collab.nextCollabId()).toBe(pid(5, 42))
        expect(session.canEdit).toBe(true)
    })

    it('加入已有房间：快照为底 + 缓冲 op 去重重放 + 锁表快照', async () => {
        const saveStore = useSaveStore()
        saveStore.save = createSave()  // DB 底（将被快照替换）
        saveStore.save.points = [{ id: 1, pos: [0, 0], dir: 0, sta: 0 }] as Save['points']

        mock.joinImpl = async () => ({
            latestSeq: 3, idPrefix: 2, ownerUserId: 9,
            members: [{ userId: 9, userName: 'boss' }, { userId: 1, userName: 'me' }],
            locks: [{ key: 'pt:5', holder: 'bob' }],
        })
        const snapSave = createSave()
        snapSave.points = [{ id: 900, pos: [1, 1], dir: 0, sta: 0 }] as Save['points']
        mock.getSnapshotImpl = async () => {
            // 同步期间到达的 op 必须先缓冲、快照落地后重放
            mock.handlers.onOp(mkOp(4, ptAdd(901)))
            return { seq: 3, payload: JSON.stringify(snapSave), fromUserName: 'boss' }
        }
        mock.syncOpsImpl = async () => ({ ops: [], latestSeq: 3, gap: false })

        const session = useCollabSessionStore()
        await session.join(1)

        const save = useSaveStore().save!
        expect(save.points.map(p => p.id).sort()).toEqual([900, 901])  // 旧 DB 底被替换
        expect(session.currentSeq()).toBe(4)
        expect(session.state).toBe('synced')
        expect(session.isOwner).toBe(false)
        expect(session.ownerUserId).toBe(9)
        expect(useCollabLockStore().otherLocks.get('pt:5')).toBe('bob')
        expect(useCollabStore().idPrefix).toBe(2)
    })

    it('稳态：ack 不推进水位，本人 seq 在序流中跳过', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        await session.join(1)

        // 服务器把我们的 op 排在 seq 2（seq 1 是他人 op，广播还没到）
        mock.submitImpl = async () => 2
        await session.submitOp(ptAdd(800))
        expect(session.currentSeq()).toBe(0)  // ack 本身不推进

        mock.handlers.onOp(mkOp(1, ptAdd(801)))
        await flush()
        expect(session.currentSeq()).toBe(2)  // 应用 1 后级联跳过自己的 2

        const ids = useSaveStore().save!.points.map(p => p.id)
        expect(ids).toContain(801)
        expect(ids).not.toContain(800)  // 本人 op 不由会话层重复应用（本地管线负责乐观应用）

        mock.handlers.onOp(mkOp(3, ptAdd(802)))
        await flush()
        expect(session.currentSeq()).toBe(3)
        expect(useSaveStore().save!.points.map(p => p.id)).toContain(802)
    })

    it('稳态：重复/旧 seq 的 op 被忽略', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        await session.join(1)
        mock.handlers.onOp(mkOp(1, ptAdd(801)))
        await flush()

        mock.handlers.onOp(mkOp(1, ptAdd(888)))  // 重放的旧 seq
        await flush()
        expect(useSaveStore().save!.points.map(p => p.id)).not.toContain(888)
        expect(session.currentSeq()).toBe(1)
    })

    it('稳态：seq 跳号触发 SyncOps 追赶，按序补齐', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        await session.join(1)
        mock.handlers.onOp(mkOp(1, ptAdd(801)))
        await flush()

        mock.syncOpsImpl = async (_sid) => ({
            ops: [mkOp(3, ptAdd(803)), mkOp(2, ptAdd(802))],  // 乱序返回也应按 seq 应用
            latestSeq: 3, gap: false,
        })
        mock.handlers.onOp(mkOp(3, ptAdd(803)))
        await waitFor(() => session.currentSeq() === 3)

        expect(mock.syncOpsCalls).toContain(1)
        const ids = useSaveStore().save!.points.map(p => p.id)
        expect(ids).toEqual(expect.arrayContaining([801, 802, 803]))
    })

    it('SyncOps 报 Gap：走快照整档重建', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        await session.join(1)
        mock.handlers.onOp(mkOp(1, ptAdd(801)))
        await flush()

        // 只有第一次 SyncOps 报 Gap（快照重建后再 SyncOps 应正常返回，否则快照流程会在后台空转泄漏到后续用例）
        let syncCalls = 0
        mock.syncOpsImpl = async () => {
            syncCalls++
            return syncCalls === 1
                ? { ops: [], latestSeq: 5, gap: true }
                : { ops: [], latestSeq: 5, gap: false }
        }
        const snapSave = createSave()
        snapSave.points = [{ id: 950, pos: [0, 0], dir: 0, sta: 0 }] as Save['points']
        mock.getSnapshotImpl = async () => ({ seq: 5, payload: JSON.stringify(snapSave), fromUserName: 'boss' })

        mock.handlers.onOp(mkOp(5, ptAdd(951)))  // 乱序触发追赶；该 op 在快照水位内，应被跳过
        await waitFor(() => session.currentSeq() === 5 && session.state === 'synced')
        await flush()  // 等快照流程收尾（SyncOps/drainBuffer），避免泄漏到后续用例

        const ids = useSaveStore().save!.points.map(p => p.id)
        expect(ids).toEqual([950])  // 整档替换，乱序 op 已被快照覆盖
    })

    it('快照轮询超时后重新请求（房主可能已换人），多轮后成功', async () => {
        useSaveStore().save = createSave()
        mock.joinImpl = async () => ({
            latestSeq: 2, idPrefix: 1, ownerUserId: 9,
            members: [{ userId: 9, userName: 'boss' }, { userId: 1, userName: 'me' }], locks: [],
        })
        // 第一轮请求后快照始终未就绪（超时）；第二轮立即可得
        mock.getSnapshotImpl = async () => {
            if (mock.requestSnapshotCalls < 2)
                return null
            const s = createSave()
            return { seq: 2, payload: JSON.stringify(s), fromUserName: 'boss' }
        }
        mock.syncOpsImpl = async () => ({ ops: [], latestSeq: 2, gap: false })

        const session = useCollabSessionStore()
        await session.join(1)

        expect(mock.requestSnapshotCalls).toBe(2)
        expect(session.state).toBe('synced')
    })

    it('快照彻底失败：join 抛错、本地清理、通知服务器离房', async () => {
        useSaveStore().save = createSave()
        mock.joinImpl = async () => ({
            latestSeq: 2, idPrefix: 1, ownerUserId: 9,
            members: [{ userId: 9, userName: 'boss' }, { userId: 1, userName: 'me' }], locks: [],
        })
        collabSessionTiming.snapshotMaxAttempts = 2

        const session = useCollabSessionStore()
        await expect(session.join(1)).rejects.toThrow()

        expect(session.state).toBe('off')
        expect(useCollabStore().idPrefix).toBeNull()
        expect(mock.leaves).toEqual([1])
    })

    it('重连：rejoin 幂等 + 清本地锁 + 锁快照重建 + 增量补齐 + 前缀种子只增不减', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        await session.join(1)  // 前缀 5

        const collab = useCollabStore()
        collab.nextCollabId(); collab.nextCollabId(); collab.nextCollabId()  // 本地计数到 3
        const lockStore = useCollabLockStore()
        lockStore.acquireMine('pt:1')
        expect(mock.locksAcquired).toEqual(['pt:1'])

        mock.handlers.onReconnecting()
        expect(session.connState).toBe('reconnecting')
        expect(session.canEdit).toBe(false)

        // 重连成功：服务器侧我的锁已清、房间有了新 op 与他人锁
        mock.syncOpsImpl = async () => ({
            ops: [mkOp(1, ptAdd(801)), mkOp(2, ptAdd(802))], latestSeq: 2, gap: false,
        })
        mock.joinImpl = async () => ({
            latestSeq: 2, idPrefix: 5, ownerUserId: 1,
            members: [{ userId: 1, userName: 'me' }, { userId: 9, userName: 'bob' }],
            locks: [{ key: 'pt:7', holder: 'bob' }],
        })
        mock.handlers.onReconnected()
        await waitFor(() => session.state === 'synced' && session.currentSeq() === 2)

        expect(mock.joinCalls.length).toBe(2)
        expect(session.connState).toBe('online')
        expect(lockStore.myLocks.size).toBe(0)               // 断连期间服务器已清
        expect(lockStore.otherLocks.get('pt:7')).toBe('bob') // 新锁快照为准
        expect(useSaveStore().save!.points.map(p => p.id)).toEqual(expect.arrayContaining([801, 802]))
        // 扫描种子为 0，但本地计数器已用到 3：只增不减，防止复用已删除元素的 id
        expect(collab.nextCollabId()).toBe(pid(5, 3))
    })

    it('UserLeft 清除该成员的锁；OwnerChanged 更新房主', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        await session.join(1)

        mock.handlers.onUserJoined({ userId: 9, userName: 'bob' })
        mock.handlers.onLockAcquired({ key: 'pt:5', holder: 'bob' })
        mock.handlers.onLockAcquired({ key: 'pt:6', holder: 'alice' })
        const lockStore = useCollabLockStore()
        expect(lockStore.otherLocks.size).toBe(2)

        mock.handlers.onUserLeft({ userId: 9, userName: 'bob' })
        expect(lockStore.otherLocks.has('pt:5')).toBe(false)
        expect(lockStore.otherLocks.has('pt:6')).toBe(true)
        expect(session.members.map(m => m.userId)).not.toContain(9)

        expect(session.isOwner).toBe(true)  // 首进房者
        mock.handlers.onOwnerChanged({ userId: 9, userName: 'alice' })
        expect(session.isOwner).toBe(false)
        expect(session.ownerUserId).toBe(9)
    })

    it('SnapshotRequested：房主上传（水位=已应用 seq），非房主/其他房间忽略', async () => {
        const save = createSave()
        save.points = [{ id: 1, pos: [2, 3], dir: 0, sta: 0 }] as Save['points']
        useSaveStore().save = save
        const session = useCollabSessionStore()
        await session.join(1)  // 我是房主

        mock.handlers.onSnapshotRequested(999)  // 其他房间
        mock.handlers.onSnapshotRequested(1)
        await flush()

        expect(mock.uploads.length).toBe(1)
        expect(mock.uploads[0].seq).toBe(0)
        const payload = JSON.parse(mock.uploads[0].payload)
        expect(payload.points[0].id).toBe(1)
    })

    it('submitOp 守卫：未同步完成或断线时拒绝提交', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        await expect(session.submitOp(ptAdd(1))).rejects.toThrow()  // off
        await session.join(1)
        mock.handlers.onDisconnected()
        await expect(session.submitOp(ptAdd(1))).rejects.toThrow()  // disconnected
    })

    it('leave：清理全部会话状态并通知服务器', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        await session.join(1)
        useCollabLockStore().acquireMine('pt:1')

        await session.leave()

        expect(session.state).toBe('off')
        expect(session.saveId).toBeNull()
        expect(mock.leaves).toEqual([1])
        expect(useCollabStore().idPrefix).toBeNull()
        const lockStore = useCollabLockStore()
        expect(lockStore.myLocks.size).toBe(0)
        expect(lockStore.otherLocks.size).toBe(0)
        expect(lockStore.lockRequestHandler).toBeUndefined()
    })

    it('SyncOps 返回含本人 op 时跳过不重复应用', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        await session.join(1)

        mock.submitImpl = async () => 2
        await session.submitOp(ptAdd(802))  // 本地管线会乐观应用；此处只验证会话层不重复应用

        // seq 3 先到（乱序）→ 追赶；syncOps 回包含本人 seq 2 的完整队列
        mock.syncOpsImpl = async () => ({
            ops: [mkOp(1, ptAdd(801)), mkOp(2, ptAdd(802)), mkOp(3, ptAdd(803))],
            latestSeq: 3, gap: false,
        })
        mock.handlers.onOp(mkOp(3, ptAdd(803)))
        await waitFor(() => session.currentSeq() === 3)

        const ids = useSaveStore().save!.points.map(p => p.id)
        expect(ids).toEqual(expect.arrayContaining([801, 803]))
        expect(ids).not.toContain(802)  // 本人 op 被跳过
    })

    it('已保存通知：房主保存后广播，其他人收到后弹窗', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        await session.join(1)
        expect(session.isOwner).toBe(true)

        // 房主保存成功 → 广播"已保存"
        session.notifySaved()
        await flush()
        expect(mock.savedNotices).toEqual([1])

        // 其他人视角：收到 Saved 事件 → 弹窗"房主已保存"
        const popSpy = vi.spyOn(useUniqueComponentsStore(), 'showPop')
        mock.handlers.onSaved('me')
        expect(popSpy).toHaveBeenCalledWith('房主已保存', 'success')
    })

    it('已保存通知：非房主不发送', async () => {
        useSaveStore().save = createSave()
        mock.joinImpl = async () => ({
            latestSeq: 3, idPrefix: 2, ownerUserId: 9,
            members: [{ userId: 9, userName: 'boss' }, { userId: 1, userName: 'me' }],
            locks: [],
        })
        const snapSave = createSave()
        mock.getSnapshotImpl = async () => ({ seq: 3, payload: JSON.stringify(snapSave), fromUserName: 'boss' })
        mock.syncOpsImpl = async () => ({ ops: [], latestSeq: 3, gap: false })

        const session = useCollabSessionStore()
        await session.join(1)
        expect(session.isOwner).toBe(false)

        session.notifySaved()
        await flush()
        expect(mock.savedNotices).toEqual([])
    })

    it('hasEverSynced：进房成功到达稳态后为 true，离房后复位', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        expect(session.hasEverSynced()).toBe(false)

        await session.join(1)
        expect(session.state).toBe('synced')
        expect(session.hasEverSynced()).toBe(true)

        await session.leave()
        expect(session.state).toBe('off')
        expect(session.hasEverSynced()).toBe(false)
    })

    it('hasEverSynced：进房被拒（从未到达稳态）保持 false，供 Editor 区分"会话异常结束"', async () => {
        useSaveStore().save = createSave()
        mock.joinImpl = async () => { throw Error('仅存档所有者可开启协作') }

        const session = useCollabSessionStore()
        await expect(session.join(1)).rejects.toThrow('仅存档所有者可开启协作')

        expect(session.state).toBe('off')
        expect(session.hasEverSynced()).toBe(false)
    })
})
