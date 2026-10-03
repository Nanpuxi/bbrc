<script lang="ts" setup>
import { storeToRefs } from 'pinia';
import ConfigSection from './shared/ConfigSection.vue';
import { configDefault, useConfigStore } from 'aarc-core/models/stores/configStore';
import { useEnvStore } from 'aarc-core/models/stores/envStore';
import { clamp } from 'aarc-core/utils/lang/clamp';
import { debounce } from 'aarc-core/utils/lang/debounce';
import { watch } from 'vue';

const { config } = storeToRefs(useConfigStore())
const envStore = useEnvStore()

watch(() => [
    config.value.lineCarpet,
    config.value.lineCarpetWiden,
    config.value.textTagCarpet,
], debounce(() => envStore.rerender([], []), 500))

/**
 * 数字输入框能被清空（此时 valueAsNumber 为 NaN），也能填出滑块表示不了的越界值。
 * 空值回落到生效默认值，其余夹到滑块区间。
 */
function repairWiden(evt:Event){
    const el = evt.target as HTMLInputElement
    const val = el.valueAsNumber
    config.value.lineCarpetWiden = Number.isFinite(val) ? clamp(val, 0, 30) : configDefault.lineCarpetWiden
}
</script>

<template>
<ConfigSection :title="'白边'">
    <table class="fullWidth"><tbody>
        <tr>
            <td>线路<br/>白边</td>
            <td>
                <select v-model="config.lineCarpet">
                    <option :value="true">开启</option>
                    <option :value="false">关闭</option>
                </select>
                <div class="explain">线路底层白边的默认开关<br/>线路可另外单独设置</div>
            </td>
        </tr>
        <tr>
            <td>线路<br/>白边<br/>宽度</td>
            <td>
                <input type="range" v-model.number="config.lineCarpetWiden" :min="0" :max="30" :step="1"/>
                <div>
                    <input type="number" v-model.number.lazy="config.lineCarpetWiden"
                        :min="0" :max="30" :step="1"
                        @change="repairWiden"/>
                </div>
                <div class="explain">线路白边在线宽基础上<br/>额外加宽的像素值</div>
            </td>
        </tr>
        <tr>
            <td>标签<br/>白边</td>
            <td>
                <select v-model="config.textTagCarpet">
                    <option :value="true">开启</option>
                    <option :value="false">关闭</option>
                </select>
                <div class="explain">标签底层白边的默认开关<br/>标签可另外单独设置</div>
            </td>
        </tr>
    </tbody></table>
</ConfigSection>
</template>
