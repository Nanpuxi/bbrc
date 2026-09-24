import { describe, it, expect, beforeEach } from 'vitest'
import { Coord, FormalPt } from 'aarc-core/models/coord'
import { ControlPoint, ControlPointDir, ControlPointSta, Line } from 'aarc-core/models/save'
import { coordDist } from 'aarc-core/utils/coordUtils/coordDist'
import { ArcPrimitive } from 'aarc-core/utils/lineUtils/linePathPrimitives'
import { buildLinePathGeometry, adaptLegacyGetTurnRadiusOf, GetTurnRadiusOf } from 'aarc-core/utils/lineUtils/buildLinePathGeometry'
import { intervalMidpoint, intervalMidpoints } from 'aarc-core/utils/lineUtils/intervalMidpoints'
import { formalize } from 'aarc-core/utils/lineUtils/formalize'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import { useFormalizedLineStore } from 'aarc-core/models/stores/saveDerived/formalizedLineStore'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useConfigStore } from 'aarc-core/models/stores/configStore'
import { createEmptySave, createLine, resetIdCounter } from '../../helpers/saveFactory'

function fpts(positions: [number, number][], freeIdx: Set<number> = new Set()): FormalPt[] {
  return positions.map((pos, idx) => ({ pos, afterIdxEqv: idx, free: freeIdx.has(idx) || undefined }))
}

function dummyLine(): Line {
  return { id: 1, pts: [], name: '', nameSub: '', color: '', type: 0, width: 1 }
}

function fixedRadius(r: number): GetTurnRadiusOf {
  return () => r
}

function mkPt(id: number, pos: [number, number]): ControlPoint {
  return { id, pos, dir: ControlPointDir.vertical, sta: ControlPointSta.sta }
}

function expectCoord(actual: Coord | undefined, x: number, y: number) {
  expect(actual).toBeDefined()
  expect(actual![0]).toBeCloseTo(x, 9)
  expect(actual![1]).toBeCloseTo(y, 9)
}

describe('intervalMidpoints（纯几何层）', () => {
  it('单区间直线：中点 = 弧长范围取半；不存在的区间返回 undefined', () => {
    const prims = buildLinePathGeometry(fpts([[0, 0], [10, 0]]), dummyLine(), fixedRadius(2))
    expectCoord(intervalMidpoint(prims, 0), 5, 0)
    expect(intervalMidpoint(prims, 1)).toBeUndefined()
    expect(intervalMidpoint(prims, 99)).toBeUndefined()
    expect(intervalMidpoints(prims)).toEqual([[5, 0]])
  })

  it('多区间折线：中点个数与顺序按路径走向', () => {
    // 区间 0 = 第一段直线（转角弧归属区间 1），区间 1 = 弧 + 第二段直线
    const prims = buildLinePathGeometry(fpts([[0, 0], [10, 0], [10, 10]]), dummyLine(), fixedRadius(2))
    const mids = intervalMidpoints(prims)
    expect(mids).toHaveLength(2)
    expectCoord(mids[0], 4, 0) // 直线 (0,0)->(8,0) 的中点
    expect(mids[1][0]).toBeCloseTo(10, 9) // 落在转角之后的第二段直线上（x=10, y>切点 2）
    expect(mids[1][1]).toBeGreaterThan(2)
  })

  it('90° 转角区间：中点落在弧上（到圆心距离 = r）', () => {
    const prims = buildLinePathGeometry(fpts([[0, 0], [40, 0], [40, 8]]), dummyLine(), fixedRadius(4))
    const arc = prims[1] as ArcPrimitive
    const mid = intervalMidpoint(prims, 1)!
    expect(Math.abs(coordDist(mid, arc.center) - arc.r)).toBeLessThan(1e-6)
  })

  it('环线：区间数 = 控制点数', () => {
    // 首末 formal 点重合 → 环线，3 个控制点、3 个区间（含闭合段）
    const prims = buildLinePathGeometry(fpts([[0, 0], [10, 0], [10, 10], [0, 0]]), dummyLine(), fixedRadius(2))
    const mids = intervalMidpoints(prims)
    expect(mids).toHaveLength(3)
    for (const m of mids) {
      expect(Number.isFinite(m[0])).toBe(true)
      expect(Number.isFinite(m[1])).toBe(true)
    }
  })
})

