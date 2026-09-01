import { describe, it, expect, beforeEach } from 'vitest'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useFreePtDirectionStore } from 'aarc-core/models/stores/saveDerived/freePtDirectionStore'
import { computeFreeSnapCandidatesMulti } from 'aarc-core/utils/snapUtils/snapInterPtFree'
import { ControlPointDir, ControlPointSta } from 'aarc-core/models/save'
import {
  resetIdCounter,
  createEmptySave
} from '../../helpers/saveFactory'

describe('freePtDirectionStore', () => {
  beforeEach(() => {
    resetIdCounter()
    createTestPinia()
  })

  it('free 点的相邻段和方向信息应正确', () => {
    const saveStore = useSaveStore()
    const freePt = {
      id: 2,
      pos: [1, 0] as [number, number],
      dir: ControlPointDir.vertical,
      sta: ControlPointSta.sta,
      free: true
    }
    const prevPt = {
      id: 1,
      pos: [0, 0] as [number, number],
      dir: ControlPointDir.vertical,
      sta: ControlPointSta.sta
    }
    const nextPt = {
      id: 3,
      pos: [3, 1] as [number, number],
      dir: ControlPointDir.vertical,
      sta: ControlPointSta.sta
    }
    saveStore.save = createEmptySave({
      points: [prevPt, freePt, nextPt],
      lines: [{
        id: 1,
        pts: [1, 2, 3],
        name: '测试线',
        nameSub: '',
        color: '#ff0000',
        type: 0
      }]
    })

    const store = useFreePtDirectionStore()
    const seg = store.getAdjacentSeg(2)
    expect(seg?.prev).toStrictEqual(prevPt)
    expect(seg?.next).toStrictEqual(nextPt)

    const info = store.getPtDirectionInfo(2)
    expect(info).toBeDefined()
    expect(info!.prev).toBeDefined()
    expect(info!.next).toBeDefined()
    expect(info!.all).toHaveLength(2)

    const dirs = store.getPtDirections(2)
    expect(dirs).toHaveLength(2)
  })

  it('非 free 点不应被缓存', () => {
    const saveStore = useSaveStore()
    const nonFreePt = {
      id: 2,
      pos: [1, 0] as [number, number],
      dir: ControlPointDir.vertical,
      sta: ControlPointSta.sta
    }
    const prevPt = {
      id: 1,
      pos: [0, 0] as [number, number],
      dir: ControlPointDir.vertical,
      sta: ControlPointSta.sta
    }
    saveStore.save = createEmptySave({
      points: [prevPt, nonFreePt],
      lines: [{
        id: 1,
        pts: [1, 2],
        name: '测试线',
        nameSub: '',
        color: '#ff0000',
        type: 0
      }]
    })

    const store = useFreePtDirectionStore()
    expect(store.getAdjacentSeg(2)).toBeUndefined()
    expect(store.getPtDirectionInfo(2)).toBeUndefined()
    expect(store.getPtDirections(2)).toHaveLength(0)
  })

  it('save 变化后缓存应重新计算', () => {
    const saveStore = useSaveStore()
    const freePt = {
      id: 2,
      pos: [1, 0] as [number, number],
      dir: ControlPointDir.vertical,
      sta: ControlPointSta.sta,
      free: true
    }
    const prevPt = {
      id: 1,
      pos: [0, 0] as [number, number],
      dir: ControlPointDir.vertical,
      sta: ControlPointSta.sta
    }
    saveStore.save = createEmptySave({
      points: [prevPt, freePt],
      lines: [{
        id: 1,
        pts: [1, 2],
        name: '测试线',
        nameSub: '',
        color: '#ff0000',
        type: 0
      }]
    })

    const store = useFreePtDirectionStore()
    expect(store.getPtDirections(2)).toHaveLength(1)

    // 移动 prevPt 到与 freePt 重合，方向应消失
    prevPt.pos = [1, 0]
    saveStore.save = { ...saveStore.save! }
    expect(store.getPtDirections(2)).toHaveLength(0)
  })

  // 回归：free 点属于两条互相垂直的直线线路时，应产生 4 个偏移吸附候选
  // （每条直线各贡献 2 个垂足，合起来呈十字形）。
  // 此前 adjacentSegMap 只取第一次出现的线路（segs[0]），第二条线的方向被丢弃，
  // 只会产生 2 个；修复后按每次出现分别生成候选再合并去重。
  function setupTwoPerpendicularLines() {
    const saveStore = useSaveStore()
    const mkPt = (id: number, pos: [number, number], free = false) => ({
      id,
      pos,
      dir: ControlPointDir.vertical,
      sta: ControlPointSta.sta,
      free: free || undefined
    })
    // free 点 B(0,0) 同时属于水平线 [1,2,3] 与竖直线 [4,2,5]
    const freePt = mkPt(2, [0, 0], true)
    saveStore.save = createEmptySave({
      points: [
        mkPt(1, [-10, 0]),
        freePt,
        mkPt(3, [10, 0]),
        mkPt(4, [0, -10]),
        mkPt(5, [0, 10])
      ],
      lines: [
        { id: 1, pts: [1, 2, 3], name: '水平线', nameSub: '', color: '#ff0000', type: 0 },
        { id: 2, pts: [4, 2, 5], name: '竖直线', nameSub: '', color: '#00ff00', type: 0 }
      ]
    })
    return freePt
  }

  it('属于两条垂直线路的 free 点应包含两条线的方向', () => {
    setupTwoPerpendicularLines()
    const store = useFreePtDirectionStore()
    const dirs = store.getPtDirections(2)
    // 水平方向 [1,0] 与竖直方向 [0,1]（或反向）都应存在
    expect(dirs).toHaveLength(2)
    expect(dirs.some(d => Math.abs(d[0]) === 1 && d[1] === 0)).toBe(true)
    expect(dirs.some(d => d[0] === 0 && Math.abs(d[1]) === 1)).toBe(true)
  })

  it('属于两条垂直线路的 free 点应产生 4 个偏移吸附候选（十字形）', () => {
    setupTwoPerpendicularLines()
    const store = useFreePtDirectionStore()
    const freePt = useSaveStore().getPtById(2)!
    const d = 10
    // 与 snapCore.snapInterPt 一致：用 store 提供的每次出现的方向信息生成候选后合并
    const candidates = computeFreeSnapCandidatesMulti(freePt, d, store.getPtDirectionInfos(2))
    // 自身 + 4 个偏移候选：水平线的垂足 (0,±10) 与竖直线的垂足 (±10,0)
    expect(candidates).toHaveLength(5)
    const has = (x: number, y: number) =>
      candidates.some(c => Math.abs(c[0] - x) < 1e-6 && Math.abs(c[1] - y) < 1e-6)
    expect(has(0, 0)).toBe(true)
    expect(has(0, 10)).toBe(true)
    expect(has(0, -10)).toBe(true)
    expect(has(10, 0)).toBe(true)
    expect(has(-10, 0)).toBe(true)
  })
})
