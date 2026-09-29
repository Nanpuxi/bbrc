<script setup lang="ts">
import { useConfigStore } from 'aarc-core/models/stores/configStore';
import { storeToRefs } from 'pinia';
import ConfigSection from './shared/ConfigSection.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { PinyinCaseType, PinyinVariantType, PinyinUStyle, convertPinyinLocal, parsePinyinRules } from 'aarc-core/components/composables/pinyinConverter';
import { useEditorLocalConfigStore, type PinyinBatchMode } from 'aarc-core/app/localConfig/editorLocalConfig';
import { usePreventLeavingUnsavedStore } from 'aarc-core/utils/eventUtils/preventLeavingUnsaved';
import { useSaveStore } from 'aarc-core/models/stores/saveStore';
import { useEnvStore } from 'aarc-core/models/stores/envStore';
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents';

const { config } = storeToRefs(useConfigStore())
const { tabForPinyinConvert, pinyinBatchStaName, pinyinBatchTextTag } = storeToRefs(useEditorLocalConfigStore())
const { preventLeaving } = usePreventLeavingUnsavedStore()
const saveStore = useSaveStore()
const envStore = useEnvStore()
const { showPop } = useUniqueComponentsStore()

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

watch(()=>config.value.pinyinConvert, ()=>{
    preventLeaving()
}, {deep:true})

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
    const c = config.value.pinyinConvert
    if(!c){
        showPop('未找到拼音转换设置', 'failed')
        return
    }
    const save = saveStore.save
    if(!save){
        showPop('未找到存档', 'failed')
        return
    }
    const options = {
        rules: parsePinyinRules(c.rules),
        spaceBetweenChars: c.spaceBetweenChars,
        caseType: c.caseType,
        variantType: c.variantType,
        uStyle: c.uStyle,
        ueStyle: c.ueStyle
    }
    const stat = {
        unchanged:{sta:0, tag:0},
        changed:{sta:0, tag:0},
        skipped:{sta:0, tag:0},
        failed:{sta:0, tag:0},
        failedNames:[] as string[]
    }
    async function convertItems(kind:'sta'|'tag', items:{main:string, sub?:string, write:(v:string)=>void}[], overwrite:boolean){
        for(const item of items){
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
                    write: (v:string)=>{ p.nameS = v }
                })),
                staMode == 'overwrite')
        if(tagMode != 'none')
            await convertItems('tag',
                save.textTags.filter(t=>!!t.text?.trim()).map(t=>({
                    main: t.text ?? '',
                    sub: t.textS,
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
    <tbody>
        <tr>
            <td style="min-width: 50px;">大小写</td>
            <td>
                <select v-model="config.pinyinConvert.caseType">
                    <option :value="PinyinCaseType.Pascal">每字首字母大写</option>
                    <option :value="PinyinCaseType.FirstUpper">整体首字母大写</option>
                    <option :value="PinyinCaseType.AllUpper">全大写</option>
                    <option :value="PinyinCaseType.AllLower">全小写</option>
                </select>
            </td>
        </tr>
        <tr>
            <td style="min-width: 50px;">方言</td>
            <td>
                <select v-model="config.pinyinConvert.variantType">
                    <option :value="PinyinVariantType.Mandarin">普通话</option>
                    <option :value="PinyinVariantType.Cantonese">广东话</option>
                </select>
            </td>
        </tr>
        <tr>
            <td>字间<br/>空格</td>
            <td>
                <input v-model="config.pinyinConvert.spaceBetweenChars" type="checkbox">
            </td>
        </tr>
        <tr>
            <td>绿</td>
            <td>
                <select v-model="config.pinyinConvert.uStyle">
                    <option :value="undefined">默认</option>
                    <option :value="PinyinUStyle.U">lu</option>
                    <option :value="PinyinUStyle.Umlaut">lü</option>
                    <option :value="PinyinUStyle.V">lv</option>
                </select>
            </td>
        </tr>
        <tr>
            <td>略</td>
            <td>
                <select v-model="config.pinyinConvert.ueStyle">
                    <option :value="undefined">默认</option>
                    <option :value="PinyinUStyle.U">lue</option>
                    <option :value="PinyinUStyle.Umlaut">lüe</option>
                    <option :value="PinyinUStyle.V">lve</option>
                </select>
            </td>
        </tr>
        <tr>
            <td>
                自定义<br/>规则
            </td>
            <td>
                <textarea v-model="config.pinyinConvert.rules"></textarea>
            </td>
        </tr>
        <tr>
            <td colspan="2">
                <div class="smallNote">
                    <p>根据个人需求添加更多翻译规则，例如:</p>
                    <p class="example-p">大学:University、会展中心:Expo Center</p>
                    <p class="example-p">南站:South Rwy Sta、城市名:城市英文名</p>
                    <p>^表示开头处、$表示结尾处，例如:</p>
                    <p class="example-p">^省:provincial、站$:Rwy Sta</p>
                    <p>^$在右侧同样可以使用，例如:</p>
                    <p class="example-p">北$:^North、东$:^East</p>
                    <p class="example-p">李家村东→East LiJiaCun</p>
                </div>
            </td>
        </tr>
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
                <button class="confirm convertAllBtn" :disabled="convertingAll" @click="convertAll">一键转换全部</button>
                <select v-model="pinyinBatchStaName" class="batchModeSelect">
                    <option value="skipExist">转换站名(跳过已有)</option>
                    <option value="overwrite">转换站名(覆盖已有)</option>
                    <option value="none">不转换站名</option>
                </select>
                <select v-model="pinyinBatchTextTag" class="batchModeSelect">
                    <option value="skipExist">转换标签(跳过已有)</option>
                    <option value="overwrite">转换标签(覆盖已有)</option>
                    <option value="none">不转换标签</option>
                </select>
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
</ConfigSection>
</template>

<style lang="scss" scoped>
textarea{
    width: 180px;
    height: 205px;
}
.smallNote{
    text-align: left;
}
.example-p{
    margin-left: 10px;
}
.batchModeSelect{
    display: block;
    width: 100%;
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
</style>