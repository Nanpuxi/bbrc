import { defineStore, storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { ControlPoint, SelectionGroup, TextTag } from "../save";
import { Coord } from "../coord";
import { useSaveStore } from "./saveStore";
import { coordDistSqLessThan } from "aarc-core/utils/coordUtils/coordDist";
import { quadCoordDistSqLessThan } from "aarc-core/utils/coordUtils/coordRect";
import { useTextTagRectStore } from "./saveDerived/textTagRectStore";
import { coordAdd, coordSub } from "aarc-core/utils/coordUtils/coordMath";
import { isFocusingInput } from "aarc-core/utils/domUtils/focusingInput";
import { useCvsFrameStore } from "./cvsFrameStore";
import { useEditorLocalConfigStore } from "aarc-core/app/localConfig/editorLocalConfig";

type SelectionTarget = ControlPoint|TextTag
export const useSelectionStore = defineStore('selection', ()=>{
    const selected = ref<Set<SelectionTarget>>(new Set())
    const mode = ref<'add'|'sub'|'idle'>('idle')
    const brushStatus = ref<'up'|'down'>('up')
    const enabled = computed(() => mode.value != 'idle')
    const working = computed(() => mode.value != 'idle' && brushStatus.value == 'down')
    const showControl = ref(false)
    const showedControl = ref(false)
    const selCursor = ref<Coord>()
    const saveStore = useSaveStore()
    const { save } = storeToRefs(saveStore)
    const { enumerateTextTagRects } = useTextTagRectStore()
    
    function getBrushRadius(){
        return useCvsFrameStore().getViewRectBiggerSideLength() / 10 * useEditorLocalConfigStore().selectionSize
    }
    function brush(coord?:Coord){
        selCursor.value = coord
        if(!coord || !working.value) return
        let radius = getBrushRadius()
        const radiusSq = radius ** 2
        for(const p of save.value?.points ?? []){
            if(coordDistSqLessThan(coord, p.pos, radiusSq)){
                if(mode.value == 'add')
                    selected.value.add(p)
                else if(mode.value == 'sub')
                    selected.value.delete(p)
            }
        }
        enumerateTextTagRects((id, quad)=>{
            if(quadCoordDistSqLessThan(quad, coord, radiusSq)){
                const t = saveStore.getTextTagById(id)
                if(!t) return
                if(mode.value == 'add')
                    selected.value.add(t)
                else if(mode.value == 'sub')
                    selected.value.delete(t)
            }
        })
    }
    function setBrushStatus(status:'up'|'down'){
        brushStatus.value = status
    }

    //把选区组里的id解析回对象引用灌入selected（多组取并集），已删除元素的死id直接跳过
    function applyGroups(groups:SelectionGroup[]){
        for(const g of groups){
            for(const id of g.ptIds){
                const pt = saveStore.getPtById(id)
                if(pt)
                    selected.value.add(pt)
            }
            for(const id of g.tagIds){
                const tag = saveStore.getTextTagById(id)
                if(tag)
                    selected.value.add(tag)
            }
        }
    }

    //当前多选的 id 集合（按点/文本标签分开）
    function selectedIdSets(){
        const ptIds = new Set<number>()
        const tagIds = new Set<number>()
        for(const s of selected.value){
            if('dir' in s)
                ptIds.add(s.id)
            else
                tagIds.add(s.id)
        }
        return { ptIds, tagIds }
    }
    //当前多选的 id 集合与某个选区组完全一致时，返回该组
    const matchedSelectionGroup = computed<SelectionGroup|undefined>(()=>{
        if(selected.value.size === 0)
            return undefined
        const { ptIds, tagIds } = selectedIdSets()
        return save.value?.selectionGroups?.find(g=>
            g.ptIds.length === ptIds.size && g.tagIds.length === tagIds.size
            && g.ptIds.every(id=>ptIds.has(id))
            && g.tagIds.every(id=>tagIds.has(id)))
    })

    function enableForTouchScreen(setMode?:'add'|'sub'){
        mode.value = setMode ?? 'add'
        showControl.value = true
        showedControl.value = true
    }
    function disableForTouchScreen(){
        mode.value = 'idle'
        showControl.value = false
        selCursor.value = undefined
    }

    const draggingOriginal = ref<Coord>()
    const draggingDelta = ref<Coord>()
    const dragged = ref(false)
    function draggingStart(tar:SelectionTarget, c:Coord){
        if(!selected.value.has(tar)) return
        draggingOriginal.value = c
        draggingDelta.value = undefined
    }
    function draggingDrag(tar:SelectionTarget, c:Coord){
        if(!selected.value.has(tar)) return
        if(!draggingOriginal.value) return
        draggingDelta.value = coordSub(c, draggingOriginal.value)
    }
    function draggingCommit(draggedItem:SelectionTarget){
        if(!selected.value.has(draggedItem)) return
        if(selected.value.size == 0 || !draggingDelta.value){
            draggingDelta.value = undefined
            return
        }
        selected.value.forEach(s=>{
            if(draggedItem === s) return
            s.pos = coordAdd(s.pos, draggingDelta.value ?? [0, 0])
        })
        draggingOriginal.value = undefined
        draggingDelta.value = undefined
        dragged.value = true
    }

    // pinia单例，该语句仅执行一次
    document.addEventListener('keydown', e => {
        setMode(e)
        clearIfEsc(e)
    });
    document.addEventListener('keyup', e => {
        setMode(e)
    });
    function setMode(e: KeyboardEvent){
        if(isFocusingInput())
            return
        if(e.shiftKey) {
            if (e.ctrlKey || e.metaKey) 
                mode.value = 'sub'
            else 
                mode.value = 'add'
        } else {
            mode.value = 'idle'
        }
    }
    function clearIfEsc(e: KeyboardEvent){
        if(e.key == 'Escape'){
            clear()
        }
    }
    function clear(){
        disableForTouchScreen()
        selected.value.clear()
    }

    return {
        selected,
        mode,
        working,
        enabled,
        showControl,
        showedControl,
        selCursor,
        getBrushRadius,
        brush,
        setBrushStatus,
        applyGroups,
        selectedIdSets,
        matchedSelectionGroup,
        clear,
        enableForTouchScreen,
        disableForTouchScreen,
        draggingDelta,
        draggingStart,
        draggingDrag,
        draggingCommit,
        dragged
    }
})