import { describe, it, expect, beforeEach } from 'vitest'
import rfdc from 'rfdc'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import { resetIdCounter, createPoint, createLine, createEmptySave } from '../../helpers/saveFactory'
import { ensureDomStub } from '../../helpers/domStub'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useFormalizedLineStore } from 'aarc-core/models/stores/saveDerived/formalizedLineStore'
import { useOnDetectStore } from 'aarc-core/models/stores/saveDerived/saveDerivedDerived/onDetectStore'
import { useLineCvsWorker } from 'aarc-core/models/cvs/workers/lineCvsWorker'
import { useCvsBlocksControlStore } from 'aarc-core/models/cvs/common/cvs'
import { CvsBlock, CvsContext, Cvs2dContext } from 'aarc-core/models/cvs/common/cvsContext'
import { useEnvStore } from 'aarc-core/models/stores/envStore'
import { applyRemoteSaveDiff, initAfterRemoteSaveApplied } from 'aarc-core/models/collab/remoteOpApplier'
import { diffSave } from 'aarc-core/models/save/saveDiff'
import { Save } from 'aarc-core/models/save'

// envStore（undoStore 依赖 selectionStore）在 setup 时注册全局键盘监听，需 document 桩
ensureDomStub()

const deepClone = rfdc()

/**
 * 复现"线路能受到点击检测，但未渲染出来"（幽灵线）。
 *
 * 背景：点击检测 onDetectStore.onLine 只遍历 formalizedLineStore 的 kv 缓存，
 * 该缓存只由渲染路径（lineCvsWorker.renderLine）写入/驱逐。
 * 系统依赖隐含不变量：缓存内容 == 最近一次主画布整帧渲染时视野内的线路。
 * 本文件的用例钉住打破该不变量的几条路径。
 *
 * 其中标记 it.fails 的用例断言的是"正确行为"，当前因 bug 存在而失败（测试转绿）；
 * 修复后这些用例会转红，届时应去掉 .fails 并保留断言。
 *
 * 修复进度：
 * - 路径1/路径2（renderLine 点数不足早退不驱逐缓存）：已修复（早退时驱逐整个 family），
 *   对应用例已去掉 .fails 转为正向断言
 * - 路径3（多人时序：active 画布写共享缓存 vs 主画布渲染抑制）：已修复
 *   （renderLine 增加 writeCache 参数，active 画布只画不写，共享缓存由主画布单一维护），
 *   对应用例已转为正向断言
 */

/** 记录绘制调用的 ctx2d 桩：只关心 stroke/fill（是否真正画了像素） */
function createRecordingCtx() {
    const calls: string[] = []
    const rec = (name: string) => () => { calls.push(name) }
    const ctx2d = {
        canvas: { width: 1000, height: 1000 },
        beginPath: rec('beginPath'), closePath: rec('closePath'),
        moveTo: rec('moveTo'), lineTo: rec('lineTo'),
        stroke: rec('stroke'), fill: rec('fill'),
        strokeRect: rec('strokeRect'), fillRect: rec('fillRect'),
        arc: rec('arc'),
        strokeText: rec('strokeText'), fillText: rec('fillText'),
        measureText: () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
        setLineDash: () => {}, drawImage: () => {}, createPattern: () => null,
        translate: () => {}, save: () => {}, restore: () => {}, rotate: () => {},
        clearRect: rec('clearRect'),
        lineJoin: '', lineCap: '', lineWidth: 0,
        strokeStyle: '', fillStyle: '', globalAlpha: 1,
        textBaseline: '', textAlign: '', font: ''
    }
    const ctx = new CvsContext(new CvsBlock(1, 0, 0, ctx2d as unknown as Cvs2dContext))
    return { ctx, paintCount: () => calls.filter(c => c === 'stroke' || c === 'fill').length }
}

/** 使 blockTotalBoundary 覆盖整个画布，线路不会被 omit 判定驱逐 */
function setupFullViewBlocks() {
    useCvsBlocksControlStore().blocksControl = [{
        idx: 0, widthRatio: 1, heightRatio: 1, leftRatio: 0, topRatio: 0,
        canvasWidth: 1000, canvasHeight: 1000, key: 1
    }]
}

