import { describe, it, expect, beforeEach } from 'vitest'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import { useConfigStore, turn45Ratio } from 'aarc-core/models/stores/configStore'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { LineType } from 'aarc-core/models/save'

describe('configStore - getTurnRadiusOf', () => {
  beforeEach(() => {
    createTestPinia()
  })

  it('90° inner 半径 = base + lineWidth*width/2', () => {
    const cs = useConfigStore()
    const line = { id: 1, pts: [], name: '', nameSub: '', color: '', type: LineType.common, width: 1 }
    const expected = cs.config.lineTurnAreaRadius + cs.config.lineWidth / 2
    expect(cs.getTurnRadiusOf(line, '90')).toBeCloseTo(expected)
  })

  it('90° middle 半径等于 base（无 justify 偏移）', () => {
    const cs = useConfigStore()
    const line = { id: 1, pts: [], name: '', nameSub: '', color: '', type: LineType.common, width: 1 }
    expect(cs.getTurnRadiusOf(line, '90', 'middle')).toBeCloseTo(cs.config.lineTurnAreaRadius)
  })

  it('45° 转角半径小于 90° 半径', () => {
    const cs = useConfigStore()
    const line = { id: 1, pts: [], name: '', nameSub: '', color: '', type: LineType.common, width: 1 }
    const r90 = cs.getTurnRadiusOf(line, '90')
    const r45 = cs.getTurnRadiusOf(line, '45')
    expect(r45).toBeLessThan(r90)
  })

  it('135° 转角半径大于 90° 半径', () => {
    const cs = useConfigStore()
    const line = { id: 1, pts: [], name: '', nameSub: '', color: '', type: LineType.common, width: 1 }
    const r90 = cs.getTurnRadiusOf(line, '90')
    const r135 = cs.getTurnRadiusOf(line, '135')
    expect(r135).toBeGreaterThan(r90)
  })

  it('平行转角返回与 90° 相同的基础半径', () => {
    const cs = useConfigStore()
    const line = { id: 1, pts: [], name: '', nameSub: '', color: '', type: LineType.common, width: 1 }
    expect(cs.getTurnRadiusOf(line, 'parallel')).toBeCloseTo(
      cs.getTurnRadiusOf(line, '90')
    )
  })

  it('普通线路随 width 倍率放大基础半径', () => {
    const cs = useConfigStore()
    const lineWidth2 = { id: 1, pts: [], name: '', nameSub: '', color: '', type: LineType.common, width: 2 }
    const lineWidth1 = { id: 2, pts: [], name: '', nameSub: '', color: '', type: LineType.common, width: 1 }
    expect(cs.getTurnRadiusOf(lineWidth2, '90', 'middle')).toBeCloseTo(
      cs.getTurnRadiusOf(lineWidth1, '90', 'middle') * 2
    )
  })

  it('地形线路的 base 不受 width 倍率影响，但 justifyBy 仍受影响', () => {
    const cs = useConfigStore()
    const terrainLine = { id: 1, pts: [], name: '', nameSub: '', color: '', type: LineType.terrain, width: 2 }
    // middle 模式下无 justifyBy，base 不变
    expect(cs.getTurnRadiusOf(terrainLine, '90', 'middle')).toBeCloseTo(cs.config.lineTurnAreaRadius)
  })

  it('传入 number 作为 width 倍率只影响 justifyBy，不影响 base', () => {
    const cs = useConfigStore()
    const r1 = cs.getTurnRadiusOf(1, '90', 'middle')
    const r2 = cs.getTurnRadiusOf(2, '90', 'middle')
    expect(r1).toBeCloseTo(r2)
    expect(r1).toBeCloseTo(cs.config.lineTurnAreaRadius)
  })

  it('不同 justify 模式产生预期大小关系', () => {
    const cs = useConfigStore()
    const line = { id: 1, pts: [], name: '', nameSub: '', color: '', type: LineType.common, width: 1 }
    const inner = cs.getTurnRadiusOf(line, '90', 'inner')
    const middle = cs.getTurnRadiusOf(line, '90', 'middle')
    const outer = cs.getTurnRadiusOf(line, '90', 'outer')

    expect(inner).toBeGreaterThan(middle)
    expect(middle).toBeGreaterThan(outer)
  })

  it('outer 模式下半径不会为负数', () => {
    const cs = useConfigStore()
    const line = { id: 1, pts: [], name: '', nameSub: '', color: '', type: LineType.common, width: 1 }
    expect(cs.getTurnRadiusOf(line, '135', 'outer')).toBeGreaterThanOrEqual(0)
  })

  it('非 45°/135° 的任意角度（以弧度传入）半径与 90° 保持一致', () => {
    const cs = useConfigStore()
    const line = { id: 1, pts: [], name: '', nameSub: '', color: '', type: LineType.common, width: 1 }
    const r90 = cs.getTurnRadiusOf(line, '90', 'middle')
    expect(cs.getTurnRadiusOf(line, Math.PI / 3, 'middle')).toBeCloseTo(r90)
    expect(cs.getTurnRadiusOf(line, (2 * Math.PI) / 3, 'middle')).toBeCloseTo(r90)
  })

  it('45° 和 135°（弧度传入）仍保持原有缩放行为', () => {
    const cs = useConfigStore()
    const line = { id: 1, pts: [], name: '', nameSub: '', color: '', type: LineType.common, width: 1 }
    const r90 = cs.getTurnRadiusOf(line, '90', 'middle')
    expect(cs.getTurnRadiusOf(line, Math.PI / 4, 'middle')).toBeCloseTo(r90 / turn45Ratio)
    expect(cs.getTurnRadiusOf(line, (3 * Math.PI) / 4, 'middle')).toBeCloseTo(r90 * turn45Ratio)
  })

  it('WayRel 45° 和 135° 仍保持原有缩放行为', () => {
    const cs = useConfigStore()
    const line = { id: 1, pts: [], name: '', nameSub: '', color: '', type: LineType.common, width: 1 }
    const r90 = cs.getTurnRadiusOf(line, '90', 'middle')
    expect(cs.getTurnRadiusOf(line, '45', 'middle')).toBeCloseTo(r90 / turn45Ratio)
    expect(cs.getTurnRadiusOf(line, '135', 'middle')).toBeCloseTo(r90 * turn45Ratio)
  })
})

