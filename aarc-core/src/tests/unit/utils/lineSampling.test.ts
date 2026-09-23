import { describe, it, expect, beforeEach } from 'vitest'
import { Coord, FormalPt } from 'aarc-core/models/coord'
import { ControlPoint, ControlPointDir, ControlPointSta, Line } from 'aarc-core/models/save'
import { WayRel } from 'aarc-core/utils/rayUtils/rayParallel'
import { coordDist } from 'aarc-core/utils/coordUtils/coordDist'
import { LinePrimitive, ArcPrimitive, PathPrimitive, totalPathLength, pointAtArcLength } from 'aarc-core/utils/lineUtils/linePathPrimitives'
import { buildLinePathGeometry, adaptLegacyGetTurnRadiusOf, TurnRadiusContext, GetTurnRadiusOf } from 'aarc-core/utils/lineUtils/buildLinePathGeometry'
import { sampleLinePath, intervalArcRange } from 'aarc-core/utils/lineUtils/sampleLinePath'
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

function dist(a: Coord, b: Coord) {
  return coordDist(a, b)
}

describe('LinePrimitive', () => {
  it('length/pointAt 自洽：端点、内部点、数值切向', () => {
    const p = new LinePrimitive([1, 2], [5, -1], [0, 1])
    expect(p.length()).toBeCloseTo(Math.sqrt(16 + 9))
    expect(p.pointAt(0)).toEqual([1, 2])
    expect(p.pointAt(p.length())).toEqual([5, -1])
    const mid = p.pointAt(p.length() / 2)
    expect(mid[0]).toBeCloseTo(3)
    expect(mid[1]).toBeCloseTo(0.5)
    // 数值微分验证切向：与线段方向平行
    const h = 1e-5
    const d = p.length() / 2
    const tangent: Coord = [p.pointAt(d + h)[0] - p.pointAt(d - h)[0], p.pointAt(d + h)[1] - p.pointAt(d - h)[1]]
    const dir: Coord = [4, -3]
    const cross = tangent[0] * dir[1] - tangent[1] * dir[0]
    expect(Math.abs(cross)).toBeLessThan(1e-6)
  })

  it('零长直线：length 为 0，pointAt 返回端点', () => {
    const p = new LinePrimitive([3, 4], [3, 4], [0, 0])
    expect(p.length()).toBe(0)
    expect(p.pointAt(0)).toEqual([3, 4])
    expect(p.pointAt(1.5)).toEqual([3, 4])
  })
})

describe('ArcPrimitive', () => {
  // (8,0) -> 弧 -> (10,2)，圆心 (8,2)，半径 2，从 -π/2 顺时针（角度增大）到 π…0
  function quarterArc() {
    return new ArcPrimitive([8, 2], 2, -Math.PI / 2, 0, false, [8, 0], [1, 1])
  }
  it('长度 = r·|扫掠角|，端点与角度一致', () => {
    const a = quarterArc()
    expect(a.length()).toBeCloseTo(Math.PI)
    expect(a.start()).toEqual([8, 0])
    const end = a.pointAt(a.length())
    expect(end[0]).toBeCloseTo(10)
    expect(end[1]).toBeCloseTo(2)
  })
  it('pointAt 保持在圆上，数值切向垂直于半径', () => {
    const a = quarterArc()
    for (const t of [0, 0.3, 0.5, 0.97]) {
      const pt = a.pointAt(a.length() * t)
      expect(dist(pt, [8, 2])).toBeCloseTo(2, 9)
    }
    const h = 1e-5
    const s = a.length() * 0.5
    const p1 = a.pointAt(s - h), p2 = a.pointAt(s + h)
    const tangent: Coord = [p2[0] - p1[0], p2[1] - p1[1]]
    const pm = a.pointAt(s)
    const radial: Coord = [pm[0] - 8, pm[1] - 2]
    const dot = tangent[0] * radial[0] + tangent[1] * radial[1]
    expect(Math.abs(dot)).toBeLessThan(1e-6)
  })
  it('ccw 弧扫掠方向取负', () => {
    const cw = new ArcPrimitive([0, 0], 1, 0, Math.PI / 2, false, [1, 0], [0, 0])
    const ccw = new ArcPrimitive([0, 0], 1, 0, Math.PI / 2, true, [1, 0], [0, 0])
    expect(cw.length()).toBeCloseTo(Math.PI / 2)
    expect(ccw.length()).toBeCloseTo(3 * Math.PI / 2)
    expect(cw.pointAt(cw.length() / 2)[1]).toBeGreaterThan(0)
    expect(ccw.pointAt(ccw.length() / 2)[1]).toBeLessThan(0)
  })
})

