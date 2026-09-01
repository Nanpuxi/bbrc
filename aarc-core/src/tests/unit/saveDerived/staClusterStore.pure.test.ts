import { describe, it, expect } from 'vitest'
import {
  buildNeighbors,
  cleanNeighborsForDeletedPt,
  clusterRestoreIncrementalLimit,
  decideClusterRestoreStrategy,
  expandSetInNeighbors,
  getClusterMaxSizePure,
  getMaxSizePtWithinClusterPure,
  getRectOfClusterPure,
  getStaClusterByIdPure,
  isPtSinglePure,
  makeClustersFromNeighborsPure,
  Neighbors,
  ptClingingPure,
  resolveStaNamePure,
  tryTransferStaNameWithinClusterPure,
  updateNeighborsForMovedPt
} from 'aarc-core/models/stores/saveDerived/staClusterStore.pure'
import { ControlPoint, ControlPointLinkType, ControlPointSta } from 'aarc-core/models/save'
import { numberCmpEpsilon } from 'aarc-core/utils/consts'

function pt(id: number, pos: [number, number], sta: ControlPointSta = ControlPointSta.sta, overrides?: Partial<ControlPoint>): ControlPoint {
  return {
    id,
    pos,
    dir: 0,
    sta,
    ...overrides
  }
}

const snapSizeOne = () => 1

const configClingingDist = 25

