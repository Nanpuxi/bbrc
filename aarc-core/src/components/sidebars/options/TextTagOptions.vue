<script setup lang="ts">
import { LineType, TextTag } from 'aarc-core/models/save';
import { computed, ref, useTemplateRef, watch } from 'vue';
import { useSaveStore } from 'aarc-core/models/stores/saveStore';
import SideBar from '../../common/SideBar.vue';
import { AuColorPicker } from '@aurouscia/au-color-picker';
import { useConfigStore } from 'aarc-core/models/stores/configStore';
import { useIconStore } from 'aarc-core/models/stores/iconStore';
import { storeToRefs } from 'pinia';
import FontInput from '../shared/FontInput.vue';
import AngleInput from '../shared/AngleInput.vue';

const cs = useConfigStore()
const saveStore = useSaveStore()
const iconStore = useIconStore()
const { prefixSelected } = storeToRefs(iconStore)

const sidebar = useTemplateRef('sidebar')
const picker1 = useTemplateRef('picker1')
const picker2 = useTemplateRef('picker2')

const editing = ref<TextTag>()
const pinyinPresetRefStale = computed(()=>{
    const ref = editing.value?.pinyinConvertPreset
    return typeof ref === 'string' && !cs.config.pinyinConvertPresets.some(p=>p.name===ref)
})
function startEditing(tag: TextTag) {
    editing.value = tag
    if(tag.forId && tag.padding === undefined)
        tag.padding = 0
    if(tag.forId && tag.width === undefined)
        tag.width = 0
    if(!tag.textOp) 
        tag.textOp = { size:0, color: cs.config.textTagFontColorHex }
    if(!tag.textSOp)
        tag.textSOp = { size:0, color: cs.config.textTagSubFontColorHex }
    if(!tag.opacity)
        tag.opacity = 1
    if(tag.zIndex === undefined)
        tag.zIndex = 0
    picker1.value?.enforceTo(tag.textOp?.color || '#000000')
    picker2.value?.enforceTo(tag.textSOp?.color || '#000000')
    iconStore.enforcePrefixSelectedTo(tag.icon??0)
    sidebar.value?.extend()
}

const editingDropCapActualEnabled = computed(()=>{
    return editing.value?.dropCap ?? cs.config.textTagForLineDropCap
})

const editingForLine = computed(()=>{
    const forId = editing.value?.forId
    if(!forId)
        return
    return saveStore.getLineById(forId)
})

function ensureIconInSelection(){
    if(editing.value){
        if(!editing.value.icon || !iconStore.prefixedIcons.some(x=>x.i.id===editing.value?.icon)){
            editing.value.icon = iconStore.prefixedIcons.at(0)?.i.id ?? -1
        }
    }
}
function turnOffIcon(){
    if(editing.value && window.confirm('确认关闭该标签的图标？')){
        editing.value.icon = undefined
    }
}
watch(()=>editing.value, ()=>{
    //开销不大
    emit('changed')
}, {deep:true})

const emit = defineEmits<{
    (e:'changed'):void
}>()
defineExpose({
    startEditing
})
</script>

