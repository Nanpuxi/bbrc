<script setup lang="ts">
import { useConfigStore } from 'aarc-core/models/stores/configStore';
import { storeToRefs } from 'pinia';
import ConfigSection from './shared/ConfigSection.vue';
import PinyinConvertFields from './shared/PinyinConvertFields.vue';
import Prompt from 'aarc-core/components/common/Prompt.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { PinyinUStyle, convertPinyinLocal, toPinyinOptions, type PinyinConvertOptions } from 'aarc-core/components/composables/pinyinConverter';
import { useEditorLocalConfigStore, type PinyinBatchMode } from 'aarc-core/app/localConfig/editorLocalConfig';
import { usePreventLeavingUnsavedStore } from 'aarc-core/utils/eventUtils/preventLeavingUnsaved';
import { useSaveStore } from 'aarc-core/models/stores/saveStore';
import { useEnvStore } from 'aarc-core/models/stores/envStore';
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents';
import { PinyinConvertPreset } from 'aarc-core/models/config';
import { PINYIN_PRESET_NAME_MAX, clearPinyinPresetRefs, nextPinyinPresetName, renamePinyinPresetRefs, resolvePinyinConvert, validatePinyinPresetName } from 'aarc-core/models/pinyinPreset';
import rfdc from 'rfdc';

const { config } = storeToRefs(useConfigStore())
const { tabForPinyinConvert, pinyinBatchStaName, pinyinBatchTextTag } = storeToRefs(useEditorLocalConfigStore())
const { preventLeaving } = usePreventLeavingUnsavedStore()
const saveStore = useSaveStore()
const envStore = useEnvStore()
const { showPop } = useUniqueComponentsStore()
const deepClone = rfdc()

onMounted(()=>{
    const ori = config.value.pinyinConvert
    if(!ori || !Object.keys(ori).length){
        config.value.pinyinConvert = {
            caseType: 0,
            variantType: 0,
            uStyle: PinyinUStyle.V,
            ueStyle: PinyinUStyle.U,
            rules: "公园:Park\n广场:Square\n路$:Rd.\n街$:St."
        }
    }
})

watch(()=>[config.value.pinyinConvert, config.value.pinyinConvertPresets], ()=>{
    preventLeaving()
}, {deep:true})

const editingPreset = ref<PinyinConvertPreset>()
const presetNameDraft = ref('')
const presetPromptShow = ref(false)

function openPresetPrompt(preset:PinyinConvertPreset){
    editingPreset.value = preset
    presetNameDraft.value = preset.name
    presetPromptShow.value = true
}

function closePresetPrompt(){
    presetPromptShow.value = false
    editingPreset.value = undefined
}

function addPreset(){
    const presets = config.value.pinyinConvertPresets
    const preset:PinyinConvertPreset = {
        name: nextPinyinPresetName(presets),
        convert: deepClone(config.value.pinyinConvert)
    }
    presets.push(preset)
    preventLeaving()
    openPresetPrompt(preset)
}

/** 预设改名：校验后写回，并级联更新所有引用它的站名/标签 */
function applyPresetName(){
    const preset = editingPreset.value
    if(!preset)
        return
    const name = presetNameDraft.value.trim()
    const err = validatePinyinPresetName(name, config.value.pinyinConvertPresets, preset)
    if(err){
        showPop(err, 'failed')
        presetNameDraft.value = preset.name
        return
    }
    presetNameDraft.value = name
    if(name === preset.name)
        return
    const oldName = preset.name
    preset.name = name
    const save = saveStore.save
    if(save){
        const count = renamePinyinPresetRefs(save.points, save.textTags, oldName, name)
        if(count)
            showPop(`已更新 ${count} 处引用`, 'info')
    }
    preventLeaving()
}

function deletePreset(){
    const preset = editingPreset.value
    if(!preset)
        return
    if(!window.confirm(`确认删除预设 ${preset.name}？引用它的站名/标签将回退为存档默认设置`))
        return
    const presets = config.value.pinyinConvertPresets
    const idx = presets.indexOf(preset)
    if(idx >= 0)
        presets.splice(idx, 1)
    const save = saveStore.save
    if(save){
        const count = clearPinyinPresetRefs(save.points, save.textTags, preset.name)
        if(count)
            showPop(`已清除 ${count} 处引用`, 'info')
    }
    preventLeaving()
    closePresetPrompt()
}

const convertingAll = ref(false)
type BatchCount = { sta:number, tag:number }
const convertResult = ref<{unchanged:BatchCount, changed:BatchCount, skipped:BatchCount, failed:BatchCount, failedNames:string[]}>()