describe('staClusterStore.pure - ptClingingPure', () => {
  it('距离小于阈值时应返回 true', () => {
    const a = pt(1, [0, 0])
    const b = pt(2, [10, 10])
    expect(ptClingingPure(a, b, configClingingDist, snapSizeOne, numberCmpEpsilon)).toBe(true)
  })

  it('距离大于阈值时应返回 false', () => {
    const a = pt(1, [0, 0])
    const b = pt(2, [100, 100])
    expect(ptClingingPure(a, b, configClingingDist, snapSizeOne, numberCmpEpsilon)).toBe(false)
  })

  it('阈值边界附近应正确判断', () => {
    const a = pt(1, [0, 0])
    // distSq = 24^2 = 576 < 25^2 = 625
    const b = pt(2, [24, 0])
    expect(ptClingingPure(a, b, configClingingDist, snapSizeOne, numberCmpEpsilon)).toBe(true)
    // distSq = 26^2 = 676 > 625
    const c = pt(3, [26, 0])
    expect(ptClingingPure(a, c, configClingingDist, snapSizeOne, numberCmpEpsilon)).toBe(false)
  })

  it('尺寸越大阈值应越大', () => {
    const a = pt(1, [0, 0])
    const b = pt(2, [40, 0])
    // 默认尺寸 1：clingingDist = 25，40 > 25，false
    expect(ptClingingPure(a, b, configClingingDist, snapSizeOne, numberCmpEpsilon)).toBe(false)
    // 尺寸 2：平均尺寸 2，clingingDist = 50，40 < 50，true
    expect(ptClingingPure(a, b, configClingingDist, () => 2, numberCmpEpsilon)).toBe(true)
  })

  it('带吸附候选时，bbox 快速拒绝应与正式比较保持一致的 epsilon 余量', () => {
    // 回归：长 cluster 中浮点漂移使边界距离略微超过阈值（如 25.00001 vs 25），
    // 曾被不带 epsilon 的 bbox 检查误杀，导致 cluster 在任意位置断开
    const snapOf = (pos: [number, number]) => ({
      candidates: [pos] as [number, number][],
      reach: 0,
      bbox: { minX: pos[0], maxX: pos[0], minY: pos[1], maxY: pos[1] }
    })
    const a = pt(1, [0, 0])
    const aSnap = snapOf(a.pos)
    // 距离 25.00001，略超阈值 25，但在 epsilon 余量内
    const b = pt(2, [25.00001, 0])
    expect(ptClingingPure(a, b, configClingingDist, snapSizeOne, numberCmpEpsilon, aSnap, snapOf(b.pos))).toBe(true)
    // 距离 25.5，超出 epsilon 余量
    const c = pt(3, [25.5, 0])
    expect(ptClingingPure(a, c, configClingingDist, snapSizeOne, numberCmpEpsilon, aSnap, snapOf(c.pos))).toBe(false)
  })

  it('候选比较应为“点的实际位置 vs 对方候选”，候选对候选贴近不应贴合', () => {
    // 回归：旧实现比较双方全部候选的两两组合，任一候选对贴近即贴合。
    // 两个偏移候选之间的贴近不对应任何真实吸附（snapCore.snapInterPt 的语义是
    // “一个点的实际位置落在另一个点的候选上”），导致 cluster 在数倍阈值距离上误并
    const snapWith = (pos: [number, number], extra: [number, number][]) => {
      const candidates: [number, number][] = [pos, ...extra]
      const xs = candidates.map(c => c[0])
      const ys = candidates.map(c => c[1])
      return {
        candidates,
        reach: Math.max(...extra.map(c => Math.max(Math.abs(c[0] - pos[0]), Math.abs(c[1] - pos[1])), 0)),
        bbox: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
      }
    }
    // A(0,0) 与 B(50,50) 各有一个候选在中点 (25,25)，候选对候选距离为 0，
    // 但双方实际位置均不在对方任何候选的阈值（25）内：不应贴合
    const a = pt(1, [0, 0])
    const b = pt(2, [50, 50])
    const aSnap = snapWith(a.pos, [[25, 25]])
    const bSnap = snapWith(b.pos, [[25, 25]])
    expect(ptClingingPure(a, b, configClingingDist, snapSizeOne, numberCmpEpsilon, aSnap, bSnap)).toBe(false)
  })

  it('点的实际位置落在对方候选的吸附阈值内应贴合（与实际吸附对齐）', () => {
    const snapWith = (pos: [number, number], extra: [number, number][]) => {
      const candidates: [number, number][] = [pos, ...extra]
      const xs = candidates.map(c => c[0])
      const ys = candidates.map(c => c[1])
      return {
        candidates,
        reach: Math.max(...extra.map(c => Math.max(Math.abs(c[0] - pos[0]), Math.abs(c[1] - pos[1])), 0)),
        bbox: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
      }
    }
    // 偏移候选的比较用吸附阈值 snapThrs（这里取 10，与默认配置一致）而非 clingingDist(25)：
    // B 的候选 (20,0) 距 A(0,0) 为 20，大于 snapThrs 但小于 clingingDist，
    // 实际吸附不会发生，不应贴合；候选 (8,0) 距 A 为 8 < 10，贴合
    const snapThrs10 = () => 10
    const a = pt(1, [0, 0])
    const b = pt(2, [50, 0])
    const aSnap = snapWith(a.pos, [])
    const bSnapFar = snapWith(b.pos, [[20, 0]])
    expect(ptClingingPure(a, b, configClingingDist, snapSizeOne, numberCmpEpsilon, aSnap, bSnapFar, snapThrs10)).toBe(false)
    const bSnapNear = snapWith(b.pos, [[8, 0]])
    expect(ptClingingPure(a, b, configClingingDist, snapSizeOne, numberCmpEpsilon, aSnap, bSnapNear, snapThrs10)).toBe(true)
    // 反向：A 的候选 (44, 3) 距 B(50,0) 约 5.8 < 10，也应贴合
    const aSnapNear = snapWith(a.pos, [[44, 3]])
    expect(ptClingingPure(a, b, configClingingDist, snapSizeOne, numberCmpEpsilon, aSnapNear, bSnapFar, snapThrs10)).toBe(true)
    // 位置对位置的基准判断不受吸附阈值收紧影响：距离 20 < clingingDist(25) 仍贴合
    const c = pt(3, [20, 0])
    expect(ptClingingPure(a, c, configClingingDist, snapSizeOne, numberCmpEpsilon, aSnap, snapWith(c.pos, []), snapThrs10)).toBe(true)
  })

  it('off 模式下任何含 free 点的点对都不贴合', () => {
    // off：free 点完全不参与 cluster 生成，即使位置几乎重合（pos-pos 基准距离内）
    const a = pt(1, [0, 0], ControlPointSta.sta, { free: true })
    const b = pt(2, [1, 0], ControlPointSta.sta, { free: true })
    expect(ptClingingPure(a, b, configClingingDist, snapSizeOne, numberCmpEpsilon, undefined, undefined, undefined, 'off')).toBe(false)
    // free 与非 free 混合也不贴合
    const c = pt(3, [1, 0])
    expect(ptClingingPure(a, c, configClingingDist, snapSizeOne, numberCmpEpsilon, undefined, undefined, undefined, 'off')).toBe(false)
    // 纯非 free 点对不受影响
    const d = pt(4, [1, 0])
    expect(ptClingingPure(c, d, configClingingDist, snapSizeOne, numberCmpEpsilon, undefined, undefined, undefined, 'off')).toBe(true)
    // loose/strict 下重合的 free 点对仍按基准判断贴合
    expect(ptClingingPure(a, b, configClingingDist, snapSizeOne, numberCmpEpsilon, undefined, undefined, undefined, 'loose')).toBe(true)
    expect(ptClingingPure(a, b, configClingingDist, snapSizeOne, numberCmpEpsilon, undefined, undefined, undefined, 'strict')).toBe(true)
  })

  it('strict 模式下偏移候选需几乎精确命中（仅 epsilon 余量）才贴合', () => {
    const snapWith = (pos: [number, number], extra: [number, number][]) => {
      const candidates: [number, number][] = [pos, ...extra]
      const xs = candidates.map(c => c[0])
      const ys = candidates.map(c => c[1])
      return {
        candidates,
        reach: Math.max(...extra.map(c => Math.max(Math.abs(c[0] - pos[0]), Math.abs(c[1] - pos[1])), 0)),
        bbox: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
      }
    }
    const snapThrs10 = () => 10
    const a = pt(1, [0, 0])
    const b = pt(2, [50, 0])
    const aSnap = snapWith(a.pos, [])
    // B 的候选 (8,0) 距 A(0,0) 为 8：loose 下 < snapThrs(10) 贴合；
    // strict 下候选阈值仅 epsilon 余量，不贴合
    const bSnapNear = snapWith(b.pos, [[8, 0]])
    expect(ptClingingPure(a, b, configClingingDist, snapSizeOne, numberCmpEpsilon, aSnap, bSnapNear, snapThrs10, 'loose')).toBe(true)
    expect(ptClingingPure(a, b, configClingingDist, snapSizeOne, numberCmpEpsilon, aSnap, bSnapNear, snapThrs10, 'strict')).toBe(false)
    // strict 下候选与 A 几乎重合（浮点漂移量级，在 epsilon 余量内）仍贴合
    const bSnapExact = snapWith(b.pos, [[0.00001, 0]])
    expect(ptClingingPure(a, b, configClingingDist, snapSizeOne, numberCmpEpsilon, aSnap, bSnapExact, snapThrs10, 'strict')).toBe(true)
    // strict 不影响位置对位置的基准判断：距离 20 < clingingDist(25) 仍贴合
    const c = pt(3, [20, 0])
    expect(ptClingingPure(a, c, configClingingDist, snapSizeOne, numberCmpEpsilon, aSnap, snapWith(c.pos, []), snapThrs10, 'strict')).toBe(true)
  })
})

