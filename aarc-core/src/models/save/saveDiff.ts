import rfdc from "rfdc";

/**
 * 协作 patch（SaveDiff）的生成与应用。
 *
 * 格式为自定义的“应用导向”格式，不对齐后端 AARC.Diff：
 * 协作 op 对服务器完全透传（见 docs/multiplayer/backend-plan.md §3），
 * 应用侧只需要新值，因此不记录旧值，也不区分长/短数组。
 *
 * 格式（顶层与嵌套普通对象均为 { 属性名: PropDiff }）：
 * - { $set: value }   原子替换/新增属性（标量、非 keyed 数组、其它一切）
 * - { $del: true }    删除属性（值为 undefined 视为不存在；JSON 传输下 undefined 会丢失，必须显式表达删除）
 * - keyed 数组（全部元素为带唯一 id 的对象）：{ $add?: 完整元素[], $rm?: id[], $upd?: 按 id 更新[], $seq?: 新的完整 id 顺序 }
 *   - $upd 条目：{ id, ...变化属性的新值, $del?: 被删除的属性名[] }
 *   - $seq 仅在“删除+追加后仍无法得到目标顺序”时输出（纯尾部追加不产生 $seq）
 * - 普通对象：递归的子 diff
 *
 * keyed 判定是自动的（无配置表）：数组非空、元素均为含唯一 number/string id 的普通对象。
 * 任一侧不满足（含空数组、重复 id）则回退为原子 $set 整体替换。
 */

const clone = rfdc()

export type Id = number | string

export type SaveDiff = Record<string, PropDiff>

export type PropDiff = DiffSet | DiffDel | KeyedArrDiff | NestedDiff

export interface NestedDiff { [key: string]: PropDiff }

export interface DiffSet { $set: unknown }
export interface DiffDel { $del: true }

export interface KeyedArrDiff {
    $add?: object[]
    $rm?: Id[]
    $upd?: KeyedItemUpd[]
    $seq?: Id[]
}

export interface KeyedItemUpd {
    id: Id
    $del?: string[]
    [prop: string]: unknown
}

/** 生成 prev → next 的 diff；无变化时返回 null（调用方不应发送） */
export function diffSave(prev: object, next: object): SaveDiff | null {
    const diff: SaveDiff = {}
    let changed = false
    const p = prev as Record<string, unknown>
    const n = next as Record<string, unknown>
    const keys = new Set([...Object.keys(p), ...Object.keys(n)])
    for (const key of keys) {
        const oldV = p[key]
        const newV = n[key]
        if (oldV === undefined && newV === undefined)
            continue
        if (newV === undefined) {
            diff[key] = { $del: true }
            changed = true
            continue
        }
        if (oldV === undefined) {
            diff[key] = { $set: clone(newV) }
            changed = true
            continue
        }
        const node = diffProp(oldV, newV)
        if (node !== null) {
            diff[key] = node
            changed = true
        }
    }
    return changed ? diff : null
}

/** 把 diff 原地应用到 save 上（保持已有元素的对象引用，供 activePt/selected 等本地引用存活） */
export function applySaveDiff(save: object, diff: SaveDiff): void {
    applyInto(save as Record<string, unknown>, diff)
}

function diffProp(oldV: unknown, newV: unknown): PropDiff | null {
    if (Array.isArray(oldV) && Array.isArray(newV)) {
        const oldIds = keyedIds(oldV)
        const newIds = keyedIds(newV)
        if (oldIds && newIds)
            return diffKeyedArr(oldV, oldIds, newV, newIds)
    } else if (isPlainObj(oldV) && isPlainObj(newV)) {
        return diffSave(oldV, newV)
    }
    return deepEqual(oldV, newV) ? null : { $set: clone(newV) }
}

function diffKeyedArr(oldArr: unknown[], oldIds: Id[], newArr: unknown[], newIds: Id[]): KeyedArrDiff | null {
    const oldMap = new Map<Id, Record<string, unknown>>()
    oldArr.forEach((el, i) => oldMap.set(oldIds[i], el as Record<string, unknown>))
    const newMap = new Map<Id, Record<string, unknown>>()
    newArr.forEach((el, i) => newMap.set(newIds[i], el as Record<string, unknown>))
    const res: KeyedArrDiff = {}
    let changed = false

    const adds: Record<string, unknown>[] = []
    for (const [id, item] of newMap) {
        if (!oldMap.has(id))
            adds.push(clone(item))
    }
    if (adds.length > 0) {
        res.$add = adds
        changed = true
    }

    const rms: Id[] = []
    for (const id of oldMap.keys()) {
        if (!newMap.has(id))
            rms.push(id)
    }
    if (rms.length > 0) {
        res.$rm = rms
        changed = true
    }

    const upds: KeyedItemUpd[] = []
    for (const [id, newItem] of newMap) {
        const oldItem = oldMap.get(id)
        if (!oldItem)
            continue
        const upd = diffKeyedItem(id, oldItem, newItem)
        if (upd)
            upds.push(upd)
    }
    if (upds.length > 0) {
        res.$upd = upds
        changed = true
    }

    // 与 apply 的处理顺序对齐（先 $rm、再 $add 追加、最后 $seq 排序）：
    // “删除+尾部追加”后即已达成目标顺序时无需 $seq
    const expected = [...oldIds.filter(id => newMap.has(id)), ...newIds.filter(id => !oldMap.has(id))]
    if (!idsEqual(expected, newIds)) {
        res.$seq = [...newIds]
        changed = true
    }

    return changed ? res : null
}