function countText(c:BatchCount){
    return `${c.sta}站名 ${c.tag}标签`
}

const staModeText: Record<PinyinBatchMode, string> = {
    skipExist: '这只对副站名为空的站生效',
    overwrite: '这会覆盖所有已有的副站名',
    none: '不转换站名'
}
const tagModeText: Record<PinyinBatchMode, string> = {
    skipExist: '这只对副文本为空的标签生效',
    overwrite: '这会覆盖所有已有的副文本',
    none: '不转换标签'
}

async function convertAll(){
    if(convertingAll.value)
        return
    const staMode = pinyinBatchStaName.value
    const tagMode = pinyinBatchTextTag.value
    if(staMode == 'none' && tagMode == 'none'){
        showPop('两项都选择了不转换', 'info')
        return
    }
    if(!window.confirm(`确定要一键拼音转换？\n站名：${staModeText[staMode]}\n标签：${tagModeText[tagMode]}`))
        return
    const globalConvert = config.value.pinyinConvert
    if(!globalConvert){
        showPop('未找到拼音转换设置', 'failed')
        return
    }
    const save = saveStore.save
    if(!save){
        showPop('未找到存档', 'failed')
        return
    }
    const presets = config.value.pinyinConvertPresets
    const optionsCache = new Map<string|null|undefined, PinyinConvertOptions|undefined>()
    function optionsFor(presetRef:string|null|undefined){
        if(!optionsCache.has(presetRef)){
            const c = resolvePinyinConvert(presetRef, presets, globalConvert)
            optionsCache.set(presetRef, c ? toPinyinOptions(c) : undefined)
        }
        return optionsCache.get(presetRef)
    }
    const stat = {
        unchanged:{sta:0, tag:0},
        changed:{sta:0, tag:0},
        skipped:{sta:0, tag:0},
        failed:{sta:0, tag:0},
        failedNames:[] as string[]
    }
    async function convertItems(kind:'sta'|'tag', items:{main:string, sub?:string, presetRef:string|null|undefined, write:(v:string)=>void}[], overwrite:boolean){
        for(const item of items){
            const options = optionsFor(item.presetRef)
            if(!options){
                //该项设置为“不转换”
                stat.skipped[kind]++
                continue
            }
            if(!overwrite && item.sub?.trim()){
                stat.skipped[kind]++
                continue
            }
            const res = await convertPinyinLocal(item.main, options)
            if(res === null){
                stat.failed[kind]++
                stat.failedNames.push(item.main)
                continue
            }
            if(res === item.sub){
                stat.unchanged[kind]++
                continue
            }
            item.write(res)
            stat.changed[kind]++
        }
    }
    convertingAll.value = true
    convertResult.value = undefined
    try{
        if(staMode != 'none')
            await convertItems('sta',
                save.points.filter(p=>saveStore.isNamedPt(p)).map(p=>({
                    main: p.name ?? '',
                    sub: p.nameS,
                    presetRef: p.pinyinConvertPreset,
                    write: (v:string)=>{ p.nameS = v }
                })),
                staMode == 'overwrite')
        if(tagMode != 'none')
            await convertItems('tag',
                save.textTags.filter(t=>!!t.text?.trim()).map(t=>({
                    main: t.text ?? '',
                    sub: t.textS,
                    presetRef: t.pinyinConvertPreset,
                    write: (v:string)=>{ t.textS = v }
                })),
                tagMode == 'overwrite')
    }finally{
        convertingAll.value = false
    }
    convertResult.value = stat
    if(stat.changed.sta || stat.changed.tag){
        preventLeaving()
        envStore.rerender([], [])
    }
}

const failedNamesText = computed(()=>{
    const names = convertResult.value?.failedNames
    if(!names?.length)
        return ''
    const shown = names.slice(0, 10).join('、')
    return names.length > 10 ? `${shown}等${names.length}个名称` : shown
})
</script>