describe('buildLinePathGeometry 转角处理', () => {
  it('90° 转角：直线-弧-直线，弧经过顶点侧且切点截断相邻段', () => {
    const prims = buildLinePathGeometry(fpts([[0, 0], [10, 0], [10, 10]]), dummyLine(), fixedRadius(2))
    expect(prims.map(p => p.kind)).toEqual(['line', 'arc', 'line'])
    const arc = prims[1] as ArcPrimitive
    expect(arc.start()).toEqual([8, 0])
    expect(prims[2].start()).toEqual([10, 2])
    expect(dist(arc.pointAt(arc.length() / 2), arc.center)).toBeCloseTo(arc.r)
  })

  it('转角半径查询按 8 方向关系注入', () => {
    const seen: (WayRel | number)[] = []
    const spy: GetTurnRadiusOf = (ctx: TurnRadiusContext) => {
      seen.push(ctx.relOrTheta)
      expect(ctx.prevDist).toBeGreaterThan(0)
      expect(ctx.nextDist).toBeGreaterThan(0)
      return 2
    }
    // (0,0)->(10,0)->(15,5)->(20,10)：45°、parallel 转角
    buildLinePathGeometry(fpts([[0, 0], [10, 0], [15, 5], [20, 10]]), dummyLine(), spy)
    expect(seen).toEqual(['45', 'parallel'])
  })

  it('短段上切点受 len/2 截断', () => {
    const prims = buildLinePathGeometry(fpts([[0, 0], [3, 0], [3, 3]]), dummyLine(), fixedRadius(100))
    const arc = prims[1] as ArcPrimitive
    expect(arc.r).toBeCloseTo(1.5)
  })

  it('自由点任意角度转角用 theta 查询半径并画 free 弧', () => {
    const seen: (WayRel | number)[] = []
    const spy: GetTurnRadiusOf = (ctx) => {
      seen.push(ctx.relOrTheta)
      return 1
    }
    // B 为自由点，内角 60°
    const formalPts: FormalPt[] = [
      { pos: [0, 0], afterIdxEqv: 0 },
      { pos: [10, 0], afterIdxEqv: 1, free: true },
      { pos: [7, 3 * Math.sqrt(3)], afterIdxEqv: 2 },
    ]
    const prims = buildLinePathGeometry(formalPts, dummyLine(), spy)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBeCloseTo(Math.PI / 3)
    expect(prims.map(p => p.kind)).toEqual(['line', 'arc', 'line'])
    const arc = prims[1] as ArcPrimitive
    const d = Math.sqrt(3)
    expect(arc.start()[0]).toBeCloseTo(10 - d)
    expect(arc.start()[1]).toBeCloseTo(0)
    expect(arc.center[0]).toBeCloseTo(10 - d)
    expect(arc.center[1]).toBeCloseTo(1)
    expect(arc.r).toBeCloseTo(1)
  })

  it('平行转角退化为直线（无弧）', () => {
    const prims = buildLinePathGeometry(fpts([[0, 0], [10, 0], [20, 0]]), dummyLine(), fixedRadius(2))
    expect(prims.every(p => p.kind === 'line')).toBe(true)
    // 退化弧以“切点间直线”形式保留，几何连续
    for (let i = 1; i < prims.length; i++)
      expect(prims[i].start()).toEqual(prims[i - 1].pointAt(prims[i - 1].length()))
  })

  it('环线：从头部切点开始，末尾回到起点闭合', () => {
    const prims = buildLinePathGeometry(fpts([[0, 0], [10, 0], [10, 10], [0, 0]]), dummyLine(), fixedRadius(2))
    expect(prims[0].kind).toBe('arc')
    const total = totalPathLength(prims)
    expect(total).toBeGreaterThan(0)
    // 序列首尾重合
    const last = prims[prims.length - 1]
    expect(dist(last.pointAt(last.length()), prims[0].start())).toBeLessThan(1e-9)
    // 环线弧数 = 转角数 = 3
    expect(prims.filter(p => p.kind === 'arc')).toHaveLength(3)
  })

  it('simplify 模式：只输出 formal 折线', () => {
    const pts: [number, number][] = [[0, 0], [10, 0], [10, 10], [20, 10]]
    const prims = buildLinePathGeometry(fpts(pts), dummyLine(), fixedRadius(2), { simplify: true })
    expect(prims).toHaveLength(pts.length - 1)
    expect(prims.every(p => p.kind === 'line')).toBe(true)
    expect(prims[0].start()).toEqual([0, 0])
    expect(prims[prims.length - 1].pointAt(prims[prims.length - 1].length())).toEqual([20, 10])
  })

  it('spanIdxRange 标注：直线段按起点区间、转角弧按顶点区间', () => {
    const formalPts: FormalPt[] = [
      { pos: [0, 0], afterIdxEqv: 0 },
      { pos: [5, 0], afterIdxEqv: 0 },
      { pos: [10, 0], afterIdxEqv: 1 },
      { pos: [10, 10], afterIdxEqv: 2 },
    ]
    const prims = buildLinePathGeometry(formalPts, dummyLine(), fixedRadius(2))
    // 区间 0 覆盖：首两段直线 + 位于控制点 1 之前（顶点 afterIdx 0）的转角弧……
    const range0 = intervalArcRange(prims, 0)
    const range1 = intervalArcRange(prims, 1)
    expect(range0).toBeDefined()
    expect(range1).toBeDefined()
    // 相邻区间首尾相接
    expect(range1![0]).toBeCloseTo(range0![1], 9)
  })
})