function diffKeyedItem(id: Id, oldItem: Record<string, unknown>, newItem: Record<string, unknown>): KeyedItemUpd | null {
    const upd: KeyedItemUpd = { id }
    let changed = false
    const delProps: string[] = []
    const keys = new Set([...Object.keys(oldItem), ...Object.keys(newItem)])
    for (const key of keys) {
        if (key === 'id')
            continue
        const ov = oldItem[key]
        const nv = newItem[key]
        if (nv === undefined) {
            if (ov !== undefined) {
                delProps.push(key)
                changed = true
            }
            continue
        }
        if (!deepEqual(ov, nv)) {
            upd[key] = clone(nv)
            changed = true
        }
    }
    if (delProps.length > 0)
        upd.$del = delProps
    return changed ? upd : null
}

function applyInto(target: Record<string, unknown>, diff: SaveDiff): void {
    for (const key of Object.keys(diff)) {
        const node = diff[key] as Record<string, unknown>
        if (!node || typeof node !== 'object')
            continue
        if ('$set' in node) {
            target[key] = clone(node.$set)
        } else if ('$del' in node) {
            delete target[key]
        } else if ('$add' in node || '$rm' in node || '$upd' in node || '$seq' in node) {
            applyKeyedArr(target, key, node as unknown as KeyedArrDiff)
        } else {
            if (!isPlainObj(target[key]))
                target[key] = {}
            applyInto(target[key] as Record<string, unknown>, node as SaveDiff)
        }
    }
}

function applyKeyedArr(target: Record<string, unknown>, key: string, node: KeyedArrDiff): void {
    if (!Array.isArray(target[key]))
        target[key] = []
    const arr = target[key] as Record<string, unknown>[]

    if (node.$rm && node.$rm.length > 0) {
        const rm = new Set<Id>(node.$rm)
        replaceArrContents(arr, arr.filter(el => !rm.has(el?.id as Id)))
    }

    if (node.$upd && node.$upd.length > 0) {
        const map = new Map<Id, Record<string, unknown>>()
        for (const el of arr) {
            if (el && typeof el === 'object' && 'id' in el)
                map.set(el.id as Id, el)
        }
        for (const upd of node.$upd) {
            const item = map.get(upd.id)
            if (!item)
                continue // 目标元素已不存在（被他人先删）：LWW 容忍，跳过
            for (const prop of Object.keys(upd)) {
                if (prop === 'id' || prop === '$del')
                    continue
                item[prop] = clone(upd[prop])
            }
            for (const prop of upd.$del ?? [])
                delete item[prop]
        }
    }

    if (node.$add && node.$add.length > 0) {
        const existing = new Set<Id>(arr.map(el => el?.id as Id))
        for (const item of node.$add) {
            const id = (item as Record<string, unknown>).id as Id
            if (!existing.has(id)) {
                arr.push(clone(item) as Record<string, unknown>)
                existing.add(id)
            }
        }
    }

    if (node.$seq && node.$seq.length > 0) {
        const ord = new Map<Id, number>()
        node.$seq.forEach((id, i) => ord.set(id, i))
        // 不在序列中的元素保持相对顺序置于末尾（对乱序到达/基线不一致的防御）
        const sorted = arr
            .map((el, idx) => ({ el, idx, ord: ord.get(el?.id as Id) ?? Infinity }))
            .sort((a, b) => a.ord - b.ord || a.idx - b.idx)
            .map(x => x.el)
        replaceArrContents(arr, sorted)
    }
}

/** 数组非空、元素均为含唯一 number/string id 的普通对象时返回 id 序列，否则返回 null */
function keyedIds(arr: unknown[]): Id[] | null {
    if (arr.length === 0)
        return null
    const ids: Id[] = []
    const seen = new Set<Id>()
    for (const el of arr) {
        if (!el || typeof el !== 'object' || Array.isArray(el))
            return null
        const id = (el as Record<string, unknown>).id
        if (typeof id !== 'number' && typeof id !== 'string')
            return null
        if (seen.has(id))
            return null
        seen.add(id)
        ids.push(id)
    }
    return ids
}

function idsEqual(a: Id[], b: Id[]): boolean {
    if (a.length !== b.length)
        return false
    return a.every((x, i) => x === b[i])
}

function isPlainObj(x: unknown): x is Record<string, unknown> {
    return !!x && typeof x === 'object' && !Array.isArray(x)
}

function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b)
        return true
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object')
        return false
    const aArr = Array.isArray(a)
    const bArr = Array.isArray(b)
    if (aArr !== bArr)
        return false
    if (aArr && bArr) {
        if (a.length !== b.length)
            return false
        return a.every((x, i) => deepEqual(x, b[i]))
    }
    const aKeys = Object.keys(a).filter(k => (a as Record<string, unknown>)[k] !== undefined)
    const bKeys = Object.keys(b).filter(k => (b as Record<string, unknown>)[k] !== undefined)
    if (aKeys.length !== bKeys.length)
        return false
    return aKeys.every(k => deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k]))
}

function replaceArrContents(arr: unknown[], items: unknown[]): void {
    for (let i = 0; i < items.length; i++)
        arr[i] = items[i]
    arr.length = items.length
}
