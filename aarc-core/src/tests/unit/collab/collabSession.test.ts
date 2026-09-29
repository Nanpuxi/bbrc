import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import { ensureDomStub } from '../../helpers/domStub'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents'
import { useCollabStore, collabIdCounterCap } from 'aarc-core/models/stores/collabStore'
import { useCollabLockStore } from 'aarc-core/models/stores/collabLockStore'
import { useCollabSessionStore, collabSessionTiming } from 'aarc-core/models/collab/collabSessionStore'
import { useCollabLogStore } from 'aarc-core/models/collab/collabLogStore'
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
    closes: number[] = []
    locksAcquired: string[] = []
    locksReleased: string[] = []
    savedNotices: number[] = []

    myUserId() { return this.myId }
    setHandlers(h: CollabTransportHandlers) { this.handlers = h }
    async join(saveId: number) { this.joinCalls.push(saveId); return this.joinImpl(saveId) }
    async leave(saveId: number) { this.leaves.push(saveId) }
    async closeRoom(saveId: number) { this.closes.push(saveId) }
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
        vi.unstubAllGlobals()
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
        // join 先试增量：首轮报 Gap（队列修剪）→ 快照兜底；快照重建后再 SyncOps 为稳态
        let syncCalls = 0
        mock.syncOpsImpl = async () => {
            syncCalls++
            return syncCalls === 1
                ? { ops: [], latestSeq: 3, gap: true }
                : { ops: [], latestSeq: 4, gap: false }
        }

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
        // join 先试增量：首轮报 Gap（队列修剪）→ 快照兜底；快照重建后再 SyncOps 为稳态
        let syncCalls = 0
        mock.syncOpsImpl = async () => {
            syncCalls++
            return syncCalls === 1
                ? { ops: [], latestSeq: 2, gap: true }
                : { ops: [], latestSeq: 2, gap: false }
        }

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
        // join 先试增量：Gap（队列修剪）→ 快照兜底；快照始终未就绪 → 彻底失败
        mock.syncOpsImpl = async () => ({ ops: [], latestSeq: 2, gap: true })

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

    it('SnapshotRequested：稳态且无未ack编辑的成员均可上传（房主优先由服务器转发）', async () => {
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

        // 非房主（协作者）收到转发同样上传——房主无存活连接时成员兜底（§7.1 ③）
        mock.joinImpl = async () => ({
            latestSeq: 3, idPrefix: 2, ownerUserId: 9,
            members: [{ userId: 9, userName: 'boss' }, { userId: 1, userName: 'me' }],
            locks: [],
        })
        mock.syncOpsImpl = async () => ({
            ops: [mkOp(1, ptAdd(1)), mkOp(2, ptAdd(2)), mkOp(3, ptAdd(3))], latestSeq: 3, gap: false,
        })
        await session.leave()
        await session.join(1)
        expect(session.isOwner).toBe(false)
        mock.handlers.onSnapshotRequested(1)
        await flush()
        expect(mock.uploads.length).toBe(2)
        expect(mock.uploads[1].seq).toBe(3)   // 水位 = 已应用 seq
    })

    it('SnapshotRequested：持有未 ack 本地编辑时不上传（水位必须覆盖快照内容）', async () => {
        const save = createSave()
        useSaveStore().save = save
        const session = useCollabSessionStore()
        await session.join(1)
        expect(session.isOwner).toBe(true)

        // 本地编辑入队但未 ack（submit 抛错即留在待发队列）
        save.points = [{ id: 7, pos: [0, 0], dir: 0, sta: 0 }] as Save['points']
        session.captureLocalOp()
        expect(session.pendingLocalOpCount()).toBe(1)
        mock.submitImpl = async () => { throw Error('断线') }
        await session.flushLocalOps()

        mock.handlers.onSnapshotRequested(1)
        await flush()
        expect(mock.uploads.length).toBe(0)   // 拒绝上传：快照会含未入水位的编辑

        // ack 后队列出空 → 恢复可上传
        mock.submitImpl = async () => 1
        await session.flushLocalOps()
        expect(session.pendingLocalOpCount()).toBe(0)
        mock.handlers.onSnapshotRequested(1)
        await flush()
        expect(mock.uploads.length).toBe(1)
    })

    it('SnapshotRequested：同步中（等快照/追赶）但本地状态未被重建时可上传——破解双向互拒死锁', async () => {
        useSaveStore().save = createSave()
        mock.joinImpl = async () => ({
            latestSeq: 3, idPrefix: 2, ownerUserId: 9,
            members: [{ userId: 9, userName: 'boss' }, { userId: 1, userName: 'me' }],
            locks: [],
        })
        mock.syncOpsImpl = async () => ({
            ops: [mkOp(1, ptAdd(1)), mkOp(2, ptAdd(2)), mkOp(3, ptAdd(3))], latestSeq: 3, gap: false,
        })
        const session = useCollabSessionStore()
        await session.join(1)
        expect(session.isOwner).toBe(false)

        // 房主重连：成员处于 resyncAfterOwnerReconnect 的 syncing 窗口，
        // 本地存档仍是房内完整副本（水位覆盖内容）→ 可提供快照，打破双方 syncing 互拒
        session.state = 'syncing'
        mock.handlers.onSnapshotRequested(1)
        await flush()
        expect(mock.uploads.length).toBe(1)
        expect(mock.uploads[0].seq).toBe(3)
    })

    it('join：非独房且队列未修剪 → 增量补齐即完成，不请求快照（B 修复）', async () => {
        useSaveStore().save = createSave()
        mock.joinImpl = async () => ({
            latestSeq: 2, idPrefix: 5, ownerUserId: 9,
            members: [{ userId: 9, userName: 'boss' }, { userId: 1, userName: 'me' }],
            locks: [],
        })
        mock.syncOpsImpl = async () => ({ ops: [mkOp(1, ptAdd(801)), mkOp(2, ptAdd(802))], latestSeq: 2, gap: false })

        const session = useCollabSessionStore()
        await session.join(1)

        expect(session.state).toBe('synced')
        expect(mock.requestSnapshotCalls).toBe(0)  // 队列完整：根本不需要快照
        expect(session.currentSeq()).toBe(2)
        expect(useSaveStore().save!.points.map(p => p.id)).toEqual([801, 802])
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

    // ---- 房主生命周期修订（backend-plan.md §7.1 ②③）----

    it('leave：房主离开发 closeRoom（主动关房信号）再走连接级离房；非房主只发 leave', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        await session.join(1)
        expect(session.isOwner).toBe(true)

        await session.leave()
        expect(mock.closes).toEqual([1])
        expect(mock.leaves).toEqual([1])

        // 非房主：只 leave 不 closeRoom
        mock.joinImpl = async () => ({
            latestSeq: 3, idPrefix: 2, ownerUserId: 9,
            members: [{ userId: 9, userName: 'boss' }, { userId: 1, userName: 'me' }],
            locks: [],
        })
        mock.getSnapshotImpl = async () => ({ seq: 3, payload: JSON.stringify(createSave()), fromUserName: 'boss' })
        mock.syncOpsImpl = async () => ({ ops: [], latestSeq: 3, gap: false })
        await session.join(1)
        expect(session.isOwner).toBe(false)

        await session.leave()
        expect(mock.closes).toEqual([1])   // 未再增加
        expect(mock.leaves).toEqual([1, 1])
    })

    it('RoomClosed：清理本地会话并置 roomClosedNotice（web 据此弹窗+跳首页）', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        await session.join(1)
        const noticeBefore = session.roomClosedNotice

        mock.handlers.onRoomClosed(1)

        expect(session.state).toBe('off')
        expect(session.isInSession).toBe(false)
        expect(session.saveId).toBe(null)
        expect(session.roomClosedNotice).toBe(noticeBefore + 1)
        // 清理幂等：重复事件不再计数
        mock.handlers.onRoomClosed(1)
        expect(session.roomClosedNotice).toBe(noticeBefore + 1)
        // 其他存档的房间关闭不影响本会话（单房间假设下仅防御）
        await session.join(1)
        const n2 = session.roomClosedNotice
        mock.handlers.onRoomClosed(2)
        expect(session.state).toBe('synced')
        expect(session.roomClosedNotice).toBe(n2)
    })

    it('OwnerOffline/OwnerReconnected：离线禁编辑，重连后整档重建再解除蒙层', async () => {
        useSaveStore().save = createSave()
        mock.joinImpl = async () => ({
            latestSeq: 3, idPrefix: 2, ownerUserId: 9,
            members: [{ userId: 9, userName: 'boss' }, { userId: 1, userName: 'me' }],
            locks: [],
        })
        mock.getSnapshotImpl = async () => ({ seq: 3, payload: JSON.stringify(createSave()), fromUserName: 'boss' })
        mock.syncOpsImpl = async () => ({ ops: [], latestSeq: 3, gap: false })

        const session = useCollabSessionStore()
        await session.join(1)
        expect(session.canEdit).toBe(true)

        mock.handlers.onOwnerOffline(1)
        expect(session.ownerOffline).toBe(true)
        expect(session.canEdit).toBe(false)
        // 离线期间拒绝提交
        await expect(session.submitOp(ptAdd(1))).rejects.toThrow()

        // 房主重连：快照整档重建（走 getSnapshot），完成后解除蒙层
        const snapSave = createSave()
        snapSave.points = [{ id: 950, pos: [2, 2], dir: 0, sta: 0 }] as Save['points']
        mock.getSnapshotImpl = async () => ({ seq: 7, payload: JSON.stringify(snapSave), fromUserName: 'boss' })
        mock.syncOpsImpl = async () => ({ ops: [], latestSeq: 7, gap: false })
        mock.handlers.onOwnerReconnected(1)
        await waitFor(() => session.ownerOffline === false)

        expect(session.state).toBe('synced')
        expect(session.canEdit).toBe(true)
        expect(session.currentSeq()).toBe(7)
        expect(useSaveStore().save!.points.map(p => p.id)).toEqual([950])
    })

    it('join：进房时服务器报告房主处于宽限期（ownerOffline）→ 非房主显示离线蒙层', async () => {
        useSaveStore().save = createSave()
        mock.joinImpl = async () => ({
            latestSeq: 3, idPrefix: 2, ownerUserId: 9,
            members: [{ userId: 9, userName: 'boss' }, { userId: 1, userName: 'me' }],
            locks: [],
            ownerOffline: true,
        })
        mock.getSnapshotImpl = async () => ({ seq: 3, payload: JSON.stringify(createSave()), fromUserName: 'boss' })
        mock.syncOpsImpl = async () => ({ ops: [], latestSeq: 3, gap: false })

        const session = useCollabSessionStore()
        await session.join(1)

        expect(session.isOwner).toBe(false)
        expect(session.ownerOffline).toBe(true)
        expect(session.canEdit).toBe(false)
    })

    it('重连：房内仅自己一人且队列修剪（Gap）→ 不请求快照，直接续用本地状态', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        await session.join(1)  // 房主独房
        mock.handlers.onDisconnected()

        // 重连：队列已被修剪（Gap），房内仍只有自己
        mock.joinImpl = async () => ({
            latestSeq: 5, idPrefix: 5, ownerUserId: 1,
            members: [{ userId: 1, userName: 'me' }],
            locks: [],
        })
        mock.syncOpsImpl = async () => ({ ops: [], latestSeq: 5, gap: true })

        mock.handlers.onReconnected()
        await waitFor(() => session.state === 'synced')

        expect(session.isInSession).toBe(true)
        expect(mock.requestSnapshotCalls).toBe(0)  // 未走快照流程（无人可提供）
    })

    it('重连：房内仅自己一人且补齐失败 → 跳过快照兜底，直接续用本地状态', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        await session.join(1)  // 房主独房
        mock.handlers.onDisconnected()

        mock.joinImpl = async () => ({
            latestSeq: 5, idPrefix: 5, ownerUserId: 1,
            members: [{ userId: 1, userName: 'me' }],
            locks: [],
        })
        mock.syncOpsImpl = async () => { throw Error('网络抖动') }

        mock.handlers.onReconnected()
        await waitFor(() => session.state === 'synced')

        expect(session.isInSession).toBe(true)
        expect(mock.requestSnapshotCalls).toBe(0)
        // 恢复稳态后本地 op 队列照常重发
        mock.submitImpl = async () => 6
        const save = useSaveStore().save!
        save.points = [{ id: 7, pos: [0, 0], dir: 0, sta: 0 }] as Save['points']
        session.captureLocalOp()
        await waitFor(() => session.pendingLocalOpCount() === 0)
    })

    it('重连：服务器重启房间重建（水位回退）→ 重置水位/缓冲/标记，以本地状态为底继续', async () => {
        const ls = stubLocalStorage()
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        await session.join(1)  // 房主独房

        // 应用两个远程 op，水位推进到 2；模拟保存（标记=2）
        mock.handlers.onOp(mkOp(1, ptAdd(801)))
        mock.handlers.onOp(mkOp(2, ptAdd(802)))
        await waitFor(() => session.currentSeq() === 2)
        session.notifySaved()
        expect(ls.get('aarc-collab-saved-seq:1')).toBe('2')
        // 一个已 ack 但广播还没回来的本人 op（ack 的是 seq 5，中间隔着他人 op，
        // pendingOwnSeqs={5}，水位不推进）
        mock.submitImpl = async () => 5
        await session.submitOp(ptAdd(803))
        expect(session.currentSeq()).toBe(2)

        mock.handlers.onReconnecting()
        // 服务器重启：内存清空，房主重连重新开房（fresh room：水位 0、仅自己）
        mock.joinImpl = async () => ({
            latestSeq: 0, idPrefix: 5, ownerUserId: 1,
            members: [{ userId: 1, userName: 'me' }],
            locks: [],
            myConnectionCount: 1,
        })
        mock.handlers.onReconnected()
        await waitFor(() => session.state === 'synced')

        expect(session.currentSeq()).toBe(0)              // 水位已重置为新房水位
        expect(ls.get('aarc-collab-saved-seq:1')).toBe('0')  // 标记重写为新房基线
        expect(mock.syncOpsCalls).toEqual([])             // 不做增量补齐（旧 seq 已无意义）
        // 本地状态原样保留（含重启前已应用的远程 op）
        expect(useSaveStore().save!.points.map(p => p.id)).toEqual(expect.arrayContaining([801, 802]))
        // 新房 seq 从 1 重新开始：后续 op 不再被旧水位误判为"重复"而跳过
        mock.handlers.onOp(mkOp(1, ptAdd(901)))
        await waitFor(() => session.currentSeq() === 1)
        expect(useSaveStore().save!.points.map(p => p.id)).toContain(901)
    })

    // ---- 独房重进（刷新页面，§7.1 ③配套）：不请求快照，按保存点水位从队列重建 ----

    function stubLocalStorage(initial: Record<string, string> = {}) {
        const data = new Map(Object.entries(initial))
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => data.has(k) ? data.get(k)! : null,
            setItem: (k: string, v: string) => { data.set(k, v) },
            removeItem: (k: string) => { data.delete(k) },
        })
        return data
    }

    it('join：独房刷新重进 + 保存点标记（未保存过=0）→ 从队列恢复全部编辑，不请求快照', async () => {
        stubLocalStorage({ 'aarc-collab-saved-seq:1': '0' })  // 开房时写入的标记，刷新后仍在
        useSaveStore().save = createSave()  // DB 加载底（=房间基线，未保存过）
        mock.joinImpl = async () => ({
            latestSeq: 2, idPrefix: 5, ownerUserId: 1,
            members: [{ userId: 1, userName: 'me' }],
            locks: [],
            myConnectionCount: 1,
        })
        const afterSeqs: number[] = []
        mock.syncOpsImpl = async (_s, afterSeq) => {
            afterSeqs.push(afterSeq)
            return { ops: [mkOp(1, ptAdd(801)), mkOp(2, ptAdd(802))], latestSeq: 2, gap: false }
        }

        const session = useCollabSessionStore()
        await session.join(1)

        expect(session.state).toBe('synced')
        expect(mock.requestSnapshotCalls).toBe(0)      // 不请求快照（无人可提供）
        expect(afterSeqs).toEqual([0])                 // 从保存点（0）补齐
        expect(session.currentSeq()).toBe(2)
        expect(useSaveStore().save!.points.map(p => p.id)).toEqual([801, 802])  // 未保存编辑全部恢复
    })

    it('join：独房刷新重进 + 保存点标记 m → 只补保存点之后的 op（已落库的不重复应用）', async () => {
        stubLocalStorage({ 'aarc-collab-saved-seq:1': '2' })  // 保存发生在水位 2
        const save = createSave()
        save.points = [{ id: 801, pos: [0, 0], dir: 0, sta: 0 }] as Save['points']  // DB 已含 op1 的效果
        useSaveStore().save = save
        mock.joinImpl = async () => ({
            latestSeq: 3, idPrefix: 5, ownerUserId: 1,
            members: [{ userId: 1, userName: 'me' }],
            locks: [],
            myConnectionCount: 1,
        })
        const afterSeqs: number[] = []
        mock.syncOpsImpl = async (_s, afterSeq) => {
            afterSeqs.push(afterSeq)
            return { ops: [mkOp(3, ptAdd(802))], latestSeq: 3, gap: false }
        }

        const session = useCollabSessionStore()
        await session.join(1)

        expect(mock.requestSnapshotCalls).toBe(0)
        expect(afterSeqs).toEqual([2])                 // 从保存点补齐，不重放已落库的 op1
        expect(useSaveStore().save!.points.map(p => p.id)).toEqual([801, 802])
    })

    it('join：独房刷新重进但无标记（他端保存过）→ 保守跳过历史 op，不请求快照', async () => {
        stubLocalStorage()  // 空：无标记
        useSaveStore().save = createSave()
        mock.joinImpl = async () => ({
            latestSeq: 5, idPrefix: 5, ownerUserId: 1,
            members: [{ userId: 1, userName: 'me' }],
            locks: [],
            myConnectionCount: 1,
        })

        const session = useCollabSessionStore()
        await session.join(1)

        expect(session.state).toBe('synced')
        expect(mock.requestSnapshotCalls).toBe(0)
        expect(mock.syncOpsCalls).toEqual([])          // 不补队列（DB 与队列对应关系不可考）
        expect(session.currentSeq()).toBe(5)           // 采纳房间水位，以 DB 状态为底继续
        expect(useSaveStore().save!.points).toEqual([])
    })

    it('join：独房刷新重进但保存点之后的 op 被修剪（Gap）→ 保守续用 DB 状态', async () => {
        stubLocalStorage({ 'aarc-collab-saved-seq:1': '2' })
        useSaveStore().save = createSave()
        mock.joinImpl = async () => ({
            latestSeq: 9, idPrefix: 5, ownerUserId: 1,
            members: [{ userId: 1, userName: 'me' }],
            locks: [],
            myConnectionCount: 1,
        })
        mock.syncOpsImpl = async () => ({ ops: [], latestSeq: 9, gap: true })

        const session = useCollabSessionStore()
        await session.join(1)

        expect(session.state).toBe('synced')
        expect(mock.requestSnapshotCalls).toBe(0)
        expect(session.currentSeq()).toBe(9)
        expect(useSaveStore().save!.points).toEqual([])
    })

    it('join：同用户其他连接在房（多标签页/多设备）不算独房 → 走正常快照流程', async () => {
        useSaveStore().save = createSave()
        mock.joinImpl = async () => ({
            latestSeq: 3, idPrefix: 5, ownerUserId: 1,
            members: [{ userId: 1, userName: 'me' }],
            locks: [],
            myConnectionCount: 2,   // 另一连接在房（服务器规则①可转给它供快照）
        })
        const snapSave = createSave()
        snapSave.points = [{ id: 900, pos: [0, 0], dir: 0, sta: 0 }] as Save['points']
        mock.getSnapshotImpl = async () => ({ seq: 3, payload: JSON.stringify(snapSave), fromUserName: 'me' })
        // join 先试增量：首轮报 Gap（队列修剪）→ 快照兜底；快照重建后再 SyncOps 为稳态
        let syncCalls = 0
        mock.syncOpsImpl = async () => {
            syncCalls++
            return syncCalls === 1
                ? { ops: [], latestSeq: 3, gap: true }
                : { ops: [], latestSeq: 3, gap: false }
        }

        const session = useCollabSessionStore()
        await session.join(1)

        expect(session.state).toBe('synced')
        expect(mock.requestSnapshotCalls).toBe(1)      // 非独房：请求快照（由自己的另一连接提供）
        expect(useSaveStore().save!.points.map(p => p.id)).toEqual([900])
    })

    // ---- 事件日志与进/出房气泡（activity-log.md §3.3）----

    it('他人进/出房：各记一条日志并弹气泡', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        const log = useCollabLogStore()
        await session.join(1)
        expect(log.entries).toEqual([])   // 自己进房不记日志、不弹气泡

        const popSpy = vi.spyOn(useUniqueComponentsStore(), 'showPop')
        mock.handlers.onUserJoined({ userId: 7, userName: 'alice' })
        expect(log.entries.map(e => [e.kind, e.userName, e.text])).toEqual([['join', 'alice', '加入了协作']])
        expect(popSpy).toHaveBeenCalledWith('alice 加入了协作', 'info')

        mock.handlers.onUserLeft({ userId: 7, userName: 'alice' })
        expect(log.entries.map(e => [e.kind, e.userName, e.text])).toEqual([
            ['join', 'alice', '加入了协作'],
            ['leave', 'alice', '离开了协作'],
        ])
        expect(popSpy).toHaveBeenCalledWith('alice 离开了协作', 'info')
        expect(session.members.map(m => m.userId)).toEqual([1])
    })

    it('远程 op：按应用前的存档概括成一条日志', async () => {
        const save = createSave()
        save.lines = [{ id: 1, name: '山手线', nameSub: '', pts: [], color: '#f00', type: 0 }] as Save['lines']
        useSaveStore().save = save
        const session = useCollabSessionStore()
        const log = useCollabLogStore()
        await session.join(1)

        mock.handlers.onOp(mkOp(1, { points: { $add: [{ id: 801, pos: [0, 0], dir: 0, sta: 1, name: '新宿' }] }, idIncre: { $set: 101 } } as SaveDiff))
        await flush()
        mock.handlers.onOp(mkOp(2, { lines: { $rm: [1] } } as SaveDiff))
        await flush()

        expect(log.entries.map(e => `${e.userName}:${e.text}`)).toEqual(['bob:新增了车站「新宿」', 'bob:删除了线路「山手线」'])
        expect(log.entries.every(e => e.kind === 'op')).toBe(true)
    })

    it('本地 op 不记日志（自己知道自己干了什么）', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        const log = useCollabLogStore()
        await session.join(1)

        mock.submitImpl = async () => 1
        const save = useSaveStore().save!
        save.points = [{ id: 7, pos: [0, 0], dir: 0, sta: 1, name: '池袋' }] as Save['points']
        session.captureLocalOp()
        await waitFor(() => session.pendingLocalOpCount() === 0)

        expect(log.entries).toEqual([])
    })

    it('离房清空日志（日志随会话消亡）', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        const log = useCollabLogStore()
        await session.join(1)

        mock.handlers.onUserJoined({ userId: 7, userName: 'alice' })
        expect(log.entries.length).toBe(1)

        await session.leave()
        expect(log.entries).toEqual([])
    })
})
