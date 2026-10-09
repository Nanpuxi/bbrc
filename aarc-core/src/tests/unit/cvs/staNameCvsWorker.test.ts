import { describe, it, expect, beforeEach } from 'vitest'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useStaNameCvsWorker } from 'aarc-core/models/cvs/workers/staNameCvsWorker'
import { useStaNameRectStore, useStaNameMainRectStore } from 'aarc-core/models/stores/saveDerived/staNameRectStore'
import { useOnDetectStore } from 'aarc-core/models/stores/saveDerived/saveDerivedDerived/onDetectStore'
import { CvsBlock, CvsContext } from 'aarc-core/models/cvs/common/cvsContext'
import { resetIdCounter, createPoint, createLine, createEmptySave } from '../../helpers/saveFactory'

// 模拟 ctx2d：measureText 返回固定规则（每字符宽 10），绘制调用全部为空操作
function createMockCtx() {
  const ctx2d = {
    canvas: {},
    measureText(text: string) {
      return { width: text.length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 4 }
    },
    fillText() {}, strokeText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    arc() {}, fill() {}, save() {}, restore() {}, translate() {}, rotate() {},
  }
  // scale=1, offset=0，逻辑坐标与设备坐标一致
  return new CvsContext(new CvsBlock(1, 0, 0, ctx2d as any))
}

describe('staNameCvsWorker - 空站名的包围盒处理', () => {
  beforeEach(() => {
    resetIdCounter()
    createTestPinia()
  })

  function setupPtWithName(name: string, nameS?: string) {
    const pt = createPoint(10, name)
    pt.nameS = nameS
    pt.nameP = [20, -10]
    pt.nameSize = 1
    pt.nameSSize = 1
    useSaveStore().save = createEmptySave({ points: [pt], lines: [createLine([10])] })
    return pt
  }

  it('站名置空后重新渲染应清除包围盒，且不再被命中', () => {
    const pt = setupPtWithName('车站A')
    const worker = useStaNameCvsWorker()
    const rectStore = useStaNameRectStore()
    const mainRectStore = useStaNameMainRectStore()
    const ctx = createMockCtx()

    worker.renderPtName(ctx, pt, true, undefined, true)
    expect(rectStore.getStaNameRect(10)).toBeDefined()

    // 站名清空（含纯空白）后：drawText 返回 undefined，worker 应清除缓存的包围盒，
    // 否则旧矩形或历史写入的退化四边形（±Infinity/NaN）仍参与命中检测
    pt.name = '  '
    worker.renderPtName(ctx, pt, true, undefined, true)
    expect(rectStore.getStaNameRect(10)).toBeUndefined()
    expect(mainRectStore.getStaNameMainRect(10)).toBeUndefined()

    const detect = useOnDetectStore()
    expect(detect.onStaName([120, 90])).toBeUndefined()
    expect(detect.onStaName([500, 500])).toBeUndefined()
  })

  it('needReportRect=false 的渲染不清除已登记的包围盒', () => {
    const pt = setupPtWithName('车站A')
    const worker = useStaNameCvsWorker()
    const rectStore = useStaNameRectStore()
    const ctx = createMockCtx()

    worker.renderPtName(ctx, pt, true, undefined, true)
    expect(rectStore.getStaNameRect(10)).toBeDefined()

    pt.name = ''
    worker.renderPtName(ctx, pt, false, undefined, true)
    expect(rectStore.getStaNameRect(10)).toBeDefined()
  })

  it('主站名为空但副站名非空时仍登记包围盒', () => {
    const pt = setupPtWithName('', '副站名')
    const worker = useStaNameCvsWorker()
    const rectStore = useStaNameRectStore()
    const ctx = createMockCtx()

    worker.renderPtName(ctx, pt, true, undefined, true)
    expect(rectStore.getStaNameRect(10)).toBeDefined()
  })
})
