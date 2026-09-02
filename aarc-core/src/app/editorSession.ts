import { DataSource } from "aarc-core/models/save";
import { normalizeSave } from "aarc-core/models/save/saveNormalize";
import { autoUpdateDataSources, DataSourceMergeReport } from "aarc-core/models/save/dataSourceOps";
import { useSaveStore } from "aarc-core/models/stores/saveStore";
import { useIconStore } from "aarc-core/models/stores/iconStore";
import { useResetterStore } from "aarc-core/models/stores/utils/resetterStore";
import { useUndoStore } from "aarc-core/models/stores/utils/undoStore";
import { useMainCvsDispatcher } from "aarc-core/models/cvs/dispatchers/mainCvsDispatcher";

/**
 * 编辑器会话入口（decoupling-step17.md 工作包 C）。
 * 把“存档数据进/出 core”的内部时序收口在此，
 * 宿主（web 的 Editor.vue / 未来 tauri）只传数据与选项，
 * 不再直接操作 core store 的装配顺序。
 */

export interface DataSourceUpdateEvents {
    onLoad?: (ds: DataSource) => void
    onDone?: (ds: DataSource, report: DataSourceMergeReport) => void
    onError?: (ds: DataSource, errmsg: string) => void
}

export interface LoadSaveOptions {
    /** 浏览模式（不渲染水印等）；由宿主据 preflight/所有权判定 */
    visitorMode: boolean
    /** 隐藏图标栏目（浏览模式且非所有者） */
    blockIconAccess?: boolean
    /** 数据源自动更新过程的事件回调（宿主日志等） */
    onDataSourceEvent?: DataSourceUpdateEvents
}

/**
 * 把存档数据装入编辑器：
 * normalize → 写入 store → 重建派生态 → 数据源自动更新 → 图标加载 → undo 基线。
 * 正常返回后宿主即可挂载 Cvs/Menu；抛错说明存档数据损坏。
 */
export async function loadSaveIntoEditor(raw: unknown, opts: LoadSaveOptions): Promise<void> {
    const saveStore = useSaveStore()
    const resetterStore = useResetterStore()
    const iconStore = useIconStore()
    const undoStore = useUndoStore()
    const mainCvsDispatcher = useMainCvsDispatcher()

    mainCvsDispatcher.visitorMode = opts.visitorMode
    saveStore.save = normalizeSave(raw)
    // resetDerivedStores 不是废弃逻辑：此处语义是“新数据填充后重建派生态”，必须保留
    resetterStore.resetDerivedStores()
    saveStore.ensureLinesOrdered()
    if (saveStore.save) {
        await autoUpdateDataSources(saveStore.save, saveStore.getNewId, opts.onDataSourceEvent)
        await iconStore.ensureAllLoaded()
        if (opts.blockIconAccess) {
            iconStore.accessBlocked = true
        }
        // undo 基线：首次 push 即 initUndo，clear 后必须紧跟 push 重建基线
        undoStore.clear()
        undoStore.push(saveStore.save)
    }
}
