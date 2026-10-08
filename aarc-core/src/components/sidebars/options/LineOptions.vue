<script setup lang="ts">
import SideBar from 'aarc-core/components/common/SideBar.vue';
import { Line, LineStyle, LineType } from 'aarc-core/models/save';
import { useEnvStore } from 'aarc-core/models/stores/envStore';
import { useSaveStore } from 'aarc-core/models/stores/saveStore';
import { storeToRefs } from 'pinia';
import { computed, CSSProperties, onMounted, ref, useTemplateRef, watch } from 'vue';
import ColorPickerForLine from '../shared/ColorPickerForLine.vue';
import ColorPickerForTerrain from '../shared/ColorPickerForTerrain.vue';
import { AuColorPicker } from '@aurouscia/au-color-picker';
import { useLineStateStore } from 'aarc-core/models/stores/saveDerived/state/lineStateStore';
import { useLineSpanStore } from 'aarc-core/models/stores/saveDerived/slice/lineSpanStore';
import { useConfigStore } from 'aarc-core/models/stores/configStore';
import { detectLineAttachEnd, attachesOfEnd, LINE_GRADIENT_AUTO_RANGE } from 'aarc-core/utils/lineUtils/lineGradient';


const envStore = useEnvStore()
const saveStore = useSaveStore()
const lineStateStore = useLineStateStore()
const lineSpanStore = useLineSpanStore()
const cs = useConfigStore()
const { save } = storeToRefs(saveStore)
const props = defineProps<{
    line:Line,
    lineTypeCalled:string,
    lineWidthRange:{
        min:number,
        max:number,
        step:number
    }
}>()
const selectableLineStyles = computed<LineStyle[]>(()=>{
    return save.value?.lineStyles?.map(x=>{
        const copy = {...x}
        if(!copy.name){
            copy.name = '未命名样式'
        }
        return copy
    }) || []
})

const lineStyleShadowedBySlices = computed(()=>
    lineSpanStore.isLineStyleFullyShadowedBySlices(props.line.id)
)

function isInSameFamily(line:Line){
    const p = props.line
    if(line.id===p.id)
        return true
    if(line.parent && line.parent===p.parent)
        return true
    if(line.id===p.parent || line.parent===p.id)
        return true
    return false
}
const lineZIndexSameLines = computed<{n:string,c:string}[]>(()=>{
    if(!props.line.zIndex)
        return []
    const sameLines = saveStore.save?.lines.filter(x=>{
        if(x.parent)
            return false
        if(isInSameFamily(x))
            return false
        if(x.zIndex!==props.line.zIndex)
            return false
        return true
    })
    return sameLines?.map(x=>{
        return {n:x.name||'未命名线路', c:lineStateStore.getLineActualColor(x)}
    }) ?? []
})

const myUsableLineGroups = computed(()=>{
    return save.value?.lineGroups?.filter(x=>x.lineType===props.line.type) || []
})

const selectableParent = computed<Line[]>(()=>{
    return save.value?.lines.filter(x=>{
        return x.type === LineType.common && !x.parent && x.id !== props.line.id
    }) ?? []
})
const selectedForParentAssignment = ref<number>()
function assignParent(){
    if(selectedForParentAssignment.value){
        const parentLine = saveStore.getLineById(selectedForParentAssignment.value)
        if(parentLine){
            props.line.parent = selectedForParentAssignment.value
            envStore.ensureChildrenOptionsSame(parentLine.id)
            saveStore.ensureLinesOrdered()
            envStore.rerender([], [])
        }
    }
}
const haveChildren = computed(()=>{
    return saveStore.save?.lines.some(x=>x.parent && x.parent == props.line.id) || false
})
const haveParent = computed(()=>!!props.line.parent)

