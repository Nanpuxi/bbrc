import { watch, type Ref } from "vue";
import rfdc from "rfdc";
import type { ControlPoint, TextTag } from "aarc-core/models/save";
import { deepEqual } from "aarc-core/models/save/saveDiff";
import { useSelectionStore } from "aarc-core/models/stores/selectionStore";
import { useEditorLocalConfigStore, multiEditSyncKeyDefaults } from "aarc-core/app/localConfig/editorLocalConfig";

type SyncableTarget = ControlPoint | TextTag

const clone = rfdc()

//不做属性级同步的键：pos 的选区级同步由 draggingCommit 统一处理；
//nameP 不在此列——它由属性组 pt:namePos 控制（组关闭即不同步），且拖动期间由 envStore 挂起同步
const excludedKeys = ['pos']
//仅允许 forId 一致的同伴间同步的键（字体体系随标签归属不同）
const forIdScopedKeys = ['textOp', 'textSOp']
/**
 * 嵌套对象逐字段同步注册表：值为扁平纯对象的顶层键。
 * 这些键仍作为整体受逐键开关（pt:nameCarpet 等）与 forId 限制约束，
 * 但 diff、sameValueOnly 比较、写入都落到内部字段——只把实际变化的字段
 * 合并进同伴的对象，未变化字段（如只调字号时的 color）不动同伴。
 * 以后新增嵌套对象属性，在此加一行即可纳入逐字段同步。
 */
const nestedObjectSyncKeys: Record<string, true> = {
    textOp: true,     // TextTag TextOptions {size,color,font,weight,style}
    textSOp: true,    // 同上（副文字）
    nameCarpet: true, // ControlPoint StaNameCarpetConfig {width,color,opacity}
}
//sameValueOnly 比较时 undefined 视为 0 的键（0/undefined 均表示"使用默认"）：
//startEditing 会给打开面板的元素补 0，而同伴可能仍是 undefined，不规范化会永不同步
const defaultZeroKeys = ['nameSize', 'nameSSize', 'padding', 'width', 'zIndex']

//sameValueOnly 模式下，同伴当前值与编辑前旧值是否视为等价
function peerValueEquals(key: string, peerV: unknown, oldV: unknown): boolean {
    if (defaultZeroKeys.includes(key)) {
        const norm = (v: unknown) => v === undefined ? 0 : v
        if (deepEqual(norm(peerV), norm(oldV)))
            return true
    }
    return deepEqual(peerV, oldV)
}

function isObj(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === 'object' && !Array.isArray(v)
}

//嵌套对象逐字段同步时，同伴某字段与编辑前旧字段是否视为等价：
//同伴从未设置该对象（整体跟随默认）时，旧字段为 0/undefined 视为等价
function nestedPeerFieldEquals(peerObj: unknown, field: string, oldField: unknown): boolean {
    if (!isObj(peerObj))
        return oldField === undefined || oldField === 0
    return deepEqual(peerObj[field], oldField)
}

//scope 四档是否允许同步（notGroupOnly/groupOnly 的组指选区组，与属性组无关）
function scopeAllows(): boolean {
    const selectionStore = useSelectionStore()
    const scope = useEditorLocalConfigStore().multiEditSyncScope
    if (!scope || scope === 'never')
        return false
    if (scope === 'notGroupOnly' && selectionStore.matchedSelectionGroup)
        return false
    if (scope === 'groupOnly' && !selectionStore.matchedSelectionGroup)
        return false
    if (scope === 'always' && selectionStore.selected.size < 2)
        return false
    return true
}

//逐键开关：用户显式选择优先，其次默认值表，其余属性默认允许
function keyAllowed(prefix: 'pt' | 'tag', key: string): boolean {
    const editorLocalConfig = useEditorLocalConfigStore()
    return editorLocalConfig.multiEditSyncKeys[`${prefix}:${key}`]
        ?? multiEditSyncKeyDefaults[`${prefix}:${key}`] ?? true
}

//startEditing 补默认值等"非用户编辑"期间挂起同步（挂起期间的变更只更新快照、不传播）
let suspendCount = 0
export function suspendSelectionPropSync() {
    suspendCount++
    return () => { suspendCount = Math.max(0, suspendCount - 1) }
}

//顶层浅拷贝 + 对象/数组值深拷贝（rfdc 可处理响应式代理，structuredClone 不能）
function snapshotOf(t: SyncableTarget): Record<string, unknown> {
    const snap: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(t))
        snap[k] = (v && typeof v === 'object') ? clone(v) : v
    return snap
}