describe('sampleLinePath', () => {
  function straight(interval: number, includeEnds = true): Coord[] {
    const prims = buildLinePathGeometry(fpts([[0, 0], [10, 0]]), dummyLine(), fixedRadius(2))
    return sampleLinePath(prims, interval, includeEnds)
  }

  it('间隔整除直线：均匀布点且不重复终点', () => {
    expect(straight(5)).toEqual([[0, 0], [5, 0], [10, 0]])
  })
  it('间隔不整除直线：补终点', () => {
    const pts = straight(3)
    expect(pts).toEqual([[0, 0], [3, 0], [6, 0], [9, 0], [10, 0]])
  })
  it('includeEnds=false：不含起点与终点', () => {
    expect(straight(5, false)).toEqual([[5, 0]])
  })
  it('interval<=0 或空图元：返回空', () => {
    expect(straight(0)).toEqual([])
    expect(sampleLinePath([], 1)).toEqual([])
  })

  it('单转角：转角处的采样点落在圆弧上', () => {
    const prims = buildLinePathGeometry(fpts([[0, 0], [10, 0], [10, 10]]), dummyLine(), fixedRadius(2))
    const arc = prims[1] as ArcPrimitive
    const total = totalPathLength(prims)
    const pts = sampleLinePath(prims, total / 5, true)
    expect(pts).toHaveLength(6)
    for (const pt of pts) {
      // 每个采样点都在路径上：直线段上 y=0 或 x=10，或弧上距圆心 r
      const onArc = Math.abs(dist(pt, arc.center) - arc.r) < 1e-6
      const onLines = Math.abs(pt[1]) < 1e-6 || Math.abs(pt[0] - 10) < 1e-6
      expect(onArc || onLines).toBe(true)
    }
    // 端点：路径起点与终点（最后一段直线终点 (10,10)）
    expect(pts[0]).toEqual([0, 0])
    expect(pts[5][0]).toBeCloseTo(10)
    expect(pts[5][1]).toBeCloseTo(10)
  })

  it('环线采样：闭合且不重复输出首点', () => {
    const prims = buildLinePathGeometry(fpts([[0, 0], [10, 0], [10, 10], [0, 0]]), dummyLine(), fixedRadius(2))
    const total = totalPathLength(prims)
    const pts = sampleLinePath(prims, total / 4)
    // 间隔整除周长：终点采样与起点重合，不应重复
    expect(pts).toHaveLength(4)
    expect(dist(pts[0], pts[3])).toBeGreaterThan(1)
  })

  it('退化段（零长线段）不产生异常点', () => {
    const prims = buildLinePathGeometry(fpts([[0, 0], [0, 0], [10, 0]]), dummyLine(), fixedRadius(2))
    const pts = sampleLinePath(prims, 4)
    for (const pt of pts) {
      expect(Number.isFinite(pt[0])).toBe(true)
      expect(Number.isFinite(pt[1])).toBe(true)
    }
    expect(pts[0]).toEqual([0, 0])
  })

  it('pointAtArcLength 与采样行走一致', () => {
    const prims = buildLinePathGeometry(fpts([[0, 0], [10, 0], [10, 10]]), dummyLine(), fixedRadius(2))
    const pts = sampleLinePath(prims, 3)
    for (let i = 0; i < pts.length - 1; i++)
      expect(pointAtArcLength(prims, i * 3)).toEqual(pts[i])
    expect(pointAtArcLength(prims, -5)).toEqual(pts[0])
  })
})

