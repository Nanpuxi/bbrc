import { describe, it, expect, beforeEach } from 'vitest'
import {
  PINYIN_PRESET_NAME_MAX,
  clearPinyinPresetRefs,
  nextPinyinPresetName,
  renamePinyinPresetRefs,
  resolvePinyinConvert,
  validatePinyinPresetName
} from 'aarc-core/models/pinyinPreset'
import { PinyinConvertConfig, PinyinConvertPreset } from 'aarc-core/models/config'
import { ControlPoint, ControlPointDir, ControlPointSta, TextTag } from 'aarc-core/models/save'
import { configDefault, useConfigStore } from 'aarc-core/models/stores/configStore'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { createTestPinia } from '../helpers/piniaTestHelper'

const globalCfg: PinyinConvertConfig = { caseType: 0, rules: '公园:Park' }
const presetA: PinyinConvertPreset = { name: '粤语', convert: { caseType: 1, variantType: 1 } }
const presetB: PinyinConvertPreset = { name: '小写', convert: { caseType: 2 } }
const presets = [presetA, presetB]

function pt(id: number, presetRef?: string | null): ControlPoint {
  return { id, pos: [0, 0], dir: ControlPointDir.vertical, sta: ControlPointSta.sta, name: `站${id}`, pinyinConvertPreset: presetRef }
}
function tag(id: number, presetRef?: string | null): TextTag {
  return { id, pos: [0, 0], text: `标签${id}`, pinyinConvertPreset: presetRef }
}

describe('resolvePinyinConvert', () => {
  it('null 表示不转换', () => {
    expect(resolvePinyinConvert(null, presets, globalCfg)).toBeNull()
  })
  it('undefined 使用存档默认设置', () => {
    expect(resolvePinyinConvert(undefined, presets, globalCfg)).toBe(globalCfg)
  })
  it('按名称取到预设的那一份独立设置', () => {
    expect(resolvePinyinConvert('粤语', presets, globalCfg)).toBe(presetA.convert)
    expect(resolvePinyinConvert('小写', presets, globalCfg)).toBe(presetB.convert)
  })
  it('引用名失效时回退到存档默认设置', () => {
    expect(resolvePinyinConvert('已被删除的预设', presets, globalCfg)).toBe(globalCfg)
  })
})

describe('validatePinyinPresetName', () => {
  it('空名（含纯空格）被拒绝', () => {
    expect(validatePinyinPresetName('', presets)).toBe('预设名称不能为空')
    expect(validatePinyinPresetName('   ', presets)).toBe('预设名称不能为空')
  })
  it('超过上限被拒绝', () => {
    const tooLong = '名'.repeat(PINYIN_PRESET_NAME_MAX + 1)
    expect(validatePinyinPresetName(tooLong, presets)).toBe(`预设名称不能超过${PINYIN_PRESET_NAME_MAX}个字符`)
  })
  it('重名被拒绝', () => {
    expect(validatePinyinPresetName('粤语', presets)).toBe('已存在同名预设“粤语”')
  })
  it('改名时按对象排除自身，不因“名字就是自己当前的名字”而误判重名', () => {
    expect(validatePinyinPresetName('粤语', presets, presetA)).toBeNull()
  })
  it('合法名称返回 null（前后空格在校验时被忽略）', () => {
    expect(validatePinyinPresetName(' 闽南语 ', presets)).toBeNull()
  })
})

describe('renamePinyinPresetRefs', () => {
  it('改动站名与标签的引用并返回条目数，非目标项不受影响', () => {
    const points = [pt(1, '粤语'), pt(2, '粤语'), pt(3, '小写'), pt(4), pt(5, null)]
    const tags = [tag(6, '粤语'), tag(7, '小写')]
    expect(renamePinyinPresetRefs(points, tags, '粤语', '广东话')).toBe(3)
    expect(points.map(p => p.pinyinConvertPreset)).toEqual(['广东话', '广东话', '小写', undefined, null])
    expect(tags.map(t => t.pinyinConvertPreset)).toEqual(['广东话', '小写'])
  })
})

describe('clearPinyinPresetRefs', () => {
  it('删除预设后引用回到“跟随存档默认”（undefined）', () => {
    const points = [pt(1, '粤语'), pt(2, '小写')]
    const tags = [tag(3, '粤语'), tag(4, null)]
    expect(clearPinyinPresetRefs(points, tags, '粤语')).toBe(2)
    expect(points.map(p => p.pinyinConvertPreset)).toEqual([undefined, '小写'])
    expect(tags.map(t => t.pinyinConvertPreset)).toEqual([undefined, null])
  })
})

describe('nextPinyinPresetName', () => {
  it('从预设1开始，并跳过已占用的名称', () => {
    expect(nextPinyinPresetName([])).toBe('预设1')
    expect(nextPinyinPresetName([{ name: '预设1', convert: {} }, { name: '预设2', convert: {} }])).toBe('预设3')
  })
})