/**
 * 多选同属性同步：监视锚点对象（由调用方指定，通常为 envStore 的激活对象），
 * 属性变化时按 editorLocalConfig 的 multiEditSyncScope/multiEditSyncValue
 * 配置把同属性同步给选区内其他同类选中元素。
 * flush 为 sync：锚点引用变化时同步取基线快照，因此同一手势内"先激活后修改"
 * （如点击站点的同时切换 sta）也能被 diff 到；锚点切换本身不传播，
 * startEditing 补默认值请用 suspendSelectionPropSync 包裹。
 */
export function useSelectionPropSync(anchor: Ref<SyncableTarget | undefined>) {
    const selectionStore = useSelectionStore()
    const editorLocalConfig = useEditorLocalConfigStore()
    let prevSnapshot: Record<string, unknown> | undefined = undefined
    takeSnapshot()

    function takeSnapshot() {
        const cur = anchor.value
        prevSnapshot = cur ? snapshotOf(cur) : undefined
    }

    watch(() => anchor.value, (newVal, oldVal) => {
        if (newVal !== oldVal) {
            takeSnapshot()
            return
        }
        if (newVal)
            syncChangedProps(newVal)
    }, { deep: true, flush: 'sync' })

    function syncChangedProps(cur: SyncableTarget) {
        const prev = prevSnapshot
        takeSnapshot()
        if (suspendCount > 0)
            return
        if (!prev)
            return
        if (!selectionStore.selected.has(cur))
            return
        if (!scopeAllows())
            return
        const sameValueOnly = editorLocalConfig.multiEditSyncValue === 'sameValueOnly'
        const prefix = 'dir' in cur ? 'pt' : 'tag'
        const curRec = cur as unknown as Record<string, unknown>
        const changedKeys = new Set([...Object.keys(prev), ...Object.keys(curRec)])
        for (const key of changedKeys) {
            if (excludedKeys.includes(key))
                continue
            const oldV = prev[key]
            const newV = curRec[key]
            if (deepEqual(oldV, newV))
                continue
            if (!keyAllowed(prefix as 'pt' | 'tag', key))
                continue
            //注册表内的嵌套对象键：逐字段 diff/比较/合并写入（newV 非对象=整体移除，走整键写入）
            if (nestedObjectSyncKeys[key] && isObj(newV)) {
                syncNestedKey(cur, key, isObj(oldV) ? oldV : {}, newV, sameValueOnly)
                continue
            }
            eachPeer(cur, key, (_peer, peerRec) => {
                if (sameValueOnly && !peerValueEquals(key, peerRec[key], oldV))
                    return
                peerRec[key] = newV === undefined ? undefined : clone(newV)
            })
        }
    }

    //遍历可同步的同伴（同类、非自身；forId 受限键还要求 forId 一致）
    function eachPeer(cur: SyncableTarget, key: string, fn: (peer: SyncableTarget, peerRec: Record<string, unknown>) => void) {
        for (const peer of selectionStore.selected) {
            if (peer === cur)
                continue
            if (('dir' in peer) !== ('dir' in cur))
                continue
            if (forIdScopedKeys.includes(key)
                && (('dir' in peer) || ('dir' in cur) || peer.forId !== cur.forId))
                continue
            fn(peer, peer as unknown as Record<string, unknown>)
        }
    }

    //嵌套对象键逐字段同步：只把变化字段合并进同伴对象，未变化字段不动
    function syncNestedKey(cur: SyncableTarget, key: string, oldObj: Record<string, unknown>, newObj: Record<string, unknown>, sameValueOnly: boolean) {
        const changed: Record<string, unknown> = {}
        for (const f of new Set([...Object.keys(oldObj), ...Object.keys(newObj)])) {
            if (!deepEqual(oldObj[f], newObj[f]))
                changed[f] = newObj[f]
        }
        const fields = Object.keys(changed)
        if (!fields.length)
            return
        eachPeer(cur, key, (_peer, peerRec) => {
            if (sameValueOnly) {
                for (const f of fields) {
                    if (!nestedPeerFieldEquals(peerRec[key], f, oldObj[f]))
                        return
                }
            }
            const merged: Record<string, unknown> = { ...(isObj(peerRec[key]) ? peerRec[key] : {}) }
            for (const f of fields)
                merged[f] = changed[f] === undefined ? undefined : clone(changed[f])
            peerRec[key] = merged
        })
    }
}