describe('staClusterStore.pure - buildNeighbors', () => {
  it('空列表应返回空邻接表', () => {
    expect(buildNeighbors([], configClingingDist, snapSizeOne, numberCmpEpsilon)).toEqual({})
  })

  it('两个接近的 sta 点应互相邻接', () => {
    const pts = [pt(1, [0, 0]), pt(2, [10, 10])]
    const neighbors = buildNeighbors(pts, configClingingDist, snapSizeOne, numberCmpEpsilon)
    expect(neighbors[1]?.has(2)).toBe(true)
    expect(neighbors[2]?.has(1)).toBe(true)
  })

  it('两个远离的 sta 点不应邻接', () => {
    const pts = [pt(1, [0, 0]), pt(2, [100, 100])]
    const neighbors = buildNeighbors(pts, configClingingDist, snapSizeOne, numberCmpEpsilon)
    expect(neighbors[1]).toBeUndefined()
    expect(neighbors[2]).toBeUndefined()
  })

  it('plain 点不应参与邻接', () => {
    const pts = [pt(1, [0, 0], ControlPointSta.plain), pt(2, [1, 1], ControlPointSta.plain)]
    const neighbors = buildNeighbors(pts, configClingingDist, snapSizeOne, numberCmpEpsilon)
    expect(Object.keys(neighbors)).toHaveLength(0)
  })

  it('X 方向超出跳过阈值时不应建立邻接', () => {
    // 2.5 * 25 = 62.5，X 差 70 应直接跳过
    const pts = [pt(1, [0, 0]), pt(2, [70, 0])]
    const neighbors = buildNeighbors(pts, configClingingDist, snapSizeOne, numberCmpEpsilon)
    expect(neighbors[1]).toBeUndefined()
  })

  it('三个点形成链式邻接', () => {
    const pts = [pt(1, [0, 0]), pt(2, [10, 0]), pt(3, [20, 0])]
    const neighbors = buildNeighbors(pts, configClingingDist, snapSizeOne, numberCmpEpsilon)
    expect(neighbors[1]?.has(2)).toBe(true)
    expect(neighbors[2]?.has(1)).toBe(true)
    expect(neighbors[2]?.has(3)).toBe(true)
    expect(neighbors[3]?.has(2)).toBe(true)
  })

  it('两对独立接近的点应形成两个独立邻接关系', () => {
    const pts = [pt(1, [0, 0]), pt(2, [1, 0]), pt(3, [100, 0]), pt(4, [101, 0])]
    const neighbors = buildNeighbors(pts, configClingingDist, snapSizeOne, numberCmpEpsilon)
    expect(neighbors[1]?.has(2)).toBe(true)
    expect(neighbors[3]?.has(4)).toBe(true)
    expect(neighbors[1]?.has(3)).toBe(false)
    expect(neighbors[2]?.has(4)).toBe(false)
  })

  it('负坐标点应正确聚类', () => {
    const pts = [pt(1, [-10, -10]), pt(2, [-10.5, -10.5]), pt(3, [-100, -100])]
    const neighbors = buildNeighbors(pts, configClingingDist, snapSizeOne, numberCmpEpsilon)
    expect(neighbors[1]?.has(2)).toBe(true)
    expect(neighbors[1]?.has(3)).toBe(false)
  })

  it('恰好在网格边界上的点不应遗漏邻接', () => {
    // cellSize = 2.5 * 25 = 62.5
    // 让点分别位于 (62.4, 0) 和 (62.6, 0)，跨越 x=62.5 网格边界但仍非常接近
    const pts = [pt(1, [62.4, 0]), pt(2, [62.6, 0])]
    const neighbors = buildNeighbors(pts, configClingingDist, snapSizeOne, numberCmpEpsilon)
    expect(neighbors[1]?.has(2)).toBe(true)
  })

  it('网格结果应与暴力 O(n^2) 结果一致（混合密度）', () => {
    const pts: ControlPoint[] = []
    let id = 1
    // 5 个密集簇
    for (let c = 0; c < 5; c++) {
      const baseX = c * 200
      const baseY = c * 150
      for (let i = 0; i < 30; i++) {
        pts.push(pt(id++, [baseX + i * 0.3, baseY + (i % 5) * 0.3]))
      }
    }
    // 100 个随机分散点（使用确定性伪随机）
    let seed = 12345
    for (let i = 0; i < 100; i++) {
      seed = (seed * 9301 + 49297) % 233280
      const x = (seed / 233280) * 2000 - 1000
      seed = (seed * 9301 + 49297) % 233280
      const y = (seed / 233280) * 2000 - 1000
      pts.push(pt(id++, [x, y]))
    }

    const grid = buildNeighbors(pts, configClingingDist, snapSizeOne, numberCmpEpsilon)
    const brute = buildNeighborsBruteForce(pts, configClingingDist, snapSizeOne, numberCmpEpsilon)
    expect(grid).toEqual(brute)
  })

  it('大站点尺寸（平均尺寸>2.5）时不应被预筛误杀', () => {
    // 阈值 = 25*3 = 75，间距恰好 75；固定的 2.5*25=62.5 预筛会把这种点对提前丢弃
    const size3 = () => 3
    const pts = [pt(1, [0, 0]), pt(2, [75, 0]), pt(3, [150, 0])]
    const neighbors = buildNeighbors(pts, configClingingDist, size3, numberCmpEpsilon)
    expect(neighbors[1]?.has(2)).toBe(true)
    expect(neighbors[2]?.has(3)).toBe(true)
  })

  it('大站点尺寸且相隔多个网格时不应遗漏邻接', () => {
    // cellSize = 62.5；(62.4,0) 在 cell 0，(137.4,0) 在 cell 2，相隔两格
    const size3 = () => 3
    const pts = [pt(1, [62.4, 0]), pt(2, [137.4, 0])]
    const neighbors = buildNeighbors(pts, configClingingDist, size3, numberCmpEpsilon)
    expect(neighbors[1]?.has(2)).toBe(true)
  })

  it('吸附候选路径下大站点尺寸同样不应被预筛误杀', () => {
    const size3 = () => 3
    const pts = [pt(1, [0, 0]), pt(2, [75, 0])]
    const neighbors = buildNeighbors(pts, configClingingDist, size3, numberCmpEpsilon, posOnlySnap)
    expect(neighbors[1]?.has(2)).toBe(true)
  })

  it('混合尺寸链（中间换乘点尺寸更大）应整体连通', () => {
    // 复刻实际断链场景：size 2-3-3-1，间距 50/75/25，均在各自点对阈值内
    const sizes: Record<number, number> = { 1: 2, 2: 3, 3: 3, 4: 1 }
    const getSize = (id: number) => sizes[id] ?? 1
    const pts = [pt(1, [0, 0]), pt(2, [50, 0]), pt(3, [125, 0]), pt(4, [150, 0])]
    const neighbors = buildNeighbors(pts, configClingingDist, getSize, numberCmpEpsilon)
    expect(neighbors[1]?.has(2)).toBe(true)
    expect(neighbors[2]?.has(3)).toBe(true)
    expect(neighbors[3]?.has(4)).toBe(true)
  })

  it('轴向粗筛应带 epsilon 余量，极微小超界距离不应被误杀', () => {
    // 回归：距离 25.000000001 vs 阈值 25，正式判断（带 epsilon*10 余量）会放行，
    // 但不带余量的轴向粗筛会把这种点对提前丢弃
    const pts = [pt(1, [0, 0]), pt(2, [25.000000001, 0])]
    const neighbors = buildNeighbors(pts, configClingingDist, snapSizeOne, numberCmpEpsilon)
    expect(neighbors[1]?.has(2)).toBe(true)
    // 距离 25.5，超出 epsilon 余量
    const far = [pt(1, [0, 0]), pt(2, [25.5, 0])]
    expect(buildNeighbors(far, configClingingDist, snapSizeOne, numberCmpEpsilon)[1]).toBeUndefined()
  })

  it('吸附候选路径下轴向粗筛同样应带 epsilon 余量', () => {
    const pts = [pt(1, [0, 0]), pt(2, [25.000000001, 0])]
    const neighbors = buildNeighbors(pts, configClingingDist, snapSizeOne, numberCmpEpsilon, posOnlySnap)
    expect(neighbors[1]?.has(2)).toBe(true)
  })

  it('吸附候选路径下 strict 模式应收紧偏移候选判断', () => {
    // A(0,0)、B(50,0)，B 有偏移候选 (8,0) 距 A 为 8：
    // loose（snapThrs=10）应邻接；strict（仅 epsilon 余量）不应邻接
    const pts = [pt(1, [0, 0]), pt(2, [50, 0])]
    const snapThrs10 = () => 10
    const getCandidates = (p: ControlPoint) => {
      const extra: [number, number][] = p.id === 2 ? [[8, 0]] : []
      const candidates: [number, number][] = [[...p.pos], ...extra]
      const xs = candidates.map(c => c[0])
      const ys = candidates.map(c => c[1])
      return {
        candidates,
        reach: extra.reduce((r, c) => Math.max(r, Math.abs(c[0] - p.pos[0]), Math.abs(c[1] - p.pos[1])), 0),
        bbox: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
      }
    }
    const loose = buildNeighbors(pts, configClingingDist, snapSizeOne, numberCmpEpsilon, getCandidates, snapThrs10, 'loose')
    expect(loose[1]?.has(2)).toBe(true)
    const strict = buildNeighbors(pts, configClingingDist, snapSizeOne, numberCmpEpsilon, getCandidates, snapThrs10, 'strict')
    expect(strict[1]).toBeUndefined()
  })
})

