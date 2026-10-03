<script lang="ts" setup>
import { storeToRefs } from 'pinia';
import ConfigSection from './shared/ConfigSection.vue';
import { useConfigStore } from 'aarc-core/models/stores/configStore';
import { useEnvStore } from 'aarc-core/models/stores/envStore';
import { clamp } from 'aarc-core/utils/lang/clamp';
import { debounce } from 'aarc-core/utils/lang/debounce';
import { computed, useTemplateRef, watch } from 'vue';
import { AuColorPicker } from '@aurouscia/au-color-picker';

const cs = useConfigStore()
const { config } = storeToRefs(cs)
const envStore = useEnvStore()
const pStaCarpet = useTemplateRef('pStaCarpet')

function closeAllPickers(){
    pStaCarpet.value?.closePanel()
}

watch(() => [
    config.value.lineCarpet,
    config.value.lineCarpetWiden,
    config.value.textTagCarpet,
    config.value.textTagCarpetWidth,
], debounce(() => envStore.rerender([], []), 500))

/**
 * 数字输入框能被清空（此时 valueAsNumber 为 NaN），也能填出滑块表示不了的越界值。
 * 空值回落到生效默认值，其余夹到滑块区间。
 */
function repairNum(evt:Event, apply:(v:number)=>void, min:number, max:number, fallback:number){
    const el = evt.target as HTMLInputElement
    const val = el.valueAsNumber
    apply(Number.isFinite(val) ? clamp(val, min, max) : fallback)
}

function customizeCarpetColor(){
    cs.config.staNameCarpet.color = '#ffffff'
    envStore.rerender([], [])
}
function resetCarpetColor(){
    cs.config.staNameCarpet.color = undefined
    envStore.rerender([], [])
}
function carpetNumberChanged(key:'width'|'opacity'){
    const v = cs.config.staNameCarpet[key]
    if(typeof v !== 'number' || isNaN(v))
        cs.config.staNameCarpet[key] = undefined
    envStore.rerender([], [])
}
//滑块拖动时事件密集，防抖后再重绘
let rtimer = 0
function carpetRangeInput(){
    window.clearTimeout(rtimer)
    rtimer = window.setTimeout(()=> envStore.rerender([], []), 500)
}
//滑块无法表示undefined：未设置时显示默认生效值
const carpetWidth = computed<number>({
    get: ()=> cs.config.staNameCarpet.width ?? 1,
    set: v => { cs.config.staNameCarpet.width = v }
})
const carpetOpacity = computed<number>({
    get: ()=> cs.config.staNameCarpet.opacity ?? 0.8,
    set: v => { cs.config.staNameCarpet.opacity = v }
})
</script>

<template>
<ConfigSection :title="'白边'">
    <table class="fullWidth" @click="closeAllPickers"><tbody>
        <tr>
            <th colspan="2">
                线路白边
            </th>
        </tr>
        <tr>
            <td>开关</td>
            <td>
                <select v-model="config.lineCarpet">
                    <option :value="true">开启</option>
                    <option :value="false">关闭</option>
                </select>
                <div class="explain">线路底层白边的默认开关<br/>线路可另外单独设置</div>
            </td>
        </tr>
        <tr>
            <td>宽度</td>
            <td>
                <input type="range" v-model.number="config.lineCarpetWiden" :min="0" :max="30" :step="1"/>
                <div>
                    <input type="number" v-model.number.lazy="config.lineCarpetWiden"
                        :min="0" :max="30" :step="1"
                        @change="repairNum($event, v=>config.lineCarpetWiden=v, 0, 30, 7)"/>
                </div>
                <div class="explain">线路白边在线宽基础上<br/>额外加宽的像素值</div>
            </td>
        </tr>
        <tr>
            <th colspan="2">
                标签白边
            </th>
        </tr>
        <tr>
            <td>开关</td>
            <td>
                <select v-model="config.textTagCarpet">
                    <option :value="true">开启</option>
                    <option :value="false">关闭</option>
                </select>
                <div class="explain">标签底层白边的默认开关<br/>标签可另外单独设置</div>
            </td>
        </tr>
        <tr>
            <td>宽度<br/>倍率</td>
            <td>
                <input type="range" v-model.number="config.textTagCarpetWidth" :min="0" :max="3" :step="0.25"/>
                <div>
                    <input type="number" v-model.number.lazy="config.textTagCarpetWidth"
                        :min="0" :max="3" :step="0.25"
                        @change="repairNum($event, v=>config.textTagCarpetWidth=v, 0, 3, 1)"/>
                </div>
                <div class="explain">标签白边默认宽度<br/>的倍率</div>
            </td>
        </tr>
        <tr>
            <th colspan="2">
                站名基底
            </th>
        </tr>
        <tr>
            <td>宽度<br/>倍率</td>
            <td>
                <input type="range" v-model.number="carpetWidth"
                    :min="0" :max="2" :step="0.25"
                    @input="carpetRangeInput"/>
                <div>
                    <input type="number" v-model.number.lazy="cs.config.staNameCarpet.width"
                        :min="0" :step="0.1" placeholder="1"
                        @change="carpetNumberChanged('width')"/>
                </div>
            </td>
        </tr>
        <tr>
            <td>不透<br/>明度</td>
            <td>
                <input type="range" v-model.number="carpetOpacity"
                    :min="0" :max="1" :step="0.1"
                    @input="carpetRangeInput"/>
                <div>
                    <input type="number" v-model.number.lazy="cs.config.staNameCarpet.opacity"
                        :min="0" :max="1" :step="0.05" placeholder="0.8"
                        @change="carpetNumberChanged('opacity')"/>
                </div>
            </td>
        </tr>
        <tr>
            <td>颜色</td>
            <td class="carpet-color">
                <template v-if="cs.config.staNameCarpet.color !== undefined">
                    <AuColorPicker v-model="cs.config.staNameCarpet.color" :pos="-120" ref="pStaCarpet"
                        @done="envStore.rerender([], [])"
                        :panel-click-stop-propagation="true" :entry-respond-delay="1">
                    </AuColorPicker>
                    <div style="margin-top: 4px;">
                        <button class="lite" @click="resetCarpetColor">恢复（跟随背景）</button>
                    </div>
                </template>
                <button v-else class="lite" @click="customizeCarpetColor">自定义</button>
            </td>
        </tr>
    </tbody></table>
</ConfigSection>
</template>

<style scoped lang="scss">
.carpet-color{
    .lite{
        text-decoration: underline;
    }
}
td{
    &:deep(.acp){
        margin: auto;
    }
}
</style>
