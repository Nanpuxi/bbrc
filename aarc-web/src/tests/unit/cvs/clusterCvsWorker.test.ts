import { describe, it, expect, beforeEach } from 'vitest'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import { useSaveStore } from '@/models/stores/saveStore'
import { useClusterCvsWorker } from '@/models/cvs/workers/clusterCvsWorker'
import { ControlPointLinkType, ControlPointSta } from '@/models/save'
import { isZero } from '@/utils/sgn'
import {
  resetIdCounter,
  createPoint,
  createLine,
  createEmptySave
} from '../../helpers/saveFactory'

function setupSaveStore(save: ReturnType<typeof createEmptySave>) {
  const saveStore = useSaveStore()
  saveStore.save = save
  return saveStore
}

function bbox(coords: [number, number][]) {
  const xs = coords.map(p => p[0])
  const ys = coords.map(p => p[1])
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys)
  }
}

function expectBoxCovers(
  box: ReturnType<typeof bbox>,
  expected: { minX: number; maxX: number; minY: number; maxY: number }
) {
  expect(isZero(box.minX - expected.minX)).toBe(true)
  expect(isZero(box.maxX - expected.maxX)).toBe(true)
  expect(isZero(box.minY - expected.minY)).toBe(true)
  expect(isZero(box.maxY - expected.maxY)).toBe(true)
}

