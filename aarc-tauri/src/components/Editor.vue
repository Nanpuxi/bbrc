<script setup lang="ts">
// 编辑器宿主组件（对应 aarc-web 的 Editor.vue 极简版）：
// 无权限判定、无心跳、无压缩上传；存档经 saveStorage（tauri fs / 浏览器 localStorage 双实现）存取。
// “离开”按钮打开存档管理器 Modal；切换存档仿照 web 的做法：记录目标 id 后整页 reload
//（运行时切换的状态清理缺陷见 aarc-core/docs/problems/save-switching-problems.md，修复前不做运行时切换）。
import Cvs from 'aarc-core/components/Cvs.vue';
import Menu from 'aarc-core/components/Menu.vue';
import SaveManagerModal from './SaveManagerModal.vue';
import { onBeforeMount, onBeforeUnmount, ref, useTemplateRef } from 'vue';
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents';
import { usePreventLeavingUnsavedStore } from 'aarc-core/utils/eventUtils/preventLeavingUnsaved';
import { useMainCvsDispatcher } from 'aarc-core/models/cvs/dispatchers/mainCvsDispatcher';
import { loadSaveIntoEditor, disposeEditor, prepareSavePayload, DataSourceUpdateEvents } from 'aarc-core/app/editorSession';
import { setCurrentSaveIdRaw } from 'aarc-core/models/save/currentSaveId';
import { saveStorage, newSaveId, SaveIndexEntry } from '../saves/saveStorage';

// 无路由：当前存档 id 持久化在 localStorage，重启/切换（reload）后恢复
const currentIdStorageKey = 'aarc-tauri-current-save'
const currentSaveId = ref('')
const currentSaveName = ref('')

const uniq = useUniqueComponentsStore()
const { showPop } = uniq
const { preventLeaving, releasePreventLeaving } = usePreventLeavingUnsavedStore()
const mainCvsDispatcher = useMainCvsDispatcher()
const loadComplete = ref(false)

const dataSourceEventLoggers: DataSourceUpdateEvents = {
    onLoad: (ds) => {
        console.log('[Editor] 自动更新加载:', ds.name, 'type:', ds.type)
    },
    onDone: (ds, report) => {
        console.log('[Editor] 自动更新完成:', ds.name, 'report:', report)
    },
    onError: (ds, errmsg) => {
        console.warn(`[数据源自动更新]"${ds.name}"失败: ${errmsg}`)
    }
}

async function load() {
    // 恢复上次编辑的存档；无记录或指向已删存档时取最近保存者；清单为空则现场新建空白存档
    const remembered = localStorage.getItem(currentIdStorageKey)
    const saves = await saveStorage.list()
    let target: SaveIndexEntry|undefined = saves.find(x => x.id === remembered) ?? saves[0]
    if(!target){
        const id = newSaveId()
        await saveStorage.store(id, '新存档', {})
        target = { id, name: '新存档', createdAt: Date.now(), updatedAt: Date.now() }
    }
    currentSaveId.value = target.id
    currentSaveName.value = target.name
    setCurrentSaveIdRaw(target.id)
    localStorage.setItem(currentIdStorageKey, target.id)
    let raw: unknown = {} // 读不到时传空对象，normalizeSave 会按全新存档初始化
    try{
        raw = await saveStorage.load(target.id)
    }catch{
        showPop('读取存档失败，已从空白存档开始', 'failed')
    }
    try{
        await loadSaveIntoEditor(raw, {
            visitorMode: false,
            onDataSourceEvent: dataSourceEventLoggers
        })
        loadComplete.value = true
    }catch{
        showPop('存档损坏，无法打开', 'failed')
    }
}

let lastSavedTime = 0
async function saveData(_mustBackup:boolean){
    // minimal 无云端，mustBackup（服务端备份）无意义，忽略
    if(lastSavedTime + 1000 > Date.now()){
        console.warn('保存过于频繁（1秒内），已忽略本次保存请求')
        return
    }
    lastSavedTime = Date.now()
    const payload = prepareSavePayload() // core 侧：配置写回 + 站名坐标截断
    try{
        await saveStorage.store(currentSaveId.value, currentSaveName.value, payload ?? {})
    }catch(e){
        console.warn('[存档] 保存失败', e)
        showPop('保存失败', 'failed')
        return // 保持脏态拦截，不 release
    }
    releasePreventLeaving()
    showPop('保存成功', 'success')
}

const saveManager = useTemplateRef('saveManager')
function leave(){
    // “离开”= 打开存档管理器；此刻数据必定已保存干净（core 的 Menu 脏时按钮只显示“保存”）
    saveManager.value?.open()
}
function switchSave(id: string){
    // 仿照 web 的彻底 reload：记录目标存档 id 后整页刷新，启动流程会加载它
    //（避开运行时切换的状态清理问题，见 aarc-core/docs/problems/save-switching-problems.md）
    if(id === currentSaveId.value)
        return
    localStorage.setItem(currentIdStorageKey, id)
    window.location.reload()
}

onBeforeMount(async()=>{
    // 将“主画布重新渲染”当成“存档信息变化”：重新渲染时阻止用户离开/刷新/关闭页面
    //（undo 入栈已由 core 在 notifyMainCvsRendered 内处理）
    mainCvsDispatcher.initAfterMainCvsRendered(()=>{
        preventLeaving()
    })
    await load()
})
onBeforeUnmount(()=>{
    disposeEditor()
})
</script>

<template>
    <Cvs v-if="loadComplete"></Cvs>
    <Menu v-if="loadComplete" @save-data="saveData" @leave="leave"></Menu>
    <SaveManagerModal ref="saveManager" :current-save-id="currentSaveId" @select="switchSave"/>
</template>
