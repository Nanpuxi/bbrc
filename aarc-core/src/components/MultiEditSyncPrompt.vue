<script setup lang="ts">
import { ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import Prompt from 'aarc-core/components/common/Prompt.vue';
import { useSelectionStore } from 'aarc-core/models/stores/selectionStore';
import { useEditorLocalConfigStore, type MultiEditSyncScope, type MultiEditSyncValue } from 'aarc-core/app/localConfig/editorLocalConfig';

const selectionStore = useSelectionStore()
const editorLocalConfigStore = useEditorLocalConfigStore()
const { multiEditSyncScope } = storeToRefs(editorLocalConfigStore)

//多选同步策略未选择（undefined）时，首次多选手势结束后弹窗引导设置
const promptShow = ref(false)
const promptScope = ref<Exclude<MultiEditSyncScope, undefined>>('notGroupOnly')
const promptValue = ref<MultiEditSyncValue>('always')
watch(() => selectionStore.brushStatus, (status, oldStatus)=>{
    if(status === 'up' && oldStatus === 'down'
        && selectionStore.selected.size >= 2
        && multiEditSyncScope.value === undefined)
        promptShow.value = true
})
function confirm(){
    editorLocalConfigStore.multiEditSyncScope = promptScope.value
    editorLocalConfigStore.multiEditSyncValue = promptValue.value
    promptShow.value = false
}
</script>

<template>
    <Prompt v-if="promptShow">
        <div class="multiEditSyncInit">
            <div class="title">多选属性同步设置</div>
            <div class="smallNote">选中多个对象后，编辑其中一个<br/>是否要同步编辑选区的其他对象？</div>
            <label>
                同步范围
                <select v-model="promptScope">
                    <option value="never">不同步</option>
                    <option value="notGroupOnly">非选区组时同步</option>
                    <option value="groupOnly">仅选区组时同步</option>
                    <option value="always">总是同步</option>
                </select>
            </label>
            <label>
                同步方式
                <select v-model="promptValue">
                    <option value="sameValueOnly">仅值相同时同步</option>
                    <option value="always">全部同步</option>
                </select>
            </label>
            <button @click="confirm">确认</button>
            <div class="smallNote">现在可直接点击确认<br/>可稍后在“工具-批量选择功能设置”<br/>中进行更多调整</div>
        </div>
    </Prompt>
</template>

<style scoped lang="scss">
.multiEditSyncInit{
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 220px;
    .title{
        font-weight: bold;
        text-align: center;
    }
    label{
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
    }
    select{
        font-size: 16px;
    }
    button{
        align-self: center;
        padding-left: 20px;
        padding-right: 20px;
    }
    .smallNote{
        font-size: 12px;
        color: gray;
    }
}
</style>