<template>
<SideBar ref="sidebar" @click="picker1?.closePanel();picker2?.closePanel()">
    <div v-if="editing" class="options">
        <h2>标签设置</h2>
        <div class="optionSection">
            <table class="fullWidth"><tbody>
                <tr>
                    <td>坐标</td>
                    <td class="coord">
                        <input type="number" v-model="editing.pos[0]"/><br/>
                        <input type="number" v-model="editing.pos[1]"/>
                    </td>
                </tr>
                <tr v-if="!editing.forId">
                    <td>图标</td>
                    <td>
                        <button v-if="!editing.icon" class="lite confirm" @click="ensureIconInSelection">启用图标</button>
                        <button v-else @click="turnOffIcon" class="lite">关闭图标</button>
                        <div v-if="editing.icon">
                            <select v-model="prefixSelected" @change="ensureIconInSelection" class="iconSelect">
                                <option v-for="ip in iconStore.prefixes" :value="ip">{{ ip }}</option>
                            </select><br/>
                            <select v-model="editing.icon" class="iconSelect">
                                <option v-for="ic in iconStore.prefixedIcons" :value="ic.i.id">{{ ic.i.name }}</option>
                            </select>
                        </div>
                        <div class="smallNote">“设置-文本标签图标”<br/>中可添加更多图标以及调整尺寸</div>
                    </td>
                </tr>
                <tr v-if="editing.forId">
                    <td>边距</td>
                    <td>
                        <div class="viewableRange">
                            <input type="range" v-model="editing.padding" :min="0" :max="5" :step="0.25"/>
                            <input type="number" v-model="editing.padding" :min="0" :max="5"/>
                            <div class="smallNote">设为0使用全局设置</div>
                            <div class="smallNote">仅对线路名称标签有效</div>
                        </div>
                    </td>
                </tr>
                <tr>
                    <td>横向<br/>锚点</td>
                    <td>
                        <select v-model="editing.anchorX">
                            <option :value="undefined">默认</option>
                            <option :value="1">左侧</option>
                            <option :value="0">中心</option>
                            <option :value="-1">右侧</option>
                        </select>
                    </td>
                </tr>
                <tr>
                    <td>纵向<br/>锚点</td>
                    <td>
                        <select v-model="editing.anchorY">
                            <option :value="undefined">默认</option>
                            <option :value="1">顶部</option>
                            <option :value="0">中心</option>
                            <option :value="-1">底部</option>
                        </select>
                    </td>
                </tr>
                <tr>
                    <td>文字<br/>对齐</td>
                    <td>
                        <select v-model="editing.textAlign">
                            <option :value="undefined">默认</option>
                            <option :value="null">跟随横向锚点</option>
                            <option :value="1">靠左</option>
                            <option :value="0">居中</option>
                            <option :value="-1">靠右</option>
                        </select>
                    </td>
                </tr>
                <tr>
                    <td>旋转</td>
                    <td>
                        <AngleInput v-model="editing.angle"/>
                        <div class="smallNote">单位：角度制</div>
                    </td>
                </tr>
                <tr v-if="editing.forId">
                    <td>宽度</td>
                    <td>
                        <div class="viewableRange">
                            <input type="range" v-model="editing.width" :min="0" :max="300" :step="5"/>
                            <input type="number" v-model="editing.width" :min="0" :step="1"/>
                            <div class="smallNote">如果短于指定宽度<br/>将会向锚点对侧拉长</div>
                            <div class="smallNote">设为0使用默认值</div>
                        </div>
                    </td>
                </tr>
                <tr v-if="editing.forId && editingForLine?.type===LineType.common">
                    <td>文字<br/>颜色</td>
                    <td>
                        <div class="selectItem">
                            <select v-model="editingForLine.tagTextColor">
                                <option :value="undefined">自动颜色</option>
                                <option :value="'black'">固定黑色</option>
                                <option :value="'white'">固定白色</option>
                            </select>
                        </div>
                        <div class="smallNote">此项是线路下所有<br/>线路名标签共享</div>
                    </td>
                </tr>
                <tr v-if="editing.forId">
                    <td :rowspan="editingDropCapActualEnabled ? 2 : 1">数字<br/>放大</td>
                    <td>
                        <select v-model="editing.dropCap">
                            <option :value="undefined">默认</option>
                            <option :value="true">开启</option>
                            <option :value="false">关闭</option>
                        </select>
                        <div class="smallNote">若字母数字+"线"结尾</div>
                        <div class="smallNote">将会无视文字对齐</div>
                    </td>
                </tr>
                <tr v-if="editing.forId && editingDropCapActualEnabled">
                    <td>
                        <button v-if="editing.dropCapLength===undefined" class="lite confirm" @click="editing.dropCapLength=1">
                            启用长度设定(当前自动)
                        </button>
                        <template v-else>
                            <button class="lite" @click="editing.dropCapLength=undefined">
                                关闭长度设定(设为自动)
                            </button>
                            <div class="viewableRange" style="margin-top: 10px;">
                                <input v-model.number="editing.dropCapLength" type="range" min="0" max="8"/>
                                <div class="smallNote">{{ editing.dropCapLength }}</div>
                            </div>
                        </template>
                    </td>
                </tr>
                <tr v-if="!editing.forId">
                    <td>去除<br/>白边</td>
                    <td>
                        <input type="checkbox" v-model="editing.removeCarpet"/>
                        <div class="smallNote">标签将不会有底层的白边</div>
                    </td>
                </tr>
                <tr v-if="!editing.forId">
                    <td>不透<br/>明度</td>
                    <td>
                        <div class="viewableRange">
                            <input type="range" v-model.number="editing.opacity" :min="0.05" :max="1" :step="0.05"/>
                            <input type="number" v-model.number="editing.opacity" :min="0.05" :max="1" :step="0.05"/>
                            <div class="smallNote">配合“去除白边”使用</div>
                        </div>
                    </td>
                </tr>
                <tr>
                    <td>置底</td>
                    <td>
                        <input type="checkbox" v-model="editing.sunken"/>
                        <div class="smallNote">标签将置于线路下方，用于区划名</div>
                    </td>
                </tr>
                <tr>
                    <td>层级</td>
                    <td>
                        <div class="viewableRange">
                            <input type="range" v-model.number="editing.zIndex" :min="-9" :max="9" :step="1"/>
                            <input type="number" v-model.number.lazy="editing.zIndex"/>
                            <div class="smallNote">控制标签的显示顺序<br/>高层级会盖住低层级</div>
                            <div class="smallNote">当前：{{ editing.zIndex ?? 0 }}</div>
                            <div class="smallNote" v-if="editing.sunken">“置底”的标签仍整体<br/>位于线路下方</div>
                        </div>
                    </td>
                </tr>
                <tr>
                    <td>拼音<br/>转换</td>
                    <td>
                        <select v-model="editing.pinyinConvertPreset">
                            <option :value="undefined">跟随存档默认</option>
                            <option :value="null">不转换</option>
                            <option v-if="pinyinPresetRefStale" :value="editing.pinyinConvertPreset">预设已失效</option>
                            <option v-for="p in cs.config.pinyinConvertPresets" :key="p.name" :value="p.name">{{ p.name }}</option>
                        </select>
                        <div class="smallNote">此项决定本标签的副文本<br/>用哪份设置做拼音转换</div>
                    </td>
                </tr>
                <tr v-if="editing.forId">
                    <td colspan="2" class="smallNote">
                        以上设置部分可在“设置”侧栏<br/>
                        定义全局默认值
                    </td>
                </tr>
            </tbody></table>
        </div>
        <h2>主文字样式</h2>
        <div class="optionSection">
            <table class="fullWidth"><tbody>
                <tr v-if="!editing.forId">
                    <td>颜色</td>
                    <td class="colorPickerTd" v-if="editing.textOp">
                        <AuColorPicker ref="picker1" v-model="editing.textOp.color" :pos="-120"
                            @done="emit('changed')"
                            :panel-click-stop-propagation="true" :entry-respond-delay="1">
                        </AuColorPicker>
                    </td>
                </tr>
                <tr>
                    <td>大小</td>
                    <td>
                        <div class="viewableRange" v-if="editing.textOp">
                            <input type="range" v-model="editing.textOp.size" :min="0" :max="5" :step="0.05"/>
                            <input type="number" v-model="editing.textOp.size" :min="0" :max="16" :step="0.05"/>
                            <div class="smallNote">设为0使用全局设置</div>
                        </div>
                    </td>
                </tr>
                <tr v-if="!editing.forId">
                    <td>字体</td>
                    <td v-if="editing.textOp">
                        <FontInput :allow-undefined="true"
                            v-model="editing.textOp.font"
                            v-model:font-style="editing.textOp.style"
                            v-model:font-weight="editing.textOp.weight"
                            ></FontInput>
                    </td>
                </tr>
            </tbody></table>
        </div>
        <h2>副文字样式</h2>
        <div class="optionSection">
            <table class="fullWidth"><tbody>
                <tr v-if="!editing.forId">
                    <td>颜色</td>
                    <td class="colorPickerTd" v-if="editing.textSOp">
                        <AuColorPicker ref="picker2" v-model="editing.textSOp.color" :pos="-120"
                            @done="emit('changed')"
                            :panel-click-stop-propagation="true" :entry-respond-delay="1">
                        </AuColorPicker>
                    </td>
                </tr>
                <tr>
                    <td>大小</td>
                    <td>
                        <div class="viewableRange" v-if="editing.textSOp">
                            <input type="range" v-model="editing.textSOp.size" :min="0" :max="5" :step="0.05"/>
                            <input type="number" v-model="editing.textSOp.size" :min="0" :max="16" :step="0.05"/>
                            <div class="smallNote">设为0使用全局设置</div>
                        </div>
                    </td>
                </tr>
                <tr v-if="!editing.forId">
                    <td>字体</td>
                    <td v-if="editing.textSOp">
                        <FontInput :allow-undefined="true"
                            v-model="editing.textSOp.font"
                            v-model:font-style="editing.textSOp.style"
                            v-model:font-weight="editing.textSOp.weight"
                            ></FontInput>
                    </td>
                </tr>
            </tbody></table>
        </div>
    </div>
    <div class="smallNote" style="text-align: center;"><b>
        提示：右键点击文本标签可直接打开本菜单
    </b></div>
</SideBar>
</template>

<style scoped lang="scss">
.iconSelect{
    min-width: 100px;
    max-width: 170px;
}
</style>