<template>
<ConfigSection :title="'站名拼音转换'" @hide="convertResult = undefined">
<table v-if="config.pinyinConvert">
    <PinyinConvertFields :settings="config.pinyinConvert"/>
    <tbody>
        <tr>
            <td>tab键<br/>使用</td>
            <td>
                <input v-model="tabForPinyinConvert" type="checkbox"> 
            </td>
        </tr>
        <tr>
            <td colspan="2">
                <div class="smallNote">
                    <p>关于“tab键使用”选项：</p>
                    <p>1.输入主站名后，按tab键可切换为选中副站名输入框，勾选此项后使用tab切换到副站名时会自动进行一次拼音转换</p>
                    <p>2.注意：为避免覆盖，仅在副站名为空时生效</p>
                    <p>3.本设置与存档无关，仅保存在浏览器里</p>
                    <p>4.提示：选中车站后，第一次按tab可开始输入主站名，第二次按tab即自动生成副站名</p>
                </div>
            </td>
        </tr>
        <tr>
            <td colspan="2">
                <div class="presetTitle">预设列表</div>
                <div v-for="p in config.pinyinConvertPresets" :key="p.name" class="presetRow">
                    <span class="presetName">{{ p.name }}</span>
                    <button class="lite" @click="openPresetPrompt(p)">设置</button>
                </div>
                <div v-if="!config.pinyinConvertPresets.length" class="presetEmpty">
                    暂无预设<br/>
                    添加预设，并在站名/标签处设置使用哪个预设，可以实现默认规则之外的特殊转换
                </div>
                <button class="ok lite" @click="addPreset()">+新建预设</button>
            </td>
        </tr>
        <tr>
            <td colspan="2">
                <div class="presetTitle">一键转换全图</div>
                <select v-model="pinyinBatchStaName" class="batchModeSelect">
                    <option value="skipExist">转换全部站名(跳过已有)</option>
                    <option value="overwrite">转换全部站名(覆盖已有)</option>
                    <option value="none">不转换站名</option>
                </select>
                <select v-model="pinyinBatchTextTag" class="batchModeSelect">
                    <option value="skipExist">转换全部标签(跳过已有)</option>
                    <option value="overwrite">转换全部标签(覆盖已有)</option>
                    <option value="none">不转换标签</option>
                </select>
                <button class="confirm convertAllBtn" :disabled="convertingAll" @click="convertAll">一键转换全部</button>
                <div v-if="convertResult" class="convertResult">
                    <p><span>未改动</span><span>{{ countText(convertResult.unchanged) }}</span></p>
                    <p><span>已改动</span><span>{{ countText(convertResult.changed) }}</span></p>
                    <p><span>跳过</span><span>{{ countText(convertResult.skipped) }}</span></p>
                    <p><span>失败</span><span>{{ countText(convertResult.failed) }}</span></p>
                    <p v-if="convertResult.failedNames.length" class="failedNames">{{ failedNamesText }}</p>
                </div>
            </td>
        </tr>
    </tbody>
</table>

<Prompt v-if="presetPromptShow && editingPreset" :bg-click-close="true" @close="closePresetPrompt">
    <div class="presetModal">
        <div class="presetModalTitle">拼音转换预设</div>
        <div class="presetNameField">
            <span>名称</span>
            <input v-model="presetNameDraft" :maxlength="PINYIN_PRESET_NAME_MAX" @blur="applyPresetName"/>
        </div>
        <table>
            <PinyinConvertFields :settings="editingPreset.convert"/>
        </table>
        <div class="presetOps">
            <button class="cancel" @click="deletePreset()">删除</button>
            <button class="ok" @click="closePresetPrompt()">完成</button>
        </div>
    </div>
</Prompt>
</ConfigSection>
</template>

<style lang="scss" scoped>
.smallNote{
    text-align: left;
}
.presetTitle{
    font-size: 14px;
    font-weight: bold;
    margin-bottom: 4px;
}
.presetRow{
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 3px 0;
    padding: 3px 0;
    border-bottom: 1px solid #ddd;
    .presetName{
        font-size: 14px;
        word-break: break-all;
    }
    button{
        font-size: 14px;
    }
}
.presetEmpty{
    font-size: 13px;
    color: #999;
    margin: 10px 0px;
}
.addPresetBtn{
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin: 6px 0 0;
}
.batchModeSelect{
    display: block;
    max-width: unset;
    margin: 3px auto !important;
    box-sizing: border-box;
    font-size: 14px;
    margin: 4px 0;
}
.convertAllBtn{
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-left: 0;
    margin-right: 0;
    &:disabled{
        background-color: #999;
        cursor: default;
    }
}
.convertResult{
    margin: 6px 10px;
    font-size: 14px;
    color: #999;
    p{
        display: flex;
        justify-content: space-between;
        margin-top: 4px;
    }
    p.failedNames{
        display: block;
        text-align: left;
        word-break: break-all;
    }
}
.presetModal{
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 240px;
    .presetModalTitle{
        font-weight: bold;
        font-size: 14px;
        text-align: center;
    }
    .presetNameField{
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 13px;
        input{
            width: 180px;
            font-size: 13px;
        }
    }
    .presetOps{
        display: flex;
        justify-content: center;
        gap: 8px;
        margin-top: 4px;
    }
}
</style>
