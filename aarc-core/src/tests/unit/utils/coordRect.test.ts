import { describe, it, expect } from 'vitest'
import {
  rectInside,
  rectCoordDistSqLessThan,
  quadInside,
  quadCoordDistSqLessThan,
  enlargeRect,
  enlargeRectBy,
  enlargeQuad,
  rectToQuad,
  quadBoundingRect,
  rotateRectToQuad,
  toQuadCoord
} from 'aarc-core/utils/coordUtils/coordRect'
import { Coord, QuadCoord, RectCoord } from 'aarc-core/models/coord'

describe('rectToQuad', () => {
  it('按左上、右上、右下、左下顺序返回四个顶点', () => {
    const rect: RectCoord = [[0, 0], [10, 20]]
    expect(rectToQuad(rect)).toEqual([
      [0, 0],
      [10, 0],
      [10, 20],
      [0, 20]
    ] as QuadCoord)
  })

  it('支持负坐标矩形', () => {
    const rect: RectCoord = [[-5, -10], [5, 10]]
    expect(rectToQuad(rect)).toEqual([
      [-5, -10],
      [5, -10],
      [5, 10],
      [-5, 10]
    ] as QuadCoord)
  })
})

describe('rotateRectToQuad', () => {
  it('angle=0 时等价于 rectToQuad', () => {
    const rect: RectCoord = [[0, 0], [10, 20]]
    expect(rotateRectToQuad(rect, [5, 10], 0)).toEqual(rectToQuad(rect))
  })

  it('绕中心旋转 90° 得到正确四边形', () => {
    const rect: RectCoord = [[0, 0], [10, 20]]
    const quad = rotateRectToQuad(rect, [5, 10], Math.PI / 2)
    // 原矩形中心 (5,10)，宽 10 高 20；旋转 90° 后宽 20 高 10
    expect(quad[0][0]).toBeCloseTo(15, 5)
    expect(quad[0][1]).toBeCloseTo(5, 5)
    expect(quad[1][0]).toBeCloseTo(15, 5)
    expect(quad[1][1]).toBeCloseTo(15, 5)
    expect(quad[2][0]).toBeCloseTo(-5, 5)
    expect(quad[2][1]).toBeCloseTo(15, 5)
    expect(quad[3][0]).toBeCloseTo(-5, 5)
    expect(quad[3][1]).toBeCloseTo(5, 5)
  })

  it('绕中心旋转 30° 得到正确四边形', () => {
    const rect: RectCoord = [[0, 0], [10, 10]]
    const quad = rotateRectToQuad(rect, [5, 5], Math.PI / 6)
    const cos = Math.sqrt(3) / 2
    const sin = 0.5
    // 左上角 [0,0] 相对 [-5,-5]
    expect(quad[0][0]).toBeCloseTo(5 + (-5 * cos - (-5) * sin), 5)
    expect(quad[0][1]).toBeCloseTo(5 + (-5 * sin + (-5) * cos), 5)
    // 右上角 [10,0] 相对 [5,-5]
    expect(quad[1][0]).toBeCloseTo(5 + (5 * cos - (-5) * sin), 5)
    expect(quad[1][1]).toBeCloseTo(5 + (5 * sin + (-5) * cos), 5)
    // 右下角 [10,10] 相对 [5,5]
    expect(quad[2][0]).toBeCloseTo(5 + (5 * cos - 5 * sin), 5)
    expect(quad[2][1]).toBeCloseTo(5 + (5 * sin + 5 * cos), 5)
    // 左下角 [0,10] 相对 [-5,5]
    expect(quad[3][0]).toBeCloseTo(5 + (-5 * cos - 5 * sin), 5)
    expect(quad[3][1]).toBeCloseTo(5 + (-5 * sin + 5 * cos), 5)
  })

  it('绕中心旋转 180° 得到对称四边形', () => {
    const rect: RectCoord = [[0, 0], [10, 20]]
    const quad = rotateRectToQuad(rect, [5, 10], Math.PI)
    expect(quad[0][0]).toBeCloseTo(10, 5)
    expect(quad[0][1]).toBeCloseTo(20, 5)
    expect(quad[1][0]).toBeCloseTo(0, 5)
    expect(quad[1][1]).toBeCloseTo(20, 5)
    expect(quad[2][0]).toBeCloseTo(0, 5)
    expect(quad[2][1]).toBeCloseTo(0, 5)
    expect(quad[3][0]).toBeCloseTo(10, 5)
    expect(quad[3][1]).toBeCloseTo(0, 5)
  })

  it('绕非中心点旋转后，该点位置不变', () => {
    const rect: RectCoord = [[0, 0], [10, 10]]
    const pivot: Coord = [0, 0]
    const quad = rotateRectToQuad(rect, pivot, Math.PI / 4)
    // 旋转中心本身应保持不变
    expect(quad[0]).toEqual([0, 0] as Coord)
  })
})

