import { describe, it, expect, beforeEach } from 'vitest'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useLineStateStore } from 'aarc-core/models/stores/saveDerived/state/lineStateStore'
import { useLineSpanStore } from 'aarc-core/models/stores/saveDerived/slice/lineSpanStore'
import { useRenderOptionsStore } from 'aarc-core/models/stores/renderOptionsStore'
import { useConfigStore } from 'aarc-core/models/stores/configStore'
import { useColorProcStore } from 'aarc-core/models/stores/utils/colorProcStore'
import { resetIdCounter, createPoint, createLine, createTimeSlice, createEmptySave } from '../../helpers/saveFactory'
import { resolveLineGradient, resolveSpanStrokeColor } from 'aarc-core/utils/lineUtils/lineGradient'
import { FormalPt } from 'aarc-core/models/coord'

// 场景对照（docs/rendering/branch-line-gradient.md §8）：
// 端点局部淡化已接入渐变取色（getJunctionPtColor，方向感知）：渐变两端颜色自动判定时，
// 跟随接点相邻 span 的局部 downplay 状态（交界点按支线接入方向选侧，垂直时非淡化
// 优先兜底，导出过滤时取背景色），而非整线统一颜色。
// 本组用例固定并文档化该行为。
describe('支线渐变色 × 时间淡化（导出场景）', () => {
  beforeEach(() => {
    resetIdCounter()
    createTestPinia()
  })

  function setupScenario() {
    const pts = [10, 20, 30]
    const lineA = createLine([10, 20], { color: '#ff0000', time: { open: new Date('2024-01-01').getTime() } })
    const lineB = createLine([20, 30], { color: '#0000ff', time: { open: new Date('2029-01-01').getTime() } })
    // 支线两端分别与 A（pt10）、B（pt20）共享控制点；color 跟随主线 A
    const branch = createLine([10, 20], { color: '#ff0000', parent: lineA.id, gradient: {} })
    const save = createEmptySave({ points: pts.map(id => createPoint(id)), lines: [lineA, lineB, branch] })
    const saveStore = useSaveStore()
    saveStore.save = save
    const renderOptions = useRenderOptionsStore()
    renderOptions.exporting = true
    renderOptions.timeMoment = new Date('2026-01-01').getTime()
    renderOptions.timeConfig = { enabledPreview: true }
    const lineStateStore = useLineStateStore()
    const lineSpanStore = useLineSpanStore()
    // 支线 formalPts：pt10 → pt20（pos 来自 createPoint: [id*10, id*10]）
    const branchFormalPts: FormalPt[] = [
      { pos: [100, 100], afterIdxEqv: 0 },
      { pos: [200, 200], afterIdxEqv: 1 },
    ]
    return { lineA, lineB, branch, saveStore, lineStateStore, lineSpanStore, branchFormalPts }
  }

  it('导出 2026：A 原色、B 整线时间淡化、支线不连带淡化', () => {
    const { lineA, lineB, branch, lineStateStore } = setupScenario()
    const colorProc = useColorProcStore()
    const grayB = colorProc.colorProcDownplay.convert('#0000ff')

    expect(lineStateStore.getLineActualColor(lineA)).toBe('#ff0000')
    expect(lineStateStore.getLineActualColor(lineB)).toBe(grayB)
    expect(lineStateStore.lineActualColors.get(lineB.id)?.downplayedBy).toBe('time')
    // 支线自身无 time，parent A 已开通 → 不淡化
    expect(lineStateStore.getLineActualColor(branch)).toBe('#ff0000')
    expect(lineStateStore.isLineDownplayed(branch.id)).toBeFalsy()
  })

  it('2026：自动渐变目标色跟随 B 的局部淡化；导出时 B 被过滤 → 背景色', () => {
    const { branch, saveStore, lineStateStore, branchFormalPts } = setupScenario()
    const colorProc = useColorProcStore()
    const resolve = () => resolveLineGradient(branch, branchFormalPts, saveStore.save?.lines,
      l => lineStateStore.getLineActualColor(l),
      (l, ptId, approach, selfLineId) => lineStateStore.getJunctionPtColor(l.id, ptId, approach, selfLineId))

    // 预览：B 未开通 span 仍渲染（淡化灰）→ 目标色 = B 的淡化色
    useRenderOptionsStore().exporting = false
    let res = resolve()
    expect(res).toBeDefined()
    expect(res!.fromColor).toBe('#ff0000')                                        // 主色 = A 色（原色）
    expect(res!.toColor).toBe(colorProc.colorProcDownplay.convert('#0000ff'))     // 目标色 = B 的淡化灰
    expect(res!.from).toEqual([100, 100])                                         // pt10 端（接 A）
    expect(res!.to).toEqual([200, 200])                                           // pt20 端（接 B）

    // 导出：B 整线未开通被过滤、不渲染 → 目标色 = 背景色（溶入背景，而非指向不存在的线）
    useRenderOptionsStore().exporting = true
    res = resolve()
    expect(res!.toColor).toBe(useConfigStore().config.bgColor)
  })

  it('2026：目标端局部未开通（TimeSlice，B 整线未淡化）→ 预览取局部淡化色，导出取背景色', () => {
    const pts = [10, 20, 30, 40]
    const lineA = createLine([10, 20], { color: '#ff0000' })
    const lineB = createLine([20, 30, 40], { color: '#0000ff' })
    // B 只有接续 span（20-30）未开通，整线无 time → B 整线不淡化
    const timeSlice = createTimeSlice({
      line: lineB.id,
      fromPt: 20,
      toPt: 30,
      time: { open: new Date('2029-01-01').getTime() }
    })
    const branch = createLine([10, 20], { color: '#ff0000', parent: lineA.id, gradient: {} })
    const save = createEmptySave({ points: pts.map(id => createPoint(id)), lines: [lineA, lineB, branch], timeSlices: [timeSlice] })
    const saveStore = useSaveStore()
    saveStore.save = save
    const renderOptions = useRenderOptionsStore()
    renderOptions.exporting = false
    renderOptions.timeMoment = new Date('2026-01-01').getTime()
    renderOptions.timeConfig = { enabledPreview: true }
    const lineStateStore = useLineStateStore()
    const colorProc = useColorProcStore()

    // B 整线未淡化（异常场景：旧行为下渐变目标色会取整线蓝色，无视接续点局部时间设置）
    expect(lineStateStore.getLineActualColor(lineB)).toBe('#0000ff')

    const branchFormalPts: FormalPt[] = [
      { pos: [100, 100], afterIdxEqv: 0 },
      { pos: [200, 200], afterIdxEqv: 1 },
    ]
    const resolve = () => resolveLineGradient(branch, branchFormalPts, saveStore.save?.lines,
      l => lineStateStore.getLineActualColor(l),
      (l, ptId, approach, selfLineId) => lineStateStore.getJunctionPtColor(l.id, ptId, approach, selfLineId))

    // 预览：接续 span 局部未开通仍渲染（淡化灰）→ 目标色 = 局部淡化色
    let res = resolve()
    expect(res).toBeDefined()
    expect(res!.toColor).toBe(colorProc.colorProcDownplay.convert('#0000ff'))
    expect(res!.fromColor).toBe('#ff0000')

    // 导出：接续 span 被过滤 → 目标色 = 背景色
    renderOptions.exporting = true
    res = resolve()
    expect(res!.toColor).toBe(useConfigStore().config.bgColor)
  })

  it('2026：主色端局部未开通（支线首端 span 被 TimeSlice 淡化）→ 预览淡化、导出背景色', () => {
    const pts = [10, 20, 25, 30]
    const lineA = createLine([10, 20], { color: '#ff0000' })
    const lineB = createLine([25, 30], { color: '#0000ff' })
    const branch = createLine([10, 20, 25], { color: '#ff0000', parent: lineA.id, gradient: {} })
    // 支线首段（10-20）未开通，末段（20-25）无限制
    const timeSlice = createTimeSlice({
      line: branch.id,
      fromPt: 10,
      toPt: 20,
      time: { open: new Date('2029-01-01').getTime() }
    })
    const save = createEmptySave({ points: pts.map(id => createPoint(id)), lines: [lineA, lineB, branch], timeSlices: [timeSlice] })
    const saveStore = useSaveStore()
    saveStore.save = save
    const renderOptions = useRenderOptionsStore()
    renderOptions.exporting = false
    renderOptions.timeMoment = new Date('2026-01-01').getTime()
    renderOptions.timeConfig = { enabledPreview: true }
    const lineStateStore = useLineStateStore()
    const colorProc = useColorProcStore()

    const branchFormalPts: FormalPt[] = [
      { pos: [100, 100], afterIdxEqv: 0 },
      { pos: [200, 200], afterIdxEqv: 1 },
      { pos: [250, 250], afterIdxEqv: 2 },
    ]
    const resolve = () => resolveLineGradient(branch, branchFormalPts, saveStore.save?.lines,
      l => lineStateStore.getLineActualColor(l),
      (l, ptId, approach, selfLineId) => lineStateStore.getJunctionPtColor(l.id, ptId, approach, selfLineId))

    // 预览：主色端点所在 span（10-20）局部未开通 → 淡化
    let res = resolve()
    expect(res).toBeDefined()
    expect(res!.fromColor).toBe(colorProc.colorProcDownplay.convert('#ff0000'))
    // 目标端 = pt25 接 B，B 无时间限制 → 原色
    expect(res!.toColor).toBe('#0000ff')

    // 导出：支线首段被过滤 → 主色端也溶入背景；目标端不受影响
    renderOptions.exporting = true
    res = resolve()
    expect(res!.fromColor).toBe(useConfigStore().config.bgColor)
    expect(res!.toColor).toBe('#0000ff')
  })

  it('导出 2026：支线 span 未淡化 → 落笔用渐变（红→灰）', () => {
    const { branch, lineStateStore, branchFormalPts } = setupScenario()
    const gradient = resolveLineGradient(branch, branchFormalPts,
      useSaveStore().save?.lines, l => lineStateStore.getLineActualColor(l))!

    const spanDownplayed = lineStateStore.isSpanDownplayed(branch.id, 0)
    expect(spanDownplayed).toBe(false)

    const strokeColor = resolveSpanStrokeColor({
      gradient,
      color: lineStateStore.getSpanActualColor(branch.id, 0),
      fallbackColor: lineStateStore.getLineActualColor(branch),
      downplayed: spanDownplayed,
      downplayedBy: lineStateStore.lineActualColors.get(branch.id)?.downplayedBy
    })
    expect(strokeColor).toBe(gradient)
  })

  it('导出 2026：B 的 span 未开通 → 导出时被过滤，B 不渲染', () => {
    const { lineA, lineB, lineSpanStore } = setupScenario()
    const t = new Date('2026-01-01').getTime()
    expect(lineSpanStore.isSpanOpened(lineA.id, 0, t)).toBe(true)
    expect(lineSpanStore.isSpanOpened(lineB.id, 0, t)).toBe(false)
  })
})

