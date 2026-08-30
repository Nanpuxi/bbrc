import { defineStore } from "pinia";
import { ref, watch, type Ref } from "vue";
import { localConfigKeyPrefix } from "./common/keyPrefix";

export const cvsRenderResolutionRatioLimits = { min: 0.5, max: 2 }

export const useEditorLocalConfigStore = defineStore('editorLocalConfig',()=>{
    const staNameFob = ref<number|string>()
    const lineFob = ref<number|string>()
    const staFob = ref<number|string>()
    const tabForPinyinConvert = ref<boolean>(false)
    const duplicateNameDistThrs = ref<number|string>(200)
    const allowMergePtAndTerrain = ref<boolean>(true)
    const ignoreStyleAndSpan = ref<boolean>(false)
    const staNameSnapDiagonal = ref<'inner'|'outer'|'both'>('both')
    const gridLabelSize = ref<number>(0)
    const cvsRenderResolutionRatio = ref<number>(2)
    watch(cvsRenderResolutionRatio as Ref<number | string>, (v)=>{
        if(v === '' || v == null || typeof v !== 'number' || isNaN(v))
            return
        if(v < cvsRenderResolutionRatioLimits.min)
            cvsRenderResolutionRatio.value = cvsRenderResolutionRatioLimits.min
        else if(v > cvsRenderResolutionRatioLimits.max)
            cvsRenderResolutionRatio.value = cvsRenderResolutionRatioLimits.max
    })

    //旧版兼容性
    function backCompat(){
        const legacyStaNameFobKey = 'localConfig_editor_staNameFob'
        const legacyStaNameFob = localStorage.getItem(legacyStaNameFobKey)
        if(legacyStaNameFob){
            staNameFob.value = legacyStaNameFob
        }
        localStorage.removeItem(legacyStaNameFobKey)
    }

    return {
        staNameFob,
        lineFob,
        staFob,
        tabForPinyinConvert,
        duplicateNameDistThrs,
        allowMergePtAndTerrain,
        ignoreStyleAndSpan,
        staNameSnapDiagonal,
        gridLabelSize,
        cvsRenderResolutionRatio,
        backCompat
    }
},
{
    persist:{
        key: `${localConfigKeyPrefix}-editor`
    }
})