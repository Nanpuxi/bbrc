import { describe, it, expect } from 'vitest'
import { FormalPt } from 'aarc-core/models/coord'
import { Line, LineType } from 'aarc-core/models/save'
import {
    buildLineGradient,
    detectLineAttachEnd,
    attachesOfEnd,
    resolveLineGradient,
    LINE_GRADIENT_AUTO_RANGE
} from 'aarc-core/utils/lineUtils/lineGradient'

function makeLine(id: number, pts: number[], opts?: Partial<Line>): Line {
    return { id, pts, name: '', nameSub: '', color: `#c${id}`, type: LineType.common, ...opts }
}
function fp(pos: FormalPt['pos'], afterIdxEqv: number): FormalPt {
    return { pos, afterIdxEqv }
}
function colorsOf(lines: Line[]) {
    const map = new Map(lines.map(l => [l.id, l.color]))
    return (l: Line) => map.get(l.id) ?? l.color
}

describe('detectLineAttachEnd', () => {
    it('端点与其他普通线路共享控制点时应检测到', () => {
        const branch = makeLine(3, [10, 20])
        const other = makeLine(4, [10, 99])
        const res = detectLineAttachEnd(branch, [branch, other])
        expect(res?.end).toBe(0)
        expect(res?.targetLine.id).toBe(4)
    })
    it('pts[last] 端连接时应返回 end=1', () => {
        const branch = makeLine(3, [10, 20])
        const other = makeLine(4, [20, 99])
        const res = detectLineAttachEnd(branch, [branch, other])
        expect(res?.end).toBe(1)
    })
    it('地形线不接（决策 B）', () => {
        const branch = makeLine(3, [10, 20])
        const terrain = makeLine(4, [10, 99], { type: LineType.terrain })
        expect(detectLineAttachEnd(branch, [branch, terrain])).toBeUndefined()
    })
    it('自身与无共享点的线路不参与', () => {
        const branch = makeLine(3, [10, 20])
        expect(detectLineAttachEnd(branch, [branch, makeLine(4, [50, 60])])).toBeUndefined()
    })
    it('两端都接线时非 parent 优先（决策 C）', () => {
        const parent = makeLine(1, [10, 30])
        const branch = makeLine(3, [10, 20], { parent: 1 })
        const other = makeLine(4, [20, 99])
        // 两端分别接 parent 和 other，应取 other（非 parent）
        const res = detectLineAttachEnd(branch, [parent, branch, other])
        expect(res?.targetLine.id).toBe(4)
        expect(res?.end).toBe(1)
    })
    it('两端接的都是 parent 时取 pts[last] 端', () => {
        const parent = makeLine(1, [10, 20])
        const branch = makeLine(3, [10, 20], { parent: 1 })
        const res = detectLineAttachEnd(branch, [parent, branch])
        expect(res?.end).toBe(1)
        expect(res?.targetLine.id).toBe(1)
    })
    it('一端被多条线路共享时应全部检测到', () => {
        const branch = makeLine(3, [10, 20])
        const other1 = makeLine(4, [10, 99])
        const other2 = makeLine(5, [10, 98])
        const lines = [branch, other1, other2]
        expect(attachesOfEnd(branch, lines, 0).map(x => x.id)).toEqual([4, 5])
        expect(attachesOfEnd(branch, lines, 1)).toEqual([])
        // 自动模式在同端多候选时优先非 parent
        const withParent = makeLine(1, [10, 30])
        const branch2 = makeLine(3, [10, 20], { parent: 1 })
        const res = detectLineAttachEnd(branch2, [withParent, branch2, other1])
        expect(res?.targetLine.id).toBe(4)
    })
    it('环线不参与', () => {
        const branch = makeLine(3, [10, 20, 10])
        const other = makeLine(4, [10, 99])
        expect(detectLineAttachEnd(branch, [branch, other])).toBeUndefined()
    })
})