function posOnlySnap(p: ControlPoint) {
  return {
    candidates: [[...p.pos]] as [number, number][],
    reach: 0,
    bbox: { minX: p.pos[0], maxX: p.pos[0], minY: p.pos[1], maxY: p.pos[1] }
  }
}

function buildNeighborsBruteForce(
  pts: ControlPoint[],
  configClingingDist: number,
  getSnapSize: (id: number) => number,
  epsilon: number
) {
  const neighbors: Neighbors = {}
  const skipThrs = 2.5 * configClingingDist
  const staPts = pts.filter(p => p.sta === ControlPointSta.sta)
  for (let i = 0; i < staPts.length - 1; i++) {
    for (let j = i + 1; j < staPts.length; j++) {
      const a = staPts[i]
      const b = staPts[j]
      if (Math.abs(a.pos[0] - b.pos[0]) > skipThrs) continue
      if (Math.abs(a.pos[1] - b.pos[1]) > skipThrs) continue
      if (ptClingingPure(a, b, configClingingDist, getSnapSize, epsilon)) {
        if (!neighbors[a.id]) neighbors[a.id] = new Set<number>()
        if (!neighbors[b.id]) neighbors[b.id] = new Set<number>()
        neighbors[a.id]?.add(b.id)
        neighbors[b.id]?.add(a.id)
      }
    }
  }
  return neighbors
}

