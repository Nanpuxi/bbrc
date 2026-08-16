import { defineStore } from "pinia";
import { useFormalizedLineStore } from '../saveDerived/formalizedLineStore'
import { useStaNameMainRectStore, useStaNameRectStore } from "../saveDerived/staNameRectStore";
import { useTextTagRectStore } from "../saveDerived/textTagRectStore";
import { useLineExtendStore } from "../saveDerived/saveDerivedDerived/lineExtendStore";
import { useCvsBlocksControlStore } from "@/models/cvs/common/cvs";
import { useStaClusterStore } from "../saveDerived/staClusterStore";
import { useEnvStore } from "../envStore";
import { usePointLinkStore } from "../pointLinkStore";
import { useIconStore } from "../iconStore";
import { useDiscardAreaStore } from "../discardAreaStore";
import { useNameEditStore } from "../nameEditStore";
import { useTextTagEditStore } from "../textTagEditStore";
import { SavePatch } from "../saveDerived/staClusterStore.pure";

/**
 * 在加载前重置所有状态（已废弃）  
 * 依然有“串台”的情况发生，无法定位原因  
 * 所以改为刷新页面(location.reload)确保状态全新  
 * 见models\stores\utils\loadedSave.ts
 */
export const useResetterStore = defineStore('resetter', ()=>{
    const envStore = useEnvStore()
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
        useTextTagEditStore
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
        envStore.endEveryEditing()
        envStore.cancelActive()
        envStore.closeOps()
    }

    async function relaunchDerivedStores(){
        await useIconStore().ensureAllLoaded()
        useCvsBlocksControlStore().refreshBlocks()
    }

    return { resetDerivedStores, relaunchDerivedStores }
})