// 支线渐变色（gradient 存在即启用）
const gradient = computed(()=>props.line.gradient)
const gradientAttach = computed(()=>{
    if(!props.line.gradient)
        return undefined
    return detectLineAttachEnd(props.line, save.value?.lines)
})
// 目标颜色三种模式：自动（null/null）/ 手动指定（targetColor）/ 指定线路（targetLine）
const gradientTargetMode = computed(()=>{
    const g = props.line.gradient
    if(!g)
        return 'auto'
    if(g.targetLine != null)
        return 'line'
    if(g.targetColor != null)
        return 'manual'
    return 'auto'
})
/** 本线路两端"接着"的所有其他线路（指定线路模式的候选；同一端有多条时全部列出；排除 parent） */
const gradientConnectedLines = computed(()=>{
    const lines = save.value?.lines
    if(!lines)
        return []
    const res: Line[] = []
    for(const end of [0, 1] as const){
        for(const l of attachesOfEnd(props.line, lines, end)){
            if(l.id === props.line.parent || res.some(x => x.id === l.id))
                continue
            res.push(l)
        }
    }
    return res
})
const gradientTargetLineId = computed<number|undefined>({
    get: () => props.line.gradient?.targetLine ?? undefined,
    set: (v) => {
        const g = props.line.gradient
        if(g)
            g.targetLine = v ?? null
    }
})
function setGradientTargetMode(mode: string){
    const g = props.line.gradient
    if(!g)
        return
    if(mode === 'manual'){
        g.targetLine = null
        g.targetColor = lineStateStore.getLineActualColor(props.line)
    }
    else if(mode === 'line'){
        g.targetColor = null
        const connected = gradientConnectedLines.value
        if(g.targetLine == null || g.targetLine === props.line.parent
            || !connected.some(x => x.id === g.targetLine))
            g.targetLine = connected[0]?.id ?? null
    }
    else{
        g.targetLine = null
        g.targetColor = null
    }
}
const gradientTargetColor = computed<string|undefined>({
    get: () => props.line.gradient?.targetColor ?? undefined,
    set: (v) => {
        const g = props.line.gradient
        if(g)
            g.targetColor = v
    }
})
function enableGradient(){
    props.line.gradient = { range: [...LINE_GRADIENT_AUTO_RANGE] }
}
function disableGradient(){
    if(window.confirm('确定要关闭本线路的渐变色吗？这会使设置丢失')){
        props.line.gradient = undefined
    }
}
function setGradientAngleMode(manual: boolean){
    const g = props.line.gradient
    if(!g)
        return
    g.angle = manual ? (g.angle ?? 0) : undefined
}
const gradientAngleDeg = computed({
    get: () => {
        const a = props.line.gradient?.angle
        return a === undefined ? 0 : Math.round(a * 180 / Math.PI * 10) / 10
    },
    set: (v: number) => {
        const g = props.line.gradient
        if(g)
            g.angle = v * Math.PI / 180
    }
})
const gradientRangeFromPct = computed({
    get: () => props.line.gradient?.range ? Math.round(props.line.gradient.range[0] * 100) : 25,
    set: (v: number) => {
        const g = props.line.gradient
        if(!g)
            return
        const range = g.range ?? [...LINE_GRADIENT_AUTO_RANGE]
        const pct = Math.min(100, Math.max(0, v))
        const other = Math.round(range[1] * 100)
        // 第一个必须 <= 第二个；不合法时交换两值
        g.range = pct > other ? [other / 100, pct / 100] : [pct / 100, other / 100]
    }
})
const gradientRangeToPct = computed({
    get: () => props.line.gradient?.range ? Math.round(props.line.gradient.range[1] * 100) : 75,
    set: (v: number) => {
        const g = props.line.gradient
        if(!g)
            return
        const range = g.range ?? [...LINE_GRADIENT_AUTO_RANGE]
        const pct = Math.min(100, Math.max(0, v))
        const other = Math.round(range[0] * 100)
        // 第一个必须 <= 第二个；不合法时交换两值
        g.range = pct < other ? [pct / 100, other / 100] : [other / 100, pct / 100]
    }
})
let gradientReportTimer = 0
watch(() => props.line.gradient, () => {
    window.clearTimeout(gradientReportTimer)
    gradientReportTimer = window.setTimeout(() => {
        envStore.lineInfoChanged(props.line)
    }, 500)
}, { deep: true })

const picker0 = useTemplateRef('picker0')
const picker1 = useTemplateRef('picker1')
const gradientPicker = useTemplateRef('gradientPicker')
function closePickers(){
    picker0.value?.close()
    picker1.value?.close()
    gradientPicker.value?.closePanel()
}
const pickerEntryStyles:CSSProperties = {
    width: '240px', height: '26px'
}

/**
 * 防抖机制：停止操作一段时间后触发重绘，且按需重新计算车站团
 * 通过 watch 监听线路属性变化，自动聚合 staSizeChanged
 */
