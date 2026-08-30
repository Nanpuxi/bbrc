<script lang="ts" setup>
import { useConfigStore } from '@/models/stores/configStore';
import { useEnvStore } from '@/models/stores/envStore';
import { usePreventLeavingUnsavedStore } from '@/utils/eventUtils/preventLeavingUnsaved';
import ConfigSection from './shared/ConfigSection.vue';
import { storeToRefs } from 'pinia';
import { ref, watch } from 'vue';

const configStore = useConfigStore()
const envStore = useEnvStore()
const { preventLeaving } = usePreventLeavingUnsavedStore()
const { config, snapRayAnglesForFreeEnabled } = storeToRefs(configStore)

const snapRayAnglesForFreeText = ref('')
watch(() => config.value.snapRayAnglesForFree, (angles) => {
    snapRayAnglesForFreeText.value = angles.join('\n')
}, { immediate: true })

function enableFreeSegmentDirection() {
    config.value.snapRayAnglesForFree = ['0', '45', '90', '135']
    preventLeaving()
}

function applySnapRayAnglesForFree() {
    const angles = snapRayAnglesForFreeText.value
        .split('\n')
        .map(s => s.trim())
        .filter(s => s.length > 0)
    config.value.snapRayAnglesForFree = angles
    preventLeaving()
}
</script>

<template>
<ConfigSection :title="'自由区间方向'">
    <table><tbody>
        <tr><th>{{ snapRayAnglesForFreeEnabled ? '自由区间吸附角度' : '自由区间' }}</th></tr>
        <tr v-if="!snapRayAnglesForFreeEnabled">
            <td>
                <button @click="enableFreeSegmentDirection">启用自由区间</button>
                <div class="explain">
                    <p>启用后，将可以设置点是否“自由”，自由点之间将直接连接。</p>
                </div>
            </td>
        </tr>
        <template v-else>
            <tr>
                <td>
                    <textarea v-model="snapRayAnglesForFreeText" rows="4" style="width: 120px;"
                        @blur="applySnapRayAnglesForFree"/><br/>
                    <button class="minor" @click="config.snapRayAnglesForFree = []; preventLeaving()">禁用自由区间</button>
                </td>
            </tr>
            <tr>
                <td>
                    <div class="explain">
                        一行一个角度（度），自动取模 180。<br/>
                        例如：0、45、90、135<br/>
                        配置 30 表示 30° 和 210° 方向<br/>
                        也可以写比值，例如 2:3<br/>
                        表示向右两格向上三格的方向
                    </div>
                </td>
            </tr>
        </template>
    </tbody></table>
    <table><tbody>
        <tr><th>自由点车站团生成</th></tr>
        <tr>
            <td>
                <select v-model="config.freePtClusterMode" @change="preventLeaving">
                    <option value="loose">宽松</option>
                    <option value="strict">严格</option>
                    <option value="off">关闭</option>
                </select>
                <div class="explain">
                    <p>控制自由点如何参与车站团生成。</p>
                    <p>宽松：默认设置</p>
                    <p>严格：仅吸附点位上</p>
                    <p>关闭：自由点不参与车站团生成，以便完全手动控制连接</p>
                </div>
            </td>
        </tr>
        <tr>
            <td>
                <button @click="envStore.rerender()">手动触发重绘</button>
                <div class="explain">
                    <p>修改后需要重绘才能有实际效果，较大的图中首次重绘可能耗时较久。</p>
                </div>
                <div class="smallNote">也可不点击此处，直接继续编辑也会触发重绘</div>
            </td>
        </tr>
        <tr>
            <td>
                <div class="explain">此处设置仅针对自由点，如果未生效请检查其是否已设为自由</div>
            </td>
        </tr>
        <tr>
            <td>
                <div class="explain">提示：你可以在右下角折叠菜单开启/关闭点间吸附，但吸附是否开启与车站团是否生成无关</div>
            </td>
        </tr>
    </tbody></table>
</ConfigSection>
</template>

<style lang="scss" scoped>
textarea{
    width: 120px;
}
</style>
