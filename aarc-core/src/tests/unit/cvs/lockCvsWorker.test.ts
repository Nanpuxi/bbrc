import { describe, it, expect, beforeEach } from 'vitest'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import { resetIdCounter, createPoint, createLine, createEmptySave } from '../../helpers/saveFactory'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useCollabLockStore } from 'aarc-core/models/stores/collabLockStore'
import { useLockCvsWorker } from 'aarc-core/models/cvs/workers/lockCvsWorker'
import { TextTag } from 'aarc-core/models/save'

describe('lockCvsWorker - collectLockCrosses', () => {
  beforeEach(() => {
    resetIdCounter()
    createTestPinia()
  })

  it('无他人锁时返回空', () => {
    useSaveStore().save = createEmptySave({ points: [createPoint(1)] })
    expect(useLockCvsWorker().collectLockCrosses()).toEqual([])
  })

  it('被他人锁定的点产生以点位为中心的叉', () => {
    const save = createEmptySave({ points: [{ ...createPoint(1), pos: [30, 40] }] })
    useSaveStore().save = save
    useCollabLockStore().applyRemoteLock('pt:1', 'userB')

    const marks = useLockCvsWorker().collectLockCrosses()
    expect(marks).toHaveLength(1)
    expect(marks[0].center).toEqual([30, 40])
    expect(marks[0].arm).toBeGreaterThan(0)
    expect(marks[0].width).toBeGreaterThan(0)
  })

  it('锁定不存在的对象时跳过（防御）', () => {
    useSaveStore().save = createEmptySave({ points: [createPoint(1)] })
    const lockStore = useCollabLockStore()
    lockStore.applyRemoteLock('pt:99', 'userB')
    lockStore.applyRemoteLock('line:99', 'userB')
    lockStore.applyRemoteLock('tag:99', 'userB')
    expect(useLockCvsWorker().collectLockCrosses()).toEqual([])
  })

  it('被他人锁定的文本标签（无渲染登记）在锚点画叉', () => {
    const tag = { id: 5, pos: [50, 60] } as TextTag
    useSaveStore().save = createEmptySave({ textTags: [tag] })
    useCollabLockStore().applyRemoteLock('tag:5', 'userB')

    const marks = useLockCvsWorker().collectLockCrosses()
    expect(marks).toHaveLength(1)
    expect(marks[0].center).toEqual([50, 60])
  })

  it('被他人锁定的线在点质心处画叉', () => {
    const save = createEmptySave({
      points: [
        { ...createPoint(1), pos: [0, 0] },
        { ...createPoint(2), pos: [100, 0] }
      ],
      lines: [createLine([1, 2], { id: 7 })]
    })
    useSaveStore().save = save
    useCollabLockStore().applyRemoteLock('line:7', 'userB')

    const marks = useLockCvsWorker().collectLockCrosses()
    expect(marks).toHaveLength(1)
    expect(marks[0].center).toEqual([50, 0])
  })

  it('自己持有的锁不画叉', () => {
    const save = createEmptySave({ points: [createPoint(1)] })
    useSaveStore().save = save
    useCollabLockStore().acquireMine('pt:1')
    expect(useLockCvsWorker().collectLockCrosses()).toEqual([])
  })
})