describe('区间中点（弧长范围往返）', () => {
  it('直线区间中点 = 弧长范围取半', () => {
    const prims = buildLinePathGeometry(fpts([[0, 0], [10, 0]]), dummyLine(), fixedRadius(2))
    const [a, b] = intervalArcRange(prims, 0)!
    expect(a).toBeCloseTo(0)
    expect(b).toBeCloseTo(10)
    expect(pointAtArcLength(prims, (a + b) / 2)).toEqual([5, 0])
  })

  it('各控制点区间的弧长范围连续覆盖整条路径', () => {
    const formalPts: FormalPt[] = [
      { pos: [0, 0], afterIdxEqv: 0 },
      { pos: [6, 0], afterIdxEqv: 0 },
      { pos: [10, 0], afterIdxEqv: 1, free: true },
      { pos: [10, 8], afterIdxEqv: 2 },
    ]
    const prims = buildLinePathGeometry(formalPts, dummyLine(), fixedRadius(2))
    const total = totalPathLength(prims)
    const r0 = intervalArcRange(prims, 0)!
    const r1 = intervalArcRange(prims, 1)!
    // 控制点为 0..2，只存在区间 0、1
    expect(intervalArcRange(prims, 2)).toBeUndefined()
    expect(r0[0]).toBeCloseTo(0)
    expect(r1[0]).toBeCloseTo(r0[1], 9)
    expect(r1[1]).toBeCloseTo(total, 9)
    // 区间中点沿路径单调
    const mids = [r0, r1].map(r => pointAtArcLength(prims as PathPrimitive[], (r[0] + r[1]) / 2))
    for (const m of mids) {
      expect(Number.isFinite(m[0])).toBe(true)
      expect(Number.isFinite(m[1])).toBe(true)
    }
  })

  it('90° 转角区间中点落在弧上', () => {
    const prims = buildLinePathGeometry(fpts([[0, 0], [10, 0], [10, 10]]), dummyLine(), fixedRadius(2))
    // 区间 1（B→C）从顶点 B 的转角弧开始
    const [a, b] = intervalArcRange(prims, 1)!
    const arc = prims[1] as ArcPrimitive
    const total = totalPathLength(prims)
    expect(b).toBeCloseTo(total)
    expect(dist(pointAtArcLength(prims, a), arc.start())).toBeLessThan(1e-9)
    const mid = pointAtArcLength(prims, a + arc.length() / 2)
    expect(Math.abs(dist(mid, arc.center) - arc.r)).toBeLessThan(1e-6)
  })
})

describe('formalizedLineStore.sampleLineCoords（业务入口）', () => {
  beforeEach(() => {
    resetIdCounter()
    createTestPinia()
  })

  function mkPt(id: number, pos: [number, number]): ControlPoint {
    return { id, pos, dir: ControlPointDir.vertical, sta: ControlPointSta.sta }
  }

  it('命中 formalPts 缓存：与纯几何层结果一致（同一半径来源）', () => {
    const fstore = useFormalizedLineStore()
    const line = createLine([1, 2, 3])
    const fps = fpts([[0, 0], [10, 0], [10, 10]])
    fstore.setLinesFormalPts(line.id, fps)
    const cs = useConfigStore()
    const prims = buildLinePathGeometry(fps, line,
      adaptLegacyGetTurnRadiusOf(cs.getTurnRadiusOf))
    const expected = sampleLinePath(prims, 3)
    expect(fstore.sampleLineCoords(line, 3)).toEqual(expected)
  })

  it('未命中缓存：从存档控制点即时 formalize，端点与折线首尾一致', () => {
    const saveStore = useSaveStore()
    const pts = [mkPt(1, [0, 0]), mkPt(2, [10, 0])]
    const line = createLine(pts.map(p => p.id))
    saveStore.save = createEmptySave({ points: pts })
    const fstore = useFormalizedLineStore()
    const sampled = fstore.sampleLineCoords(line, 4)
    const formal = formalize(pts)
    expect(sampled.length).toBeGreaterThan(0)
    expect(sampled[0]).toEqual(formal[0].pos)
    expect(dist(sampled[sampled.length - 1], formal[formal.length - 1].pos)).toBeLessThan(1e-9)
  })
})