describe('staClusterStore.pure - makeClustersFromNeighborsPure', () => {
  it('空邻接表应返回空 clusters', () => {
    const dict: Record<number, ControlPoint> = {}
    expect(makeClustersFromNeighborsPure({}, id => dict[id])).toEqual([])
  })

  it('两个互相邻接的点应形成一个 cluster', () => {
    const a = pt(1, [0, 0])
    const b = pt(2, [1, 0])
    const neighbors = { 1: new Set([2]), 2: new Set([1]) }
    const clusters = makeClustersFromNeighborsPure(neighbors, id => [a, b].find(p => p.id === id))
    expect(clusters).toHaveLength(1)
    expect(clusters[0].map(p => p.id).sort()).toEqual([1, 2])
  })

  it('链式邻接应扩展成一个 cluster', () => {
    const pts = [pt(1, [0, 0]), pt(2, [1, 0]), pt(3, [2, 0])]
    const neighbors = { 1: new Set([2]), 2: new Set([1, 3]), 3: new Set([2]) }
    const clusters = makeClustersFromNeighborsPure(neighbors, id => pts.find(p => p.id === id))
    expect(clusters).toHaveLength(1)
    expect(clusters[0].map(p => p.id).sort()).toEqual([1, 2, 3])
  })

  it('两个独立 cluster 应分别返回', () => {
    const pts = [pt(1, [0, 0]), pt(2, [1, 0]), pt(3, [100, 0]), pt(4, [101, 0])]
    const neighbors = {
      1: new Set([2]),
      2: new Set([1]),
      3: new Set([4]),
      4: new Set([3])
    }
    const clusters = makeClustersFromNeighborsPure(neighbors, id => pts.find(p => p.id === id))
    expect(clusters).toHaveLength(2)
    const ids = clusters.map(c => c.map(p => p.id).sort())
    expect(ids).toContainEqual([1, 2])
    expect(ids).toContainEqual([3, 4])
  })

  it('getPtById 返回 undefined 的点应被忽略', () => {
    const a = pt(1, [0, 0])
    const neighbors = { 1: new Set([2, 3]), 2: new Set([1, 3]), 3: new Set([1, 2]) }
    const clusters = makeClustersFromNeighborsPure(neighbors, id => id === 1 ? a : undefined)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toEqual([a])
  })
})