describe('configDefault', () => {
  it('含空的 pinyinConvertPresets', () => {
    expect(Array.isArray(configDefault.pinyinConvertPresets)).toBe(true)
    expect(configDefault.pinyinConvertPresets).toHaveLength(0)
  })
})

describe('协作：远端存档应用后的预设解析', () => {
  beforeEach(() => {
    createTestPinia()
  })

  /** 模拟对端写入的存档快照（config 为对端 config.value，points/textTags 带预设引用） */
  function remoteSave(config: any, pointRefs: (string | null | undefined)[] = [], tagRefs: (string | null | undefined)[] = []): any {
    return {
      idIncre: 1000,
      points: pointRefs.map((ref, i) => ({ id: i + 1, pos: [0, 0], dir: 0, sta: 0, name: `站${i + 1}`, pinyinConvertPreset: ref })),
      lines: [],
      textTags: tagRefs.map((ref, i) => ({ id: 101 + i, pos: [0, 0], text: `标签${i + 1}`, pinyinConvertPreset: ref })),
      cvsSize: [1000, 1000],
      meta: { textTagIconsVersion: 1 },
      config
    }
  }

  it('对端存档的预设与引用完整应用：解析到预设自己的那份设置', () => {
    const saveStore = useSaveStore()
    const cs = useConfigStore()
    saveStore.save = remoteSave(
      { pinyinConvert: { caseType: 0 }, pinyinConvertPresets: [{ name: '粤语', convert: { variantType: 1 } }] },
      ['粤语', undefined, null], ['粤语']) as any
    cs.readConfigFromSave()
    const presets = cs.config.pinyinConvertPresets
    expect(resolvePinyinConvert(saveStore.save!.points[0].pinyinConvertPreset, presets, cs.config.pinyinConvert)).toEqual({ variantType: 1 })
    expect(resolvePinyinConvert(saveStore.save!.points[1].pinyinConvertPreset, presets, cs.config.pinyinConvert)).toBe(cs.config.pinyinConvert)
    expect(resolvePinyinConvert(saveStore.save!.points[2].pinyinConvertPreset, presets, cs.config.pinyinConvert)).toBeNull()
    expect(resolvePinyinConvert(saveStore.save!.textTags[0].pinyinConvertPreset, presets, cs.config.pinyinConvert)).toEqual({ variantType: 1 })
  })

  it('对端引用在本地配置中不存在（悬空引用）时回退存档默认，不报错', () => {
    const saveStore = useSaveStore()
    const cs = useConfigStore()
    saveStore.save = remoteSave(
      { pinyinConvert: { caseType: 1 }, pinyinConvertPresets: [] },
      ['对端已删除的预设'], []) as any
    cs.readConfigFromSave()
    expect(resolvePinyinConvert(saveStore.save!.points[0].pinyinConvertPreset, cs.config.pinyinConvertPresets, cs.config.pinyinConvert))
      .toBe(cs.config.pinyinConvert)
  })

  it('旧版客户端存档（无 pinyinConvertPresets 键）应用后补齐为空数组，引用回退默认', () => {
    const saveStore = useSaveStore()
    const cs = useConfigStore()
    saveStore.save = remoteSave(
      { pinyinConvert: { caseType: 2 } },
      ['旧版客户端不可能有的引用'], []) as any
    cs.readConfigFromSave()
    expect(cs.config.pinyinConvertPresets).toEqual([])
    expect(resolvePinyinConvert(saveStore.save!.points[0].pinyinConvertPreset, cs.config.pinyinConvertPresets, cs.config.pinyinConvert))
      .toBe(cs.config.pinyinConvert)
  })

  it('快照往返无损：应用对端存档→写回→再读回，预设与引用保持原样', () => {
    const saveStore = useSaveStore()
    const cs = useConfigStore()
    saveStore.save = remoteSave(
      { pinyinConvert: { caseType: 0 }, pinyinConvertPresets: [{ name: '粤语', convert: { variantType: 1 } }, { name: '小写', convert: { caseType: 2 } }] },
      ['粤语', '小写'], [null]) as any
    cs.readConfigFromSave()
    cs.writeConfigToSave()
    // 对端拿到这份快照再应用一次
    cs.readConfigFromSave()
    expect(cs.config.pinyinConvertPresets.map(p => p.name)).toEqual(['粤语', '小写'])
    expect(cs.config.pinyinConvertPresets[0].convert).toEqual({ variantType: 1 })
    expect(saveStore.save!.points.map(p => p.pinyinConvertPreset)).toEqual(['粤语', '小写'])
    expect(saveStore.save!.textTags.map(t => t.pinyinConvertPreset)).toEqual([null])
  })
})
