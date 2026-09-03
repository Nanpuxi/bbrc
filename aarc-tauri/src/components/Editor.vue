<script setup lang="ts">
// 编辑器宿主组件（对应 aarc-web 的 Editor.vue 极简版）：
// 无权限判定、无心跳、无压缩上传；存档经 localStorage 存取，使用固定本地存档标识。
import Cvs from 'aarc-core/components/Cvs.vue';
import Menu from 'aarc-core/components/Menu.vue';
import { onBeforeMount, onBeforeUnmount, ref } from 'vue';
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents';
import { usePreventLeavingUnsavedStore } from 'aarc-core/utils/eventUtils/preventLeavingUnsaved';
import { useMainCvsDispatcher } from 'aarc-core/models/cvs/dispatchers/mainCvsDispatcher';
import { loadSaveIntoEditor, disposeEditor, prepareSavePayload, DataSourceUpdateEvents } from 'aarc-core/app/editorSession';
import { setCurrentSaveIdRaw } from 'aarc-core/models/save/currentSaveId';

// minimal：无路由，用固定本地存档标识（core 不读 route）
const localSaveId = 'local'
const storageKey = `aarc-tauri-save-${localSaveId}`
setCurrentSaveIdRaw(localSaveId)

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
    let raw: unknown = {} // 本地无存档时传空对象，normalizeSave 会按全新存档初始化
    const stored = localStorage.getItem(storageKey)
    if(stored){
        try{
            raw = JSON.parse(stored)
        }catch{
            showPop('本地存档损坏，已从空白存档开始', 'failed')
        }
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
    localStorage.setItem(storageKey, JSON.stringify(payload ?? {}))
    releasePreventLeaving()
    showPop('保存成功', 'success')
}

function leave(){
    // minimal 无其他页面可去：提示用户直接关闭/刷新即可（离开拦截由 core 的 onbeforeunload 自理）
    showPop('数据保存在浏览器本地\n可直接关闭或刷新页面', 'info')
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
</template>
