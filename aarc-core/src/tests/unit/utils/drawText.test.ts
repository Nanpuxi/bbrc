import { describe, it, expect } from 'vitest'
import { CvsBlock, CvsContext } from 'aarc-core/models/cvs/common/cvsContext'
import { drawText, drawTextForLineName, DrawTextBodyOption } from 'aarc-core/utils/drawUtils/drawText'
import { Coord, QuadCoord } from 'aarc-core/models/coord'

// 测试内独立实现的旋转公式（不引用被测代码），用于计算预期的四个顶点
function rotatePt(p: Coord, center: Coord, angle: number): Coord {
    const cos = Math.cos(angle), sin = Math.sin(angle)
    const dx = p[0] - center[0], dy = p[1] - center[1]
    return [center[0] + dx * cos - dy * sin, center[1] + dx * sin + dy * cos]
}

type Call = [string, ...unknown[]]

// 模拟 ctx2d：measureText 返回固定规则（每字符宽 10），记录所有绘制/变换调用
function createMockCtx() {
    const calls: Call[] = []
    const ctx2d = {
        canvas: {},
        measureText(text: string) {
            return { width: text.length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 4 }
        },
        fillText(...args: unknown[]) { calls.push(['fillText', ...args]) },
        strokeText(...args: unknown[]) { calls.push(['strokeText', ...args]) },
        save() { calls.push(['save']) },
        restore() { calls.push(['restore']) },
        translate(...args: unknown[]) { calls.push(['translate', ...args]) },
        rotate(...args: unknown[]) { calls.push(['rotate', ...args]) },
    }
    // scale=1, offset=0，逻辑坐标与设备坐标一致
    const ctx = new CvsContext(new CvsBlock(1, 0, 0, ctx2d as any))
    return { ctx, calls }
}

function expectQuadCloseTo(actual: QuadCoord, expected: Coord[]) {
    expect(actual.length).toBe(4)
    for (let i = 0; i < 4; i++) {
        expect(actual[i][0]).toBeCloseTo(expected[i][0], 6)
        expect(actual[i][1]).toBeCloseTo(expected[i][1], 6)
    }
}

// 固定测量规则下：
// main 'ABC' 宽 30 行高 10，sub 'xy' 宽 20 行高 20
// pos=[100,50] align=[1,0] → 轴对齐 rectFull = [[100,35],[130,65]]，rectMain = [[100,35],[130,45]]
// （rectMain 底边 = 65 - (总高30 - 主高10) = 45）
const pos: Coord = [100, 50]
const mainOpt: DrawTextBodyOption = { text: 'ABC', color: 'black', font: '', fontSize: 10, rowHeight: 10 }
const subOpt: DrawTextBodyOption = { text: 'xy', color: 'gray', font: '', fontSize: 10, rowHeight: 20 }
const rectFullCorners: Coord[] = [[100, 35], [130, 35], [130, 65], [100, 65]]
const rectMainCorners: Coord[] = [[100, 35], [130, 35], [130, 45], [100, 45]]

describe('drawText 角度支持', () => {
    it('angle 缺省时返回的四边形与轴对齐矩形四角一致', () => {
        const { ctx, calls } = createMockCtx()
        const res = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure')
        expect(res?.rectFull).toEqual(rectFullCorners)
        expect(res?.rectMain).toEqual(rectMainCorners)
        // 不旋转时不应产生任何变换调用
        expect(calls.filter(c => c[0] === 'rotate' || c[0] === 'translate')).toEqual([])
    })

    it('angle=90° 时 rectFull/rectMain 四个顶点绕 pos 旋转（手算预期值）', () => {
        const { ctx } = createMockCtx()
        const res = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure', undefined, Math.PI / 2)
        // 手算：[100,35] 相对 pos [0,-15] 旋转90° → (15,0) → [115,50]；[130,45] 相对 [30,-5] → (5,30) → [105,80]，以此类推
        expectQuadCloseTo(res!.rectFull, [[115, 50], [115, 80], [85, 80], [85, 50]])
        expectQuadCloseTo(res!.rectMain, [[115, 50], [115, 80], [105, 80], [105, 50]])
    })

    it('angle=30° 时与测试内独立三角计算一致', () => {
        const { ctx } = createMockCtx()
        const angle = Math.PI / 6
        const res = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure', undefined, angle)
        expectQuadCloseTo(res!.rectFull, rectFullCorners.map(p => rotatePt(p, pos, angle)))
        expectQuadCloseTo(res!.rectMain, rectMainCorners.map(p => rotatePt(p, pos, angle)))
    })

    it('angle=0 时与不传 angle 行为完全一致', () => {
        const { ctx, calls } = createMockCtx()
        const res = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure', undefined, 0)
        expect(res?.rectFull).toEqual(rectFullCorners)
        expect(res?.rectMain).toEqual(rectMainCorners)
        expect(calls.filter(c => c[0] === 'rotate' || c[0] === 'translate')).toEqual([])
    })

    it('width 参数在旋转前沿文字方向扩展矩形', () => {
        const { ctx } = createMockCtx()
        // width=50，xSgn=1 → 右边缘从 130 扩展到 150，再绕 pos 旋转 90°
        const res = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure', 50, Math.PI / 2)
        expectQuadCloseTo(res!.rectFull, [[115, 50], [115, 100], [85, 100], [85, 50]])
    })

    it('绘制时以 pos 为中心应用旋转变换，fillText 仍使用未旋转的逻辑坐标', () => {
        const { ctx, calls } = createMockCtx()
        drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'both', undefined, Math.PI / 2)
        const kinds = calls.map(c => c[0])
        // 变换顺序：save → translate(pos) → rotate → translate(-pos) → 绘制 → restore
        const iSave = kinds.indexOf('save')
        const iRestore = kinds.lastIndexOf('restore')
        expect(iSave).toBeGreaterThanOrEqual(0)
        expect(iRestore).toBeGreaterThan(iSave)
        expect(calls[iSave + 1]).toEqual(['translate', 100, 50])
        expect(calls[iSave + 2]).toEqual(['rotate', Math.PI / 2])
        expect(calls[iSave + 3]).toEqual(['translate', -100, -50])
        // 文字仍在未旋转的逻辑坐标处绘制（由画布变换完成旋转）
        // 基线修正 fix = (8-4)/2 = 2：main 行 y = 35+5+2 = 42，sub 行 y = 35+20+2 = 57
        expect(calls).toContainEqual(['fillText', 'ABC', 100, 42])
        expect(calls).toContainEqual(['fillText', 'xy', 100, 57])
        // 所有 fillText 都发生在变换区间之内
        const fillIdx = kinds.map((k, i) => k === 'fillText' ? i : -1).filter(i => i >= 0)
        for (const i of fillIdx) {
            expect(i).toBeGreaterThan(iSave)
            expect(i).toBeLessThan(iRestore)
        }
    })

    it('未旋转绘制时不应用任何变换', () => {
        const { ctx, calls } = createMockCtx()
        drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'both')
        expect(calls.filter(c => ['save', 'restore', 'translate', 'rotate'].includes(c[0]))).toEqual([])
    })
})

