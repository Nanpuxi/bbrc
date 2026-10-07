<script setup lang="ts">
import { ref, useTemplateRef } from 'vue';
import SideBar from '../common/SideBar.vue';
import { useEnvStore } from 'aarc-core/models/stores/envStore';
import { storeToRefs } from 'pinia';
import { usePointLinkStore } from 'aarc-core/models/stores/pointLinkStore';
import { useSelectionStore } from 'aarc-core/models/stores/selectionStore';
import { ControlPointLinkType } from 'aarc-core/models/save';
import { useStashStore } from 'aarc-core/models/stores/utils/stashStore';
import Prompt from '../common/Prompt.vue';
import { searchMarkForEmptyName, useNameSearchStore } from 'aarc-core/models/stores/nameSearchStore';
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents';
import { useEditorLocalConfigStore, selectionSizeLimits } from 'aarc-core/app/localConfig/editorLocalConfig';
import { useMainCvsDispatcher } from 'aarc-core/models/cvs/dispatchers/mainCvsDispatcher';
import StringReplace from './StringReplace.vue';
import ConfigSection from './configs/shared/ConfigSection.vue';
import MultiEditSyncConfig from './configs/MultiEditSyncConfig.vue';
import ToolItem from './shared/ToolItem.vue';
import textTagIcon from 'aarc-core/assets/ui/editor/textTag.svg';
import ptLinkIcon from 'aarc-core/assets/ui/editor/ptLink.svg';
import plainPtIcon from 'aarc-core/assets/ui/editor/plainPt.svg';
import selectionIcon from 'aarc-core/assets/ui/editor/selection.svg';
import stashIcon from 'aarc-core/assets/ui/editor/stash.svg';

const envStore = useEnvStore()
const pointLinkStore = usePointLinkStore()
const selectionStore = useSelectionStore()
const { creatingLinkType } = storeToRefs(pointLinkStore)
const stashStore = useStashStore()
const nameSearchStore = useNameSearchStore()
const { showPop } = useUniqueComponentsStore()
const { duplicateNameDistThrs, selectionSize, blankClickBehavior, selectionLockedBehavior } = storeToRefs(useEditorLocalConfigStore())
const { visitorMode } = storeToRefs(useMainCvsDispatcher())
const mustBackup = defineModel<boolean>()

function fd(){
    sidebar.value?.fold()
}
function end(){
    envStore.endEveryEditing()
}

const showPcSelectionGuide = ref(false)
const openSelectionLocked = ref(false)
function openSelection(type:'mouse'|'touch'){
    if(openSelectionLocked.value) return // 避免一些触屏设备两者都触发
    openSelectionLocked.value = true
    window.setTimeout(()=>{
        openSelectionLocked.value = false
    }, 100)

    end()
    if(type == 'mouse'){
        showPcSelectionGuide.value = true
    }
    else{
        selectionStore.enableForTouchScreen()
        fd()
    }
}

function findDuplicateStas(){
    const name = nameSearchStore.findDuplicateAndFarEnough()
    if(!name){
        showPop(`指定间距(${duplicateNameDistThrs.value})外\n没有重名车站`, 'success')
        return
    }
    nameSearchStore.toggleShow(name)
    fd()
}

const sidebar = useTemplateRef('sidebar')
defineExpose({
    comeOut: ()=>{sidebar.value?.extend()},
    fold: ()=>{sidebar.value?.fold()}
})
</script>

