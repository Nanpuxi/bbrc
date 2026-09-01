import { ControlPoint } from "aarc-core/models/save";
import { defineStore } from "pinia";
import { computed, ref } from "vue";

export interface NamePosMemory {
    nameP?: ControlPoint['nameP'],
    anchorX?: ControlPoint['anchorX'],
    anchorY?: ControlPoint['anchorY'],
    noLeader?: ControlPoint['noLeader'],
    nameAngle?: ControlPoint['nameAngle'],
}

export const useNamePosMemoryStore = defineStore('namePosMemory', ()=>{
    const mem = ref<NamePosMemory>()
    const hasMem = computed(()=>!!mem.value)

    function write(pt: ControlPoint){
        mem.value = {
            nameP: pt.nameP ? [...pt.nameP] : undefined,
            anchorX: pt.anchorX,
            anchorY: pt.anchorY,
            noLeader: pt.noLeader,
            nameAngle: pt.nameAngle,
        }
    }
    function clear(){
        mem.value = undefined
    }
    function clearItems(){
        clear()
    }
    /**
     * 将记忆值应用到指定点：覆盖其站名位置相关属性
     * （nameP、anchorX、anchorY、noLeader、nameAngle）。
     * @param pt 目标点，会被就地修改
     * @returns 是否成功应用；无记忆时返回 false 且不修改目标点
     */
    function apply(pt: ControlPoint): boolean{
        if(!mem.value)
            return false
        if(mem.value.nameP)
            pt.nameP = [...mem.value.nameP]
        pt.anchorX = mem.value.anchorX
        pt.anchorY = mem.value.anchorY
        pt.noLeader = mem.value.noLeader
        pt.nameAngle = mem.value.nameAngle
        return true
    }

    return {
        hasMem,
        write,
        clear,
        clearItems,
        apply
    }
})