describe('staClusterStore.pure - updateNeighborsForMovedPt', () => {
  it('移动点脱离原 cluster 后应移除旧邻接', () => {
    const a = pt(1, [0, 0])
    const b = pt(2, [1, 0])
    const neighbors = buildNeighbors([a, b], configClingingDist, snapSizeOne, numberCmpEpsilon)
    const movedA = pt(1, [100, 100])
    const next = updateNeighborsForMovedPt(neighbors, movedA, [movedA, b], configClingingDist, snapSizeOne, numberCmpEpsilon)
    expect(next[1]?.has(2)).toBe(false)
    expect(next[2]?.has(1)).toBe(false)
  })

  it('移动点靠近新点后应建立新邻接', () => {
    const a = pt(1, [0, 0])
    const b = pt(2, [100, 0])
    const c = pt(3, [200, 0])
    const neighbors = buildNeighbors([a, b, c], configClingingDist, snapSizeOne, numberCmpEpsilon)
    const movedB = pt(2, [1, 0])
    const next = updateNeighborsForMovedPt(neighbors, movedB, [a, movedB, c], configClingingDist, snapSizeOne, numberCmpEpsilon)
    expect(next[2]?.has(1)).toBe(true)
    expect(next[1]?.has(2)).toBe(true)
  })

  it('点状态变为 plain 后应清除其邻接', () => {
    const a = pt(1, [0, 0])
    const b = pt(2, [1, 0])
    const neighbors = buildNeighbors([a, b], configClingingDist, snapSizeOne, numberCmpEpsilon)
    const plainA = pt(1, [0, 0], ControlPointSta.plain)
    const next = updateNeighborsForMovedPt(neighbors, plainA, [plainA, b], configClingingDist, snapSizeOne, numberCmpEpsilon)
    expect(next[1]?.size).toBe(0)
    expect(next[2]?.has(1)).toBe(false)
  })

  it('不应与自己建立邻接', () => {
    const a = pt(1, [0, 0])
    const next = updateNeighborsForMovedPt({}, a, [a], configClingingDist, snapSizeOne, numberCmpEpsilon)
    expect(next[1]?.has(1)).toBe(false)
  })

  it('大站点尺寸的点移动后不应被粗筛漏掉', () => {
    // 阈值 = 25*3 = 75，间距恰好 75；旧的固定 2.5*25=62.5 粗筛会漏掉这条边
    const size3 = () => 3
    const movedA = pt(1, [0, 0])
    const b = pt(2, [75, 0])
    const next = updateNeighborsForMovedPt({}, movedA, [movedA, b], configClingingDist, size3, numberCmpEpsilon, posOnlySnap)
    expect(next[1]?.has(2)).toBe(true)
    expect(next[2]?.has(1)).toBe(true)
  })

  it('极微小超界距离的点移动后不应被粗筛误杀', () => {
    // 回归：距离 25.000000001 vs 阈值 25，增量更新的粗筛曾缺少 epsilon 余量
    const movedA = pt(1, [0, 0])
    const b = pt(2, [25.000000001, 0])
    const next = updateNeighborsForMovedPt({}, movedA, [movedA, b], configClingingDist, snapSizeOne, numberCmpEpsilon, posOnlySnap)
    expect(next[1]?.has(2)).toBe(true)
    expect(next[2]?.has(1)).toBe(true)
  })
})

describe('staClusterStore.pure - cleanNeighborsForDeletedPt', () => {
  it('删除点应从邻居的邻接表中移除', () => {
    const a = pt(1, [0, 0])
    const b = pt(2, [1, 0])
    const c = pt(3, [2, 0])
    const neighbors = buildNeighbors([a, b, c], configClingingDist, snapSizeOne, numberCmpEpsilon)
    const next = cleanNeighborsForDeletedPt(neighbors, 2)
    expect(next[2]).toBeUndefined()
    expect(next[1]?.has(2)).toBe(false)
    expect(next[3]?.has(2)).toBe(false)
    expect(next[1]?.has(3)).toBe(true)
  })

  it('删除孤立点应无影响', () => {
    const next = cleanNeighborsForDeletedPt({ 1: new Set() }, 1)
    expect(next[1]).toBeUndefined()
  })
})

