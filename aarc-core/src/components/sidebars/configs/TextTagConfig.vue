<script lang="ts" setup>
import { storeToRefs } from 'pinia';
import ConfigSection from './shared/ConfigSection.vue';
import { useConfigStore } from 'aarc-core/models/stores/configStore';
import { useEnvStore } from 'aarc-core/models/stores/envStore';
import { TextTagPerTypeGlobalConfig } from 'aarc-core/models/config';
import { clamp } from 'aarc-core/utils/lang/clamp';
import { debounce } from 'aarc-core/utils/lang/debounce';
import { computed, watch } from 'vue';

const { config } = storeToRefs(useConfigStore())
const envStore = useEnvStore()

const dropCapDetectExplain = computed(()=>{
    if(config.value.textTagForLineDropCapDetect == 'loose')
        return '“M1某某线”的M将被放大'
    return '“A1号线”的A1将被放大'
})

// 必须在注册 watch 之前补齐默认值，否则挂载时会多触发一次全量重绘
config.value.textTagPlain.fontSize ??= 1
config.value.textTagPlain.subFontSize ??= 1

config.value.textTagForLine.padding ??= 1
config.value.textTagForLine.fontSize ??= 1
config.value.textTagForLine.subFontSize ??= 1
config.value.textTagForLine.width ??= 0

config.value.textTagForTerrain.fontSize ??= 1
config.value.textTagForTerrain.subFontSize ??= 1

watch(() => [
    config.value.textTagPlain.fontSize,
    config.value.textTagPlain.subFontSize,
    config.value.textTagForLine.fontSize,
    config.value.textTagForLine.subFontSize,
    config.value.textTagForLine.padding,
    config.value.textTagForLine.edgeAnchorOutsidePadding,
    config.value.textTagForLine.anchorX,
    config.value.textTagForLine.anchorY,
    config.value.textTagForLine.textAlign,
    config.value.textTagForLine.width,
    config.value.textTagForLineDropCap,
    config.value.textTagForLineDropCapDetect,
    config.value.textTagForTerrain.fontSize,
    config.value.textTagForTerrain.subFontSize,
], debounce(() => envStore.rerender([], []), 500))

/**
 * 数字输入框能被清空（此时 valueAsNumber 为 NaN），也能填出滑块表示不了的越界值。
 * 空值回落到生效默认值，其余夹到滑块区间——字号 0 会画出隐形文字。
 * 区间取自 input 自身的 min/max，避免和模板里的属性写两份。
 */
function repairNum(evt:Event, group:TextTagPerTypeGlobalConfig,
        key:'fontSize'|'subFontSize'|'padding'|'width', fallback:number){
    const el = evt.target as HTMLInputElement
    const val = el.valueAsNumber
    group[key] = Number.isFinite(val) ? clamp(val, Number(el.min), Number(el.max)) : fallback
}
</script>

