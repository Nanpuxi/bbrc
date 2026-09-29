import { describe, it, expect, beforeEach } from 'vitest'
import { Coord } from 'aarc-core/models/coord'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import { resetIdCounter, createPoint, createLine, createEmptySave } from '../../helpers/saveFactory'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useConfigStore } from 'aarc-core/models/stores/configStore'
import { useCollabLockStore } from 'aarc-core/models/stores/collabLockStore'
import { useLockCvsWorker } from 'aarc-core/models/cvs/workers/lockCvsWorker'
import { TextTag } from 'aarc-core/models/save'
import { buildLinePathGeometry, adaptLegacyGetTurnRadiusOf } from 'aarc-core/utils/lineUtils/buildLinePathGeometry'
import { intervalMidpoints } from 'aarc-core/utils/lineUtils/intervalMidpoints'
import { formalize } from 'aarc-core/utils/lineUtils/formalize'

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

  it('被他人锁定的两控制点线在区间中点画叉', () => {
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

  it('锁定 3 控制点折线出 2 个叉，位置与纯几何层区间中点逐一比对', () => {
    const saveStore = useSaveStore()
    const pts = [
      { ...createPoint(1), pos: [0, 0] as Coord },
      { ...createPoint(2), pos: [100, 0] as Coord },
      { ...createPoint(3), pos: [100, 100] as Coord }
    ]
    const line = createLine(pts.map(p => p.id), { id: 7 })
    saveStore.save = createEmptySave({ points: pts, lines: [line] })
    useCollabLockStore().applyRemoteLock('line:7', 'userB')

    const marks = useLockCvsWorker().collectLockCrosses()
    const expected = intervalMidpoints(buildLinePathGeometry(formalize(pts), line,
      adaptLegacyGetTurnRadiusOf(useConfigStore().getTurnRadiusOf)))
    expect(expected).toHaveLength(2)
    expect(marks).toHaveLength(expected.length)
    for (let i = 0; i < expected.length; i++) {
      expect(marks[i].center[0]).toBeCloseTo(expected[i][0], 9)
      expect(marks[i].center[1]).toBeCloseTo(expected[i][1], 9)
    }
    // 叉确实标在区间中点而非整体质心
    expect(marks.some(m => Math.abs(m.center[0] - 200 / 3) < 1 && Math.abs(m.center[1] - 100 / 3) < 1)).toBe(false)
  })

  it('锁定单控制点线路（无区间）：退化为其控制点处一个叉', () => {
    const save = createEmptySave({
      points: [{ ...createPoint(1), pos: [30, 40] }],
      lines: [createLine([1], { id: 7 })]
    })
    useSaveStore().save = save
    useCollabLockStore().applyRemoteLock('line:7', 'userB')

    const marks = useLockCvsWorker().collectLockCrosses()
    expect(marks).toHaveLength(1)
    expect(marks[0].center).toEqual([30, 40])
  })

  it('自己持有的锁不画叉', () => {
    const save = createEmptySave({ points: [createPoint(1)] })
    useSaveStore().save = save
    useCollabLockStore().acquireMine('pt:1')
    expect(useLockCvsWorker().collectLockCrosses()).toEqual([])
  })
})