describe('staClusterStore.pure - tryTransferStaNameWithinClusterPure', () => {
  it('无 nameP 时不应转移', () => {
    const sta = pt(1, [0, 0], ControlPointSta.sta, { name: 'A', nameS: 'a' })
    const cluster = [sta, pt(2, [10, 0])]
    expect(tryTransferStaNameWithinClusterPure(sta, cluster)).toBeUndefined()
  })

  it('同 cluster 中存在更近点时返回转移描述', () => {
    const sta = pt(1, [0, 0], ControlPointSta.sta, { name: 'A', nameS: 'a', nameP: [15, 0] })
    // nameGlobalPos = [15, 0]
    // originalDistSq = 225
    const closer = pt(2, [14, 0])
    // distSq = 1，远小于 225，差值 > 200
    const cluster = [sta, closer]
    const transfer = tryTransferStaNameWithinClusterPure(sta, cluster)
    expect(transfer).toBeDefined()
    expect(transfer?.fromId).toBe(1)
    expect(transfer?.toId).toBe(2)
    expect(transfer?.name).toBe('A')
    expect(transfer?.nameP).toEqual([1, 0])
  })

  it('距离差异不足时不应转移', () => {
    const sta = pt(1, [0, 0], ControlPointSta.sta, { name: 'A', nameP: [5, 0] })
    const other = pt(2, [4, 0])
    // originalDistSq = 25, otherDistSq = 1, diff = 24 < 200
    const cluster = [sta, other]
    expect(tryTransferStaNameWithinClusterPure(sta, cluster)).toBeUndefined()
  })

  it('单点 cluster 不应转移', () => {
    const sta = pt(1, [0, 0], ControlPointSta.sta, { name: 'A', nameP: [100, 0] })
    expect(tryTransferStaNameWithinClusterPure(sta, [sta])).toBeUndefined()
  })
})

describe('staClusterStore.pure - getClusterMaxSizePure', () => {
  it('cluster 存在时返回其中最大尺寸', () => {
    const cluster = [pt(1, [0, 0]), pt(2, [1, 0]), pt(3, [2, 0])]
    expect(getClusterMaxSizePure(cluster, id => id)).toBe(3)
  })

  it('未聚类且提供 fallback 时返回 fallback 点尺寸', () => {
    expect(getClusterMaxSizePure(undefined, () => 5, 1)).toBe(5)
  })

  it('cluster 为空且提供 fallback 时返回 fallback 点尺寸', () => {
    expect(getClusterMaxSizePure([], () => 5, 1)).toBe(5)
  })

  it('cluster 为空且无 fallback 时返回 1', () => {
    expect(getClusterMaxSizePure([], () => 5)).toBe(1)
  })

  it('不将小于 1 的尺寸钳位到 1', () => {
    const cluster = [pt(1, [0, 0]), pt(2, [1, 0])]
    const getSize = (id: number) => id === 1 ? 0.3 : 0.7
    expect(getClusterMaxSizePure(cluster, getSize)).toBe(0.7)
  })
})

describe('staClusterStore.pure - getMaxSizePtWithinClusterPure', () => {
  it('未聚类点返回自身尺寸', () => {
    expect(getMaxSizePtWithinClusterPure(1, [], () => 3)).toBe(3)
  })

  it('聚类点返回 cluster 中最大尺寸', () => {
    const cluster = [pt(1, [0, 0]), pt(2, [1, 0]), pt(3, [2, 0])]
    const getSize = (id: number) => id
    expect(getMaxSizePtWithinClusterPure(1, [cluster], getSize)).toBe(3)
  })
})

describe('staClusterStore.pure - getRectOfClusterPure', () => {
  it('返回 cluster 的四角点', () => {
    const cluster = [
      pt(1, [0, 0]),
      pt(2, [10, 5]),
      pt(3, [3, 8])
    ]
    const rect = getRectOfClusterPure(cluster)
    expect(rect).toContainEqual([10, 8])
    expect(rect).toContainEqual([10, 0])
    expect(rect).toContainEqual([0, 8])
    expect(rect).toContainEqual([0, 0])
  })
})

describe('staClusterStore.pure - getStaClusterByIdPure', () => {
  it('返回点所在的 cluster', () => {
    const cluster = [pt(1, [0, 0]), pt(2, [1, 0])]
    expect(getStaClusterByIdPure(1, [cluster], () => undefined)).toEqual(cluster)
  })

  it('未聚类点返回自身组成的单点 cluster', () => {
    const a = pt(1, [0, 0])
    expect(getStaClusterByIdPure(1, [], id => id === 1 ? a : undefined)).toEqual([a])
  })

  it('点不存在时返回空数组', () => {
    expect(getStaClusterByIdPure(1, [], () => undefined)).toEqual([])
  })
})

