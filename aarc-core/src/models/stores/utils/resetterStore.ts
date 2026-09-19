import { defineStore } from "pinia";
import { useFormalizedLineStore } from '../saveDerived/formalizedLineStore'
import { useStaNameMainRectStore, useStaNameRectStore } from "../saveDerived/staNameRectStore";
import { useTextTagRectStore } from "../saveDerived/textTagRectStore";
import { useLineExtendStore } from "../saveDerived/saveDerivedDerived/lineExtendStore";
import { useCvsBlocksControlStore } from "aarc-core/models/cvs/common/cvs";
import { useStaClusterStore } from "../saveDerived/staClusterStore";
import { useEnvStore } from "../envStore";
import { usePointLinkStore } from "../pointLinkStore";
import { useIconStore } from "../iconStore";
import { useDiscardAreaStore } from "../discardAreaStore";
import { useNameEditStore } from "../nameEditStore";
import { useTextTagEditStore } from "../textTagEditStore";
import { useNamePosMemoryStore } from "./namePosMemoryStore";
import { SavePatch, saveDiffToSavePatch } from "../saveDerived/staClusterStore.pure";
import { SaveDiff } from "aarc-core/models/save/saveDiff";

/**
 * 在加载前重置所有状态（已废弃）  
 * 依然有“串台”的情况发生，无法定位原因  
 * 所以改为刷新页面(location.reload)确保状态全新  
 * 见models\stores\utils\loadedSave.ts
 */
export const useResetterStore = defineStore('resetter', ()=>{
    const needClearItemsStoreUses:(()=>{clearItems:()=>void})[] = [
        useFormalizedLineStore,
        useStaNameRectStore,
        useStaNameMainRectStore,
        useTextTagRectStore,
        useLineExtendStore,
        useCvsBlocksControlStore,
        usePointLinkStore,
        useIconStore,
        useDiscardAreaStore,
        useNameEditStore,
        useTextTagEditStore,
        useNamePosMemoryStore
    ]

    // 远程 op 的纯数据刷新只失效“由存档数据派生的缓存”；
    // 不触碰本地编辑/交互态（nameEdit/textTagEdit 的编辑中状态、pointLink 的连线创建、
    // discardArea 的拖删状态、namePosMemory 的站名位置记忆、envStore 的激活对象），
    // 避免远程变更打断本地正在进行的输入或拖动。
    // 注意不含 cvsBlocksControl：画布块几何只取决于视口框/分辨率比，不由存档数据派生，
    // 而其 clearItems 会清空 blocksControl（canvas DOM 随之销毁）——每条远程 op 都重建
    // 画布块是远程重渲染白闪的根源
    const remoteDataCacheStoreUses:(()=>{clearItems:()=>void})[] = [
        useFormalizedLineStore,
        useStaNameRectStore,
        useStaNameMainRectStore,
        useTextTagRectStore,
        useLineExtendStore,
        useIconStore
    ]

    /**
     * @param patch undo/redo 应用的补丁；staClusterStore 会据此决定保留缓存、
     * 增量恢复还是全量重建。不传（如加载/stash 路径）时保守地全部清空
     */
    function resetDerivedStores(patch?: SavePatch){
        for(const use of needClearItemsStoreUses){
            use().clearItems()
        }
        useStaClusterStore().restoreWithPatch(patch)
        const envStore = useEnvStore()
        envStore.endEveryEditing()
        envStore.cancelActive()
        envStore.closeOps()
    }

    /**
     * 协作场景：远程 op 应用到存档后的派生态刷新。
     * 与 resetDerivedStores 的区别：不结束编辑、不取消激活对象、不清理交互态
     * @param diff 本次应用的协作 diff；staClusterStore 据此决定保留/增量/重建。
     * 不传时保守地全量重建 cluster
     */
    function refreshDerivedStoresForRemote(diff?: SaveDiff){
        for(const use of remoteDataCacheStoreUses){
            use().clearItems()
        }
        useStaClusterStore().restoreWithPatch(diff ? saveDiffToSavePatch(diff) : undefined)
    }

    /**
     * 重启派生 store（await 图标加载完成）。
     * @param repairCanvasBlocks 是否重刷画布块。undo/stash 等整档重置会先 clearItems 掉
     * 画布块（canvas DOM 随之销毁），须在此重建并借 reform handler 补绘；
     * 远程 op 只失效数据缓存、不碰画布块，传 false——否则每条 op 都因重建 canvas DOM
     * 产生空白帧（白闪），还可能与同步渲染竞争把内容画到已离屏的旧 canvas 上
     */
    async function relaunchDerivedStores(repairCanvasBlocks = true){
        await useIconStore().ensureAllLoaded()
        if(repairCanvasBlocks)
            useCvsBlocksControlStore().refreshBlocks()
    }

    return { resetDerivedStores, refreshDerivedStoresForRemote, relaunchDerivedStores }
})