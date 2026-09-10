<script setup lang="ts">
import { configDefault, useConfigStore } from 'aarc-core/models/stores/configStore';
import ConfigSection from './shared/ConfigSection.vue';
import { useEnvStore } from 'aarc-core/models/stores/envStore';
import { AuColorPicker } from '@aurouscia/au-color-picker';
import { computed, useTemplateRef } from 'vue';
import { Config } from 'aarc-core/models/config';

const cs = useConfigStore()
const envStore = useEnvStore()
const pBg = useTemplateRef('pBg')
const pSta = useTemplateRef('pSta')
const pStaSub = useTemplateRef('pStaSub')
const pStaFill = useTemplateRef('pStaFill')
const pStaCarpet = useTemplateRef('pStaCarpet')
const pickers = [pBg, pSta, pStaSub, pStaFill, pStaCarpet]

function closeAllPickers(){
    for(const p of pickers){
        p.value?.closePanel()
    }
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
function recover(){
    const obj:Partial<Config> = {
        bgColor: configDefault.bgColor,
        staNameColor: configDefault.staNameColor,
        staNameSubColor: configDefault.staNameSubColor,
        ptStaFillColor: configDefault.ptStaFillColor
    }
    Object.assign(cs.config, obj)
    envStore.rerender([], [])
}
function setToDark(){
    const obj:Partial<Config> = {
        bgColor: '#222233',
        staNameColor: '#ffffff',
        staNameSubColor: '#dddddd',
        ptStaFillColor: '#111122'
    }
    Object.assign(cs.config, obj)
    envStore.rerender([], [])
}
</script>

<template>
<ConfigSection :title="'颜色设置'">
    <table class="fullWidth" @click="closeAllPickers"><tbody>
        <tr>
            <td colspan="2">
                <button @click="recover">恢复默认浅色</button>
                <button @click="setToDark">设为深色</button>
            </td>
        </tr>
        <tr>
            <td style="width: 76px;">背景</td>
            <td>
                <AuColorPicker v-model="cs.config.bgColor" :pos="-120" ref="pBg"
                    @done="envStore.rerender([], [])"
                    :panel-click-stop-propagation="true" :entry-respond-delay="1">
                </AuColorPicker>
            </td>
        </tr>
        <tr>
            <td>主站名</td>
            <td>
                <AuColorPicker v-model="cs.config.staNameColor" :pos="-120" ref="pSta"
                    @done="envStore.rerender([], [])"
                    :panel-click-stop-propagation="true" :entry-respond-delay="1">
                </AuColorPicker>
            </td>
        </tr>
        <tr>
            <td>副站名</td>
            <td>
                <AuColorPicker v-model="cs.config.staNameSubColor" :pos="-120" ref="pStaSub"
                    @done="envStore.rerender([], [])"
                    :panel-click-stop-propagation="true" :entry-respond-delay="1">
                </AuColorPicker>
            </td>
        </tr>
        <tr>
            <td>站点填充</td>
            <td>
                <AuColorPicker v-model="cs.config.ptStaFillColor" :pos="-120" ref="pStaFill"
                    @done="envStore.rerender([], [])"
                    :panel-click-stop-propagation="true" :entry-respond-delay="1">
                </AuColorPicker>
            </td>
        </tr>
        <tr>
            <td>站名基底<br/>宽度倍率</td>
            <td>
                <input type="number" v-model.number.lazy="cs.config.staNameCarpet.width"
                    :min="0" :step="0.1" placeholder="1"
                    @change="carpetNumberChanged('width')"/>
                <input type="range" v-model.number="carpetWidth"
                    :min="0" :max="2" :step="0.25"
                    @input="carpetRangeInput"/>
            </td>
        </tr>
        <tr>
            <td>站名基底<br/>不透明度</td>
            <td>
                <input type="number" v-model.number.lazy="cs.config.staNameCarpet.opacity"
                    :min="0" :max="1" :step="0.05" placeholder="0.8"
                    @change="carpetNumberChanged('opacity')"/>
                <input type="range" v-model.number="carpetOpacity"
                    :min="0" :max="1" :step="0.1"
                    @input="carpetRangeInput"/>
            </td>
        </tr>
        <tr>
            <td>站名基底<br/>颜色</td>
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
        <tr>
            <td colspan="2">
                <span class="smallNote">敬请期待：地形预设颜色</span>
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