describe('staClusterStore.pure - isPtSinglePure', () => {
  it('未聚类点应视为单点', () => {
    expect(isPtSinglePure(1, [])).toBe(true)
  })

  it('cluster 长度小于等于 1 时应视为单点', () => {
    expect(isPtSinglePure(1, [[pt(1, [0, 0])]])).toBe(true)
  })

  it('cluster 长度大于 1 时不视为单点', () => {
    expect(isPtSinglePure(1, [[pt(1, [0, 0]), pt(2, [1, 0])]])).toBe(false)
  })
})

describe('staClusterStore.pure - resolveStaNamePure', () => {
  it('自身有名称时返回自身', () => {
    const pts = [pt(1, [0, 0], ControlPointSta.sta, { name: 'A', nameS: 'a' })]
    const result = resolveStaNamePure(1, false, pts, [], [])
    expect(result).toEqual({ name: 'A', nameSub: 'a', ptId: 1 })
  })

  it('自身无名称时从同 cluster 获取', () => {
    const a = pt(1, [0, 0])
    const b = pt(2, [1, 0], ControlPointSta.sta, { name: 'B', nameS: 'b' })
    const result = resolveStaNamePure(1, false, [a, b], [], [[a, b]])
    expect(result).toEqual({ name: 'B', nameSub: 'b', ptId: 2 })
  })

  it('通过 pointLink 跨 cluster 获取名称', () => {
    const a = pt(1, [0, 0])
    const b = pt(2, [1, 0])
    const c = pt(3, [100, 0], ControlPointSta.sta, { name: 'C', nameS: 'c' })
    const links = [{ pts: [2, 3] as [number, number], type: ControlPointLinkType.cluster }]
    const result = resolveStaNamePure(1, false, [a, b, c], links, [[a, b], [c]])
    expect(result).toEqual({ name: 'C', nameSub: 'c', ptId: 3 })
  })

  it('raw=true 时保留换行符', () => {
    const pts = [pt(1, [0, 0], ControlPointSta.sta, { name: 'A\nB', nameS: 'a\nb' })]
    const result = resolveStaNamePure(1, true, pts, [], [])
    expect(result).toEqual({ name: 'A\nB', nameSub: 'a\nb', ptId: 1 })
  })

  it('默认移除换行符', () => {
    const pts = [pt(1, [0, 0], ControlPointSta.sta, { name: 'A\nB', nameS: 'a\nb' })]
    const result = resolveStaNamePure(1, false, pts, [], [])
    expect(result).toEqual({ name: 'AB', nameSub: 'ab', ptId: 1 })
  })

  it('无名称可获取时返回 #ptId', () => {
    const a = pt(1, [0, 0])
    const result = resolveStaNamePure(1, false, [a], [], [])
    expect(result).toEqual({ name: '#1', nameSub: '', ptId: 1 })
  })
})

describe('staClusterStore.pure - expandSetInNeighbors', () => {
  it('应递归扩展邻接集合', () => {
    const neighbors = {
      1: new Set([2]),
      2: new Set([1, 3]),
      3: new Set([2])
    }
    const set = new Set<number>()
    expandSetInNeighbors(neighbors, set, 1)
    expect(set).toEqual(new Set([1, 2, 3]))
  })
})

describe('staClusterStore.pure - decideClusterRestoreStrategy', () => {
  const movedPtsPatch = (n: number) => ({
    points: Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      old: pt(i + 1, [0, 0]),
      new: pt(i + 1, [1, 0])
    }))
  })

  it('无补丁信息（undefined）时应重建', () => {
    expect(decideClusterRestoreStrategy(undefined, true)).toBe('rebuild')
  })

  it('补丁不含 points/lines 时应保留缓存', () => {
    expect(decideClusterRestoreStrategy({}, true)).toBe('preserve')
    expect(decideClusterRestoreStrategy({ points: [] }, true)).toBe('preserve')
  })

  it('补丁触及 lines 时应重建（尺寸与 free 方向可能变化）', () => {
    const patch = { lines: [{ id: 1, old: undefined, new: {} }] }
    expect(decideClusterRestoreStrategy(patch, true)).toBe('rebuild')
  })

  it('少量 points 变更且已构建过时应增量恢复', () => {
    expect(decideClusterRestoreStrategy(movedPtsPatch(3), true)).toBe('incremental')
  })

  it('未构建过时即使少量变更也应重建（由懒加载完成）', () => {
    expect(decideClusterRestoreStrategy(movedPtsPatch(1), false)).toBe('rebuild')
  })

  it('变更点超过阈值时应重建', () => {
    expect(decideClusterRestoreStrategy(movedPtsPatch(clusterRestoreIncrementalLimit + 1), true)).toBe('rebuild')
    expect(decideClusterRestoreStrategy(movedPtsPatch(clusterRestoreIncrementalLimit), true)).toBe('incremental')
  })
})
