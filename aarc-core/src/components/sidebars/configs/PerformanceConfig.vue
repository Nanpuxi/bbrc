<script lang="ts" setup>
import { useEditorLocalConfigStore, cvsRenderResolutionRatioLimits } from 'aarc-core/app/localConfig/editorLocalConfig';
import ConfigSection from './shared/ConfigSection.vue';
import { storeToRefs } from 'pinia';
import { ref, watch, computed } from 'vue';

const ratioPlaceholder = computed(() => `${cvsRenderResolutionRatioLimits.min}-${cvsRenderResolutionRatioLimits.max}`)

const configStore = useEditorLocalConfigStore()
const { lineFob, staFob, staNameFob, cvsRenderResolutionRatio } = storeToRefs(configStore)
const ratioInputValue = ref<string|number>(cvsRenderResolutionRatio.value)
watch(cvsRenderResolutionRatio, (v)=>{
    ratioInputValue.value = v
})
function onRatioInputChange(){
    const v = ratioInputValue.value
    if(v === '' || v == null){
        ratioInputValue.value = cvsRenderResolutionRatio.value
        return
    }
    const num = typeof v === 'string' ? parseFloat(v) : v
    if(typeof num !== 'number' || isNaN(num)){
        ratioInputValue.value = cvsRenderResolutionRatio.value
        return
    }
    // 在 UI 层直接 clamp，保证输入框能同步回弹到合法值
    let clamped = num
    if(num < cvsRenderResolutionRatioLimits.min)
        clamped = cvsRenderResolutionRatioLimits.min
    else if(num > cvsRenderResolutionRatioLimits.max)
        clamped = cvsRenderResolutionRatioLimits.max
    cvsRenderResolutionRatio.value = clamped
    ratioInputValue.value = clamped
}
</script>

<template>
<ConfigSection :title="'性能优化'">
    <table><tbody>
        <tr><th>画布渲染分辨率</th></tr>
        <tr>
            <td>
                <input v-model.lazy.number="ratioInputValue" @change="onRatioInputChange" :placeholder="ratioPlaceholder"/>
                <div>
                    <button class="minor" @click="cvsRenderResolutionRatio = 0.8">流畅</button>
                    <button class="minor" @click="cvsRenderResolutionRatio = 1">低清</button>
                    <button class="minor" @click="cvsRenderResolutionRatio = 1.5">高清</button>
                    <button class="minor" @click="cvsRenderResolutionRatio = cvsRenderResolutionRatioLimits.max">超清</button>
                </div>
                <div class="explain">
                    <p>可牺牲编辑时的清晰度，换取响应速度（大屏幕设备推荐调小）</p>
                    <p style="color:cornflowerblue">值越小，渲染像素越少（越糊、但越快），范围 {{ ratioPlaceholder }}</p>
                </div>
            </td>
        </tr>
        <tr><th>线路糊弄机制</th></tr>
        <tr>
            <td class="explain" style="font-size: 14px;">
                <p>对于超大地图，此处的“糊弄机制”可以在视角拉远时明显提高编辑器速度，建议使用默认值。可根据需要调整其阈值，设备卡顿的话使用“标准”或“宽松”。</p>
            </td>
        </tr>
        <tr>
            <td>
                <input v-model="lineFob" placeholder="0.1-10"/>
                <div>
                    <button class="minor" @click="lineFob = 0.01">关闭</button>
                    <button class="minor" @click="lineFob = 0.7">严格</button>
                    <button class="minor" @click="lineFob = 1">标准</button>
                    <button class="minor" @click="lineFob = 5">宽松</button>
                </div>
                <div class="explain">
                    <p>在视角拉远时，直接以直线连接线路点，并省略样式与分段，仅绘制线路本体，以加快响应速度。</p>
                    <p style="color:cornflowerblue">值越大，线路糊弄机制触发条件越宽松（性能越好、但拐角越明显）</p>
                    <p>设为0或1使用默认值</p>
                </div>
            </td>
        </tr>
        <tr><th>车站糊弄机制</th></tr>
        <tr>
            <td>
                <input v-model="staFob" placeholder="0.1-10"/>
                <div>
                    <button class="minor" @click="staFob = 0.01">关闭</button>
                    <button class="minor" @click="staFob = 0.7">严格</button>
                    <button class="minor" @click="staFob = 1">标准</button>
                    <button class="minor" @click="staFob = 5">宽松</button>
                </div>
                <div class="explain">
                    <p>在视角拉远时，车站只绘制填充圆，不描边、不根据分段取色，以加快响应速度。</p>
                    <p style="color:cornflowerblue">值越大，车站糊弄机制触发条件越宽松（性能越好、但颜色细节越少）</p>
                    <p>设为0或1使用默认值</p>
                </div>
            </td>
        </tr>
        <tr><th>站名糊弄机制</th></tr>
        <tr>
            <td>
                <input v-model="staNameFob" placeholder="0.1-10"/>
                <div>
                    <button class="minor" @click="staNameFob = 0.01">关闭</button>
                    <button class="minor" @click="staNameFob = 0.7">严格</button>
                    <button class="minor" @click="staNameFob = 1">标准</button>
                    <button class="minor" @click="staNameFob = 5">宽松</button>
                </div>
                <div class="explain">
                    <p>在视角拉远时，站名可被渲染为一个尺寸相同的矩形，以加快响应速度。</p>
                    <p>如果觉得用起来不舒服，可以在这里调整到本设备合适的值。</p>
                    <p style="color:cornflowerblue">值越大，表示“站名糊弄机制”触发条件越宽松（性能越好、但更难看到字）</p>
                    <p>设为0或1使用默认值</p>
                </div>
            </td>
        </tr>
    </tbody></table>        
</ConfigSection>
</template>

<style lang="scss" scoped>
input{
    width: 100px;
    text-align: center;
}
</style>