describe('drawTextForLineName 角度支持', () => {
    const linePos: Coord = [200, 100]
    const lineMain: DrawTextBodyOption = { text: '试验线', color: 'black', font: '', fontSize: 10, rowHeight: 10 }
    const lineSubEmpty: DrawTextBodyOption = { text: '', color: 'gray', font: '', fontSize: 10, rowHeight: 10 }

    it('非 dropCap 时 fallback 到 drawText 并旋转（手算预期值）', () => {
        const { ctx } = createMockCtx()
        // '试验线' 宽 30 高 10，align=[1,1] → 轴对齐矩形 [[200,100],[230,110]]
        const res = drawTextForLineName(ctx, linePos, [1, 1], 1, lineMain, lineSubEmpty, false, 'measure', undefined, undefined, Math.PI / 2)
        expect(res?.isDropCap).toBe(false)
        // [230,100] 相对 pos [30,0] 旋转90° → (0,30) → [200,130]，以此类推
        expectQuadCloseTo(res!.rect!, [[200, 100], [200, 130], [190, 130], [190, 100]])
    })

    it('dropCap 线路名旋转后四个顶点正确（手算预期值）', () => {
        const { ctx, calls } = createMockCtx()
        const dcMain: DrawTextBodyOption = { text: '10号线', color: 'black', font: '', fontSize: 10, rowHeight: 10 }
        const dcSub: DrawTextBodyOption = { text: 'Line10', color: 'gray', font: '', fontSize: 10, rowHeight: 10 }
        // giantFontSize=20，giantMarginRight=1；宽：'10'=20，'号线'=20，'Line10'=60（6个字符）
        // totalWidth = 20 + max(21, 62) = 82，totalHeight = 20 → 轴对齐矩形 [[200,100],[282,120]]
        const res = drawTextForLineName(ctx, linePos, [1, 1], 1, dcMain, dcSub, false, 'both', undefined, 'classic', Math.PI / 2)
        expect(res?.isDropCap).toBe(true)
        // [282,100] 相对 pos [82,0] 旋转90° → (0,82) → [200,182]；[282,120] 相对 [82,20] → (-20,82) → [180,182]，以此类推
        expectQuadCloseTo(res!.rect!, [[200, 100], [200, 182], [180, 182], [180, 100]])
        // dropCap 各部分仍在未旋转的逻辑坐标处绘制（基线修正 fix=2）
        expect(calls).toContainEqual(['fillText', '10', 200, 112])
        expect(calls).toContainEqual(['fillText', '号线', 221, 107])
        expect(calls).toContainEqual(['fillText', 'Line10', 222, 117])
    })

    it('angle 缺省时 dropCap 返回轴对齐矩形四角', () => {
        const { ctx } = createMockCtx()
        const dcMain: DrawTextBodyOption = { text: '10号线', color: 'black', font: '', fontSize: 10, rowHeight: 10 }
        const dcSub: DrawTextBodyOption = { text: 'Line10', color: 'gray', font: '', fontSize: 10, rowHeight: 10 }
        const res = drawTextForLineName(ctx, linePos, [1, 1], 1, dcMain, dcSub, false, 'measure', undefined, 'classic')
        expect(res?.isDropCap).toBe(true)
        expect(res?.rect).toEqual([[200, 100], [282, 100], [282, 120], [200, 120]])
    })
})
