import { describe, it, expect, beforeEach } from 'vitest'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import { ensureDomStub } from '../../helpers/domStub'
import { resetIdCounter, createPoint, createEmptySave } from '../../helpers/saveFactory'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useEnvStore } from 'aarc-core/models/stores/envStore'
import { useSelectionStore } from 'aarc-core/models/stores/selectionStore'
import { useCollabLockStore } from 'aarc-core/models/stores/collabLockStore'
import { applyRemoteCollabLock } from 'aarc-core/models/collab/lockApplier'
import { diffSave } from 'aarc-core/models/save/saveDiff'
import { ControlPointDir, TextTag } from 'aarc-core/models/save'
import rfdc from 'rfdc'

const deepClone = rfdc()

ensureDomStub()

describe('applyRemoteCollabLock 败方降级', () => {
  beforeEach(() => {
    resetIdCounter()
    createTestPinia()
  })

  it('他人锁定我激活的点：取消激活并释放我的锁', () => {
    const save = createEmptySave({ points: [createPoint(1)] })
    useSaveStore().save = save
    const envStore = useEnvStore()
    const lockStore = useCollabLockStore()

    envStore.activePt = save.points[0]
    lockStore.acquireMine('pt:1')

    applyRemoteCollabLock('pt:1', 'userB')

    expect(envStore.activePt).toBeUndefined()
    expect(lockStore.isLockedByOther('pt:1')).toBe(true)
    expect(lockStore.myLocks.has('pt:1')).toBe(false)
  })

  it('他人锁定我激活的文本标签：取消激活', () => {
    const tag = { id: 5, pos: [0, 0] } as TextTag
    const save = createEmptySave({ textTags: [tag] })
    useSaveStore().save = save
    const envStore = useEnvStore()
    envStore.activeTextTag = tag

    applyRemoteCollabLock('tag:5', 'userB')

    expect(envStore.activeTextTag).toBeUndefined()
  })

  it('他人锁定我选区中的点：移出选区', () => {
    const save = createEmptySave({ points: [createPoint(1), createPoint(2)] })
    useSaveStore().save = save
    const selectionStore = useSelectionStore()
    const lockStore = useCollabLockStore()
    selectionStore.selected.add(save.points[0])
    selectionStore.selected.add(save.points[1])
    lockStore.acquireMine('pt:1')
    lockStore.acquireMine('pt:2')

    applyRemoteCollabLock('pt:2', 'userB')

    expect(selectionStore.selected.size).toBe(1)
    expect([...selectionStore.selected][0].id).toBe(1)
    expect(lockStore.myLocks.has('pt:2')).toBe(false)
    expect(lockStore.myLocks.has('pt:1')).toBe(true) // 未冲突的锁不受影响
  })

  it('他人锁定与本地无关的对象：不影响本地状态', () => {
    const save = createEmptySave({ points: [createPoint(1)] })
    useSaveStore().save = save
    const envStore = useEnvStore()
    envStore.activePt = save.points[0]

    applyRemoteCollabLock('pt:99', 'userB')

    expect(envStore.activePt?.id).toBe(1)
    expect(useCollabLockStore().isLockedByOther('pt:99')).toBe(true)
  })
})

describe('applyRemoteCollabLock 败方快照恢复', () => {
  beforeEach(() => {
    resetIdCounter()
    createTestPinia()
  })

  it('败方降级时把激活点恢复为加锁时的快照（pos/dir/sta 及新增字段）', () => {
    const save = createEmptySave({ points: [createPoint(1)] })
    useSaveStore().save = save
    const envStore = useEnvStore()
    const lockStore = useCollabLockStore()
    const baseline = deepClone(save)

    const pt = save.points[0]
    envStore.activePt = pt
    lockStore.acquireMine('pt:1', pt)
    // 模拟拖动/改向/站名位移：改动已落在 save 上
    pt.pos = [777, 888]
    pt.dir = ControlPointDir.incline
    pt.nameP = [3, 4]

    applyRemoteCollabLock('pt:1', 'userB')

    expect(envStore.activePt).toBeUndefined()
    expect(pt.pos).toEqual([10, 10])
    expect(pt.dir).toBe(ControlPointDir.vertical)
    expect(pt.nameP).toBeUndefined() // 快照中不存在的键被移除
    // 恢复后 save 与基线一致 → 下一次取 diff 为空，半截改动零网络痕迹
    expect(diffSave(baseline, save)).toBeNull()
  })

  it('选区中的败方对象被恢复并移出选区，其余选中对象不受影响', () => {
    const save = createEmptySave({ points: [createPoint(1), createPoint(2)] })
    useSaveStore().save = save
    const selectionStore = useSelectionStore()
    const lockStore = useCollabLockStore()
    selectionStore.selected.add(save.points[0])
    selectionStore.selected.add(save.points[1])
    lockStore.acquireMine('pt:1', save.points[0])
    lockStore.acquireMine('pt:2', save.points[1])
    // 模拟多选拖动：两个点都动过
    save.points[0].pos = [100, 100]
    save.points[1].pos = [200, 200]

    applyRemoteCollabLock('pt:2', 'userB')

    expect(selectionStore.selected.size).toBe(1)
    expect(save.points[1].pos).toEqual([20, 20]) // 败方恢复
    expect(save.points[0].pos).toEqual([100, 100]) // 仍持有的对象保留改动
  })

  it('败方对象已被删除：跳过恢复，正常取消激活', () => {
    const save = createEmptySave({ points: [createPoint(1)] })
    useSaveStore().save = save
    const envStore = useEnvStore()
    const lockStore = useCollabLockStore()
    envStore.activePt = save.points[0]
    lockStore.acquireMine('pt:1', save.points[0])
    save.points.splice(0, 1) // 对象已不在存档中

    expect(() => applyRemoteCollabLock('pt:1', 'userB')).not.toThrow()
    expect(envStore.activePt).toBeUndefined()
    expect(lockStore.myLocks.has('pt:1')).toBe(false)
  })

  it('未登记快照的锁被夺走时仍正常降级（向后兼容）', () => {
    const save = createEmptySave({ points: [createPoint(1)] })
    useSaveStore().save = save
    const envStore = useEnvStore()
    const lockStore = useCollabLockStore()
    envStore.activePt = save.points[0]
    lockStore.acquireMine('pt:1') // 无快照
    save.points[0].pos = [777, 888]

    applyRemoteCollabLock('pt:1', 'userB')

    expect(envStore.activePt).toBeUndefined()
    expect(save.points[0].pos).toEqual([777, 888]) // 无快照可恢复，改动保留（LWW 兜底）
  })

  it('文本标签败方恢复 pos', () => {
    const tag = { id: 5, pos: [0, 0] } as TextTag
    const save = createEmptySave({ textTags: [tag] })
    useSaveStore().save = save
    const envStore = useEnvStore()
    const lockStore = useCollabLockStore()
    envStore.activeTextTag = tag
    lockStore.acquireMine('tag:5', tag)
    tag.pos = [50, 60]

    applyRemoteCollabLock('tag:5', 'userB')

    expect(envStore.activeTextTag).toBeUndefined()
    expect(tag.pos).toEqual([0, 0])
  })
})
