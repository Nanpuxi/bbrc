import { SaveDiff, applySaveDiff } from "aarc-core/models/save/saveDiff";
import { useSaveStore } from "aarc-core/models/stores/saveStore";
import { useUndoStore } from "aarc-core/models/stores/utils/undoStore";
import { useResetterStore } from "aarc-core/models/stores/utils/resetterStore";

/**
 * 把一条远程协作 op（SaveDiff）应用到本地存档，顺序：
 * 1. 原地应用 diff：保留未变更元素的对象引用，
 *    本地激活/选中对象（activePt、selected 等持有存档内对象引用）不被打断
 * 2. 同步 undo 基线：远程变更不进入本地 undo 栈（见 au-undo-redo syncBaseline）
 * 3. 刷新派生缓存并重启派生 store：纯数据路径，
 *    不结束本地编辑、不取消激活对象、不清理交互态
 *
 * 不放在 collabStore 中是为了避免模块循环依赖（saveStore 已引用 collabStore）
 */
export async function applyRemoteSaveDiff(diff: SaveDiff): Promise<void> {
    const saveStore = useSaveStore()
    const save = saveStore.save
    if (!save)
        return
    applySaveDiff(save, diff)
    useUndoStore().syncBaseline(save)
    const resetterStore = useResetterStore()
    resetterStore.refreshDerivedStoresForRemote(diff)
    await resetterStore.relaunchDerivedStores()
}
