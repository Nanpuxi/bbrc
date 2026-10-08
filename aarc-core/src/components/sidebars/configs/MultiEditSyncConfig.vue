<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useEditorLocalConfigStore, multiEditSyncKeyDefaults, multiEditSyncGroupDefaults } from 'aarc-core/app/localConfig/editorLocalConfig';

const { multiEditSyncScope, multiEditSyncValue, multiEditSyncKeys, multiEditSyncFontScope } = storeToRefs(useEditorLocalConfigStore())
//默认不同步的键（平铺项）
const multiEditSyncKeyLabels: [string, string][] = [
    ['pt:dir', '点方向'],
    ['pt:sta', '是否车站'],
    ['pt:free', '是否自由'],
    ['tag:icon', '图标'],
    ['pt:name', '站名文本'],
    ['pt:nameS', '副站名'],
    ['tag:text', '标签文本'],
    ['tag:textS', '副文本'],
]
//属性组：组 checkbox 为派生状态（全选=选中、部分选=indeterminate），
//组成员可单独开关；同步判定落到各成员的逐键设置上
const multiEditSyncGroupLabels: [string, string][] = [
    ['pt:namePos', '站名位置'],
]
const multiEditSyncGroupChildLabels: Record<string, [string, string][]> = {
    'pt:namePos': [
        ['pt:nameP', '站名坐标'],
        ['pt:anchorX', '横向对齐'],
        ['pt:anchorY', '纵向对齐'],
        ['pt:noLeader', '引导线'],
        ['pt:nameAngle', '旋转'],
    ],
}
function syncKeyOn(key: string): boolean {
    return multiEditSyncKeys.value[key] ?? multiEditSyncKeyDefaults[key] ?? true
}
function setSyncKey(key: string, e: Event) {
    multiEditSyncKeys.value[key] = (e.target as HTMLInputElement).checked
}
function groupFullKeys(group: string): string[] {
    return multiEditSyncGroupDefaults[group].map(k => `${group.split(':')[0]}:${k}`)
}
function syncGroupAllOn(group: string): boolean {
    return groupFullKeys(group).every(k => syncKeyOn(k))
}
function syncGroupSomeOn(group: string): boolean {
    return groupFullKeys(group).some(k => syncKeyOn(k))
}
//点击组：当前全选则全不选，否则全选（indeterminate 态点击视为全选）
function setSyncGroup(group: string, e: Event) {
    const checked = (e.target as HTMLInputElement).checked
    for (const k of groupFullKeys(group))
        multiEditSyncKeys.value[k] = checked
}
</script>

<template>
<div class="multiEditSyncConfig">
    <div class="smallNote">多选选中后编辑某元素时<br/>是否同步给其他同类选中元素</div>
    <select v-model="multiEditSyncScope">
        <option value="never">不同步</option>
        <option value="notGroupOnly">非选区组时同步</option>
        <option value="groupOnly">仅选区组时同步</option>
        <option value="always">总是同步</option>
        <option v-if="multiEditSyncScope===undefined" :value="undefined">未选择</option>
    </select>
    <select v-model="multiEditSyncValue" :disabled="!multiEditSyncScope || multiEditSyncScope==='never'">
        <option value="sameValueOnly">仅值相同时同步</option>
        <option value="always">全部同步</option>
    </select>
    <template v-if="multiEditSyncScope && multiEditSyncScope!=='never'">
        <div class="smallNote">以下属性默认不同步<br/>需自行勾选开启：</div>
        <div v-for="[group, groupLabel] in multiEditSyncGroupLabels" :key="group" class="syncGroupBox">
            <label class="syncGroupLabel">
                <input type="checkbox" :checked="syncGroupAllOn(group)"
                    :indeterminate.prop="!syncGroupAllOn(group) && syncGroupSomeOn(group)"
                    @change="setSyncGroup(group, $event)"/>
                {{ groupLabel }}
            </label>
            <div class="multiEditSyncKeys syncGroupChildren">
                <label v-for="[key, label] in multiEditSyncGroupChildLabels[group]" :key="key">
                    <input type="checkbox" :checked="syncKeyOn(key)" @change="setSyncKey(key, $event)"/>
                    {{ label }}
                </label>
            </div>
        </div>
        <div class="multiEditSyncKeys">
            <label v-for="[key, label] in multiEditSyncKeyLabels" :key="key">
                <input type="checkbox" :checked="syncKeyOn(key)" @change="setSyncKey(key, $event)"/>
                {{ label }}
            </label>
        </div>
    </template>
    <div class="smallNote">文本标签字体同步范围</div>
    <select v-model="multiEditSyncFontScope" :disabled="!multiEditSyncScope || multiEditSyncScope==='never'">
        <option value="all">全部同步</option>
        <option value="never">全部不同步</option>
        <option value="sameLine">仅同线路同步</option>
        <option value="sameKind">仅同类同步</option>
    </select>
</div>
</template>

<style scoped lang="scss">
select{
    font-size: 16px;
}
.multiEditSyncKeys{
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    margin: 4px 0;
    label{
        display: inline-flex;
        align-items: center;
        gap: 3px;
        white-space: nowrap;
        font-size: 14px;
    }
}
.syncGroupBox{
    background-color: white;
    border-radius: 10px;
    padding: 10px;
    margin: 4px 0;
}
.syncGroupLabel{
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 14px;
}
.syncGroupChildren{
    display: block;
    margin-left: 22px;
    label{
        display: flex;
    }
}
</style>
