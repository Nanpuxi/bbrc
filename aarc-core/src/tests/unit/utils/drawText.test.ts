import { describe, it, expect } from 'vitest'
import { CvsBlock, CvsContext } from 'aarc-core/models/cvs/common/cvsContext'
import { drawText, drawTextForLineName, DrawTextBodyOption, resolveTextScale } from 'aarc-core/utils/drawUtils/drawText'
import { Coord, QuadCoord } from 'aarc-core/models/coord'

// 测试内独立实现的旋转公式（不引用被测代码），用于计算预期的四个顶点
function rotatePt(p: Coord, center: Coord, angle: number): Coord {
    const cos = Math.cos(angle), sin = Math.sin(angle)
    const dx = p[0] - center[0], dy = p[1] - center[1]
    return [center[0] + dx * cos - dy * sin, center[1] + dx * sin + dy * cos]
}

// 测试内独立实现的缩放公式（不引用被测代码）
function scalePt(p: Coord, center: Coord, sx: number, sy: number): Coord {
    return [center[0] + (p[0] - center[0]) * sx, center[1] + (p[1] - center[1]) * sy]
}

// 测试内独立实现的"先缩放后旋转"
function transformPt(p: Coord, center: Coord, angle: number, sx: number, sy: number): Coord {
    return rotatePt(scalePt(p, center, sx, sy), center, angle)
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
        scale(...args: unknown[]) { calls.push(['scale', ...args]) },
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

describe('drawText 空文本处理', () => {
    const emptyMain: DrawTextBodyOption = { text: '', color: 'black', font: '', fontSize: 10, rowHeight: 10 }
    const emptySub: DrawTextBodyOption = { text: undefined, color: 'gray', font: '', fontSize: 10, rowHeight: 20 }

    it('主副文本均为空时返回 undefined，且不产生任何绘制调用', () => {
        const { ctx, calls } = createMockCtx()
        const res = drawText(ctx, pos, [1, 0], undefined, emptyMain, emptySub, false, 'both')
        expect(res).toBeUndefined()
        expect(calls.filter(c => c[0] === 'fillText' || c[0] === 'strokeText')).toEqual([])
    })

    it('只有空白字符（含换行）视同空文本', () => {
        const { ctx } = createMockCtx()
        const res = drawText(ctx, pos, [1, 0], undefined, { ...emptyMain, text: '  \n\t ' }, emptySub, false, 'both')
        expect(res).toBeUndefined()
    })

    it('主文本为空但副文本非空时仍正常返回包围盒', () => {
        const { ctx } = createMockCtx()
        const res = drawText(ctx, pos, [1, 0], undefined, emptyMain, subOpt, false, 'measure')
        expect(res).toBeDefined()
        // 只有副文本一行：宽 20（'xy'），高 20
        expect(res?.rectFull).toEqual([[100, 40], [120, 40], [120, 60], [100, 60]])
    })

    it('drawTextForLineName 主副文本均为空时返回 undefined', () => {
        const { ctx, calls } = createMockCtx()
        const res = drawTextForLineName(ctx, [200, 100], [1, 1], 1, emptyMain, emptySub, false, 'both')
        expect(res).toBeUndefined()
        expect(calls.filter(c => c[0] === 'fillText' || c[0] === 'strokeText')).toEqual([])
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

describe('drawText 缩放支持', () => {
    it('倍率缺省（等价于 1）时不产生任何变换调用，四边形与轴对齐矩形一致', () => {
        const { ctx, calls } = createMockCtx()
        const res = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'both', undefined, undefined, 1, 1)
        expect(res?.rectFull).toEqual(rectFullCorners)
        expect(res?.rectMain).toEqual(rectMainCorners)
        expect(calls.filter(c => ['save', 'restore', 'translate', 'rotate', 'scale'].includes(c[0]))).toEqual([])
    })

    it('仅横向缩放 2 倍：宽度翻倍，高度与锚点纵坐标不变', () => {
        const { ctx } = createMockCtx()
        const res = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure', undefined, undefined, 2, 1)
        expect(res?.rectFull).toEqual([[100, 35], [160, 35], [160, 65], [100, 65]])
        expect(res?.rectMain).toEqual([[100, 35], [160, 35], [160, 45], [100, 45]])
    })

    it('仅纵向缩放 2 倍：上下边界各远离锚点一倍，rectMain 仍精确', () => {
        const { ctx } = createMockCtx()
        const res = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure', undefined, undefined, 1, 2)
        expect(res?.rectFull).toEqual([[100, 20], [130, 20], [130, 80], [100, 80]])
        expect(res?.rectMain).toEqual([[100, 20], [130, 20], [130, 40], [100, 40]])
    })

    it('副倍率独立时 rectFull 取主/副各自缩放后的并集，rectMain 按主倍率', () => {
        const { ctx } = createMockCtx()
        //主行横向 2 倍（撑到 160），副行不缩放（自身宽 20，到 120）→ 并集 x 取较宽者、y 由副行决定
        const res = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure',
            undefined, undefined, 2, 1, 1, 1)
        expect(res?.rectFull).toEqual([[100, 35], [160, 35], [160, 65], [100, 65]])
        expect(res?.rectMain).toEqual([[100, 35], [160, 35], [160, 45], [100, 45]])
        //副行横向 3 倍、纵向 2 倍，主行不缩放 → 副行带锚点侧（左对齐时为左边缘 100）不随主倍率横移，
        //自身宽度从该边起 20*3=60 撑开到 100..160；纵向：块高 = 主 10 + 副 20*2 = 50，
        //ySgn=0 时块中心钉在锚点 50 → 整块 25..75（主行带随之从 35..45 下移到 25..35，与副行带相接）
        const res2 = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure',
            undefined, undefined, 1, 1, 3, 2)
        expect(res2?.rectFull).toEqual([[100, 25], [160, 25], [160, 75], [100, 75]])
        expect(res2?.rectMain).toEqual([[100, 25], [130, 25], [130, 35], [100, 35]])
    })

    it('副横向缩放绕锚点侧边缘，方向随文字对齐（不再绕副行带自身中心）', () => {
        const { ctx } = createMockCtx()
        //右对齐（xSgn=-1）：rectFull=[[70,35],[100,65]]，副行带=[[80,45],[100,65]]，锚点侧是右边缘 100
        //副横向 3 倍应从右边缘向左撑开到 100-60=40，而不是绕自身中心 90 变成 60..120（越过锚点）
        const resRight = drawText(ctx, pos, [-1, 0], undefined, mainOpt, subOpt, false, 'measure',
            undefined, undefined, 1, 1, 3, 1)
        expect(resRight?.rectFull).toEqual([[40, 35], [100, 35], [100, 65], [40, 65]])
        //居中（xSgn=0）：副行带自身中心即锚点，行为与绕中心一致
        //rectFull=[[85,35],[115,65]]，副行带=[[90,45],[110,65]]，中心 100，3 倍 → 70..130
        const resCenter = drawText(ctx, pos, [0, 0], undefined, mainOpt, subOpt, false, 'measure',
            undefined, undefined, 1, 1, 3, 1)
        expect(resCenter?.rectFull).toEqual([[70, 35], [130, 35], [130, 65], [70, 65]])
    })

    it('副独立缩放时绘制变换的缩放中心就是锚点侧边缘（与 rectSub 测量同源）', () => {
        const { ctx, calls } = createMockCtx()
        //右对齐 + 副横向 3 倍：副块应绕副行带右边缘 (100, 45) 缩放，而不是绕自身中心 (90, 45)
        drawText(ctx, pos, [-1, 0], undefined, mainOpt, subOpt, false, 'both',
            undefined, undefined, 1, 1, 3, 1)
        expect(calls).toContainEqual(['scale', 3, 1])
        const iScale = calls.findIndex(c => c[0] === 'scale' && c[1] === 3)
        expect(calls[iScale - 1]).toEqual(['translate', 100, 45])
        expect(calls[iScale + 1]).toEqual(['translate', -100, -45])
    })

    it('主横缩放而副横不缩时，副行带贴住锚点侧不横移', () => {
        const { ctx } = createMockCtx()
        //右对齐，主横向 2 倍（70..100 → 40..100），副 ssx=1：锚点侧（右边缘 100）跟随主倍率后仍是 100
        //→ 副行带保持 80..100，不会因为“绕自身中心”而被推离锚点侧
        const res = drawText(ctx, pos, [-1, 0], undefined, mainOpt, subOpt, false, 'measure',
            undefined, undefined, 2, 1, 1, 1)
        expect(res?.rectMain).toEqual([[40, 35], [100, 35], [100, 45], [40, 45]])
        expect(res?.rectFull).toEqual([[40, 35], [100, 35], [100, 65], [40, 65]])
    })

    it('副纵向缩放小于 1 时整块仍按锚点对齐、主副行带保持相接', () => {
        const { ctx } = createMockCtx()
        //ySgn=0：块高 = 主 10 + 副 20*0.5 = 20，块中心仍钉在锚点 50 → 40..60
        //主行带 35..45 随整块下移 Δ=5 → 40..50，副行带 50..60（与主行带底边 50 无缝隙）
        const res = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure',
            undefined, undefined, 1, 1, 1, 0.5)
        expect(res?.rectFull).toEqual([[100, 40], [130, 40], [130, 60], [100, 60]])
        //主行带底（50）不越过副行带顶所在的一半：整块中心仍与锚点对齐
        const mainBottom = Math.max(...res!.rectMain.map(p => p[1]))
        expect(mainBottom).toBe(50)
    })

    it('主纵缩放而副纵不缩时，整块平移使块中心仍与锚点对齐', () => {
        const { ctx } = createMockCtx()
        //主行带绕 pos 纵向 2 倍：35..45 → 20..40；副行带不缩放（高 20），块高 40
        //ySgn=0 时块中心必须仍在锚点 50 → 整块下移 Δ=10：主 30..50、副 50..70
        const res = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure',
            undefined, undefined, 1, 2, 1, 1)
        expect(res?.rectMain).toEqual([[100, 30], [130, 30], [130, 50], [100, 50]])
        expect(res?.rectFull).toEqual([[100, 30], [130, 30], [130, 70], [100, 70]])
    })

    it('纵向锚点在上方/下方时，块的锚点侧边缘贴住锚点', () => {
        const { ctx } = createMockCtx()
        //副纵向 2 倍、主不缩放：块高 = 10 + 40 = 50
        //ySgn=1（锚点在块顶）：主行带不动 50..60，副行带向下展开 60..100 → 并集 50..100
        const resTop = drawText(ctx, pos, [1, 1], undefined, mainOpt, subOpt, false, 'measure',
            undefined, undefined, 1, 1, 1, 2)
        expect(resTop?.rectMain).toEqual([[100, 50], [130, 50], [130, 60], [100, 60]])
        expect(resTop?.rectFull).toEqual([[100, 50], [130, 50], [130, 100], [100, 100]])
        //ySgn=-1（锚点在块底）：块底边必须仍贴住锚点 50（这正是此前异常的场景：底边被抬离锚点）
        //整块上移 Δ=-20：主行带 0..10、副行带 10..50
        const resBottom = drawText(ctx, pos, [1, -1], undefined, mainOpt, subOpt, false, 'measure',
            undefined, undefined, 1, 1, 1, 2)
        expect(resBottom?.rectMain).toEqual([[100, 0], [130, 0], [130, 10], [100, 10]])
        expect(resBottom?.rectFull).toEqual([[100, 0], [130, 0], [130, 50], [100, 50]])
        //主纵 2 倍、副不缩（块高 40），ySgn=-1：块底仍贴锚点 50 → 主 10..30、副 30..50
        const resMix = drawText(ctx, pos, [1, -1], undefined, mainOpt, subOpt, false, 'measure',
            undefined, undefined, 1, 2, 1, 1)
        expect(resMix?.rectMain).toEqual([[100, 10], [130, 10], [130, 30], [100, 30]])
        expect(resMix?.rectFull).toEqual([[100, 10], [130, 10], [130, 50], [100, 50]])
    })

    it('副纵向独立缩放时绘制块与测量同源：主块平移、副块绕锚点侧缩放', () => {
        const { ctx, calls } = createMockCtx()
        //ySgn=-1 + 副纵向 2 倍：Δ=-20，主块只平移不缩放；副块的缩放中心应是锚点 (100,50)
        drawText(ctx, pos, [1, -1], undefined, mainOpt, subOpt, false, 'both',
            undefined, undefined, 1, 1, 1, 2)
        const kinds = calls.map(c => c[0])
        const iScale = kinds.findIndex(k => k === 'scale')
        expect(calls[iScale - 1]).toEqual(['translate', 100, 50])
        expect(calls[iScale + 1]).toEqual(['translate', -100, -50])
        //主块的平移量与 rectMain 的位移一致（画布矩阵中 translate 在 scale 之前发出，作用于输出空间）
        expect(calls[0]).toEqual(['save'])
        expect(calls[1]).toEqual(['translate', 0, -20])
    })

    it('主行缩放小于副行时矩形贴合主行（副侧不按整矩形宽度留白）', () => {
        const { ctx } = createMockCtx()
        //主行宽 30 横向 0.8 → 24（右缘 124）；副行宽 20 不缩放 → 并集宽 24，无两侧空白
        const res = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure',
            undefined, undefined, 0.8, 1, 1, 1)
        expect(res?.rectFull).toEqual([[100, 35], [124, 35], [124, 65], [100, 65]])
        expect(res?.rectMain).toEqual([[100, 35], [124, 35], [124, 45], [100, 45]])
    })

    it('缩放发生在文字自身坐标系内：先缩放后旋转（与测试内独立计算一致）', () => {
        const { ctx } = createMockCtx()
        const angle = Math.PI / 2
        const res = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure', undefined, angle, 2, 1)
        expectQuadCloseTo(res!.rectFull, rectFullCorners.map(p => transformPt(p, pos, angle, 2, 1)))
        expectQuadCloseTo(res!.rectMain, rectMainCorners.map(p => transformPt(p, pos, angle, 2, 1)))
    })

    it('绘制时以 pos 为中心施加 scale，文字仍在未变换的逻辑坐标处绘制', () => {
        const { ctx, calls } = createMockCtx()
        drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'both', undefined, undefined, 2, 1.5)
        const kinds = calls.map(c => c[0])
        const iSave = kinds.indexOf('save')
        const iRestore = kinds.lastIndexOf('restore')
        expect(iSave).toBeGreaterThanOrEqual(0)
        expect(iRestore).toBeGreaterThan(iSave)
        expect(calls[iSave + 1]).toEqual(['translate', 100, 50])
        expect(calls[iSave + 2]).toEqual(['scale', 2, 1.5])
        expect(calls[iSave + 3]).toEqual(['translate', -100, -50])
        expect(calls).toContainEqual(['fillText', 'ABC', 100, 42])
        expect(calls).toContainEqual(['fillText', 'xy', 100, 57])
    })

    it('主、副倍率不同时拆成两个变换块', () => {
        const { ctx, calls } = createMockCtx()
        drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'both', undefined, undefined, 2, 1, 1, 2)
        expect(calls.filter(c => c[0] === 'save')).toHaveLength(2)
        expect(calls).toContainEqual(['scale', 2, 1])
        expect(calls).toContainEqual(['scale', 1, 2])
    })

    it('非法倍率（0、负数、NaN、Infinity、字符串）按默认值处理且不产生变换', () => {
        for (const bad of [0, -2, NaN, Infinity, '2'] as unknown as number[]) {
            const { ctx, calls } = createMockCtx()
            const res = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'both', undefined, undefined, bad, bad)
            expect(res?.rectFull).toEqual(rectFullCorners)
            expect(res?.rectMain).toEqual(rectMainCorners)
            expect(calls.filter(c => ['save', 'restore', 'translate', 'rotate', 'scale'].includes(c[0]))).toEqual([])
        }
    })

    it('width 指定的拉伸是固定下限：缩放后文字超出它就不再拉伸', () => {
        const { ctx } = createMockCtx()
        //width=50，文字横向 2 倍后已经 60 宽（>50）→ 盒子就是文字的 60 宽，不再补足到 50 之外
        const res = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure', 50, undefined, 2, 1)
        expect(res?.rectFull).toEqual([[100, 35], [160, 35], [160, 65], [100, 65]])
    })

    it('width 是固定下限：主、副倍率都不改变它，只有缩放后的文字宽度能撑大它', () => {
        const { ctx } = createMockCtx()
        //主、副文字 2 倍后（60/40 宽）都仍然窄于 width=200 → 盒子恒为 200 宽
        const resFollow = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure',
            200, undefined, 2, 1)
        expect(resFollow?.rectFull).toEqual([[100, 35], [300, 35], [300, 65], [100, 65]])
        const resIndep = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure',
            200, undefined, 2, 1, 3, 1)
        expect(resIndep?.rectFull).toEqual([[100, 35], [300, 35], [300, 65], [100, 65]])
        //副文字撑得比 width 宽（20*30=600 > 200）时才会被实际宽度撑大，且不会回缩到 width
        const resWide = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure',
            200, undefined, 1, 1, 30, 1)
        expect(resWide?.rectFull).toEqual([[100, 35], [700, 35], [700, 65], [100, 65]])
    })

    it('width 撑开的盒子与倍率无关：纵向缩放只动文字块，留白不被当成副行带拉伸', () => {
        const { ctx } = createMockCtx()
        //width=200 把盒子固定在 [100..300]（文字本身 100..130，多出的 170 是盒子留白）
        //① 副纵向 2 倍、主不缩放：块高 = 10 + 20*2 = 40，ySgn=0 时块中心仍钉在锚点 50 → 25..75
        //   （曾经把 rectFull 整个当副行带映射，主行带那段也被按 ssy 拉伸，块顶多出 10 的空隙）
        const res = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure',
            200, undefined, 1, 1, 1, 2)
        expect(res?.rectFull).toEqual([[100, 25], [300, 25], [300, 75], [100, 75]])
        expect(res?.rectMain).toEqual([[100, 25], [130, 25], [130, 35], [100, 35]])
        //② 副跟随主、纵向整体 2 倍 → 高 20..80，宽度仍是固定的 200
        const resFollow = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure',
            200, undefined, 1, 2)
        expect(resFollow?.rectFull).toEqual([[100, 20], [300, 20], [300, 80], [100, 80]])
    })

    it('width 撑开的盒子：横向缩放的留白归属主/副倍率都不变', () => {
        const { ctx } = createMockCtx()
        //width=200、主文字宽 30、副文字宽 20（盒子从锚点 100 起占 100..300）
        //主横向 2 倍（100..160）仍比盒子窄 → 盒子保持 100..300，留白不被主倍率撑开
        const resMain = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure',
            200, undefined, 2, 1, 1, 1)
        expect(resMain?.rectFull).toEqual([[100, 35], [300, 35], [300, 65], [100, 65]])
        //副横向 2 倍（100..140）同样撑不开盒子
        const resSub = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure',
            200, undefined, 1, 1, 2, 1)
        expect(resSub?.rectFull).toEqual([[100, 35], [300, 35], [300, 65], [100, 65]])
        //副文字撑得比盒子宽时（20*30=600 > 盒子 200），并集已经覆盖盒子，不会再回缩到 width
        const resWide = drawText(ctx, pos, [1, 0], undefined, mainOpt, subOpt, false, 'measure',
            200, undefined, 1, 1, 30, 1)
        expect(resWide?.rectFull).toEqual([[100, 35], [700, 35], [700, 65], [100, 65]])
    })

    it('空主文本 + 副倍率：rectFull 只由副文本按副倍率缩放，不产生退化四边形', () => {
        const { ctx } = createMockCtx()
        const emptyMain: DrawTextBodyOption = { text: '', color: 'black', font: '', fontSize: 10, rowHeight: 10 }
        const res = drawText(ctx, pos, [1, 0], undefined, emptyMain, subOpt, false, 'measure',
            undefined, undefined, 1, 1, 2, 1)
        expect(res?.rectFull).toEqual([[100, 40], [140, 40], [140, 60], [100, 60]])
        //主文本行为空时 rectMain 不再退化为含 ±Infinity 的矩形，而是退回（已缩放的）整体矩形
        expect(res?.rectMain).toEqual([[100, 40], [140, 40], [140, 60], [100, 60]])
        for (const [x, y] of res!.rectMain)
            expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true)
    })
})

describe('resolveTextScale', () => {
    it('仅接受正的有限数值，其余按 fallback', () => {
        expect(resolveTextScale(undefined)).toBe(1)
        expect(resolveTextScale(0)).toBe(1)
        expect(resolveTextScale(-1.5)).toBe(1)
        expect(resolveTextScale(NaN)).toBe(1)
        expect(resolveTextScale(Infinity)).toBe(1)
        expect(resolveTextScale('2' as unknown as number)).toBe(1)
        expect(resolveTextScale(2.5)).toBe(2.5)
        expect(resolveTextScale(undefined, 3)).toBe(3)
    })
})