describe('resolveLineGradient', () => {
    const formalPts = [fp([0, 0], 0), fp([50, 0], 1), fp([100, 0], 2)]

    it('未启用渐变或不是支线时返回 undefined', () => {
        const branch = makeLine(3, [10, 20], { parent: 1 })
        expect(resolveLineGradient(branch, formalPts, [], colorsOf([branch]))).toBeUndefined()
        const noParent = makeLine(3, [10, 20], { gradient: {} })
        expect(resolveLineGradient(noParent, formalPts, [], colorsOf([noParent]))).toBeUndefined()
    })
    it('自动目标色但末端未连接时返回 undefined', () => {
        const branch = makeLine(3, [10, 20], { parent: 1, gradient: {} })
        expect(resolveLineGradient(branch, formalPts, [branch], colorsOf([branch]))).toBeUndefined()
    })
    it('formalPts 不足 2 个时返回 undefined', () => {
        const other = makeLine(4, [10, 99])
        const branch = makeLine(3, [10, 20], { parent: 1, gradient: {} })
        expect(resolveLineGradient(branch, [fp([0, 0], 0)], [branch, other], colorsOf([branch, other]))).toBeUndefined()
    })
    it('自动目标色：连接端为目标色端，范围取自动值', () => {
        const parent = makeLine(1, [30, 40])
        const other = makeLine(4, [20, 99])
        const branch = makeLine(3, [10, 20], { parent: 1, gradient: {} })
        const lines = [parent, branch, other]
        // 连接发生在 pts[last] 端（point 20）
        const res = resolveLineGradient(branch, formalPts, lines, colorsOf(lines))
        expect(res).toBeDefined()
        expect(res!.from).toEqual([0, 0])   // 主色端 = 另一端
        expect(res!.to).toEqual([100, 0])   // 目标色端 = 连接端
        expect(res!.fromColor).toBe(branch.color)
        expect(res!.toColor).toBe(other.color)
        expect(res!.range).toEqual(LINE_GRADIENT_AUTO_RANGE)
    })
    it('手动目标色无需连接也可用', () => {
        const branch = makeLine(3, [10, 20], { parent: 1, gradient: { targetColor: '#ff0000' } })
        const res = resolveLineGradient(branch, formalPts, [branch], colorsOf([branch]))
        expect(res!.toColor).toBe('#ff0000')
        expect(res!.from).toEqual([0, 0])
        expect(res!.to).toEqual([100, 0])
    })
    it('手动角度会把目标色一侧旋转到目标端方向', () => {
        const parent = makeLine(1, [10, 30])
        const branch = makeLine(3, [10, 20], { parent: 1, gradient: { angle: 0 } })
        const lines = [parent, branch]
        // 自动目标色 = parent（接在首端）→ 目标端在 [0,0]、主色端在 [100,0]；
        // 角度 0 指向 +x（主色一侧），应翻转使目标色仍在 [0,0]
        const res = resolveLineGradient(branch, formalPts, lines, colorsOf(lines))!
        expect(res.to[0]).toBeCloseTo(0)
        expect(res.from[0]).toBeCloseTo(100)
    })
    it('仅 parent 端连接时：主色在 parent 端，目标色在游离端（回归：蓝色不应出现在 parent 头）', () => {
        const parent = makeLine(1, [10, 30])
        const branch = makeLine(3, [10, 20], { parent: 1, gradient: { targetColor: '#00f' } })
        const lines = [parent, branch]
        // pts[0]（point 10）接在 parent 上，pts[last]（point 20）游离
        const res = resolveLineGradient(branch, formalPts, lines, colorsOf(lines))!
        expect(res.from).toEqual([0, 0])   // 主色端 = parent 端
        expect(res.to).toEqual([100, 0])   // 目标色端 = 游离端
        expect(res.fromColor).toBe(branch.color)
        expect(res.toColor).toBe('#00f')
    })
    it('指定线路模式：目标色取自该线路，目标色端在其接续端', () => {
        const parent = makeLine(1, [30, 40])
        const other = makeLine(4, [20, 99])
        const another = makeLine(5, [10, 98])
        const branch = makeLine(3, [10, 20], { parent: 1, gradient: { targetLine: 4 } })
        const lines = [parent, branch, other, another]
        // other 接在 pts[last]（point 20）→ 目标色端 = [100,0]
        const res = resolveLineGradient(branch, formalPts, lines, colorsOf(lines))!
        expect(res.toColor).toBe(other.color)
        expect(res.to).toEqual([100, 0])
        expect(res.from).toEqual([0, 0])
    })
    it('指定线路为 parent 时：目标色端在 parent 接续端', () => {
        const parent = makeLine(1, [10, 30])
        const branch = makeLine(3, [10, 20], { parent: 1, gradient: { targetLine: 1 } })
        const lines = [parent, branch]
        const res = resolveLineGradient(branch, formalPts, lines, colorsOf(lines))!
        expect(res.toColor).toBe(parent.color)
        expect(res.to).toEqual([0, 0])
        expect(res.from).toEqual([100, 0])
    })
    it('指定线路 id 不存在时回退自动模式', () => {
        const parent = makeLine(1, [10, 30])
        const branch = makeLine(3, [10, 20], { parent: 1, gradient: { targetLine: 99 } })
        const lines = [parent, branch]
        // 自动检测到 parent（首端）→ 目标色端在 parent 接续端 [0,0]
        const res = resolveLineGradient(branch, formalPts, lines, colorsOf(lines))!
        expect(res.toColor).toBe(parent.color)
        expect(res.to).toEqual([0, 0])
        expect(res.from).toEqual([100, 0])
    })
    it('手动角度在无连接信息时按角度指向放置目标色', () => {
        const branch = makeLine(3, [10, 20], { parent: 1, gradient: { targetColor: '#f00', angle: 0 } })
        const res = resolveLineGradient(branch, formalPts, [branch], colorsOf([branch]))!
        expect(res.from[0]).toBeCloseTo(0)
        expect(res.to[0]).toBeCloseTo(100)
    })
    it('非法范围回退自动范围', () => {
        const branch = makeLine(3, [10, 20], { parent: 1, gradient: { targetColor: '#f00', range: [0.8, 0.2] } })
        const res = resolveLineGradient(branch, formalPts, [branch], colorsOf([branch]))!
        expect(res.range).toEqual(LINE_GRADIENT_AUTO_RANGE)
    })
    it('相等范围合法：表现为在该处瞬间换色', () => {
        const branch = makeLine(3, [10, 20], { parent: 1, gradient: { targetColor: '#f00', range: [0.5, 0.5] } })
        const res = resolveLineGradient(branch, formalPts, [branch], colorsOf([branch]))!
        expect(res.range).toEqual([0.5, 0.5])
    })
})

describe('buildLineGradient', () => {
    it('轴端外延半个线宽，范围外填充纯色', () => {
        const calls: { args: number[], stops: [number, string][] }[] = []
        const fakeCtx = {
            createLinearGradient(...args: number[]) {
                const entry = { args, stops: [] as [number, string][] }
                calls.push(entry)
                return { addColorStop: (pos: number, color: string) => entry.stops.push([pos, color]) }
            }
        }
        buildLineGradient(fakeCtx as any, {
            from: [0, 0], to: [100, 0], range: [0.25, 0.75],
            fromColor: '#111', toColor: '#222'
        }, 4)
        expect(calls).toHaveLength(1)
        // 外延 = lineWidthBase/2 = 2
        expect(calls[0].args).toEqual([-2, 0, 102, 0])
        expect(calls[0].stops).toEqual([[0, '#111'], [0.25, '#111'], [0.75, '#222'], [1, '#222']])
    })
})