describe('configStore - 文本标签倍率清洗', () => {
  beforeEach(() => {
    createTestPinia()
  })

  it('空串/NaN/负数/0 字号清洗为未设置，合法字符串值转为数字', () => {
    const cs = useConfigStore()
    cs.importConfig({
      textTagForLine: {
        fontSize: '',
        subFontSize: 0,
        padding: -1,
        width: NaN
      }
    } as any)
    expect(cs.config.textTagForLine.fontSize).toBeUndefined()
    expect(cs.config.textTagForLine.subFontSize).toBeUndefined()
    expect(cs.config.textTagForLine.padding).toBeUndefined()
    expect(cs.config.textTagForLine.width).toBeUndefined()

    cs.importConfig({ textTagForLine: { fontSize: '1.25' } } as any)
    expect(cs.config.textTagForLine.fontSize).toBe(1.25)
  })

  it('width 与 padding 的 0 是合法值，予以保留', () => {
    const cs = useConfigStore()
    cs.importConfig({ textTagForLine: { width: 0, padding: 0, fontSize: '0' } } as any)
    expect(cs.config.textTagForLine.width).toBe(0)
    expect(cs.config.textTagForLine.padding).toBe(0)
    expect(cs.config.textTagForLine.fontSize).toBeUndefined()
  })

  it('三组标签都会被清洗', () => {
    const cs = useConfigStore()
    cs.importConfig({
      textTagPlain: { fontSize: '' },
      textTagForLine: { subFontSize: '' },
      textTagForTerrain: { fontSize: 'x' }
    } as any)
    expect(cs.config.textTagPlain.fontSize).toBeUndefined()
    expect(cs.config.textTagForLine.subFontSize).toBeUndefined()
    expect(cs.config.textTagForTerrain.fontSize).toBeUndefined()
  })
})

describe('configStore - 拼音转换预设', () => {
  beforeEach(() => {
    createTestPinia()
  })

  function saveWithConfig(config: any) {
    return {
      idIncre: 1000,
      points: [],
      lines: [],
      textTags: [],
      cvsSize: [1000, 1000],
      meta: { textTagIconsVersion: 1 },
      config
    }
  }

  it('老存档没有 pinyinConvertPresets 键时补齐为空数组', () => {
    const saveStore = useSaveStore()
    const cs = useConfigStore()
    saveStore.save = saveWithConfig({ pinyinConvert: { caseType: 1 } }) as any
    cs.readConfigFromSave()
    expect(cs.config.pinyinConvertPresets).toEqual([])
    expect(cs.config.pinyinConvert.caseType).toBe(1)
  })

  it('读入时清洗非法项，并保证每项有可就地编辑的 convert 对象', () => {
    const saveStore = useSaveStore()
    const cs = useConfigStore()
    saveStore.save = saveWithConfig({
      pinyinConvertPresets: [
        { name: '粤语', convert: { variantType: 1 } },
        { convert: { caseType: 2 } },
        null,
        { name: '缺convert' }
      ]
    }) as any
    cs.readConfigFromSave()
    expect(cs.config.pinyinConvertPresets).toEqual([
      { name: '粤语', convert: { variantType: 1 } },
      { name: '缺convert', convert: {} }
    ])
  })

  it('非数组的 pinyinConvertPresets 回退为空数组', () => {
    const cs = useConfigStore()
    cs.importConfig({ pinyinConvertPresets: { name: '粤语' } } as any)
    expect(cs.config.pinyinConvertPresets).toEqual([])
  })

  it('importConfig 带入的预设数组不被裁掉', () => {
    const cs = useConfigStore()
    cs.importConfig({
      pinyinConvertPresets: [{ name: '粤语', convert: { variantType: 1 } }]
    } as any)
    expect(cs.config.pinyinConvertPresets).toHaveLength(1)
    expect(cs.config.pinyinConvertPresets[0].convert.variantType).toBe(1)
  })
})
