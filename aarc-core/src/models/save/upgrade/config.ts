import { ConfigInSave } from "aarc-core/models/config"
import { Save } from "aarc-core/models/save"

export const freshNewConfigVersion = 3
export function initFreshNewConfig(save:Save){
    save.config.configVersion = freshNewConfigVersion
    save.config.textTagForLine ??= {}
    save.config.textTagForLine.edgeAnchorOutsidePadding = true
    save.config.pinyinConvert ??= {}
    save.config.pinyinConvert.spaceBetweenMixed = true
    console.log('[初始化]配置')
}
export function upgradeConfig(save:Save) {
    const ver = save.config.configVersion ?? 0
    if(ver < 1) {
        save.config.configVersion = 1
        upgradeTo1(save.config)
        console.log('[升级]配置:1')
    }
    if(ver < 2) {
        save.config.configVersion = 2
        upgradeTo2(save.config)
        console.log('[升级]配置:2')
    }
    if(ver < 3) {
        save.config.configVersion = 3
        upgradeTo3(save)
        console.log('[升级]配置:3')
    }
}

function upgradeTo1(sc: ConfigInSave){
    // 旧版中，默认线路名标签为“文本居中”且“锚点在左侧”
    // 为了确保一致性，若对象的configVersion较旧，将上述两个属性设为旧版的值
    if (!sc.textTagForLine) {
        sc.textTagForLine = {}
    }
    sc.textTagForLine.anchorX = 1
    sc.textTagForLine.textAlign = 0
}

function upgradeTo2(sc: ConfigInSave){
    // 新增“中英空格”配置：旧存档缺省时回填 true（与既往行为一致），包括预设
    sc.pinyinConvert ??= {}
    sc.pinyinConvert.spaceBetweenMixed ??= true
    if(Array.isArray(sc.pinyinConvertPresets)){
        for(const p of sc.pinyinConvertPresets){
            if(p && typeof p === 'object'){
                p.convert ??= {}
                p.convert.spaceBetweenMixed ??= true
            }
        }
    }
}

function upgradeTo3(save: Save){
    // removeCarpet 更名为 carpet，语义反转且支持跟随全局配置：
    // 仅 removeCarpet=true 转为 carpet=false（旧行为即去除白边）；
    // 缺失或为 false 的一律转为 undefined，跟随全局配置（此时全局默认已回填为 true，行为不变）
    const rc = save.config
    rc.lineCarpet ??= true
    rc.textTagCarpet ??= true
    for(const line of save.lines){
        if(!line || typeof line !== 'object')
            continue
        const legacy = (line as { removeCarpet?: boolean }).removeCarpet
        line.carpet = legacy ? false : undefined
        delete (line as { removeCarpet?: boolean }).removeCarpet
    }
    for(const tag of save.textTags){
        if(!tag || typeof tag !== 'object')
            continue
        const legacy = (tag as { removeCarpet?: boolean }).removeCarpet
        tag.carpet = legacy ? false : undefined
        delete (tag as { removeCarpet?: boolean }).removeCarpet
    }
}