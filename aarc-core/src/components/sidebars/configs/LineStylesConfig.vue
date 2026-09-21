<script setup lang="ts">
import { drawLineStylePreview, lineStylePreviewCvsWidth, lineStylePreviewCvsHeight } from 'aarc-core/models/cvs/common/lineStylePreview';
import { LineStyle } from 'aarc-core/models/save';
import { useEnvStore } from 'aarc-core/models/stores/envStore';
import { useSaveStore } from 'aarc-core/models/stores/saveStore';
import { moveUpInArray } from 'aarc-core/utils/lang/moveUpInArray';
import { AuColorPicker } from '@aurouscia/au-color-picker';
import { storeToRefs } from 'pinia';
import { CSSProperties, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import convert from 'color-convert'
import { timestampMS } from 'aarc-core/utils/timeUtils/timestamp';
import ConfigSection from '../configs/shared/ConfigSection.vue';
import { debounce } from 'aarc-core/utils/lang/debounce';
import foldIcon from 'aarc-core/assets/ui/fold.svg';
import SideBar from 'aarc-core/components/common/SideBar.vue';
import LineStylesConfigReuse from './LineStylesConfigReuse.vue';

const saveStore = useSaveStore()
const { save } = storeToRefs(saveStore)
const envStore = useEnvStore()
const showDetail = ref<Record<number, boolean|undefined>>({})
const colorPicker = useTemplateRef('colorPicker')
const reuseSidebar = useTemplateRef('reuseSidebar')
function openReuseSidebar() {
    reuseSidebar.value?.extend()
}
function clickContainer(){
    //点击“其他地方”关闭颜色选择器
    colorPicker.value?.forEach(cp=>cp?.closePanel())
}
function delLayer(lineStyle:LineStyle, layerIdx:number){
    if(window.confirm('确认删除该层级')){
        lineStyle.layers.splice(layerIdx, 1)
    }
}
function removeEmbeddedPattern(layer:LineStyle['layers'][number]){
    if(!window.confirm('确认移除嵌入的纹理？')){
        return
    }
    delete layer.patternEmbedded
    // 随嵌入一起携带的 pattern id 来自源存档，在本存档中无意义，一并清除
    layer.pattern = undefined
}
function addLayer(lineStyle:LineStyle){
    lineStyle.layers.unshift(getDefaultLayer())
}
function delStyle(lineStyle:LineStyle){
    if(window.confirm(`确认删除样式 ${lineStyle.name || ''}`)){
        const idx = save.value?.lineStyles?.findIndex(x=>x.id === lineStyle.id)
        if(idx!==undefined && idx>=0){
            save.value?.lineStyles?.splice(idx, 1)
        }
    }
}
function addStyle(){
    if(!save.value) return
    const newId = saveStore.getNewId()
    save.value.lineStyles ??= []
    save.value.lineStyles.push({
        id:newId,
        layers:[getDefaultLayer()]
    })
}
function getDefaultLayer():LineStyle['layers'][number]{
    return {
        color: '#FFFFFF',
        colorMode: 'fixed',
        width:0.5,
        opacity:1
    }
}

function cvsEleId(styleId:number){
    return `lineStylePreviewCvs_${styleId}`
}
const cvsWidth = lineStylePreviewCvsWidth
const cvsHeight = lineStylePreviewCvsHeight
const cvsStyle:CSSProperties = {
    width: '200px',
    height: '30px'
}
function renderPreviewCvs(){
    if(!save.value?.lineStyles)
        return
    const hue = timestampMS()/20 % 360
    const dynaColor = '#'+convert.hsl.hex([hue, 80, 50])
    for(const s of save.value?.lineStyles){
        renderPreviewCvsOf(s, dynaColor)
    }
}
function renderPreviewCvsOf(lineStyle:LineStyle, dynaColor:string){
    const cvs = document.getElementById(cvsEleId(lineStyle.id)) as HTMLCanvasElement|null
    const ctx = cvs?.getContext('2d')
    if(!ctx)
        return
    drawLineStylePreview(ctx, lineStyle, dynaColor)
}

const styleNameMaxLength = 8
function checkStyleName(s:LineStyle){
    if(s.name && s.name.length > styleNameMaxLength){
        s.name = s.name.substring(0, styleNameMaxLength)
    }
}

function rerender(){
    envStore.rerender([], [])
    renderPreviewCvs()
}
const debouncedRerender = debounce(rerender, 600)
watch(()=>save.value?.lineStyles, ()=>{
    debouncedRerender()
}, {deep: true})

let timer = 0
onMounted(()=>{
    renderPreviewCvs()
    timer = window.setInterval(()=>{
        renderPreviewCvs()
    }, 100)
})
onUnmounted(()=>{
    window.clearInterval(timer)
})
</script>

<template>
<ConfigSection :title="'线路样式'">
<div class="lineStyles" @click="clickContainer">
    <div v-for="s,sIdx in save?.lineStyles" :key="s.id" :class="{showDetail:showDetail[s.id]}">
        <div class="preview" @click="showDetail[s.id] = !showDetail[s.id]">
            <canvas :width="cvsWidth" :height="cvsHeight" :style="cvsStyle" :id="cvsEleId(s.id)"></canvas>
            <div class="foldBtn">
                <img :src="foldIcon"/>
            </div>
        </div>
        <div v-if="showDetail[s.id]" class="detail">
            <div class="name">
                <h3>样式名</h3><input v-model="s.name" placeholder="必填" @blur="checkStyleName(s)"/>
            </div>
            <div class="noBase">
                <label><input type="checkbox" v-model="s.noBase"/> 隐藏线路本体</label>
            </div>
            <div class="layersOps">
                <button class="ok" @click="addLayer(s)">+层级</button>
                <button v-if="sIdx>0" class="minor" @click="moveUpInArray(save?.lineStyles, sIdx)">上移样式</button>
                <button class="cancel" @click="delStyle(s)">删除样式</button>
            </div>
            <div class="layers">
                <div v-for="layer,idx in s.layers" class="layer">
                    <div class="layerHead">
                        <b v-if="idx == 0">—顶层—</b>
                        <b v-else-if="idx == s.layers.length-1">—底层—</b>
                        <b v-else>—第{{idx+1}}层—</b>
                        <div class="ops">
                            <button v-if="idx>0" class="lite lsMoveUp" @click="moveUpInArray(s.layers, idx)">上移</button>
                            <button class="lite lsDelete" @click="delLayer(s, idx)">删除</button>
                        </div>
                    </div>
                    <div>
                        <b>颜色</b>
                        <div class="colorConfig">
                            <div class="leftPart">
                                <AuColorPicker v-if="!layer.colorMode || layer.colorMode==='fixed'"
                                    ref="colorPicker"
                                    v-model="layer.color"
                                    :entry-styles="{border:'1px solid black'}" :pos="-85"
                                    :entry-respond-delay="1"
                                    :panel-click-stop-propagation="true"></AuColorPicker>
                                <div v-else-if="layer.colorMode==='line'" class="following">跟随线路颜色</div>
                            </div>
                            <button v-if="layer.colorMode!=='line'" class="lite" @click="layer.colorMode='line'">跟随线路</button>
                            <button v-else class="lite" @click="layer.colorMode='fixed'">取消跟随</button>
                        </div>
                    </div>
                    <div>
                        <b>宽度</b>
                        <div class="numberConfig">
                            <div class="leftPart">
                                <input type="range" v-model="layer.width" :min="0" :max="2" :step="0.05"/>
                            </div>
                            <div class="numberView">{{ layer.width }}</div>
                        </div>
                    </div>
                    <div>
                        <b>透明</b>
                        <div class="numberConfig">
                            <div class="leftPart">
                                <input type="range" v-model="layer.opacity" :min="0" :max="1" :step="0.05"/>
                            </div>
                            <div class="numberView">{{ layer.opacity }}</div>
                        </div>
                    </div>
                    <div>
                        <b>虚线</b>
                        <input v-model="layer.dash" class="dashConfigInput" placeholder="空格隔开的数字"/>
                    </div>
                    <div>
                        <b>端部</b>
                        <select v-model="layer.cap">
                            <option :value="undefined">方头</option>
                            <option :value="'round'">圆头</option>
                        </select>
                    </div>
                    <div v-if="!layer.dash">
                        <b>纹理</b>
                        <div v-if="layer.patternEmbedded" class="embeddedPattern">
                            <span>已使用嵌入纹理</span>
                            <button class="lite" @click="removeEmbeddedPattern(layer)">移除嵌入</button>
                        </div>
                        <select v-else v-model="layer.pattern">
                            <option :value="undefined">无</option>
                            <option v-for="p in save?.patterns" :value="p.id">{{ p.name }}</option>
                        </select>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <div class="newStyle">
        <button class="ok" @click="addStyle()">+新建样式</button>
    </div>
    <div class="reuseStyle">
        <button @click="openReuseSidebar()">导入/导出样式</button>
    </div>
</div>
</ConfigSection>

<SideBar ref="reuseSidebar">
    <LineStylesConfigReuse></LineStylesConfigReuse>
</SideBar>
</template>

<style scoped lang="scss">
.lineStyles{
    padding: 5px;
    &>div{
        border-radius: 10px;
        margin: 16px 0px 16px 0px;
        box-shadow: 0px 0px 5px 0px #ccc;
        background-color: #eee;
        overflow: visible;
        border: 2px solid #eee;
        &:first-child{
            margin-top: 0px;
        }
        .preview{
            display: flex;
            justify-content: space-between;
            align-items: center;
            height: 30px;
            padding: 5px;
            cursor: pointer;
            canvas{
                border-radius: 10px;
            }
            .foldBtn{
                width: 30px;
                height: 30px;
                border-radius: 6px;
                img{
                    width: 20px;
                    height: 20px;
                    margin: 5px;
                    transform: rotate(0deg);
                    user-select: none;
                }
            }
        }
        &.showDetail {
            border-color: #666;
            .preview{
                img {
                    transform: rotate(180deg);
                }
            }
        }
        .detail{
            background-color: white;
            padding: 8px;
            border-radius: 0px 0px 8px 8px; // 外层容器的radius - 边框宽度
            h3{
                font-size: 16px;
                font-weight: normal;
            }
            .name{
                display: flex;
                justify-content: center;
                align-items: center;
                input{
                    width: 120px;
                    border-radius: 0px;
                    border-width: 0px 0px 1px 0px;
                }
            }
            .noBase{
                display: flex;
                justify-content: center;
                align-items: center;
                margin-top: 6px;
                label{
                    display: flex;
                    align-items: center;
                    font-size: 14px;
                    color: #666;
                    cursor: pointer;
                    input{
                        margin-right: 4px;
                    }
                }
            }
            .layers{
                .layer{
                    border-radius: 5px;
                    margin: 8px 0px 0px 0px;
                    box-shadow: 0px 0px 5px 0px #ccc;
                    padding-bottom: 1px;
                    &>div{
                        margin: 5px;
                        display: flex;
                        align-items: center;
                        gap: 14px;
                        b{
                            color: #666;
                            font-size: 13px;
                        }
                        &>div{
                            height: 34px;
                        }
                        .colorConfig, .numberConfig{
                            flex-grow: 1;
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            .leftPart{
                                width: 120px;
                                display: flex;
                                justify-content: center;
                            }
                        }
                        .colorConfig{
                            .following{
                                color: #999;
                                font-size: 14px;
                            }
                            button.lite{
                                flex-grow: 0;
                                font-size: 14px;
                                text-decoration: underline;
                                &:hover{
                                    color:black
                                }
                            }
                        }
                        .numberConfig{
                            .numberView{
                                width: 40px;
                            }
                            input[type=range]{
                                width: 120px;
                            }
                        }
                        .dashConfigInput{
                            margin: 0px;
                            width: 120px;
                        }
                        .embeddedPattern{
                            display: flex;
                            flex-direction: row;
                            align-items: center;
                            justify-content: space-between;
                            gap: 6px;
                            span{
                                color: #999;
                                font-size: 14px;
                            }
                            button.lite{
                                font-size: 14px;
                                text-decoration: underline;
                                &:hover{
                                    color:black
                                }
                            }
                        }
                    }
                    .layerHead{
                        background-color: #f3f3f3;
                        margin: 0px;
                        padding: 0px 6px;
                        border-radius: 5px 5px 0px 0px;
                        b{
                            font-size: 15px;
                        }
                        .ops{
                            flex-grow: 1;
                            display: flex;
                            justify-content: flex-end;
                            align-items: center;
                            gap: 6px;
                        }
                        button{
                            font-size: 14px;
                        }
                        button.lsMoveUp{
                            color: #666;
                        }
                        button.lsDelete{
                            color: plum
                        }
                    }
                }
            }
            .layersOps{
                margin-top: 10px;
                display: flex;
                justify-content: center;
                gap: 6px;
            }
        }
    }
    &>.newStyle{
        border: none;
        display: flex;
        justify-content: center;
        margin-bottom: 8px;
        button{
            flex-grow: 1;
        }
    }
    &>.reuseStyle{
        border: none;
        display: flex;
        justify-content: center;
        margin-top: 8px;
        button{
            flex-grow: 1;
        }
    }
}
</style>