let reportExecTimer = 0
let reportExecSizeChanged = false
const sizeRelatedFields = new Set<keyof Line>(['width', 'style', 'ptSize', 'ptSnapSize', 'ptNameSnapSize'])
watch(() => {
    const l = props.line
    return {
        name: l.name,
        nameSub: l.nameSub,
        width: l.width,
        style: l.style,
        ptNameSize: l.ptNameSize,
        ptNameSSize: l.ptNameSSize,
        ptNameSnapSize: l.ptNameSnapSize,
        ptSize: l.ptSize,
        ptSnapSize: l.ptSnapSize,
        isFilled: l.isFilled,
        carpet: l.carpet,
        carpetWidth: l.carpetWidth,
        carpetOpacity: l.carpetOpacity,
        zIndex: l.zIndex,
        tagTextColor: l.tagTextColor,
        cap: l.cap,
        isFake: l.isFake,
    }
}, (newVal, oldVal) => {
    if (!oldVal) return
    const changedFields = Object.keys(newVal).filter(k =>
        (newVal as any)[k] !== (oldVal as any)[k]
    ) as (keyof Line)[]
    const staSizeChanged = changedFields.some(f => sizeRelatedFields.has(f))
    window.clearTimeout(reportExecTimer)
    reportExecSizeChanged = reportExecSizeChanged || staSizeChanged
    reportExecTimer = window.setTimeout(() => {
        envStore.lineInfoChanged(props.line, reportExecSizeChanged)
        reportExecSizeChanged = false
    }, 500)
}, { deep: false })

const sidebar = useTemplateRef('sidebar')
defineExpose({
    open: ()=>{sidebar.value?.extend()}, 
    fold: ()=>{sidebar.value?.fold()}
})
const emit = defineEmits<{
    (e:'colorUpdated'):void
    (e:'openSliceEditor'):void
}>()

function init(){
    ensureLineNumOptionsNum()
    const gId = props.line.group
    const group = myUsableLineGroups.value.find(x=>x.id===gId)
    if(!group)
        props.line.group = undefined
}
watch(props.line, ()=>{
    ensureLineNumOptionsNum()
})
function ensureLineNumOptionsNum(){
    props.line.width ||= 1
    props.line.style ||= 0
    props.line.ptNameSize ||= 0
    props.line.ptNameSSize ||= 0
    props.line.ptNameSnapSize ||= 0
    props.line.ptSnapSize ||= 0
    props.line.ptSize ||= 0
    props.line.zIndex ||= 0
}

function foldHander(){
    if(envStore.activeLine){
        envStore.cancelActive()
        envStore.closeOps()
    }
}

onMounted(()=>{
    init()
})
</script>