describe('quadBoundingRect', () => {
  it('轴对齐四边形返回自身对应矩形', () => {
    const quad = rectToQuad([[0, 0], [10, 20]])
    expect(quadBoundingRect(quad)).toEqual([[0, 0], [10, 20]] as RectCoord)
  })

  it('旋转 30° 的正方形返回正确轴对齐包围盒', () => {
    const rect: RectCoord = [[0, 0], [10, 10]]
    const quad = rotateRectToQuad(rect, [5, 5], Math.PI / 6)
    const bounding = quadBoundingRect(quad)
    const cos = Math.sqrt(3) / 2
    const sin = 0.5
    // 最左 / 最上 由左下角 [-5,5] 旋转后得到
    const leftmost = 5 + (-5 * cos - 5 * sin)
    const uppermost = 5 + (-5 * sin + (-5) * cos)
    // 最右 / 最下 由右上角 [5,-5] 旋转后得到
    const rightmost = 5 + (5 * cos - (-5) * sin)
    const lowermost = 5 + (5 * sin + 5 * cos)
    expect(bounding[0][0]).toBeCloseTo(leftmost, 5)
    expect(bounding[0][1]).toBeCloseTo(uppermost, 5)
    expect(bounding[1][0]).toBeCloseTo(rightmost, 5)
    expect(bounding[1][1]).toBeCloseTo(lowermost, 5)
  })
})

describe('rectInside', () => {
  it('轴对齐 RectCoord 内部点返回 true', () => {
    const rect: RectCoord = [[0, 0], [10, 10]]
    expect(rectInside(rect, [5, 5])).toBe(true)
    expect(rectInside(rect, [0, 0])).toBe(true)
    expect(rectInside(rect, [10, 10])).toBe(true)
  })

  it('轴对齐 RectCoord 外部点返回 false', () => {
    const rect: RectCoord = [[0, 0], [10, 10]]
    expect(rectInside(rect, [11, 5])).toBe(false)
    expect(rectInside(rect, [5, -1])).toBe(false)
  })
})

describe('quadInside', () => {
  it('轴对齐 QuadCoord 内部点返回 true', () => {
    const quad = rectToQuad([[0, 0], [10, 10]])
    expect(quadInside(quad, [5, 5])).toBe(true)
    expect(quadInside(quad, [0, 0])).toBe(true)
    expect(quadInside(quad, [10, 10])).toBe(true)
  })

  it('轴对齐 QuadCoord 外部点返回 false', () => {
    const quad = rectToQuad([[0, 0], [10, 10]])
    expect(quadInside(quad, [11, 5])).toBe(false)
    expect(quadInside(quad, [5, -1])).toBe(false)
  })

  it('旋转 30° 正方形：中心点精确命中', () => {
    const rect: RectCoord = [[0, 0], [10, 10]]
    const quad = rotateRectToQuad(rect, [5, 5], Math.PI / 6)
    expect(quadInside(quad, [5, 5])).toBe(true)
  })

  it('旋转 30° 正方形：在包围盒内但在四边形外的点返回 false', () => {
    const rect: RectCoord = [[0, 0], [10, 10]]
    const quad = rotateRectToQuad(rect, [5, 5], Math.PI / 6)
    // 最低点 y 约为 5 + (-5*sin + (-5)*cos) = 5 - 2.5 - 4.33 = -1.83，最高点约 11.83
    // 取 (5, 12) 在包围盒内但在四边形外
    expect(quadInside(quad, [5, 12])).toBe(false)
  })

  it('旋转 45° 正方形：中心点精确命中', () => {
    const rect: RectCoord = [[0, 0], [10, 10]]
    const quad = rotateRectToQuad(rect, [5, 5], Math.PI / 4)
    expect(quadInside(quad, [5, 5])).toBe(true)
  })

  it('旋转 45° 正方形：在包围盒内但在四边形外的点返回 false', () => {
    const rect: RectCoord = [[0, 0], [10, 10]]
    const quad = rotateRectToQuad(rect, [5, 5], Math.PI / 4)
    // 顶部顶点约在 (5, 5+5√2) ≈ (5, 12.07)，取 (5, 15) 在包围盒内但在四边形外
    expect(quadInside(quad, [5, 15])).toBe(false)
  })

  it('旋转 45° 正方形：顶点本身在四边形边界上返回 true', () => {
    const rect: RectCoord = [[0, 0], [10, 10]]
    const quad = rotateRectToQuad(rect, [5, 5], Math.PI / 4)
    expect(quadInside(quad, quad[0])).toBe(true)
  })
})

