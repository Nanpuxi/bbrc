import { describe, it, expect } from 'vitest'
import { upgradeConfig, initFreshNewConfig, freshNewConfigVersion } from 'aarc-core/models/save/upgrade/config'
import { upgradeLineStyles, initFreshNewLineStyles } from 'aarc-core/models/save/upgrade/lineStyles'
import { upgradePatterns, initFreshNewPatterns } from 'aarc-core/models/save/upgrade/patterns'
import { upgradeTextTagIcons } from 'aarc-core/models/save/upgrade/textTagIcons'
import { initFreshNewTextTags } from 'aarc-core/models/save/upgrade/textTags'
import { Save } from 'aarc-core/models/save'

function makeMinimalSave(): Save {
  return {
    idIncre: 1,
    points: [],
    lines: [],
    cvsSize: [1000, 1000],
    textTags: [],
    config: {} as any,
    meta: {}
  }
}

describe('upgradeConfig', () => {
  it('ver<1 时应逐级升级到最新版本', () => {
    const save = makeMinimalSave()
    save.config = {} as any
    upgradeConfig(save)
    expect(save.config.configVersion).toBe(freshNewConfigVersion)
    expect(save.config.textTagForLine).toBeDefined()
    expect(save.config.textTagForLine!.anchorX).toBe(1)
    expect(save.config.textTagForLine!.textAlign).toBe(0)
    expect(save.config.pinyinConvert!.spaceBetweenMixed).toBe(true)
  })

  it('ver<2 时应回填 spaceBetweenMixed（含预设，已有值不覆盖）', () => {
    const save = makeMinimalSave()
    save.config = {
      configVersion: 1,
      pinyinConvert: {},
      pinyinConvertPresets: [
        { name: 'a', convert: {} },
        { name: 'b', convert: { spaceBetweenMixed: false } }
      ]
    } as any
    upgradeConfig(save)
    expect(save.config.configVersion).toBe(freshNewConfigVersion)
    expect(save.config.pinyinConvert!.spaceBetweenMixed).toBe(true)
    expect(save.config.pinyinConvertPresets![0].convert.spaceBetweenMixed).toBe(true)
    expect(save.config.pinyinConvertPresets![1].convert.spaceBetweenMixed).toBe(false)
  })

  it('ver>=最新版本时不应修改配置', () => {
    const save = makeMinimalSave()
    save.config = { configVersion: freshNewConfigVersion, textTagForLine: { anchorX: 0, textAlign: 1 } } as any
    upgradeConfig(save)
    expect(save.config.textTagForLine!.anchorX).toBe(0)
    expect(save.config.textTagForLine!.textAlign).toBe(1)
  })

  it('ver<3 时应将 removeCarpet 迁移为 carpet 并回填全局配置默认值', () => {
    const save = makeMinimalSave()
    save.config = { configVersion: 2 } as any
    save.lines = [
      { id: 1, name: '', nameSub: '', color: '', type: 0, removeCarpet: true },
      { id: 2, name: '', nameSub: '', color: '', type: 0 },
      { id: 3, name: '', nameSub: '', color: '', type: 0, removeCarpet: false }
    ] as any
    save.textTags = [
      { id: 1, pos: [0, 0], removeCarpet: true },
      { id: 2, pos: [0, 0] }
    ] as any
    upgradeConfig(save)
    expect(save.config.configVersion).toBe(freshNewConfigVersion)
    expect(save.config.lineCarpet).toBe(true)
    expect(save.config.textTagCarpet).toBe(true)
    expect(save.lines[0].carpet).toBe(false)
    expect('removeCarpet' in save.lines[0]).toBe(false)
    expect(save.lines[1].carpet).toBeUndefined()
    expect(save.lines[2].carpet).toBeUndefined()
    expect(save.textTags[0].carpet).toBe(false)
    expect(save.textTags[1].carpet).toBeUndefined()
  })

  it('ver<3 且全局配置已有值时不应覆盖', () => {
    const save = makeMinimalSave()
    save.config = { configVersion: 2, lineCarpet: false, textTagCarpet: false } as any
    upgradeConfig(save)
    expect(save.config.lineCarpet).toBe(false)
    expect(save.config.textTagCarpet).toBe(false)
  })

  it('ver>=最新版本时不应迁移 removeCarpet', () => {
    const save = makeMinimalSave()
    save.config = { configVersion: freshNewConfigVersion } as any
    save.lines = [{ id: 1, name: '', nameSub: '', color: '', type: 0, removeCarpet: true }] as any
    upgradeConfig(save)
    expect((save.lines[0] as any).carpet).toBeUndefined()
    expect((save.lines[0] as any).removeCarpet).toBe(true)
  })
})