describe('接点方向感知取色（§8.6）', () => {
  // B 水平：pt20[100,300] → pt30[300,300] → pt40[500,300]
  // span [20-30] 未开通（2029）淡化，span [30-40] 正常；支线末端接在交界点 pt30
  function setupJunction(branchOther: { id: number, pos: [number, number] }, allDownplayed: boolean) {
    const p20 = createPoint(20); p20.pos = [100, 300]
    const p30 = createPoint(30); p30.pos = [300, 300]
    const p40 = createPoint(40); p40.pos = [500, 300]
    const px = createPoint(branchOther.id); px.pos = branchOther.pos
    const lineA = createLine([20, 30], { color: '#ff0000' })
    const lineB = createLine([20, 30, 40], { color: '#0000ff' })
    const ts1 = createTimeSlice({
      line: lineB.id, fromPt: 20, toPt: 30,
      time: { open: new Date('2029-01-01').getTime() }
    })
    const timeSlices = allDownplayed
      ? [ts1, createTimeSlice({
          line: lineB.id, fromPt: 30, toPt: 40,
          time: { open: new Date('2029-01-01').getTime() }
        })]
      : [ts1]
    const branch = createLine([branchOther.id, 30], { color: '#ff0000', parent: lineA.id, gradient: {} })
    const save = createEmptySave({ points: [p20, p30, p40, px], lines: [lineA, lineB, branch], timeSlices })
    const saveStore = useSaveStore()
    saveStore.save = save
    const renderOptions = useRenderOptionsStore()
    renderOptions.exporting = false
    renderOptions.timeMoment = new Date('2026-01-01').getTime()
    renderOptions.timeConfig = { enabledPreview: true }
    const lineStateStore = useLineStateStore()
    const branchFormalPts: FormalPt[] = [
      { pos: branchOther.pos, afterIdxEqv: 0 },
      { pos: [300, 300], afterIdxEqv: 1 },
    ]
    return { lineB, branch, saveStore, lineStateStore, branchFormalPts }
  }

  function resolveGradient(ctx: ReturnType<typeof setupJunction>) {
    return resolveLineGradient(ctx.branch, ctx.branchFormalPts, ctx.saveStore.save?.lines,
      l => ctx.lineStateStore.getLineActualColor(l),
      (l, ptId, approach, selfLineId) => ctx.lineStateStore.getJunctionPtColor(l.id, ptId, approach, selfLineId))
  }

  it('支线朝淡化侧接入 → 目标色随该侧淡化', () => {
    const ctx = setupJunction({ id: 50, pos: [500, 300] }, false)
    expect(resolveGradient(ctx)!.toColor).toBe(useColorProcStore().colorProcDownplay.convert('#0000ff'))
  })

  it('支线朝未淡化侧接入 → 目标色维持该侧颜色', () => {
    const ctx = setupJunction({ id: 60, pos: [100, 300] }, false)
    expect(resolveGradient(ctx)!.toColor).toBe('#0000ff')
  })

  it('垂直接入（无法判定方向）→ 非淡化优先兜底', () => {
    const ctx = setupJunction({ id: 70, pos: [300, 600] }, false)
    expect(resolveGradient(ctx)!.toColor).toBe('#0000ff')
  })

  it('垂直接入且两侧都淡化 → 取淡化色', () => {
    const ctx = setupJunction({ id: 70, pos: [300, 600] }, true)
    expect(resolveGradient(ctx)!.toColor).toBe(useColorProcStore().colorProcDownplay.convert('#0000ff'))
  })

  it('导出过滤：选中 span 未开通 → 目标色为背景色；预览仍为淡化色', () => {
    const ctx = setupJunction({ id: 50, pos: [500, 300] }, false)
    const colorProc = useColorProcStore()
    // 预览：淡化 span 仍渲染 → 淡化色
    expect(resolveGradient(ctx)!.toColor).toBe(colorProc.colorProcDownplay.convert('#0000ff'))
    // 导出：选中 span 被 filterNotOpened 过滤、不渲染 → 背景色
    useRenderOptionsStore().exporting = true
    expect(resolveGradient(ctx)!.toColor).toBe(useConfigStore().config.bgColor)
  })
})

