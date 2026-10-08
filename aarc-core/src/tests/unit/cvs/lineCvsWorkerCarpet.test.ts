import { describe, it, expect, beforeEach } from 'vitest'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import { resetIdCounter, createPoint, createLine, createStyleSlice, createEmptySave } from '../../helpers/saveFactory'
import { ensureDomStub } from '../../helpers/domStub'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useConfigStore } from 'aarc-core/models/stores/configStore'
import { useLineCvsWorker } from 'aarc-core/models/cvs/workers/lineCvsWorker'
import { useCvsBlocksControlStore } from 'aarc-core/models/cvs/common/cvs'
import { CvsBlock, CvsContext, Cvs2dContext } from 'aarc-core/models/cvs/common/cvsContext'
import { Save } from 'aarc-core/models/save'

// lineCvsWorker 的 store 闭包里有 envStore，setup 时注册全局键盘监听，需 document 桩
ensureDomStub()

interface StrokeRec { strokeStyle: string, lineCap: string, lineWidth: number, hadArc: boolean }

/** 记录每次 stroke 时的样式与"自 beginPath 以来是否走过圆弧"的 ctx2d 桩 */
function createRecordingCtx() {
    const strokes: StrokeRec[] = []
    let hadArc = false
    const ctx2d = {
        canvas: { width: 1000, height: 1000 },
        beginPath: () => { hadArc = false },
        closePath: () => {},
        moveTo: () => {}, lineTo: () => {},
        arc: () => { hadArc = true },
        stroke: () => { strokes.push({ strokeStyle: ctx2d.strokeStyle, lineCap: ctx2d.lineCap, lineWidth: ctx2d.lineWidth, hadArc }) },
        fill: () => {},
        strokeRect: () => {}, fillRect: () => {},
        strokeText: () => {}, fillText: () => {},
        measureText: () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
        setLineDash: () => {}, drawImage: () => {}, createPattern: () => null,
        translate: () => {}, save: () => {}, restore: () => {}, rotate: () => {},
        clearRect: () => {},
        lineJoin: '', lineCap: '', lineWidth: 0,
        strokeStyle: '', fillStyle: '', globalAlpha: 1,
        textBaseline: '', textAlign: '', font: ''
    }
    const ctx = new CvsContext(new CvsBlock(1, 0, 0, ctx2d as unknown as Cvs2dContext))
    return { ctx, strokes }
}

/** 使 blockTotalBoundary 覆盖整个画布，线路不会被 omit 判定驱逐 */
function setupFullViewBlocks() {
    useCvsBlocksControlStore().blocksControl = [{
        idx: 0, widthRatio: 1, heightRatio: 1, leftRatio: 0, topRatio: 0,
        canvasWidth: 1000, canvasHeight: 1000, key: 1
    }]
}

/**
 * L 形拐角线：A(0,0) -> B(100,0) -> C(100,100)，线 7（common 类型）。
 * withSlice 时用 StyleSlice[A,B] 在拐角 B 处切开（style 0 = 无样式层，只画 base）。
 */
function makeLShapedSave(withSlice: boolean): Save {
    const save = createEmptySave({
        points: [
            { ...createPoint(1), pos: [0, 0] },
            { ...createPoint(2), pos: [100, 0] },
            { ...createPoint(3), pos: [100, 100] }
        ],
        lines: [createLine([1, 2, 3], { id: 7 })]
    })
    if (withSlice)
        save.styleSlices = [createStyleSlice({ line: 7, fromPt: 1, toPt: 2, style: 0 })]
    save.meta = { textTagIconsVersion: 1 }
    return save
}

describe('carpet 按 span 拆分渲染（与本体接缝对齐）', () => {
    beforeEach(() => {
        resetIdCounter()
        createTestPinia()
        setupFullViewBlocks()
    })

    it('无 slice：carpet 仍为一笔整线，拐角处含圆弧', () => {
        useSaveStore().save = makeLShapedSave(false)
        const bg = useConfigStore().config.bgColor
        const { ctx, strokes } = createRecordingCtx()

        useLineCvsWorker().renderAllLines(ctx)

        const carpets = strokes.filter(s => s.strokeStyle === bg)
        expect(carpets).toHaveLength(1)
        expect(carpets[0].hadArc).toBe(true)
    })

    it('slice 接缝在拐角处：carpet 按 span 拆分、无圆弧、cap 与本体 base 一致', () => {
        useSaveStore().save = makeLShapedSave(true)
        const cs = useConfigStore()
        const bg = cs.config.bgColor
        const { ctx, strokes } = createRecordingCtx()

        useLineCvsWorker().renderAllLines(ctx)

        // carpet 与本体共用同一份 span 切分：两个 span 各一笔，
        // 接缝在 B 处 carpet 与本体一样形成折角（无圆弧），不再鼓出整线圆角
        const carpets = strokes.filter(s => s.strokeStyle === bg)
        expect(carpets).toHaveLength(2)
        const carpetWidth = cs.config.lineWidth * 1 + cs.config.lineCarpetWiden
        for (const c of carpets) {
            expect(c.hadArc).toBe(false)
            expect(c.lineWidth).toBeCloseTo(carpetWidth)
            // cap 与本体 base 层（lineCapWithDefault，common 线为 butt）一致
            expect(c.lineCap).toBe('butt')
        }

        // 本体 base 也是按 span 两笔，cap 同样为 butt
        const bodies = strokes.filter(s => s.strokeStyle !== bg)
        expect(bodies).toHaveLength(2)
        for (const b of bodies)
            expect(b.lineCap).toBe('butt')
    })
})