describe('clusterCvsWorker - getClustersRenderingData', () => {
  beforeEach(() => {
    resetIdCounter()
    createTestPinia()
  })

  it('free 点 cluster 的四角点只覆盖实际点，不覆盖远处 snap 候选', () => {
    // 两个 free 点实际坐标 (0,0) 与 (40,4)，前后线段夹角 90°。
    // 平行线交点候选延伸到约 -35.36 / 75.36；双方内侧交点候选距对方实际位置
    // 约 6.2 < 吸附阈值（10），因此成 cluster；四角点应紧贴实际点。
    const offset = 40 * Math.sqrt(2)
    const save = createEmptySave({
      points: [
        { ...createPoint(1), pos: [80, 80], sta: ControlPointSta.sta },
        { ...createPoint(2), pos: [0, 0], sta: ControlPointSta.sta, free: true },
        { ...createPoint(3), pos: [80, -80], sta: ControlPointSta.sta },
        { ...createPoint(4), pos: [40 - offset, 4 + offset], sta: ControlPointSta.sta },
        { ...createPoint(5), pos: [40, 4], sta: ControlPointSta.sta, free: true },
        { ...createPoint(6), pos: [40 - offset, 4 - offset], sta: ControlPointSta.sta }
      ],
      lines: [
        createLine([1, 2, 3]),
        createLine([4, 5, 6])
      ]
    })
    setupSaveStore(save)

    const worker = useClusterCvsWorker()
    const data = worker.getClustersRenderingData()

    expect(data).toHaveLength(1)
    const poly = data[0].coords
    const polyBox = bbox(poly)

    // 应紧贴覆盖两个实际点 (0,0) 与 (40,4)
    expectBoxCovers(polyBox, { minX: 0, maxX: 40, minY: 0, maxY: 4 })

    // 不应覆盖远处的平行线交点候选（约 -35.36 / 75.36）
    expect(polyBox.minX).toBeGreaterThan(-30)
    expect(polyBox.maxX).toBeLessThan(70)

    // 由于只覆盖实际点，四角点不应过分膨胀
    expect(polyBox.maxX - polyBox.minX).toBeLessThan(70)
    expect(polyBox.maxY - polyBox.minY).toBeLessThan(10)
  })

  it('120° 拐角 free 点 cluster（三点）使用角平分线方向得到贴身四角点', () => {
    // 两个 free 点实际坐标 (0,0) 与 (37,3.7)，另有一个非 free 点 (14.8,1.48) 在连线上，
    // 使 cluster 含 3 个点（两点 cluster 走零宽度线条特殊分支，不测方向选择）。
    // free 点前后线段夹角 120°，方向分别为 60°/120° 与 -60°/-120°（归一化后 60°/120°）；
    // 内侧平行线交点候选 (28.87,0)/(8.13,3.7) 距对方实际位置约 8.9 < 吸附阈值（10），因此成 cluster。
    // 若不加入角平分线 0°，OBB 会选用 60°/120°，得到高约 33 的胖矩形；
    // 加入角平分线后应选中 0°，得到紧贴实际点的低矩形。
    const sqrt3 = Math.sqrt(3)
    const save = createEmptySave({
      points: [
        { ...createPoint(1), pos: [37, -37 * sqrt3], sta: ControlPointSta.sta },
        { ...createPoint(2), pos: [0, 0], sta: ControlPointSta.sta, free: true },
        { ...createPoint(3), pos: [37, 37 * sqrt3], sta: ControlPointSta.sta },
        { ...createPoint(4), pos: [0, 3.7 + 37 * sqrt3], sta: ControlPointSta.sta },
        { ...createPoint(5), pos: [37, 3.7], sta: ControlPointSta.sta, free: true },
        { ...createPoint(6), pos: [0, 3.7 - 37 * sqrt3], sta: ControlPointSta.sta },
        { ...createPoint(7), pos: [14.8, 1.48], sta: ControlPointSta.sta }
      ],
      lines: [
        createLine([1, 2, 3]),
        createLine([4, 5, 6])
      ]
    })
    setupSaveStore(save)

    const worker = useClusterCvsWorker()
    const data = worker.getClustersRenderingData()

    expect(data).toHaveLength(1)
    const poly = data[0].coords
    const polyBox = bbox(poly)

    // 应紧贴覆盖三个实际点 (0,0)、(37,3.7) 与 (14.8,1.48)
    expectBoxCovers(polyBox, { minX: 0, maxX: 37, minY: 0, maxY: 3.7 })

    // 使用角平分线后，高度应很小；若用 60°/120° 方向，高度会约 33
    expect(polyBox.maxY - polyBox.minY).toBeLessThan(10)
  })

  it('两个点的 free cluster 不做最佳方向计算，直接形成连接两点的零宽度线条', () => {
    // 两个 free 点实际坐标 (0,0) 与 (37,3.7)，两侧线段方向（120° 拐角）与连线方向不一致；
    // 内侧平行线交点候选距对方实际位置约 8.9 < 吸附阈值（10），因此成 cluster。
    // 渲染应忽略线段方向，直接沿两点连线生成宽度为 0 的窄矩形：
    // 四角点全部落在 (0,0)-(37,3.7) 连线上，且端点恰好是两个实际点。
    const sqrt3 = Math.sqrt(3)
    const save = createEmptySave({
      points: [
        { ...createPoint(1), pos: [37, -37 * sqrt3], sta: ControlPointSta.sta },
        { ...createPoint(2), pos: [0, 0], sta: ControlPointSta.sta, free: true },
        { ...createPoint(3), pos: [37, 37 * sqrt3], sta: ControlPointSta.sta },
        { ...createPoint(4), pos: [0, 3.7 + 37 * sqrt3], sta: ControlPointSta.sta },
        { ...createPoint(5), pos: [37, 3.7], sta: ControlPointSta.sta, free: true },
        { ...createPoint(6), pos: [0, 3.7 - 37 * sqrt3], sta: ControlPointSta.sta }
      ],
      lines: [
        createLine([1, 2, 3]),
        createLine([4, 5, 6])
      ]
    })
    setupSaveStore(save)

    const worker = useClusterCvsWorker()
    const data = worker.getClustersRenderingData()

    expect(data).toHaveLength(1)
    const poly = data[0].coords
    expect(poly).toHaveLength(4)

    // 四角点全部在两点连线上（叉积为 0），即矩形宽度为 0
    for (const corner of poly) {
      const cross = 37 * (corner[1] - 0) - 3.7 * (corner[0] - 0)
      expect(isZero(cross)).toBe(true)
    }

    // 连线两端的角点恰好是两个实际点
    expectBoxCovers(bbox(poly), { minX: 0, maxX: 37, minY: 0, maxY: 3.7 })
  })

  it('伪集群端点移动后应跟随新位置（渲染缓存签名包含链接端点坐标）', () => {
    // 两个相距很远的 sta 点不构成真实 cluster，但由 fat 型 pointLink 连接，
    // 各自被涂成单点伪集群。移动其中一点后，伪集群必须跟随移动——
    // 端点不属于真实 cluster，其坐标不在全量渲染缓存签名里时，缓存不会失效，
    // 伪集群会留在原地。
    const save = createEmptySave({
      points: [
        { ...createPoint(1), pos: [0, 0], sta: ControlPointSta.sta },
        { ...createPoint(2), pos: [500, 500], sta: ControlPointSta.sta }
      ],
      pointLinks: [{ pts: [1, 2], type: ControlPointLinkType.fat }]
    })
    const saveStore = setupSaveStore(save)

    const worker = useClusterCvsWorker()
    const data1 = worker.getClustersRenderingData()
    expect(data1).toHaveLength(2)

    // 移动点 1（不属于任何真实 cluster，坐标只通过伪集群参与渲染）
    const pt1 = saveStore.getPtById(1)!
    pt1.pos = [100, 100]

    const data2 = worker.getClustersRenderingData()
    expect(data2).toHaveLength(2)
    const moved = data2.find(p =>
      isZero(p.bbox[0] - 100) && isZero(p.bbox[2] - 100))
    expect(moved).toBeTruthy()
    const stayed = data2.find(p =>
      isZero(p.bbox[0] - 500) && isZero(p.bbox[2] - 500))
    expect(stayed).toBeTruthy()
  })

  it('非 free 点 cluster 行为不受新逻辑影响', () => {
    const save = createEmptySave({
      points: [
        { ...createPoint(1), pos: [0, 0] },
        { ...createPoint(2), pos: [10, 0] }
      ]
    })
    setupSaveStore(save)

    const worker = useClusterCvsWorker()
    const data = worker.getClustersRenderingData()

    expect(data).toHaveLength(1)
    const polyBox = bbox(data[0].coords)
    expect(isZero(polyBox.minX - 0)).toBe(true)
    expect(isZero(polyBox.maxX - 10)).toBe(true)
  })
})
