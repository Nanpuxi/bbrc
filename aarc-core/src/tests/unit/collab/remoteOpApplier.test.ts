import { describe, it, expect, beforeEach } from 'vitest'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import { resetIdCounter, createPoint, createEmptySave } from '../../helpers/saveFactory'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useStaClusterStore } from 'aarc-core/models/stores/saveDerived/staClusterStore'
import { saveDiffToSavePatch } from 'aarc-core/models/stores/saveDerived/staClusterStore.pure'
import { useUndoStore } from 'aarc-core/models/stores/utils/undoStore'
import { useNamePosMemoryStore } from 'aarc-core/models/stores/utils/namePosMemoryStore'
import { applyRemoteSaveDiff } from 'aarc-core/models/collab/remoteOpApplier'
import { diffSave, SaveDiff } from 'aarc-core/models/save/saveDiff'

// selectionStore（undoStore 的依赖）在 setup 时注册全局键盘监听，
// node 测试环境提供最小 document 桩
if (typeof document === 'undefined') {
    (globalThis as Record<string, unknown>).document = { addEventListener: () => {} }
}

describe('saveDiffToSavePatch', () => {
    it('diff 未触及 points/lines 时返回空对象（preserve）', () => {
        const patch = saveDiffToSavePatch({ idIncre: { $set: 1001 } })
        expect(patch).toEqual({})
    })

    it('points 的 $rm/$add/$upd 转换为对应条目', () => {
        const diff: SaveDiff = {
            points: {
                $rm: [3],
                $add: [{ id: 9, pos: [0, 0] }],
                $upd: [{ id: 2, pos: [5, 5] }]
            }
        }
        const patch = saveDiffToSavePatch(diff)
        expect(patch?.points?.map(x => x.id)).toEqual([3, 9, 2])
        // $rm 条目 new 为 undefined（删除），$add/$upd 条目 new 有定义
        expect(patch?.points?.[0].new).toBeUndefined()
        expect(patch?.points?.[1].new).toBeDefined()
        expect(patch?.points?.[2].new).toBeDefined()
    })

    it('仅 $seq 的 keyed 变更不产生条目（顺序与 cluster 无关）', () => {
        const patch = saveDiffToSavePatch({ points: { $seq: [2, 1] } })
        expect(patch?.points).toEqual([])
    })

    it('points 为原子 $set 时返回 undefined（保守重建）', () => {
        const patch = saveDiffToSavePatch({ points: { $set: [] } })
        expect(patch).toBeUndefined()
    })

    it('lines 为 $del 时返回 undefined（保守重建）', () => {
        const patch = saveDiffToSavePatch({ lines: { $del: true } })
        expect(patch).toBeUndefined()
    })

    it('lines 的 keyed 变更转换到 lines 字段', () => {
        const patch = saveDiffToSavePatch({ lines: { $upd: [{ id: 5, color: '#000' }] } })
        expect(patch?.lines?.map(x => x.id)).toEqual([5])
        expect(patch?.points).toBeUndefined()
    })
})

describe('applyRemoteSaveDiff', () => {
    beforeEach(() => {
        resetIdCounter()
        createTestPinia()
    })

    it('原地应用 diff：未变更元素的对象引用保持不变', async () => {
        const save = createEmptySave({
            points: [createPoint(1), { ...createPoint(2), pos: [100, 100] }]
        })
        useSaveStore().save = save
        const pointsArrRef = save.points
        const pt1Ref = save.points[0]

        const next = structuredClone(save)
        next.points[1].pos = [200, 200]
        const diff = diffSave(save, next)!
        await applyRemoteSaveDiff(diff)

        expect(save.points).toBe(pointsArrRef)      // 数组引用不变
        expect(save.points[0]).toBe(pt1Ref)         // 未变更的点引用不变
        expect(save.points[1].pos).toEqual([200, 200]) // 变更已应用
    })

    it('远程变更后 cluster 缓存按 diff 增量恢复', async () => {
        const save = createEmptySave({
            points: [
                { ...createPoint(1), pos: [0, 0] },
                { ...createPoint(2), pos: [100, 100] }
            ]
        })
        useSaveStore().save = save
        const staClusterStore = useStaClusterStore()
        // 先构建 cluster 缓存（两点相距 100+，不聚类）
        expect(staClusterStore.getStaClusters()).toHaveLength(0)

        // 远程把点 2 移到点 1 旁边
        const next = structuredClone(save)
        next.points[1].pos = [0.5, 0]
        await applyRemoteSaveDiff(diffSave(save, next)!)

        // 缓存已构建过 + 少量 points 变更 → 增量恢复，两点聚成同一 cluster
        const clusters = staClusterStore.getStaClusters()
        expect(clusters).toHaveLength(1)
        expect(clusters![0].map(p => p.id).sort()).toEqual([1, 2])
    })

    it('远程新增的点进入 cluster 缓存', async () => {
        const save = createEmptySave({
            points: [{ ...createPoint(1), pos: [0, 0] }]
        })
        useSaveStore().save = save
        const staClusterStore = useStaClusterStore()
        staClusterStore.getStaClusters()

        const next = structuredClone(save)
        next.points.push({ ...createPoint(2), pos: [0.5, 0] })
        await applyRemoteSaveDiff(diffSave(save, next)!)

        const clusters = staClusterStore.getStaClusters()
        expect(clusters).toHaveLength(1)
        expect(clusters![0].map(p => p.id).sort()).toEqual([1, 2])
    })

    it('远程变更不进入本地 undo 栈', async () => {
        const save = createEmptySave({
            points: [createPoint(1), { ...createPoint(2), pos: [100, 100] }]
        })
        const saveStore = useSaveStore()
        saveStore.save = save
        const undoStore = useUndoStore()
        undoStore.push(save) // 初始化 undo 基线

        // 远程把点 2 移到 (200, 200)
        const remote = structuredClone(save)
        remote.points[1].pos = [200, 200]
        await applyRemoteSaveDiff(diffSave(save, remote)!)
        expect(undoStore.canUndo).toBe(false) // 远程变更不产生 undo 记录

        // 本地随后修改点 1 并 push
        save.points[0].pos = [1, 1]
        undoStore.push(save)
        expect(undoStore.canUndo).toBe(true)

        // undo 只回退本地变更，远程变更（点 2 在 200,200）保留
        await undoStore.undo()
        const restored = useSaveStore().save
        expect(restored?.points.find(p => p.id === 1)?.pos).toEqual([10, 10])
        expect(restored?.points.find(p => p.id === 2)?.pos).toEqual([200, 200])
    })

    it('远程刷新不打断本地交互态（站名位置记忆保留）', async () => {
        const save = createEmptySave({
            points: [createPoint(1)]
        })
        useSaveStore().save = save
        const namePosMemoryStore = useNamePosMemoryStore()
        namePosMemoryStore.write({ ...createPoint(1), nameP: [5, 5] })
        expect(namePosMemoryStore.hasMem).toBe(true)

        const next = structuredClone(save)
        next.points.push(createPoint(2))
        await applyRemoteSaveDiff(diffSave(save, next)!)

        // 远程路径不清理 namePosMemory（编辑/交互态不属于数据缓存）
        expect(namePosMemoryStore.hasMem).toBe(true)
        expect(save.points).toHaveLength(2)
    })

    it('save 未加载时应用远程 diff 不报错', async () => {
        useSaveStore().save = undefined
        await expect(applyRemoteSaveDiff({ idIncre: { $set: 1 } })).resolves.toBeUndefined()
    })
})