<template>
<SideBar ref="sidebar" @extend="init" @click="closePickers" @fold="foldHander">
<div class="options">
    <table class="fullWidth"><tbody>
    <tr>
        <td colspan="2" class="nameAndColorTd">
            <div>
                <input v-model.lazy.trim="line.name" placeholder="请输入线路名称"/>
                <input v-model.lazy.trim="line.nameSub" placeholder="请输入线路副名称"/>
                <template v-if="!haveParent">
                    <ColorPickerForLine ref="picker0" v-if="line.type===LineType.common" :line="line"
                        :entry-styles="pickerEntryStyles" @color-updated="emit('colorUpdated')"></ColorPickerForLine> 
                    <ColorPickerForTerrain ref="picker1" v-if="line.type===LineType.terrain" :line="line"
                        :entry-styles="pickerEntryStyles" @color-updated="emit('colorUpdated')"></ColorPickerForTerrain>
                </template>
            </div>
        </td>
    </tr>
    <template v-if="!haveParent">
    <tr>
        <td>分组</td>
        <td>
            <select v-model="line.group" @change="saveStore.ensureLinesOrdered();envStore.lineInfoChanged(line)">
                <option :value="undefined">默认分组</option>
                <option v-for="group in myUsableLineGroups" :value="group.id">
                    {{ group.name }}
                </option>
            </select>
            <div class="smallNote">
                可在设置-线路组中添加可选的分组
            </div>
        </td>
    </tr>
    <tr>
        <td>线宽</td>
        <td class="viewableRange">
            <input type="range" v-model.number="props.line.width"
                :min="lineWidthRange.min"
                :max="lineWidthRange.max"
                :step="lineWidthRange.step"
                />
            <input v-if="line.type===LineType.terrain" type="number"
                v-model.number.lazy="props.line.width"/>
            <div v-else>{{ props.line.width }}×</div>
        </td>
    </tr>
    <tr v-if="line.type===LineType.common">
        <td>样式</td>
        <td>
            <select v-model="props.line.style">
                <option :value="0">默认</option>
                <option v-for="style in selectableLineStyles" :value="style.id">
                    {{ style.name }}
                </option>
            </select>
            <div v-if="lineStyleShadowedBySlices" class="smallNoteVital">
                当前线路的<b>所有区间</b>均被样式片段覆盖，本设置不会生效
            </div>
            <div v-else class="smallNote">(可在设置-线路样式<br/>自定义更多选项)</div>
        </td>
    </tr>
    <tr v-if="line.type===LineType.common">
        <td>站名</td>
        <td class="viewableRange">
            <input type="range" v-model.number="props.line.ptNameSize"
                :min="0"
                :max="2"
                :step="0.25"
                />
            <input type="number" v-model.number.lazy="props.line.ptNameSize"
                :min="0"
                :max="2"
                :step="0.05"
                />
            <div class="smallNote">(设为0使用"设置-线宽对应<br/>车站尺寸"中的全局设置)</div>
        </td>
    </tr>
    <tr v-if="line.type===LineType.common">
        <td>副站名</td>
        <td class="viewableRange">
            <input type="range" v-model.number="props.line.ptNameSSize"
                :min="0"
                :max="2"
                :step="0.25"
                />
            <input type="number" v-model.number.lazy="props.line.ptNameSSize"
                :min="0"
                :max="2"
                :step="0.05"
                />
            <div class="smallNote">(设为0使用"设置-线宽对应<br/>车站尺寸"中"副站名"的全局设置，<br/>均未设置时跟随"站名"尺寸)</div>
        </td>
    </tr>
    <tr v-if="line.type===LineType.common">
        <td>车站</td>
        <td class="viewableRange">
            <input type="range" v-model.number="props.line.ptSize"
                :min="0"
                :max="2"
                :step="0.25"
                />
            <input type="number" v-model.number.lazy="props.line.ptSize"
                :min="0"
                :max="2"
                :step="0.05"
                />
            <div class="smallNote">(设为0使用"设置-线宽对应<br/>车站尺寸"中的全局设置)</div>
        </td>
    </tr>
    <tr v-if="line.type===LineType.common">
        <td>站间<br/>吸附</td>
        <td class="viewableRange">
            <input type="range" v-model.number="props.line.ptSnapSize"
                :min="0"
                :max="2"
                :step="0.25"
                />
            <input type="number" v-model.number.lazy="props.line.ptSnapSize"
                :min="0"
                :max="2"
                :step="0.05"
                />
            <div class="smallNote">(设为0使用"设置-线宽对应<br/>车站尺寸"中的全局设置)</div>
        </td>
    </tr>
    <tr v-if="line.type===LineType.common">
        <td>站名<br/>吸附</td>
        <td class="viewableRange">
            <input type="range" v-model.number="props.line.ptNameSnapSize"
                :min="0"
                :max="2"
                :step="0.25"
                />
            <input type="number" v-model.number.lazy="props.line.ptNameSnapSize"
                :min="0"
                :max="2"
                :step="0.05"
                />
            <div class="smallNote">(设为0使用"设置-线宽对应<br/>车站尺寸"中的全局设置)</div>
        </td>
    </tr>
    <tr v-if="line.type===LineType.terrain">
        <td>填充</td>
        <td>
            <input type="checkbox" v-model="line.isFilled"/>
            <div class="smallNote">勾选本项时<br/>地形必须是环形</div>
        </td>
    </tr>
    <tr v-if="line.type===LineType.common">
        <td>白边</td>
        <td>
            <select v-model="line.carpet">
                <option :value="true">开启</option>
                <option :value="false">关闭</option>
                <option :value="undefined">默认</option>
            </select>
            <div class="smallNote">
                线路底层的白边
                <br/>默认跟随全局设置
            </div>
        </td>
    </tr>
    <tr v-if="line.type===LineType.common">
        <td>白边<br/>宽度</td>
        <td>
            <button v-if="line.carpetWidth===undefined" class="lite"
                @click="line.carpetWidth=cs.config.lineCarpetWiden">此处单独设置</button>
            <template v-else>
                <div class="viewableRange">
                    <input type="range" v-model.number="line.carpetWidth" :min="0" :max="30" :step="1"/>
                    <input type="number" v-model.number.lazy="line.carpetWidth" :min="0" :max="30" :step="1"/>
                </div>
                <button class="lite" @click="line.carpetWidth=undefined">恢复跟随全局</button>
            </template>
        </td>
    </tr>
    <tr v-if="line.type===LineType.common">
        <td>白边<br/>不透<br/>明度</td>
        <td>
            <button v-if="line.carpetOpacity===undefined" class="lite"
                @click="line.carpetOpacity=cs.config.lineCarpetOpacity">此处单独设置</button>
            <template v-else>
                <div class="viewableRange">
                    <input type="range" v-model.number="line.carpetOpacity" :min="0" :max="1" :step="0.1"/>
                    <input type="number" v-model.number.lazy="line.carpetOpacity" :min="0" :max="1" :step="0.05"/>
                </div>
                <button class="lite" @click="line.carpetOpacity=undefined">恢复跟随全局</button>
            </template>
        </td>
    </tr>
    <tr>
    <td>层级</td>
        <td class="viewableRange">
            <input type="range" v-model.number="props.line.zIndex"
                :min="-9"
                :max="9"
                :step="1"
                />
            <input type="number" v-model.number.lazy="props.line.zIndex"/>
            <div v-if="!props.line.zIndex" class="smallNote">
                控制线路的显示顺序<br/>高层级会盖住低层级
            </div>
            <div v-else-if="lineZIndexSameLines.length>0" class="smallNote sameZIndexLines">
                使用该层级的其他线路：<br/>
                <span v-for="szl in lineZIndexSameLines" :style="{color:szl.c}">{{ szl.n }}</span>
            </div>
            <div v-else class="smallNote">
                使用该层级的其他线路：<br/>
                <span>无</span>
            </div>
        </td>
    </tr>
    <tr>
        <td>标签<br/>创建</td>
        <td>
            <button @click="envStore.createTextTag(line.id)" class="minor">
                点击创建
            </button>
        </td>
    </tr>
    <tr v-if="line.type===LineType.common">
        <td>标签<br/>文字</td>
        <td>
            <div class="selectItem">
                <select v-model="line.tagTextColor">
                    <option :value="undefined">自动颜色</option>
                    <option :value="'black'">固定黑色</option>
                    <option :value="'white'">固定白色</option>
                </select>
            </div>
        </td>
    </tr>
    <tr>
        <td>片段</td>
        <td>
            <button @click="emit('openSliceEditor')" class="minor">管理片段</button>
            <div class="smallNote">管理该线路的样式片段和时间片段</div>
        </td>
    </tr>
    <tr v-if="!line.parent && line.type===LineType.common">
        <td>归为<br/>支线</td>
        <td v-if="!haveChildren">
            <select v-model="selectedForParentAssignment" style="max-width: 160px;">
                <option :value="undefined">无所属</option>
                <option v-for="l in selectableParent"
                    :value="l.id">{{ l.name ?? '未命名线路' }}</option>
            </select><br/>
            <button v-if="selectedForParentAssignment" @click="assignParent">归为选中线路的支线</button>
        </td>
        <td v-else>
            <div class="smallNote">请先删除该线路的支线</div>
        </td>
    </tr>
    <tr>
        <td>端点</td>
        <td>
            <select v-model="line.cap">
                <option :value="undefined">默认</option>
                <option :value="'butt'">方头</option>
                <option :value="'round'">圆头</option>
            </select>
        </td>
    </tr>
    <tr>
        <td>伪线</td>
        <td>
            <input v-model="line.isFake" type="checkbox"/>
            <div class="smallNote">
                如果线路是类似"图例"的作用<br/>
                请勾选，将不会出现在略缩图中<br/>
                也不会被算入线路数量
            </div>
        </td>
    </tr>
    </template>
    </tbody></table>
    <table v-if="haveParent" class="fullWidth"><tbody>
        <tr v-if="line.type===LineType.common">
            <td>样式</td>
            <td>
                <select v-model="props.line.style">
                    <option :value="-1">跟随主线</option>
                    <option :value="0">默认</option>
                    <option v-for="style in selectableLineStyles" :value="style.id">
                        {{ style.name }}
                    </option>
                </select>
                <div v-if="lineStyleShadowedBySlices" class="smallNoteVital">
                    当前线路的<b>所有区间</b>均被样式片段覆盖，此处设置不会生效
                </div>
                <template v-else>
                    <div class="smallNote">(可在设置-线路样式<br/>自定义更多选项)</div>
                    <div class="smallNote">注意：支线与主线样式不同时，<br/>分叉处的半透明的样式颜色会重叠。<br/>如果要避免颜色重叠变深，<br/>请确保使用同一个样式，<br/>或设置样式透明度为1。</div>
                </template>
            </td>
        </tr>
        <tr>
            <td>标签<br/>创建</td>
            <td>
                <button @click="envStore.createTextTag(line.id)" class="minor">
                    点击创建
                </button>
            </td>
        </tr>
        <tr v-if="line.type===LineType.common">
            <td>渐变</td>
            <td>
                <button v-if="!gradient" class="minor" @click="enableGradient">启用渐变色</button>
                <button v-else class="minor" @click="disableGradient">关闭渐变色</button>
            </td>
        </tr>
        <template v-if="gradient && line.type===LineType.common">
        <tr>
            <td>目标<br/>颜色</td>
            <td>
                <select :value="gradientTargetMode"
                    @change="setGradientTargetMode(($event.target as HTMLSelectElement).value)">
                    <option value="auto">自动</option>
                    <option value="manual">手动指定</option>
                    <option value="line">指定线路</option>
                </select>
                <div v-if="gradientTargetMode==='auto'">
                    <div v-if="gradientAttach" class="smallNote">
                        从末端所接线路获取：{{ gradientAttach.targetLine.name || '未命名线路' }}
                    </div>
                    <div v-if="gradientConnectedLines.length>1" class="smallNote">
                        如效果不理想，请改用“指定线路”模式
                    </div>
                    <div v-if="gradientConnectedLines.length===0" class="smallNoteVital">
                        请将本线路接到其他线路上<br>确保两者共享节点
                    </div>
                </div>
                <div v-else-if="gradientTargetMode==='line'">
                    <select v-if="gradientConnectedLines.length>0" v-model.number="gradientTargetLineId">
                        <option v-for="x in gradientConnectedLines" :value="x.id">
                            {{ x.name || '未命名线路' }}
                        </option>
                    </select>
                    <div v-else class="smallNoteVital">
                        请将本线路末端连接其他线路<br>确保两者共享节点
                    </div>
                </div>
                <div v-else class="gradientPickerEntry">
                    <AuColorPicker ref="gradientPicker" v-model="gradientTargetColor"
                        :pos="-120" :entry-respond-delay="1" :panel-click-stop-propagation="true">
                    </AuColorPicker>
                </div>
            </td>
        </tr>
        <tr>
            <td>渐变<br/>角度</td>
            <td>
                <select :value="gradient.angle===undefined ? 'auto' : 'manual'"
                    @change="setGradientAngleMode(($event.target as HTMLSelectElement).value === 'manual')">
                    <option value="auto">自动</option>
                    <option value="manual">手动指定</option>
                </select>
                <div v-if="gradient.angle!==undefined" class="viewableRange">
                    <input type="range" v-model.number="gradientAngleDeg" :min="-180" :max="180" :step="10"/>
                    <div>{{ gradientAngleDeg }}°</div>
                    <div class="smallNote">0=向右，逆时针为正</div>
                </div>
                <div v-else class="smallNote">沿两端点连线方向</div>
            </td>
        </tr>
        <tr>
            <td>渐变<br/>范围</td>
            <td>
                <div class="viewableRange">
                    <input type="range" v-model.number="gradientRangeFromPct" :min="0" :max="100" :step="1"/>
                    <input type="range" v-model.number="gradientRangeToPct" :min="0" :max="100" :step="1"/>
                </div>
                <div class="smallNote">{{ gradientRangeFromPct }}% → {{ gradientRangeToPct }}%（沿线百分比）</div>
            </td>
        </tr>
        </template>
        <tr>
            <td>片段</td>
            <td>
                <button @click="emit('openSliceEditor')" class="minor">管理片段</button>
                <div class="smallNote">管理该线路的样式片段和时间片段</div>
            </td>
        </tr>
        <tr>
            <td colspan="2" class="mediumNote">本线路为支线<br/>大部分设置暂不支持单独调整<br/>请对其所属的主线进行设置</td>
        </tr>
    </tbody></table>
</div>
<div class="smallNote" style="text-align: center;margin-bottom: 60px;"><b>
    提示：右键点击线路可直接打开本菜单
</b></div>
</SideBar>
</template>

<style scoped lang="scss">
.nameAndColorTd{
    background-color: white;
    &>div{
        padding: 10px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
        input{
            background-color: #eee;
            text-align: center;
            margin: 0px;
            font-size: 14px;
            width: 240px;
            border: none;
        }
        input:first-child{
            font-size: 18px;
        }
    }
}
.gradientPickerEntry{
    &:deep(.acp){
        margin: auto;
    }
}
.sameZIndexLines{
    max-width: 200px;
    span{
        margin-right: 3px;
        white-space: nowrap;
    }
}
</style>