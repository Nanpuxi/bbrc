import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import { ensureDomStub } from '../../helpers/domStub'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useCollabSessionStore } from 'aarc-core/models/collab/collabSessionStore'
import { applyRemoteSaveDiff } from 'aarc-core/models/collab/remoteOpApplier'
import {
    bumpSaveDataRevision, getSaveDataRevision, hasUnsavedSaveDataRevision,
    markSaveDataSaved, resetSaveDataRevision,
} from 'aarc-core/models/collab/saveDataRevision'
import {
    CollabTransport, CollabTransportHandlers, JoinCollabRoomInfo,
    SyncCollabOpsInfo, CollabSnapshotInfo, CollabOpMsg, initCollabTransport,
} from 'aarc-core/models/collab/collabTransport'
import { resetIdCounter, createPoint, createEmptySave } from '../../helpers/saveFactory'
import { diffSave } from 'aarc-core/models/save/saveDiff'
import { Save } from 'aarc-core/models/save'
import rfdc from 'rfdc'

const deepClone = rfdc()

ensureDomStub()

/**
 * 数据版本号（saveDataRevision）：只在存档内容真的变化时递增（远程 op 应用、
 * 协作中本地编辑的 diff 检出、快照整档替换），与渲染无关——协作会话内
 * "未保存"的判据，避免无关渲染（补渲染迟到、图标加载完成）重新置位未保存标记。
 */

describe('saveDataRevision 版本语义', () => {
    afterEach(() => {
        resetSaveDataRevision()
    })

    it('初始为已保存；递增后未保存；打标后回到已保存', () => {
        expect(hasUnsavedSaveDataRevision()).toBe(false)
        bumpSaveDataRevision()
        expect(hasUnsavedSaveDataRevision()).toBe(true)
        markSaveDataSaved()
        expect(hasUnsavedSaveDataRevision()).toBe(false)
    })

    it('多次递增累计；reset 归零', () => {
        bumpSaveDataRevision()
        bumpSaveDataRevision()
        bumpSaveDataRevision()
        expect(getSaveDataRevision()).toBe(3)
        expect(hasUnsavedSaveDataRevision()).toBe(true)
        resetSaveDataRevision()
        expect(getSaveDataRevision()).toBe(0)
        expect(hasUnsavedSaveDataRevision()).toBe(false)
    })

    it('打标后发生的递增才算未保存（补渲染在保存前请求、保存后到点不重演）', () => {
        bumpSaveDataRevision()   // 远程 op 应用
        markSaveDataSaved()      // 房主保存成功：基线对齐
        expect(hasUnsavedSaveDataRevision()).toBe(false)
        // 保存完成后那次被推迟的补渲染到点：期间无新数据变化
        expect(hasUnsavedSaveDataRevision()).toBe(false)
        bumpSaveDataRevision()   // 此后新 op 到达
        expect(hasUnsavedSaveDataRevision()).toBe(true)
    })
})

describe('saveDataRevision 递增点', () => {
    beforeEach(() => {
        resetIdCounter()
        createTestPinia()
    })
    afterEach(() => {
        resetSaveDataRevision()
    })

    it('applyRemoteSaveDiff 应用远程 op 时递增（未保存 → 保存打标后清除）', async () => {
        const save = createEmptySave({
            points: [createPoint(1)]
        })
        useSaveStore().save = save
        markSaveDataSaved()
        const before = getSaveDataRevision()

        const next = deepClone(save)
        next.points.push(createPoint(2))
        await applyRemoteSaveDiff(diffSave(save, next)!)

        expect(getSaveDataRevision()).toBe(before + 1)
        expect(hasUnsavedSaveDataRevision()).toBe(true)
        markSaveDataSaved()
        expect(hasUnsavedSaveDataRevision()).toBe(false)
    })
})

describe('saveDataRevision 与本地 op 捕获', () => {
    let mock: MockTransport

    class MockTransport implements CollabTransport {
        handlers!: CollabTransportHandlers
        joinImpl: (saveId: number) => Promise<JoinCollabRoomInfo> =
            async () => ({ latestSeq: 0, idPrefix: 5, ownerUserId: 1, members: [{ userId: 1, userName: 'me' }], locks: [] })
        submitImpl: (saveId: number, opId: string, patch: string, baseSeq: number) => Promise<number> =
            async () => { throw Error('未预设 submitImpl') }
        myUserId() { return 1 }
        setHandlers(h: CollabTransportHandlers) { this.handlers = h }
        async join(saveId: number) { return this.joinImpl(saveId) }
        async leave() { /* 无需记录 */ }
        async closeRoom() { /* 无需记录 */ }
        async submitOp(saveId: number, opId: string, patch: string, baseSeq: number) { return this.submitImpl(saveId, opId, patch, baseSeq) }
        async syncOps(): Promise<SyncCollabOpsInfo> { return { ops: [], latestSeq: 0, gap: false } }
        async acquireLock() { return true }
        async releaseLock() { /* 无需记录 */ }
        async requestSnapshot() { /* 无需记录 */ }
        async uploadSnapshot() { /* 无需记录 */ }
        async getSnapshot(): Promise<CollabSnapshotInfo | null> { return null }
        async notifySaved() { /* 无需记录 */ }
    }

    function createSave(): Save {
        return createEmptySave({
            points: [{ id: 1, pos: [5, 5], dir: 0, sta: 0 } as Save['points'][number]]
        })
    }

    const flush = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)) }

    beforeEach(() => {
        createTestPinia()
        mock = new MockTransport()
        initCollabTransport(mock)
    })
    afterEach(() => {
        resetSaveDataRevision()
    })

    it('captureLocalOp：首次初始化基线不计；本地编辑检出 diff 时递增', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        await session.join(1)
        markSaveDataSaved()
        const before = getSaveDataRevision()

        session.captureLocalOp()  // 首次：初始化基线，无变化不计
        expect(getSaveDataRevision()).toBe(before)
        expect(hasUnsavedSaveDataRevision()).toBe(false)

        useSaveStore().save!.points.push({ id: 801, pos: [0, 0], dir: 0, sta: 0 } as Save['points'][number])
        session.captureLocalOp()  // 本地编辑：diff 检出 → 递增
        expect(getSaveDataRevision()).toBe(before + 1)
        expect(hasUnsavedSaveDataRevision()).toBe(true)
    })

    it('远程 op 已单独递增：其后的 capture（diff 为空）不重复递增', async () => {
        useSaveStore().save = createSave()
        const session = useCollabSessionStore()
        await session.join(1)
        session.captureLocalOp()  // 建立基线
        markSaveDataSaved()

        const before = getSaveDataRevision()
        const op: CollabOpMsg = {
            opId: 'op-1', saveId: 1, seq: 1, userId: 99, userName: 'bob',
            patch: JSON.stringify({ points: { $add: [{ id: 900, pos: [0, 0], dir: 0, sta: 0 }] } }), baseSeq: 0,
        }
        mock.handlers.onOp(op)
        await flush()
        expect(getSaveDataRevision()).toBe(before + 1)

        session.captureLocalOp()  // 远程变更已同步进基线：无 diff，不重复递增
        expect(getSaveDataRevision()).toBe(before + 1)
    })
})