<template>
<SideBar ref="sidebar">
    <ToolItem>
        <button @click="end();envStore.createTextTag();fd()"><img :src="textTagIcon"/><span>创建文本标签</span></button>
        <template #explain>
            <div class="smallNote">用于添加标题/作者等，<b style="color:red">勿</b>用于标注站名</div>
            <div class="smallNote">需要线路名标签，请点击线路/地形创建</div>
        </template>
    </ToolItem>
    <ToolItem>
        <button @click="end();pointLinkStore.startCreatingPtLink();fd()"><img :src="ptLinkIcon"/><span>车站连线</span></button>
        <select v-model="creatingLinkType">
            <option :value="ControlPointLinkType.fat">粗线</option>
            <option :value="ControlPointLinkType.thin">细线</option>
            <option :value="ControlPointLinkType.dot">虚线(原)</option>
            <option :value="ControlPointLinkType.dotCover">虚线(覆)</option>
            <option :value="ControlPointLinkType.cluster">车站团</option>
        </select>
        <template #explain>
            <div class="smallNote">
                选择“车站团”模式时，连线中央会有标记用细线，其仅在编辑器可见，导出时会隐藏
            </div>
        </template>
    </ToolItem>
    <ToolItem>
        <button @click="end();envStore.createPlainPt();fd()"><img :src="plainPtIcon"/><span>创建控制点</span></button>
        <template #explain>
            <div class="smallNote">可用于创建带折角/分叉的车站间连线</div>
        </template>
    </ToolItem>
    <ToolItem>
        <button @mouseup="openSelection('mouse')" @touchstart="openSelection('touch')">
            <img :src="selectionIcon"/><span>批量选中元素</span>
        </button>
        <Prompt v-if="showPcSelectionGuide" :close-btn="true" @close="showPcSelectionGuide=false">
            PC用户您好：<br/>
            按住<code>shift</code>并拖动鼠标左键以添加选中<br/>
            按住<code>shift</code>+<code>ctrl</code>并拖动鼠标左键以减少选中
        </Prompt>
        <template #explain>
            <div class="smallNote">目前仅支持批量选中后移动</div>
            <div class="smallNote">“创建选取组”可永久保存这次多选，便于后续多次拖动</div>
            <div class="smallNote">本页面下方可设置选区大小</div>
        </template>
    </ToolItem>
    <ToolItem>
        <button :class="{minor: stashStore.thawable}" @click="stashStore.freeze()"><img :src="stashIcon"/><span>暂存当前画布状态</span></button>
        <button v-if="stashStore.thawable" @click="stashStore.thaw()">还原为暂存的状态</button>
        <template #explain>
            <div class="smallNote">
                当“不确定会不会改坏”时，可以暂存当前画布的样子，如果修改后后悔了，可一键还原<br/>
                请注意：刷新/退出后，暂存就会丢失！
            </div>
        </template>
    </ToolItem>
    <ToolItem v-if="!visitorMode">
        <div style="display: flex;align-items: center;color:#999">
            <input v-model="mustBackup" type="checkbox"/>强制生成备份
        </div>
        <template #explain>
            <div class="smallNote">
                使本次保存强制生成备份<br/>
                建议在公共存档“即将交给他人”前备份一次<br/>
                <b>限制：</b>仅“存档所有者”且“正式用户及以上”可用，否则本次仅保存、不强制生成备份<br/>
                <b>缺陷：</b>仅对“绿色保存按钮”有效，ctrl+S无效
            </div>
        </template>
    </ToolItem>
    <ConfigSection title="批量选择功能设置">
        <table style="width: 100%;"><tbody>
            <tr>
                <td>选区大小</td>
                <td>
                    <input v-model.number="selectionSize" type="range"
                        :min="selectionSizeLimits.min" :max="selectionSizeLimits.max" :step="0.1"/>
                    <div>{{ selectionSize }}</div>
                </td>
            </tr>
            <tr>
                <td>点击空白</td>
                <td>
                    <select v-model="blankClickBehavior">
                        <option value="exitAlways">总是退出</option>
                        <option value="exitWhenGrouped">选区组时退出</option>
                        <option value="none">不退出</option>
                    </select>
                </td>
            </tr>
            <tr>
                <td>线路锁定<br/>状态处理</td>
                <td>
                    <select v-model="selectionLockedBehavior">
                        <option value="exclude">不添加到选区</option>
                        <option value="include">可添加到选区</option>
                    </select>
                </td>
            </tr>
            <tr>
                <td>多选属性<br/>同步</td>
                <td>
                    <MultiEditSyncConfig/>
                </td>
            </tr>
        </tbody></table>
    </ConfigSection>
    <ConfigSection title="站名相关功能">
        <button @click="nameSearchStore.toggleShow(searchMarkForEmptyName);fd()">
            查找无名车站
        </button>
        <button @click="findDuplicateStas">
            检测名称重复车站
        </button>
    </ConfigSection>
    <StringReplace></StringReplace>
    <div style="height: 100px;"></div>
</SideBar>
</template>

<style scoped lang="scss">
select{
    font-size: 16px;
}
button{
    display: inline-flex;
    align-items: center;
    gap: 5px;
    img{
        width: 24px;
        height: 24px;
        filter: brightness(0) invert(1);
    }
    span{
        line-height: 1;
    }
    &.minor img{
        filter: none;
    }
}
.configSection {
    padding: 0px;
    &:deep(h2) {
        align-self: stretch;
        border: none;
    }
}
</style>