describe('formalizedLineStore.getLinePathGeometry / getLineIntervalMidpoints（缓存层）', () => {
  beforeEach(() => {
    resetIdCounter()
    createTestPinia()
  })

  /** 与缓存入口同参数的纯管线结果（用于比对） */
  function pureMidpoints(line: Line, formalPts: FormalPt[]): Coord[] {
    const cs = useConfigStore()
    return intervalMidpoints(buildLinePathGeometry(formalPts, line,
      adaptLegacyGetTurnRadiusOf(cs.getTurnRadiusOf)))
  }

  it('重复调用命中缓存：几何返回同一数组引用；中点返回浅拷贝（内容相等、互不影响）', () => {
    const fstore = useFormalizedLineStore()
    const line = createLine([1, 2, 3])
    fstore.setLinesFormalPts(line.id, fpts([[0, 0], [10, 0], [10, 10]]))
    const prims1 = fstore.getLinePathGeometry(line)
    expect(fstore.getLinePathGeometry(line)).toBe(prims1)
    const mids1 = fstore.getLineIntervalMidpoints(line)
    expect(fstore.getLineIntervalMidpoints(line)).toEqual(mids1)
    // 修改返回的数组不影响缓存：再次取回仍是原内容
    const snapshot = mids1.map(c => [...c])
    mids1.pop()
    mids1.push([999, 999])
    expect(fstore.getLineIntervalMidpoints(line)).toEqual(snapshot)
  })

  it('formal 点被换新数组：引用校验令结果更新', () => {
    const fstore = useFormalizedLineStore()
    const line = createLine([1, 2])
    fstore.setLinesFormalPts(line.id, fpts([[0, 0], [10, 0]]))
    expectCoord(fstore.getLineIntervalMidpoints(line)[0], 5, 0)
    fstore.setLinesFormalPts(line.id, fpts([[0, 0], [20, 0]]))
    const mids = fstore.getLineIntervalMidpoints(line)
    expectCoord(mids[0], 10, 0)
  })

  it('修改半径配置：快照校验令结果更新（不经过任何 clearItems）', () => {
    const fstore = useFormalizedLineStore()
    const cs = useConfigStore()
    const line = createLine([1, 2, 3])
    const fps = fpts([[0, 0], [100, 0], [100, 100]])
    fstore.setLinesFormalPts(line.id, fps)
    const before = fstore.getLineIntervalMidpoints(line)
    expect(before[0][0]).toBeCloseTo((100 - (30 + cs.config.lineWidth / 2)) / 2, 9)
    cs.config.lineTurnAreaRadius = 5
    const after = fstore.getLineIntervalMidpoints(line)
    expect(after[0][0]).toBeGreaterThan(before[0][0]) // 半径变小，区间 0 变长，中点右移
    expectCoord(after[0], (100 - (5 + cs.config.lineWidth / 2)) / 2, 0)
  })

  it('clearItems 后再次调用：结果正确重建', () => {
    const saveStore = useSaveStore()
    const pts = [mkPt(1, [0, 0]), mkPt(2, [100, 0])]
    const line = createLine(pts.map(p => p.id))
    saveStore.save = createEmptySave({ points: pts, lines: [line] })
    const fstore = useFormalizedLineStore()
    fstore.setLinesFormalPts(line.id, formalize(pts))
    const mids1 = fstore.getLineIntervalMidpoints(line)
    fstore.clearItems()
    const mids2 = fstore.getLineIntervalMidpoints(line)
    expect(mids2).not.toBe(mids1)
    expect(mids2).toHaveLength(mids1.length)
    for (let i = 0; i < mids1.length; i++) {
      expectCoord(mids2[i], mids1[i][0], mids1[i][1])
    }
  })

  it('视野外驱逐 + 控制点已变：与即时 formalize 一致', () => {
    const saveStore = useSaveStore()
    const pts = [mkPt(1, [0, 0]), mkPt(2, [100, 0])]
    const line = createLine(pts.map(p => p.id))
    saveStore.save = createEmptySave({ points: pts, lines: [line] })
    const fstore = useFormalizedLineStore()
    fstore.setLinesFormalPts(line.id, formalize(pts))
    expectCoord(fstore.getLineIntervalMidpoints(line)[0], 50, 0)
    // 控制点被修改（存档侧），随后该线路被渲染层逐条驱逐
    saveStore.save!.points[1].pos = [200, 0]
    fstore.setLinesFormalPts(line.id, undefined)
    const mids = fstore.getLineIntervalMidpoints(line)
    expectCoord(mids[0], 100, 0)
    const expected = pureMidpoints(line, formalize(saveStore.getPtsByIds(line.pts)))
    expect(mids).toHaveLength(expected.length)
    for (let i = 0; i < mids.length; i++)
      expectCoord(mids[i], expected[i][0], expected[i][1])
  })

  it('sampleLineCoords（非 simplify）与 getLinePathGeometry 共享同一份几何', () => {
    const fstore = useFormalizedLineStore()
    const line = createLine([1, 2])
    fstore.setLinesFormalPts(line.id, fpts([[0, 0], [10, 0]]))
    const prims = fstore.getLinePathGeometry(line)
    // 缓存命中路径：sampleLineCoords 的几何同样来自该条目（引用层面可观察为后续调用仍命中）
    fstore.sampleLineCoords(line, 3)
    expect(fstore.getLinePathGeometry(line)).toBe(prims)
    // simplify 现构、不污染缓存
    const sampled = fstore.sampleLineCoords(line, 3, { simplify: true })
    expect(sampled).toEqual([[0, 0], [3, 0], [6, 0], [9, 0], [10, 0]])
    expect(fstore.getLinePathGeometry(line)).toBe(prims)
  })
})
