import { Id, KeyedArrDiff, SaveDiff } from "aarc-core/models/save/saveDiff";
import { ControlPointSta, Save } from "aarc-core/models/save";

/**
 * 把一条协作 op（SaveDiff）概括成一句中文，供协作面板的事件日志展示。
 *
 * 只做"大致描述"：按 diff 的顶层 key 逐个生成片段、用 `、` 连接，
 * 任何识别不了的结构都退化为兜底文本，绝不抛异常（调用点在远程 op 的数据应用路径上）。
 *
 * `$rm`/`$upd` 的名称必须在 diff **应用之前**查（应用后目标已删除/已改名），
 * 因此调用方传入应用前的存档；`$add` 的名称直接取自 diff 元素本体。
 */

const FALLBACK = '进行了编辑'
/** 名称引用过长时截断（日志单行展示） */
const NAME_MAX_LEN = 12

/** keyed 数组的顶层 key → 类型名（points 按 sta 细分为车站/控制点） */
const KEYED_LABEL: Record<string, string> = {
    points: '点',
    lines: '线路',
    textTags: '文本标签',
    lineStyles: '线路样式',
    lineGroups: '线路分组',
    styleSlices: '样式片段',
    timeSlices: '时间片段',
    textTagIcons: '图标',
    patterns: '纹理',
    dataSources: '数据源',
    selectionGroups: '选区组',
}

/** keyed 数组元素上用于引用名称的字段（无此字段或取不到值时退化为数量描述） */
const NAME_FIELD: Record<string, string> = {
    points: 'name',
    lines: 'name',
    textTags: 'text',
    lineStyles: 'name',
    lineGroups: 'name',
    textTagIcons: 'name',
    patterns: 'name',
    dataSources: 'name',
    selectionGroups: 'name',
}

/** 整组 `$set` 替换的 key（元素无 id 的数组、标量对象） */
const SET_LABEL: Record<string, string> = {
    pointLinks: '修改了点间连线',
    cvsSize: '调整了画布尺寸',
}

/** 递归对象（普通对象 diff）的 key */
const OBJECT_LABEL: Record<string, string> = {
    config: '修改了全局配置',
    meta: '修改了存档设置',
}

/**
 * save = 应用该 diff **之前**的存档（用于查 `$rm`/`$upd` 目标的名称），可能为 null。
 * 全部片段都被忽略（例如只剩 idIncre）时返回兜底文本。
 */
export function summarizeSaveDiff(diff: SaveDiff, save: Save | null | undefined): string {
    if (!isPlainObj(diff))
        return FALLBACK
    const parts: string[] = []
    for (const key of Object.keys(diff)) {
        if (key === 'idIncre')
            continue   // 自增计数器：任何元素创建都会变动，是每个 diff 的固定噪音
        const node = diff[key]
        if (!isPlainObj(node)) {
            parts.push(FALLBACK)
        } else if (isKeyedArrDiff(node)) {
            parts.push(...summarizeKeyed(key, node as KeyedArrDiff, save))
        } else if ('$set' in node) {
            parts.push(SET_LABEL[key] ?? FALLBACK)
        } else if ('$del' in node) {
            parts.push(FALLBACK)
        } else {
            parts.push(OBJECT_LABEL[key] ?? FALLBACK)
        }
    }
    const uniq = [...new Set(parts)]
    return uniq.length > 0 ? uniq.join('、') : FALLBACK
}

function summarizeKeyed(key: string, node: KeyedArrDiff, save: Save | null | undefined): string[] {
    const label = KEYED_LABEL[key]
    if (label === undefined)
        return [FALLBACK]
    const rawArr = (save as unknown as Record<string, unknown> | null)?.[key]
    const arr = Array.isArray(rawArr) ? rawArr as Record<string, unknown>[] : null

    const added = (node.$add ?? []).map(el => isPlainObj(el) ? el : null)
    const removed = (node.$rm ?? []).map(id => findItem(arr, id))
    const updated = (node.$upd ?? []).map(upd => findItem(arr, upd?.id))

    const res: string[] = []
    res.push(...describeGroup(key, '新增了', added))
    res.push(...describeGroup(key, '删除了', removed))
    res.push(...describeGroup(key, '修改了', updated))
    // 纯重排才单独成句；与增删改同时出现时增删改片段已足以说明这次编辑
    if (res.length === 0 && (node.$seq?.length ?? 0) > 0)
        res.push(`调整了${key === 'points' ? '点' : label}的顺序`)
    return res.length > 0 ? res : [FALLBACK]
}

/** 按类型名（points 细分车站/控制点）分组，逐组生成"动词 + 名称或数量 + 类型名" */
function describeGroup(key: string, verb: string, items: (Record<string, unknown> | null)[]): string[] {
    const groups = new Map<string, (Record<string, unknown> | null)[]>()
    for (const item of items) {
        const label = labelOf(key, item)
        const g = groups.get(label)
        if (g)
            g.push(item)
        else
            groups.set(label, [item])
    }
    const res: string[] = []
    for (const [label, group] of groups) {
        const name = group.length === 1 ? nameOf(key, group[0]) : null
        res.push(name !== null ? `${verb}${label}「${name}」` : `${verb} ${group.length} 个${label}`)
    }
    return res
}

function labelOf(key: string, item: Record<string, unknown> | null): string {
    if (key === 'points') {
        if (item?.sta === ControlPointSta.sta)
            return '车站'
        return item?.sta === ControlPointSta.plain ? '控制点' : '点'
    }
    return KEYED_LABEL[key]
}

function nameOf(key: string, item: Record<string, unknown> | null): string | null {
    const field = NAME_FIELD[key]
    if (!field || !item)
        return null
    const raw = item[field]
    if (typeof raw !== 'string')
        return null
    const name = raw.trim()
    if (name === '')
        return null
    return name.length > NAME_MAX_LEN ? `${name.slice(0, NAME_MAX_LEN)}…` : name
}

function findItem(arr: Record<string, unknown>[] | null, id: Id | undefined): Record<string, unknown> | null {
    if (!arr || (typeof id !== 'number' && typeof id !== 'string'))
        return null
    return arr.find(el => el?.id === id) ?? null
}

function isKeyedArrDiff(node: Record<string, unknown>): boolean {
    return '$add' in node || '$rm' in node || '$upd' in node || '$seq' in node
}

function isPlainObj(x: unknown): x is Record<string, unknown> {
    return !!x && typeof x === 'object' && !Array.isArray(x)
}