/** 两点一线的基础存档：p1@[0,0] p2@[100,0]，线 7 = [1,2] */
function makeBasicSave(): Save {
    const save = createEmptySave({
        points: [
            { ...createPoint(1), pos: [0, 0] },
            { ...createPoint(2), pos: [100, 0] }
        ],
        lines: [createLine([1, 2], { id: 7 })]
    })
    save.meta = { textTagIconsVersion: 1 }
    return save
}

describe('幽灵线：点击检测与渲染的缓存一致性', () => {
    beforeEach(() => {
        resetIdCounter()
        createTestPinia()
        setupFullViewBlocks()
        initAfterRemoteSaveApplied(undefined)
    })

    it('正常渲染后：缓存与像素同步，可点中（ Sanity 检查）', () => {
        useSaveStore().save = makeBasicSave()
        const main = createRecordingCtx()

        useLineCvsWorker().renderAllLines(main.ctx)

        expect(main.paintCount()).toBeGreaterThan(0)
        expect(useFormalizedLineStore().getLinesFormalPts(7)).toBeDefined()
        expect(useOnDetectStore().onLine([50, 5]).map(x => x.lineId)).toContain(7)
    })

    describe('路径1：线路控制点悬空（getPtsByIds<=1）时 renderLine 早退（已修复：早退驱逐缓存）', () => {
        // 悬空产生方式（多人）：对方删除某点（op 含 points.$rm），
        // 但引用该点的另一条线的 pts $upd 在 LWW 中被本方并发编辑覆盖，
        // 结果 line.pts 仍含已删除的 id。pointlessLineScan 只查 pts.length<2，漏检。
        function setupDanglingLine() {
            const save = makeBasicSave()
            useSaveStore().save = save
            const frame1 = createRecordingCtx()
            useLineCvsWorker().renderAllLines(frame1.ctx)
            expect(frame1.paintCount()).toBeGreaterThan(0) // 第一帧正常画出
            // 只删 save.points 里的点 2，line.pts 保持 [1,2]（悬空）
            // 须经 store 的响应式代理改数据，直连原始对象不会触发 computed 失效
            const reactiveSave = useSaveStore().save!
            reactiveSave.points = reactiveSave.points.filter(p => p.id !== 2)
            return save
        }

        it('机制钉住：第二帧一笔不画，且 formalPts 缓存被驱逐', () => {
            setupDanglingLine()
            const frame2 = createRecordingCtx()

            useLineCvsWorker().renderAllLines(frame2.ctx)

            expect(frame2.paintCount()).toBe(0) // 线路未渲染
            expect(useFormalizedLineStore().getLinesFormalPts(7)).toBeUndefined() // 缓存已驱逐
        })

        it('未渲染的线路不应能被点击检测命中', () => {
            setupDanglingLine()
            const frame2 = createRecordingCtx()
            useLineCvsWorker().renderAllLines(frame2.ctx)
            expect(frame2.paintCount()).toBe(0)

            // 屏幕上已经看不到这条线，点击旧位置不应命中
            expect(useOnDetectStore().onLine([50, 5])).toHaveLength(0)
        })
    })

    describe('路径2：支线控制点悬空时整条 family 不渲染（已修复：主线缓存一并驱逐）', () => {
        function setupDanglingChild() {
            const save = createEmptySave({
                points: [
                    { ...createPoint(1), pos: [0, 0] },
                    { ...createPoint(2), pos: [100, 0] },
                    { ...createPoint(3), pos: [0, 50] },
                    { ...createPoint(4), pos: [100, 50] }
                ],
                lines: [
                    createLine([1, 2], { id: 7 }),
                    createLine([3, 4], { id: 8, parent: 7 })
                ]
            })
            save.meta = { textTagIconsVersion: 1 }
            useSaveStore().save = save
            const frame1 = createRecordingCtx()
            useLineCvsWorker().renderAllLines(frame1.ctx)
            expect(frame1.paintCount()).toBeGreaterThan(0)
            // 支线的点 4 悬空（须经 store 的响应式代理改数据）
            const reactiveSave = useSaveStore().save!
            reactiveSave.points = reactiveSave.points.filter(p => p.id !== 4)
            return save
        }

        it('机制钉住：第二帧主线也一笔不画，且主线缓存被一并驱逐', () => {
            setupDanglingChild()
            const frame2 = createRecordingCtx()

            useLineCvsWorker().renderAllLines(frame2.ctx)

            expect(frame2.paintCount()).toBe(0)
            expect(useFormalizedLineStore().getLinesFormalPts(7)).toBeUndefined()
        })

        it('主线虽未渲染但不应能在旧位置点中', () => {
            setupDanglingChild()
            const frame2 = createRecordingCtx()
            useLineCvsWorker().renderAllLines(frame2.ctx)
            expect(frame2.paintCount()).toBe(0)

            expect(useOnDetectStore().onLine([50, 5])).toHaveLength(0)
        })
    })

    describe('路径3（多人时序）：远程修改本地激活的线路 + 主画布渲染被抑制（已修复：active 画布不写共享缓存）', () => {
        // remoteOpApplier 应用远程 op 时清空 formalized 缓存，渲染交由
        // remoteRenderScheduler 推迟（node 中未注入渲染函数，天然模拟"抑制"）。
        // 修复前：active 画布 50ms 循环对激活线路调用 renderLine 会把新几何写回共享缓存，
        // 造成 缓存=新位置、主画布像素=旧位置 的脱节。
        // 修复后：active 画布 renderLine 传 writeCache=false，只画 overlay 不写缓存，
        // 缓存保持为空直到主画布补渲染——抑制窗口内新旧位置都不可点中
        // （与所有非激活线路在该窗口内的表现一致，这是渲染调度设计本身的取舍）。
        async function setupRemoteModifiedActiveLine() {
            const save = makeBasicSave()
            useSaveStore().save = save
            const main = createRecordingCtx()
            useLineCvsWorker().renderAllLines(main.ctx) // 主画布旧帧：线在 y=0
            const mainPaintsBefore = main.paintCount()
            expect(mainPaintsBefore).toBeGreaterThan(0)

            // 本地激活线路 7（v1 策略：远程修改不取消本地激活）
            useEnvStore().activeLine = save.lines[0]

            // 远程 op：把两个点移到 y=500
            const next = deepClone(save)
            next.points[0].pos = [0, 500]
            next.points[1].pos = [100, 500]
            await applyRemoteSaveDiff(diffSave(save, next)!)
            return { save, main, mainPaintsBefore }
        }

        it('机制钉住：远程 op 清空缓存；active 画布 renderLine(writeCache=false) 只画不写；主画布未重渲染', async () => {
            const { save, main, mainPaintsBefore } = await setupRemoteModifiedActiveLine()

            // 远程 op 应用后缓存已被清空
            expect(useFormalizedLineStore().getLinesFormalPts(7)).toBeUndefined()

            // active 画布 50ms tick：对激活线路 renderLine（画到 overlay，不写共享缓存）
            const active = createRecordingCtx()
            useLineCvsWorker().renderLine(active.ctx, save.lines[0], undefined, false)
            expect(active.paintCount()).toBeGreaterThan(0)
            expect(useFormalizedLineStore().getLinesFormalPts(7)).toBeUndefined()

            // 主画布整帧渲染被抑制（remoteRenderScheduler 未注入/推迟）：没有新像素
            expect(main.paintCount()).toBe(mainPaintsBefore)
        })

        it('抑制窗口内：未渲染的新位置不可点中；主画布补渲染后检测与新帧同步', async () => {
            const { save } = await setupRemoteModifiedActiveLine()

            // active 画布 tick（只画不写缓存）
            const active = createRecordingCtx()
            useLineCvsWorker().renderLine(active.ctx, save.lines[0], undefined, false)

            const onDetect = useOnDetectStore()
            // 关键不变量：主画布上没有渲染 y=500 处的线，那里不应能点中（修复前的 bug）
            expect(onDetect.onLine([50, 505])).toHaveLength(0)
            // 窗口内旧位置也不命中：缓存已被远程 op 清空，
            // 与所有非激活线路在抑制窗口内的表现一致（渲染调度设计的取舍）
            expect(onDetect.onLine([50, 5])).toHaveLength(0)

            // 抑制解除后的补渲染（remoteRenderScheduler 静止后补一次整帧渲染）
            const main2 = createRecordingCtx()
            useLineCvsWorker().renderAllLines(main2.ctx)
            expect(main2.paintCount()).toBeGreaterThan(0)

            // 检测与新帧同步：新位置可点中，旧位置不再命中
            expect(onDetect.onLine([50, 505]).map(x => x.lineId)).toContain(7)
            expect(onDetect.onLine([50, 5])).toHaveLength(0)
        })
    })
})