describe('initFreshNewConfig', () => {
  it('应设置 configVersion 和 edgeAnchorOutsidePadding', () => {
    const save = makeMinimalSave()
    save.config = {} as any
    initFreshNewConfig(save)
    expect(save.config.configVersion).toBe(freshNewConfigVersion)
    expect(save.config.textTagForLine).toBeDefined()
    expect(save.config.textTagForLine!.edgeAnchorOutsidePadding).toBe(true)
    expect(save.config.pinyinConvert!.spaceBetweenMixed).toBe(true)
  })
})

describe('upgradeLineStyles', () => {
  it('ver<1 时应将 dashCap 重命名为 cap', () => {
    const save = makeMinimalSave()
    save.lineStyles = [
      {
        id: 1, name: 'test', layers: [
          { color: '#fff', dashCap: 'round' as any },
          { color: '#000' }
        ]
      }
    ] as any
    save.meta.lineStylesVersion = 0
    upgradeLineStyles(save, () => save.idIncre++)
    expect(save.meta.lineStylesVersion).toBe(1)
    expect(save.lineStyles![0].layers[0].cap).toBe('round')
    expect('dashCap' in save.lineStyles![0].layers[0]).toBe(false)
    expect(save.lineStyles![0].layers[1].cap).toBeUndefined()
  })

  it('ver>=1 时不应修改 lineStyles', () => {
    const save = makeMinimalSave()
    save.lineStyles = [{ id: 1, name: 'test', layers: [{ cap: 'butt' }] }] as any
    save.meta.lineStylesVersion = 1
    upgradeLineStyles(save, () => save.idIncre++)
    expect(save.lineStyles![0].layers[0].cap).toBe('butt')
  })

  it('lineStyles 为 undefined 且 ver<1 时应初始化为空数组', () => {
    const save = makeMinimalSave()
    save.meta.lineStylesVersion = 0
    upgradeLineStyles(save, () => save.idIncre++)
    expect(save.lineStyles).toEqual([])
    expect(save.meta.lineStylesVersion).toBe(1)
  })
})

describe('initFreshNewLineStyles', () => {
  it('应添加默认线路样式', () => {
    const save = makeMinimalSave()
    initFreshNewLineStyles(save, () => save.idIncre++)
    expect(save.lineStyles!.length).toBe(2)
    expect(save.lineStyles![0].name).toBe('快线')
    expect(save.lineStyles![1].name).toBe('铁路')
    expect(save.lineStyles![1].layers[0].dash).toBe('4 4')
  })
})

describe('upgradePatterns', () => {
  it('ver<1 时预留逻辑不应报错', () => {
    const save = makeMinimalSave()
    save.patterns = []
    save.meta.patternsVersion = 0
    upgradePatterns(save, () => save.idIncre++)
    expect(save.patterns).toEqual([])
  })
})

describe('initFreshNewPatterns', () => {
  it('应添加默认 pattern', () => {
    const save = makeMinimalSave()
    initFreshNewPatterns(save, () => save.idIncre++)
    expect(save.patterns!.length).toBe(1)
    expect(save.patterns![0].name).toBe('网格')
    expect(save.patterns![0].grid!.rise45).toBe(true)
  })
})

describe('upgradeTextTagIcons', () => {
  it('ver<1 时应添加默认图标', () => {
    const save = makeMinimalSave()
    save.textTagIcons = []
    save.meta.textTagIconsVersion = 0
    upgradeTextTagIcons(save, () => save.idIncre++)
    expect(save.meta.textTagIconsVersion).toBe(1)
    expect(save.textTagIcons.length).toBe(2)
    expect(save.textTagIcons[0].name).toBe('a-机场')
    expect(save.textTagIcons[1].name).toBe('a-火车')
  })

  it('ver>=1 时不应重复添加图标', () => {
    const save = makeMinimalSave()
    save.textTagIcons = [{ id: 1, name: 'existing' }]
    save.meta.textTagIconsVersion = 1
    upgradeTextTagIcons(save, () => save.idIncre++)
    expect(save.textTagIcons.length).toBe(1)
  })
})

describe('initFreshNewTextTags', () => {
  it('应添加新手引导文本标签', () => {
    const save = makeMinimalSave()
    initFreshNewTextTags(save, () => save.idIncre++)
    expect(save.textTags.length).toBe(1)
    expect(save.textTags[0].text).toContain('线路')
    expect(save.textTags[0].anchorY).toBe(1)
  })
})
