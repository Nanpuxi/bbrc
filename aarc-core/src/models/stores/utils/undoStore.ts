import { Save } from "aarc-core/models/save";
import { AurPatchStore } from "@aurouscia/au-undo-redo";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useSaveStore } from "../saveStore";
import { useSelectionStore } from "../selectionStore";
import { useResetterStore } from "./resetterStore";
import { SavePatch } from "../saveDerived/staClusterStore.pure";

export const useUndoStore = defineStore('undo', ()=>{
    const saveStore = useSaveStore()
    const selectionStore = useSelectionStore()
    const resetterStore = useResetterStore()
    
    let urPatches: AurPatchStore<Save>|null = null
    const canUndo = ref(false)
    const canRedo = ref(false)

    function initUndo(initialState: Save){
        urPatches = new AurPatchStore(initialState, 50, (canU, canR) => {
            console.log({canU, canR})
            canUndo.value = canU
            canRedo.value = canR
        })
    }

    function push(state: Save){
        if(!urPatches){
            initUndo(state)
            return
        }
        urPatches.push(state)
    }

    async function undo(){
        if(!urPatches || !canUndo.value)
            return
        // undo 应用的是当前 pointer 处的 patch（应用后 pointer 才后移）
        const patch = urPatches.history[urPatches.pointer] as unknown as SavePatch | undefined
        const state = urPatches.undo()
        if(state){
            await restoreState(state, patch)
        }
    }

    async function redo(){
        if(!urPatches || !canRedo.value)
            return
        const state = urPatches.redo()
        if(state){
            // redo 先前移 pointer 再应用该处的 patch
            const patch = urPatches.history[urPatches.pointer] as unknown as SavePatch | undefined
            await restoreState(state, patch)
        }
    }

    async function restoreState(state: Save, patch?: SavePatch){
        // TODO: activeCvsDispatcher会因为获取不到画布报错一次，有点难看不过问题不大
        saveStore.save = state
        // save被整体替换，selected中的引用全部失效，必须清空
        selectionStore.selected.clear()
        resetterStore.resetDerivedStores(patch)
        await resetterStore.relaunchDerivedStores()
    }

    function clear(){
        urPatches = null
        canUndo.value = false
        canRedo.value = false
    }

    return {
        canUndo: computed(()=>canUndo.value),
        canRedo: computed(()=>canRedo.value),
        push,
        undo,
        redo,
        clear
    }
})
