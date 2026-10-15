import { defineStore } from "pinia";
import { ref, watch, type Ref } from "vue";
import { localConfigKeyPrefix } from "./common/keyPrefix";
import { useBrowserInfoStore } from "aarc-core/app/globalStores/browserInfo";
import { ControlPointSta } from "aarc-core/models/save";

export const cvsRenderResolutionRatioLimits = { min: 0.5, max: 2 }
export const selectionSizeLimits = { min: 0.3, max: 2 }
export type BlankClickBehavior = 'none'|'exitAlways'|'exitWhenGrouped'
/** 批量选择时如何处理锁定线路上的点：exclude=不添加到选区 */
export type SelectionLockedBehavior = 'exclude'|'include'
/** 多选时编辑某元素，是否同步更改其他同类选中元素的同属性：undefined（默认）=尚未选择，作用与 never 一致，首次多选后由 Cvs.vue 弹窗引导设置 */
export type MultiEditSyncScope = 'never'|'notGroupOnly'|'groupOnly'|'always'|undefined
/** 同步时是否要求同伴该属性的当前值与编辑前旧值一致 */
export type MultiEditSyncValue = 'sameValueOnly'|'always'
/**
 * 文本标签字体（textOp/textSOp）的同步范围：
 * all=全部同步（不管 forId）；sameLine=仅同线路（forId 相等）；
 * sameKind=仅同类（按 forId 是否存在分两类：线路标签与独立标签各自内部同步）；
 * never=全部不同步
 */
export type MultiEditSyncFontScope = 'all'|'sameLine'|'sameKind'|'never'
/**
 * 多选属性同步的逐键开关：键为 `pt:${属性名}` / `tag:${属性名}`。
 * 不在表中的属性默认允许同步；表内列出的默认 false（面板外入口或覆盖类操作，显式 opt-in）。
 */
export const multiEditSyncKeyDefaults: Record<string, boolean> = {
    'pt:dir': false,
    'pt:sta': false,
    'pt:free': false,
    'pt:name': false,
    'pt:nameS': false,
    'tag:text': false,
    'tag:textS': false,
    'tag:icon': false,
    //站名位置组（multiEditSyncGroupDefaults 的 pt:namePos）各成员，默认关闭、可单独开启
    'pt:nameP': false,
    'pt:anchorX': false,
    'pt:anchorY': false,
    'pt:noLeader': false,
    'pt:nameAngle': false,
}
/**
 * 多选属性同步的属性组：仅定义组成员与 UI 从属关系，同步判定落到各成员的逐键开关上
 * （组 checkbox 为派生状态：全选=选中、部分选=indeterminate）。
 * 与 namePosMemory 的"站名位置记忆"同一划分。
 */
export const multiEditSyncGroupDefaults: Record<string, string[]> = {
    'pt:namePos': ['nameP', 'anchorX', 'anchorY', 'noLeader', 'nameAngle'],
}
export type TextTagClickMode = 'rect'|'anchor'|'rectAndAnchor'
/** 一键拼音转换的处理方式 */
export type PinyinBatchMode = 'none'|'skipExist'|'overwrite'

export const useEditorLocalConfigStore = defineStore('editorLocalConfig',()=>{
    const staNameFob = ref<number|string>()
    const lineFob = ref<number|string>()
    const staFob = ref<number|string>()
    const tabForPinyinConvert = ref<boolean>(false)
    const pinyinBatchStaName = ref<PinyinBatchMode>('skipExist')
    const pinyinBatchTextTag = ref<PinyinBatchMode>('none')
    const duplicateNameDistThrs = ref<number|string>(200)
    const allowMergePtAndTerrain = ref<boolean>(true)
    const ignoreStyleAndSpan = ref<boolean>(false)
    const staNameSnapDiagonal = ref<'inner'|'outer'|'both'>('both')
    const gridLabelSize = ref<number>(0)
    //无持久化值时的默认值：手机端为1，其他端为0.8（persist 会在有值时覆盖）
    const selectionSize = ref<number>(useBrowserInfoStore().isMobile ? 1 : 0.8)
    const blankClickBehavior = ref<BlankClickBehavior>('exitWhenGrouped')
    const selectionLockedBehavior = ref<SelectionLockedBehavior>('exclude')
    const multiEditSyncScope = ref<MultiEditSyncScope>(undefined)
    const multiEditSyncValue = ref<MultiEditSyncValue>('sameValueOnly')
    //用户对 multiEditSyncKeyDefaults 中各键的显式选择；未设置的键回退到默认值
    const multiEditSyncKeys = ref<Record<string, boolean>>({})
    const multiEditSyncFontScope = ref<MultiEditSyncFontScope>('sameKind')
    const cvsRenderResolutionRatio = ref<number>(2)
    const lineExtendSta = ref<ControlPointSta|undefined>(undefined)
    const textTagClickMode = ref<TextTagClickMode>('rect')
    /** 支线渐变范围的记忆列表（[起, 止]，0..1） */
    const gradientRangeMemory = ref<[number, number][]>([])

    watch(cvsRenderResolutionRatio as Ref<number | string>, (v)=>{
        if(v === '' || v == null || typeof v !== 'number' || isNaN(v))
            return
        if(v < cvsRenderResolutionRatioLimits.min)
            cvsRenderResolutionRatio.value = cvsRenderResolutionRatioLimits.min
        else if(v > cvsRenderResolutionRatioLimits.max)
            cvsRenderResolutionRatio.value = cvsRenderResolutionRatioLimits.max
    })

    watch(selectionSize as Ref<number | string>, (v)=>{
        if(v === '' || v == null || typeof v !== 'number' || isNaN(v))
            return
        if(v < selectionSizeLimits.min)
            selectionSize.value = selectionSizeLimits.min
        else if(v > selectionSizeLimits.max)
            selectionSize.value = selectionSizeLimits.max
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
        pinyinBatchStaName,
        pinyinBatchTextTag,
        duplicateNameDistThrs,
        allowMergePtAndTerrain,
        ignoreStyleAndSpan,
        staNameSnapDiagonal,
        gridLabelSize,
        selectionSize,
        blankClickBehavior,
        selectionLockedBehavior,
        multiEditSyncScope,
        multiEditSyncValue,
        multiEditSyncKeys,
        multiEditSyncFontScope,
        cvsRenderResolutionRatio,
        lineExtendSta,
        textTagClickMode,
        gradientRangeMemory,
        backCompat
    }
},
{
    persist:{
        key: `${localConfigKeyPrefix}-editor`
    }
})