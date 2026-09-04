import { Save, SelectionGroup } from "aarc-core/models/save"

export function ensureValidSelectionGroups(save: Partial<Save>) {
    if(save.selectionGroups === undefined)
        return
    if(!(save.selectionGroups instanceof Array)){
        console.warn('[规范化]selectionGroups不是数组，已丢弃')
        delete save.selectionGroups
        return
    }
    const existingPtIds = new Set(save.points?.map(p=>p.id) ?? [])
    const existingTagIds = new Set(save.textTags?.map(t=>t.id) ?? [])
    const beforeCount = save.selectionGroups.length
    const validGroups: SelectionGroup[] = []
    for(const g of save.selectionGroups){
        if(!g || typeof g !== 'object')
            continue
        const group = g as Partial<SelectionGroup>
        if(typeof group.id !== 'number')
            continue
        const ptIds = [...new Set(
            (group.ptIds instanceof Array ? group.ptIds : [])
                .filter(id=>existingPtIds.has(id))
        )]
        const tagIds = [...new Set(
            (group.tagIds instanceof Array ? group.tagIds : [])
                .filter(id=>existingTagIds.has(id))
        )]
        if(ptIds.length === 0 && tagIds.length === 0)
            continue
        const valid: SelectionGroup = { id: group.id, ptIds, tagIds }
        if(typeof group.name === 'string')
            valid.name = group.name
        validGroups.push(valid)
    }
    save.selectionGroups = validGroups
    const afterCount = validGroups.length
    if(afterCount < beforeCount){
        console.warn(`[规范化]已移除${beforeCount - afterCount}个异常选区组`)
    }
}
