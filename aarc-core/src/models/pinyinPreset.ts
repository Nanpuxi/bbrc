import { PinyinConvertConfig, PinyinConvertPreset } from "./config";
import { ControlPoint, TextTag } from "./save";

/** 预设名称长度上限（超长在输入框 blur 时截断） */
export const PINYIN_PRESET_NAME_MAX = 10

interface PinyinPresetOwner{
    pinyinConvertPreset?:string|null
}

/**
 * 解析某个车站/标签应使用的拼音转换设置。
 * 返回 null 表示该项不参与转换；引用名失效（预设已删除、存档被手改）时回退到存档默认设置。
 */
export function resolvePinyinConvert(
    presetRef:string|null|undefined,
    presets:PinyinConvertPreset[],
    globalConfig:PinyinConvertConfig
):PinyinConvertConfig|null{
    if(presetRef === null)
        return null
    if(presetRef === undefined)
        return globalConfig
    return presets.find(p=>p.name === presetRef)?.convert ?? globalConfig
}

/** 返回 null 表示名称可用，否则为拒绝原因。self 为正在改名的那一项（按对象排除，而非按名字） */
export function validatePinyinPresetName(
    name:string,
    presets:PinyinConvertPreset[],
    self?:PinyinConvertPreset
):string|null{
    const trimmed = name.trim()
    if(!trimmed)
        return '预设名称不能为空'
    if(trimmed.length > PINYIN_PRESET_NAME_MAX)
        return `预设名称不能超过${PINYIN_PRESET_NAME_MAX}个字符`
    if(presets.some(p=>p !== self && p.name === trimmed))
        return `已存在同名预设“${trimmed}”`
    return null
}

function cascadeRef<T extends PinyinPresetOwner>(items:T[], from:string, to:string|null|undefined):number{
    let count = 0
    for(const item of items){
        if(item.pinyinConvertPreset === from){
            item.pinyinConvertPreset = to
            count++
        }
    }
    return count
}

/** 预设改名后同步所有引用处，返回改动的条目数 */
export function renamePinyinPresetRefs(
    points:ControlPoint[],
    tags:TextTag[],
    from:string,
    to:string
):number{
    return cascadeRef(points, from, to) + cascadeRef(tags, from, to)
}

/** 预设删除后清除所有引用（回到“跟随存档默认”），返回改动的条目数 */
export function clearPinyinPresetRefs(
    points:ControlPoint[],
    tags:TextTag[],
    from:string
):number{
    return cascadeRef(points, from, undefined) + cascadeRef(tags, from, undefined)
}

/** 生成不与现有预设重名的默认名称 */
export function nextPinyinPresetName(presets:PinyinConvertPreset[]):string{
    let i = 1
    while(presets.some(p=>p.name === `预设${i}`))
        i++
    return `预设${i}`
}