describe('主色端跟随 parent 接点淡化（§8.6）', () => {
  // parent A：pt10[100,300] → pt20[300,300] → pt30[500,300]
  // span [10-20] 未开通（2029）淡化，span [20-30] 正常；支线首端接 parent 的交界 pt20，
  // 末端接 B（使 parent 端成为主色端）
  function setupMainEndJunction(branchOther: { id: number, pos: [number, number] }) {
    const p10 = createPoint(10); p10.pos = [100, 300]
    const p20 = createPoint(20); p20.pos = [300, 300]
    const p30 = createPoint(30); p30.pos = [500, 300]
    const px = createPoint(branchOther.id); px.pos = branchOther.pos
    const p99 = createPoint(99); p99.pos = [700, 300]
    const lineA = createLine([10, 20, 30], { color: '#ff0000' })
    const lineB = createLine([branchOther.id, 99], { color: '#0000ff' })
    const timeSlice = createTimeSlice({
      line: lineA.id, fromPt: 10, toPt: 20,
      time: { open: new Date('2029-01-01').getTime() }
    })
    const branch = createLine([20, branchOther.id], { color: '#ff0000', parent: lineA.id, gradient: {} })
    const save = createEmptySave({
      points: [p10, p20, p30, px, p99],
      lines: [lineA, lineB, branch],
      timeSlices: [timeSlice]
    })
    const saveStore = useSaveStore()
    saveStore.save = save
    const renderOptions = useRenderOptionsStore()
    renderOptions.exporting = false
    renderOptions.timeMoment = new Date('2026-01-01').getTime()
    renderOptions.timeConfig = { enabledPreview: true }
    const lineStateStore = useLineStateStore()
    const branchFormalPts: FormalPt[] = [
      { pos: [300, 300], afterIdxEqv: 0 },
      { pos: branchOther.pos, afterIdxEqv: 1 },
    ]
    return { lineA, branch, saveStore, lineStateStore, branchFormalPts }
  }

  function resolveGradient(ctx: ReturnType<typeof setupMainEndJunction>) {
    return resolveLineGradient(ctx.branch, ctx.branchFormalPts, ctx.saveStore.save?.lines,
      l => ctx.lineStateStore.getLineActualColor(l),
      (l, ptId, approach, selfLineId) => ctx.lineStateStore.getJunctionPtColor(l.id, ptId, approach, selfLineId))
  }

  it('主色端朝 parent 淡化侧伸出 → 主色随该侧淡化', () => {
    // 本体在右（pt40 [500,300]），驶向接点的延长线指向左（淡化的 [10-20] 侧）
    const ctx = setupMainEndJunction({ id: 40, pos: [500, 300] })
    const res = resolveGradient(ctx)!
    expect(res.fromColor).toBe(useColorProcStore().colorProcDownplay.convert('#ff0000'))
    // 目标端 = B（蓝色，无时间限制）不受影响
    expect(res.toColor).toBe('#0000ff')
  })

  it('主色端朝 parent 未淡化侧伸出 → 主色维持该侧颜色', () => {
    // 本体在左（pt40 [100,300]），驶向接点的延长线指向右（未淡化的 [20-30] 侧）
    const ctx = setupMainEndJunction({ id: 40, pos: [100, 300] })
    const res = resolveGradient(ctx)!
    expect(res.fromColor).toBe('#ff0000')
  })

  it('主色端垂直伸出 → 非淡化优先兜底', () => {
    const ctx = setupMainEndJunction({ id: 40, pos: [300, 600] })
    const res = resolveGradient(ctx)!
    expect(res.fromColor).toBe('#ff0000')
  })
})
