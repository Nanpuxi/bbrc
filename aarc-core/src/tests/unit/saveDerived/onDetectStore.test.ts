import { describe, it, expect, beforeEach } from 'vitest'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import { useOnDetectStore } from 'aarc-core/models/stores/saveDerived/saveDerivedDerived/onDetectStore'
import { useFormalizedLineStore } from 'aarc-core/models/stores/saveDerived/formalizedLineStore'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents'
import { useStaNameRectStore } from 'aarc-core/models/stores/saveDerived/staNameRectStore'
import { ControlPoint, ControlPointDir, ControlPointSta, Line, LineType, Save } from 'aarc-core/models/save'
import { BoxType } from 'aarc-core/components/common/types/pop'
import { FormalPt } from 'aarc-core/models/coord'

describe('onDetectStore - onLine', () => {
  beforeEach(() => {
    createTestPinia()
  })

  function fp(pos: FormalPt['pos'], afterIdxEqv: number, free?: boolean): FormalPt {
    return { pos, afterIdxEqv, free }
  }

  function setupFormalizedLine(lineId: number, pts: FormalPt[]) {
    const fls = useFormalizedLineStore()
    fls.setLinesFormalPts(lineId, pts)
  }

  function makeLine(id: number, pts: number[], locked?: boolean): Line {
    return { id, pts, name: '', nameSub: '', color: '', type: 0, locked } as Line
  }

  function setupSave(lines: Line[], points: ControlPoint[] = []) {
    const saveStore = useSaveStore()
    saveStore.save = {
      idIncre: 1, points, lines, textTags: [], cvsSize: [1000, 1000], config: {}, meta: {}
    } as Save
  }

  function setupPopRecorder() {
    const pops: { msg: string, type: BoxType }[] = []
    useUniqueComponentsStore().initCallbacks({
      popCallback: (msg, type) => { pops.push({ msg, type }) },
      waitCallback: () => {}
    })
    return pops
  }

  it('点击水平线段应返回命中', () => {
    setupFormalizedLine(1, [fp([0, 0], 0), fp([100, 0], 1)])
    const store = useOnDetectStore()

    const res = store.onLine([50, 5])

    expect(res).toHaveLength(1)
    expect(res[0].lineId).toBe(1)
    expect(res[0].alignedPos).toEqual([50, 0])
    expect(res[0].afterPtIdx).toBe(0)
    expect(res[0].dir).toBe(ControlPointDir.vertical)
  })

  it('exceptLines 应过滤指定线路', () => {
    setupFormalizedLine(1, [fp([0, 0], 0), fp([100, 0], 1)])
    setupFormalizedLine(2, [fp([0, 0], 0), fp([100, 0], 1)])
    const store = useOnDetectStore()

    const res = store.onLine([50, 5], [1])

    expect(res).toHaveLength(1)
    expect(res[0].lineId).toBe(2)
  })

  it('多条线路同时被点击时应全部返回', () => {
    setupFormalizedLine(1, [fp([0, 0], 0), fp([100, 0], 1)])
    setupFormalizedLine(2, [fp([0, 10], 0), fp([100, 10], 1)])
    const store = useOnDetectStore()

    const res = store.onLine([50, 5])

    expect(res).toHaveLength(2)
    const lineIds = res.map(x => x.lineId).sort()
    expect(lineIds).toEqual([1, 2])
  })

  it('afterPtIdx 应等于被点击区间起点的 afterIdxEqv', () => {
    setupFormalizedLine(1, [
      fp([0, 0], 0),
      fp([50, 0], 0),
      fp([100, 0], 1),
      fp([150, 0], 1),
      fp([200, 0], 2)
    ])
    const store = useOnDetectStore()

    const res = store.onLine([125, 5])

    expect(res).toHaveLength(1)
    expect(res[0].afterPtIdx).toBe(1)
  })

  it('空 formalizedLines 时不应命中', () => {
    const store = useOnDetectStore()

    const res = store.onLine([0, 0])

    expect(res).toHaveLength(0)
  })

  describe('onLine - 叠放顺序', () => {
    it('多条命中时应按视觉叠放顺序排列，zIndex 高者在前', () => {
      setupFormalizedLine(1, [fp([0, 0], 0), fp([100, 0], 1)])
      setupFormalizedLine(2, [fp([0, 0], 0), fp([100, 0], 1)])
      const l1 = makeLine(1, [10, 20]); l1.zIndex = 5
      const l2 = makeLine(2, [10, 20]); l2.zIndex = -5
      setupSave([l1, l2])
      const store = useOnDetectStore()

      const res = store.onLine([50, 0])

      expect(res.map(x => x.lineId)).toEqual([1, 2])
    })

    it('common 线路整体叠在 terrain 之上，与 zIndex 无关', () => {
      setupFormalizedLine(1, [fp([0, 0], 0), fp([100, 0], 1)])
      setupFormalizedLine(2, [fp([0, 0], 0), fp([100, 0], 1)])
      const terrain = makeLine(1, [10, 20]); terrain.type = LineType.terrain; terrain.zIndex = 9
      const common = makeLine(2, [10, 20]); common.zIndex = -9
      setupSave([terrain, common])
      const store = useOnDetectStore()

      const res = store.onLine([50, 0])

      expect(res.map(x => x.lineId)).toEqual([2, 1])
    })

    it('支线跟随其 parent 的叠放位置并叠在其上', () => {
      setupFormalizedLine(1, [fp([0, 0], 0), fp([100, 0], 1)])
      setupFormalizedLine(2, [fp([0, 0], 0), fp([100, 0], 1)])
      setupFormalizedLine(3, [fp([0, 0], 0), fp([100, 0], 1)])
      const parent = makeLine(1, [10, 20]) // zIndex 0
      const child = makeLine(2, [10, 20]); child.parent = 1; child.zIndex = -9
      const other = makeLine(3, [10, 20]); other.zIndex = -5
      setupSave([parent, child, other])
      const store = useOnDetectStore()

      const res = store.onLine([50, 0])

      // child 虽 zIndex 最低，但随 parent(zIndex 0) 渲染并叠在其上
      expect(res.map(x => x.lineId)).toEqual([2, 1, 3])
    })
  })

  describe('自由点 direct seg', () => {
    it('浅斜率任意角度直接段应正确命中并返回垂足', () => {
      setupFormalizedLine(1, [
        fp([0, 0], 0),
        fp([100, 10], 1, true)
      ])
      const store = useOnDetectStore()

      const res = store.onLine([50, 10])

      expect(res).toHaveLength(1)
      expect(res[0].lineId).toBe(1)
      expect(res[0].afterPtIdx).toBe(0)
      expect(res[0].alignedPos[0]).toBeCloseTo(50.5, 1)
      expect(res[0].alignedPos[1]).toBeCloseTo(5.05, 1)
    })

    it('负斜率任意角度直接段应返回正确垂足', () => {
      setupFormalizedLine(1, [
        fp([0, 100], 0),
        fp([100, 10], 1, true)
      ])
      const store = useOnDetectStore()

      const res = store.onLine([53, 59])

      expect(res).toHaveLength(1)
      expect(res[0].afterPtIdx).toBe(0)
      expect(res[0].alignedPos[0]).toBeCloseTo(49.67, 1)
      expect(res[0].alignedPos[1]).toBeCloseTo(55.30, 1)
    })

    it('混合 direct seg 与普通段时各自使用正确逻辑', () => {
      // A(0,0) -> B(free)(30,10) [direct] -> C(60,10) [normal horizontal]
      setupFormalizedLine(1, [
        fp([0, 0], 0),
        fp([30, 10], 1, true),
        fp([60, 10], 2)
      ])
      const store = useOnDetectStore()

      const onDirect = store.onLine([15, 8])
      expect(onDirect).toHaveLength(1)
      expect(onDirect[0].afterPtIdx).toBe(0)

      const onNormal = store.onLine([45, 15])
      expect(onNormal).toHaveLength(1)
      expect(onNormal[0].afterPtIdx).toBe(1)
      expect(onNormal[0].alignedPos).toEqual([45, 10])
    })
  })

  describe('onLine - locked 线路', () => {
    it('锁定的线路不应返回命中', () => {
      setupFormalizedLine(1, [fp([0, 0], 0), fp([100, 0], 1)])
      setupSave([makeLine(1, [10, 20], true)])
      const store = useOnDetectStore()

      expect(store.onLine([50, 5])).toHaveLength(0)
    })

    it('连续两次点击同一锁定线路应弹出提示', () => {
      setupFormalizedLine(1, [fp([0, 0], 0), fp([100, 0], 1)])
      const line = makeLine(1, [10, 20], true)
      line.name = '1号线'
      setupSave([line])
      const pops = setupPopRecorder()
      const store = useOnDetectStore()

      store.onLine([50, 5], [], true)
      expect(pops).toHaveLength(0)

      store.onLine([50, 5], [], true)
      expect(pops).toHaveLength(1)
      expect(pops[0].msg).toBe('1号线已锁定\n请前往列表解锁')
      expect(pops[0].type).toBe('failed')
    })

    it('不传 notifyLocked 时点击锁定线路不弹提示', () => {
      setupFormalizedLine(1, [fp([0, 0], 0), fp([100, 0], 1)])
      setupSave([makeLine(1, [10, 20], true)])
      const pops = setupPopRecorder()
      const store = useOnDetectStore()

      store.onLine([50, 5])
      store.onLine([50, 5])
      expect(pops).toHaveLength(0)
    })

    it('中间点击其他位置后重置，不再视为连续点击', () => {
      setupFormalizedLine(1, [fp([0, 0], 0), fp([100, 0], 1)])
      setupSave([makeLine(1, [10, 20], true)])
      const pops = setupPopRecorder()
      const store = useOnDetectStore()

      store.onLine([50, 5], [], true)
      store.onLine([500, 500], [], true) // 点击空白处，重置记录
      store.onLine([50, 5], [], true)
      expect(pops).toHaveLength(0)

      store.onLine([50, 5], [], true) // 再次连续点击才弹提示
      expect(pops).toHaveLength(1)
    })

    it('线路解锁后点击恢复命中', () => {
      setupFormalizedLine(1, [fp([0, 0], 0), fp([100, 0], 1)])
      setupSave([makeLine(1, [10, 20], true)])
      const store = useOnDetectStore()

      expect(store.onLine([50, 5])).toHaveLength(0)

      useSaveStore().save!.lines[0].locked = undefined
      const res = store.onLine([50, 5])
      expect(res).toHaveLength(1)
      expect(res[0].lineId).toBe(1)
    })
  })

  describe('onPt - locked 线路', () => {
    function makePt(id: number, pos: [number, number]): ControlPoint {
      return { id, pos, dir: ControlPointDir.vertical, sta: ControlPointSta.sta } as ControlPoint
    }

    it('点所属线路全部锁定时不应命中', () => {
      setupSave(
        [makeLine(1, [10, 20], true), makeLine(2, [10, 30], true)],
        [makePt(10, [100, 100])]
      )
      const store = useOnDetectStore()

      expect(store.onPt([100, 100])).toBeUndefined()
      expect(store.onPt([100, 100], true)).toBeUndefined()
    })

    it('点所属线路仅部分锁定时仍应命中', () => {
      setupSave(
        [makeLine(1, [10, 20], true), makeLine(2, [10, 30])],
        [makePt(10, [100, 100])]
      )
      const store = useOnDetectStore()

      expect(store.onPt([100, 100])?.id).toBe(10)
    })

    it('不属于任何线路的点不受锁定影响', () => {
      setupSave([makeLine(1, [20, 30], true)], [makePt(10, [100, 100])])
      const store = useOnDetectStore()

      expect(store.onPt([100, 100])?.id).toBe(10)
    })
  })

  describe('onStaName - locked 线路', () => {
    function makePt(id: number, pos: [number, number]): ControlPoint {
      return { id, pos, dir: ControlPointDir.vertical, sta: ControlPointSta.sta } as ControlPoint
    }

    function setupStaNameRect(ptId: number) {
      useStaNameRectStore().setStaNameRect(ptId, [[100, 100], [200, 150]])
    }

    it('点所属线路全部锁定时站名不应命中', () => {
      setupStaNameRect(10)
      setupSave([makeLine(1, [10, 20], true)], [makePt(10, [150, 120])])
      const store = useOnDetectStore()

      expect(store.onStaName([150, 120])).toBeUndefined()
    })

    it('点所属线路仅部分锁定时站名仍应命中', () => {
      setupStaNameRect(10)
      setupSave(
        [makeLine(1, [10, 20], true), makeLine(2, [10, 30])],
        [makePt(10, [150, 120])]
      )
      const store = useOnDetectStore()

      expect(store.onStaName([150, 120])?.id).toBe(10)
    })

    it('连续两次点击同一锁定站名应弹出提示', () => {
      setupStaNameRect(10)
      const line = makeLine(1, [10, 20], true)
      line.name = '1号线'
      setupSave([line], [makePt(10, [150, 120])])
      const pops = setupPopRecorder()
      const store = useOnDetectStore()

      store.onStaName([150, 120], true)
      expect(pops).toHaveLength(0)

      store.onStaName([150, 120], true)
      expect(pops).toHaveLength(1)
      expect(pops[0].msg).toBe('1号线已锁定\n请前往列表解锁')
      expect(pops[0].type).toBe('failed')
    })

    it('不传 notifyLocked 时点击锁定站名不弹提示', () => {
      setupStaNameRect(10)
      setupSave([makeLine(1, [10, 20], true)], [makePt(10, [150, 120])])
      const pops = setupPopRecorder()
      const store = useOnDetectStore()

      store.onStaName([150, 120])
      store.onStaName([150, 120])
      expect(pops).toHaveLength(0)
    })

    it('中间点击其他位置后重置，不再视为连续点击', () => {
      setupStaNameRect(10)
      setupSave([makeLine(1, [10, 20], true)], [makePt(10, [150, 120])])
      const pops = setupPopRecorder()
      const store = useOnDetectStore()

      store.onStaName([150, 120], true)
      store.onStaName([500, 500], true) // 点击空白处，重置记录
      store.onStaName([150, 120], true)
      expect(pops).toHaveLength(0)

      store.onStaName([150, 120], true) // 再次连续点击才弹提示
      expect(pops).toHaveLength(1)
    })

    it('线路解锁后站名恢复命中', () => {
      setupStaNameRect(10)
      setupSave([makeLine(1, [10, 20], true)], [makePt(10, [150, 120])])
      const store = useOnDetectStore()

      expect(store.onStaName([150, 120])).toBeUndefined()

      useSaveStore().save!.lines[0].locked = undefined
      expect(store.onStaName([150, 120])?.id).toBe(10)
    })
  })

  describe('onStaName - 叠放顺序', () => {
    function makePt(id: number, pos: [number, number]): ControlPoint {
      return { id, pos, dir: ControlPointDir.vertical, sta: ControlPointSta.sta } as ControlPoint
    }

    it('多个站名重叠时应返回 points 数组中靠后（视觉上层）的站名', () => {
      // 先登记 pt10 的 rect，使 Map 插入顺序与视觉叠放顺序相反，以区分新旧行为
      useStaNameRectStore().setStaNameRect(10, [[100, 100], [200, 150]])
      useStaNameRectStore().setStaNameRect(20, [[100, 100], [200, 150]])
      setupSave([], [makePt(10, [150, 120]), makePt(20, [150, 120])])
      const store = useOnDetectStore()

      expect(store.onStaName([150, 120])?.id).toBe(20)
    })

    it('最上层站名锁定时视为命中锁定站名，而不是穿透到下层', () => {
      useStaNameRectStore().setStaNameRect(10, [[100, 100], [200, 150]])
      useStaNameRectStore().setStaNameRect(20, [[100, 100], [200, 150]])
      // pt20 属于锁定线路，且在 points 中靠后（视觉上层）
      setupSave([makeLine(1, [20, 30], true)], [makePt(10, [150, 120]), makePt(20, [150, 120])])
      const store = useOnDetectStore()

      expect(store.onStaName([150, 120])).toBeUndefined()
    })
  })
})
