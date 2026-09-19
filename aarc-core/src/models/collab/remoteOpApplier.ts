import { SaveDiff, applySaveDiff } from "aarc-core/models/save/saveDiff";
import { Save } from "aarc-core/models/save";
import { useSaveStore } from "aarc-core/models/stores/saveStore";
import { useUndoStore } from "aarc-core/models/stores/utils/undoStore";
import { useResetterStore } from "aarc-core/models/stores/utils/resetterStore";
import { useEnvStore } from "aarc-core/models/stores/envStore";
import { useSelectionStore } from "aarc-core/models/stores/selectionStore";
import { useCollabLockStore } from "aarc-core/models/stores/collabLockStore";
import { useRemoteRenderScheduler } from "aarc-core/models/collab/remoteRenderScheduler";

/**
 * 把一条远程协作 op（SaveDiff）应用到本地存档，顺序：
 * 1. 原地应用 diff：保留未变更元素的对象引用，
 *    本地激活/选中对象（activePt、selected 等持有存档内对象引用）不被打断
 * 2. 防御：远程 patch 删掉的本地激活/选中对象要立即解除（见 dropStaleLocalHolds）
 * 3. 同步 undo 基线：远程变更不进入本地 undo 栈（见 au-undo-redo syncBaseline）
 * 4. 刷新派生缓存并重启派生 store：纯数据路径，
 *    不结束本地编辑、不取消激活对象、不清理交互态
 *
 * 不放在 collabStore 中是为了避免模块循环依赖（saveStore 已引用 collabStore）
 */

/**
 * 宿主注入的"远程 op 数据已应用"回调（web：Editor.vue 据此立即置未保存标记——
 * 数据应用是即时的，而渲染被 remoteRenderScheduler 节流（≤idleMs/交互结束），
 * 未保存标记不应跟随渲染延迟）。重复调用以最后一次为准；undefined 注销
 */
let afterRemoteSaveApplied: (() => void) | undefined
export function initAfterRemoteSaveApplied(cb?: () => void): void {
    afterRemoteSaveApplied = cb
}

export async function applyRemoteSaveDiff(diff: SaveDiff): Promise<void> {
    const saveStore = useSaveStore()
    const save = saveStore.save
    if (!save)
        return
    applySaveDiff(save, diff)
    dropStaleLocalHolds(save)
    useUndoStore().syncBaseline(save)
    const resetterStore = useResetterStore()
    resetterStore.refreshDerivedStoresForRemote(diff)
    // 数据已就位（同步部分完成，不等异步的派生 store 重启）：通知宿主立即更新
    // 未保存标记等数据态 UI；随后再请求"同步驱动"渲染（用户活跃期会被抑制/合并）
    afterRemoteSaveApplied?.()
    await resetterStore.relaunchDerivedStores()
    useRemoteRenderScheduler().requestRemoteRender()
}

/**
 * 远程 patch 应用后的本地持有状态防御（object-locking.md §2 坑 4）：
 * - 激活对象被远程删除：结束编辑 + 取消激活（否则第三步收尾会往已死对象上写数据）
 * - 选中对象被远程删除：移出选区
 * - 指向已删除对象的他人锁：清理（否则画布上残留红叉）
 * 激活对象被远程修改（未删除）时保留本地编辑（v1 策略：不打断用户操作，
 * 本地提交时按服务器全序 LWW 覆盖）
 */
function dropStaleLocalHolds(save: Save): void {
    const envStore = useEnvStore()
    const selectionStore = useSelectionStore()
    const ptExists = (id: number) => save.points.some(p => p.id === id)
    const lineExists = (id: number) => save.lines.some(l => l.id === id)
    const tagExists = (id: number) => (save.textTags ?? []).some(t => t.id === id)

    const activeGone =
        !!(envStore.activePt && !ptExists(envStore.activePt.id)) ||
        !!(envStore.activeLine && !lineExists(envStore.activeLine.id)) ||
        !!(envStore.activeTextTag && !tagExists(envStore.activeTextTag.id))
    if (activeGone) {
        envStore.endEveryEditing()
        envStore.cancelActive()
    }

    for (const s of [...selectionStore.selected]) {
        const exists = 'dir' in s ? ptExists(s.id) : tagExists(s.id)
        if (!exists)
            selectionStore.selected.delete(s)
    }

    useCollabLockStore().pruneOtherLocks((type, id) => {
        if (type === 'pt') return ptExists(id)
        if (type === 'line') return lineExists(id)
        return tagExists(id)
    })
}