describe('rectCoordDistSqLessThan', () => {
  it('轴对齐 RectCoord 内部点距离为 0', () => {
    const rect: RectCoord = [[0, 0], [10, 10]]
    expect(rectCoordDistSqLessThan(rect, [5, 5], 1)).toBe(true)
  })

  it('轴对齐 RectCoord 外部点按阈值判断', () => {
    const rect: RectCoord = [[0, 0], [10, 10]]
    expect(rectCoordDistSqLessThan(rect, [12, 5], 4)).toBe(false)  // 距离 2，平方 4 不满足 < 4
    expect(rectCoordDistSqLessThan(rect, [12, 5], 5)).toBe(true)   // 距离 2，平方 4 < 5
    expect(rectCoordDistSqLessThan(rect, [15, 5], 4)).toBe(false)  // 距离 5，平方 25 > 4
  })
})

describe('quadCoordDistSqLessThan', () => {
  it('轴对齐 QuadCoord 内部点距离为 0', () => {
    const quad = rectToQuad([[0, 0], [10, 10]])
    expect(quadCoordDistSqLessThan(quad, [5, 5], 1)).toBe(true)
  })

  it('轴对齐 QuadCoord 外部点按阈值判断', () => {
    const quad = rectToQuad([[0, 0], [10, 10]])
    expect(quadCoordDistSqLessThan(quad, [12, 5], 4)).toBe(false)
    expect(quadCoordDistSqLessThan(quad, [12, 5], 5)).toBe(true)
    expect(quadCoordDistSqLessThan(quad, [15, 5], 4)).toBe(false)
  })

  it('旋转 30° 正方形：使用精确到边的距离', () => {
    const rect: RectCoord = [[0, 0], [10, 10]]
    const quad = rotateRectToQuad(rect, [5, 5], Math.PI / 6)
    // 最高点 y 约为 11.83，取 (5, 15) 在外部，到最近顶点距离约 3.66，distSq 约 13.40
    expect(quadCoordDistSqLessThan(quad, [5, 15], 13)).toBe(false)
    expect(quadCoordDistSqLessThan(quad, [5, 15], 14)).toBe(true)
  })

  it('旋转 45° 正方形：使用精确到边的距离', () => {
    const rect: RectCoord = [[0, 0], [10, 10]]
    const quad = rotateRectToQuad(rect, [5, 5], Math.PI / 4)
    // 顶部顶点约在 (5, 5+5√2) ≈ (5, 12.07)，取 (5, 15) 距离端点约 2.93，distSq ≈ 8.58
    expect(quadCoordDistSqLessThan(quad, [5, 15], 8)).toBe(false)
    expect(quadCoordDistSqLessThan(quad, [5, 15], 9)).toBe(true)
  })

  it('远处点被快速拒绝', () => {
    const rect: RectCoord = [[0, 0], [10, 10]]
    const quad = rotateRectToQuad(rect, [5, 5], Math.PI / 4)
    expect(quadCoordDistSqLessThan(quad, [100, 100], 100)).toBe(false)
  })
})