<template>
<ConfigSection :title="'文本标签'">
    <table class="fullWidth"><tbody>
        <tr>
            <th colspan="2">
                一般标签
            </th>
        </tr>
        <tr>
            <td>主文字<br/>大小</td>
            <td>
                <input type="range" v-model.number="config.textTagPlain.fontSize" :min="0.5" :max="5" :step="0.25"/>
                <div>
                    <input type="number" v-model.number.lazy="config.textTagPlain.fontSize"
                        :min="0.1" :max="20" :step="0.1"
                        @change="repairNum($event, config.textTagPlain, 'fontSize', 1)"/>
                </div>
            </td>
        </tr>
        <tr>
            <td>副文字<br/>大小</td>
            <td>
                <input type="range" v-model.number="config.textTagPlain.subFontSize" :min="0.5" :max="5" :step="0.25"/>
                <div>
                    <input type="number" v-model.number.lazy="config.textTagPlain.subFontSize"
                        :min="0.1" :max="20" :step="0.1"
                        @change="repairNum($event, config.textTagPlain, 'subFontSize', 1)"/>
                </div>
            </td>
        </tr>
        <tr>
            <th colspan="2">
                线路名标签
            </th>
        </tr>
        <tr>
            <td>主文字<br/>大小</td>
            <td>
                <input type="range" v-model.number="config.textTagForLine.fontSize" :min="0.5" :max="5" :step="0.25"/>
                <div>
                    <input type="number" v-model.number.lazy="config.textTagForLine.fontSize"
                        :min="0.1" :max="20" :step="0.1"
                        @change="repairNum($event, config.textTagForLine, 'fontSize', 1)"/>
                </div>
            </td>
        </tr>
        <tr>
            <td>副文字<br/>大小</td>
            <td>
                <input type="range" v-model.number="config.textTagForLine.subFontSize" :min="0.5" :max="5" :step="0.25"/>
                <div>
                    <input type="number" v-model.number.lazy="config.textTagForLine.subFontSize"
                        :min="0.1" :max="20" :step="0.1"
                        @change="repairNum($event, config.textTagForLine, 'subFontSize', 1)"/>
                </div>
            </td>
        </tr>
        <tr>
            <td rowspan="2">边距</td>
            <td>
                <input type="range" v-model.number="config.textTagForLine.padding" :min="0.5" :max="5" :step="0.25"/>
                <div>
                    <input type="number" v-model.number.lazy="config.textTagForLine.padding"
                        :min="0" :max="20" :step="0.25"
                        @change="repairNum($event, config.textTagForLine, 'padding', 1)"/>
                </div>
            </td>
        </tr>
        <tr>
            <td>
                <div>
                    <input type="checkbox" v-model="config.textTagForLine.edgeAnchorOutsidePadding"/>
                    <div class="explain">
                        边缘锚点设为边距外侧
                    </div>
                </div>
            </td>
        </tr>
        <tr>
            <td>横向<br/>锚点</td>
            <td>
                <select v-model="config.textTagForLine.anchorX">
                    <option :value="1">左侧</option>
                    <option :value="undefined">中心</option>
                    <option :value="-1">右侧</option>
                </select>
                <div class="explain">可能需要重新定位</div>
            </td>
        </tr>
        <tr>
            <td>纵向<br/>锚点</td>
            <td>
                <select v-model="config.textTagForLine.anchorY">
                    <option :value="1">顶部</option>
                    <option :value="undefined">中心</option>
                    <option :value="-1">底部</option>
                </select>
                <div class="explain">可能需要重新定位</div>
            </td>
        </tr>
        <tr>
            <td>文字<br/>对齐</td>
            <td>
                <select v-model="config.textTagForLine.textAlign">
                    <option :value="undefined">跟随横向锚点</option>
                    <option :value="1">靠左</option>
                    <option :value="0">居中</option>
                    <option :value="-1">靠右</option>
                </select>
            </td>
        </tr>
        <tr>
            <td>宽度</td>
            <td>
                <input type="range" v-model.number="config.textTagForLine.width" :min="0" :max="300" :step="5"/>
                <div>
                    <input type="number" v-model.number.lazy="config.textTagForLine.width"
                        :min="0" :max="2000" :step="1"
                        @change="repairNum($event, config.textTagForLine, 'width', 0)"/>
                </div>
                <div class="explain">如果短于指定宽度<br/>将会向锚点对侧拉长</div>
                <div class="explain">设为0将其关闭</div>
            </td>
        </tr>
        <tr>
            <td :rowspan="config.textTagForLineDropCap ? 2 : 1">数字<br/>放大</td>
            <td>
                <select v-model="config.textTagForLineDropCap">
                    <option :value="true">开启</option>
                    <option :value="false">关闭</option>
                </select>
                <div class="explain">将会无视文字对齐</div>
            </td>
        </tr>
        <tr v-if="config.textTagForLineDropCap">
            <td>
                <select v-model="config.textTagForLineDropCapDetect">
                    <option :value="'classic'">经典检测</option>
                    <option :value="'loose'">宽松检测</option>
                </select>
                <div class="explain">{{ dropCapDetectExplain }}</div>
            </td>
        </tr>
        <tr>
            <th colspan="2">
                地形名标签
            </th>
        </tr>
        <tr>
            <td>主文字<br/>大小</td>
            <td>
                <input type="range" v-model.number="config.textTagForTerrain.fontSize" :min="0.5" :max="5" :step="0.25"/>
                <div>
                    <input type="number" v-model.number.lazy="config.textTagForTerrain.fontSize"
                        :min="0.1" :max="20" :step="0.1"
                        @change="repairNum($event, config.textTagForTerrain, 'fontSize', 1)"/>
                </div>
            </td>
        </tr>
        <tr>
            <td>副文字<br/>大小</td>
            <td>
                <input type="range" v-model.number="config.textTagForTerrain.subFontSize" :min="0.5" :max="5" :step="0.25"/>
                <div>
                    <input type="number" v-model.number.lazy="config.textTagForTerrain.subFontSize"
                        :min="0.1" :max="20" :step="0.1"
                        @change="repairNum($event, config.textTagForTerrain, 'subFontSize', 1)"/>
                </div>
            </td>
        </tr>
        <tr>
            <td colspan="2" class="explain">
                以上设置对所有标签生效<br/>（设置过非0/非默认值的除外）
            </td>
        </tr>
    </tbody></table>
</ConfigSection>
</template>