describe('enlargeRect', () => {
  it('向四个方向等距扩大', () => {
    const rect: RectCoord = [[0, 0], [10, 10]]
    expect(enlargeRect(rect, 2)).toEqual([[-2, -2], [12, 12]] as RectCoord)
  })
})

describe('enlargeRectBy', () => {
  it('按比例扩大', () => {
    const rect: RectCoord = [[0, 0], [10, 10]]
    expect(enlargeRectBy(rect, 0.1)).toEqual([[-1, -1], [11, 11]] as RectCoord)
  })
})

describe('enlargeQuad', () => {
  it('轴对齐矩形等价于 enlargeRect', () => {
    const quad = rectToQuad([[0, 0], [10, 20]])
    const enlarged = enlargeQuad(quad, 2)
    const expected = rectToQuad([[-2, -2], [12, 22]])
    for (let i = 0; i < 4; i++) {
      expect(enlarged[i][0]).toBeCloseTo(expected[i][0], 6)
      expect(enlarged[i][1]).toBeCloseTo(expected[i][1], 6)
    }
  })

  it('delta=0 时顶点不变', () => {
    const quad = rotateRectToQuad([[0, 0], [10, 10]], [5, 5], Math.PI / 6)
    const enlarged = enlargeQuad(quad, 0)
    for (let i = 0; i < 4; i++) {
      expect(enlarged[i][0]).toBeCloseTo(quad[i][0], 6)
      expect(enlarged[i][1]).toBeCloseTo(quad[i][1], 6)
    }
  })

  it('旋转 45° 的正方形按边法向扩大', () => {
    // 边长 10 的正方形旋转 45°，边心距（apothem）为 5；扩大 1 后边心距为 6，
    // 顶点到中心距离从 5√2 变为 6√2
    const quad = rotateRectToQuad([[0, 0], [10, 10]], [5, 5], Math.PI / 4)
    const enlarged = enlargeQuad(quad, 1)
    const r = 6 * Math.sqrt(2)
    // 顶点顺序：上、右、下、左
    expect(enlarged[0][0]).toBeCloseTo(5, 6)
    expect(enlarged[0][1]).toBeCloseTo(5 - r, 6)
    expect(enlarged[1][0]).toBeCloseTo(5 + r, 6)
    expect(enlarged[1][1]).toBeCloseTo(5, 6)
    expect(enlarged[2][0]).toBeCloseTo(5, 6)
    expect(enlarged[2][1]).toBeCloseTo(5 + r, 6)
    expect(enlarged[3][0]).toBeCloseTo(5 - r, 6)
    expect(enlarged[3][1]).toBeCloseTo(5, 6)
  })

  it('逆时针环绕的四边形也能向外扩大', () => {
    // 手动构造逆时针（屏幕坐标）顺序的轴对齐矩形
    const quad: QuadCoord = [[0, 0], [0, 20], [10, 20], [10, 0]]
    const enlarged = enlargeQuad(quad, 2)
    // 顶点顺序不变，向外扩 2
    const expected: Coord[] = [[-2, -2], [-2, 22], [12, 22], [12, -2]]
    for (let i = 0; i < 4; i++) {
      expect(enlarged[i][0]).toBeCloseTo(expected[i][0], 6)
      expect(enlarged[i][1]).toBeCloseTo(expected[i][1], 6)
    }
  })
})

describe('toQuadCoord', () => {
  it('QuadCoord 输入原样返回（忽略 center/angle）', () => {
    const quad: QuadCoord = [[1, 2], [3, 4], [5, 6], [7, 8]]
    expect(toQuadCoord(quad, [100, 100], Math.PI / 2)).toBe(quad)
  })

  it('RectCoord 输入等价于 rotateRectToQuad', () => {
    const rect: RectCoord = [[0, 0], [10, 20]]
    expect(toQuadCoord(rect, [5, 10], Math.PI / 6)).toEqual(rotateRectToQuad(rect, [5, 10], Math.PI / 6))
  })

  it('RectCoord 输入且 angle=0 时等价于 rectToQuad', () => {
    const rect: RectCoord = [[-5, -10], [5, 10]]
    expect(toQuadCoord(rect)).toEqual(rectToQuad(rect))
  })
})
