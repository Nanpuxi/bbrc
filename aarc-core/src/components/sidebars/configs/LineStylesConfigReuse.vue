<script setup lang="ts">
import { useSaveStore } from 'aarc-core/models/stores/saveStore';
import { storeToRefs } from 'pinia';
import { computed, ref, useTemplateRef, watch } from 'vue';
import copy from 'copy-to-clipboard'
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents';
import { LineStyle } from 'aarc-core/models/save';
import { upgradeLineStyle } from 'aarc-core/models/save/upgrade/lineStyles';
import { hasUserFileUploader, uploadLineStylesAsResource } from 'aarc-core/models/save/lineStyleResourceOps';
import rfdc from 'rfdc';

const saveStore = useSaveStore()
const { save } = storeToRefs(saveStore)
const { showPop } = useUniqueComponentsStore()

const selectedIds = ref<Set<number>>(new Set())

// 当 lineStyles 变化时，自动清理已不存在的选中项
watch(() => save.value?.lineStyles?.length, () => {
    const existingIds = new Set(save.value?.lineStyles?.map(s => s.id) || [])
    for (const id of selectedIds.value) {
        if (!existingIds.has(id)) {
            selectedIds.value.delete(id)
        }
    }
})

const allSelected = computed<boolean>({
    get() {
        const styles = save.value?.lineStyles
        if (!styles || styles.length === 0) return false
        return styles.every(s => selectedIds.value.has(s.id))
    },
    set(val) {
        const styles = save.value?.lineStyles
        if (!styles) return
        if (val) {
            styles.forEach(s => selectedIds.value.add(s.id))
        } else {
            selectedIds.value.clear()
        }
    }
})

const deepClone = rfdc()

function getLineStylesForExport(): LineStyle[] {
    const styles = save.value?.lineStyles
    if (!styles) return []
    const toExport = styles.filter(s => selectedIds.value.has(s.id))
    return deepClone(toExport)
}

async function exportToClipboard() {
    const data = getLineStylesForExport()
    if (data.length === 0) {
        showPop('请先选择要导出的样式', 'warning')
        return
    }
    const success = await copy(JSON.stringify(data))
    if (success)
        showPop('已复制到剪切板', 'success')
    else
        showPop('复制失败，请改用正规浏览器', 'failed')
}

function exportToFile() {
    const data = getLineStylesForExport()
    if (data.length === 0) {
        showPop('请先选择要导出的样式', 'warning')
        return
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'lineStyles.json'
    a.click()
    URL.revokeObjectURL(url)
}

// 宿主（web）在应用启动时注入上传实现，编辑器打开时必定已就绪
const uploaderAvailable = hasUserFileUploader()

// 上传的样式会被导入到任意存档，pattern id 在目标存档中无意义，须把引用的 pattern 整体嵌入
function embedReferencedPatterns(styles: LineStyle[]) {
    const patterns = save.value?.patterns
    if (!patterns) return
    for (const s of styles) {
        for (const layer of s.layers) {
            if (layer.pattern === undefined) continue
            const p = patterns.find(x => x.id === layer.pattern)
            if (p) layer.patternEmbedded = deepClone(p)
        }
    }
}

async function uploadAsResource() {
    const data = getLineStylesForExport()
    if (data.length === 0) {
        showPop('请先选择要上传的样式', 'warning')
        return
    }
    embedReferencedPatterns(data)
    const res = await uploadLineStylesAsResource(data)
    if (res === 'ok')
        showPop('上传成功，可前往"文件"页收藏这些资源', 'success')
    else if (res === 'canceled')
        showPop('已取消上传', 'info')
    else
        showPop('上传失败', 'failed')
}

const wantToImport = ref(false)
const importedJson = ref('')

function importFromClipboard() {
    wantToImport.value = true
}

function handleInputChange() {
    try {
        const parsed = JSON.parse(importedJson.value)
        const importedStyles = Array.isArray(parsed) ? parsed : [parsed]
        mergeLineStyles(importedStyles)
        showPop('导入成功', 'success')
        wantToImport.value = false
        importedJson.value = ''
    } catch (e) {
        console.error(e)
        showPop('导入失败，请检查格式是否正确', 'failed')
        importedJson.value = ''
    }
}

const fileInputRef = useTemplateRef('fileInputRef')

function importFromFile() {
    fileInputRef.value?.click()
}

function handleFileChange(event: Event) {
    const target = event.target as HTMLInputElement
    const file = target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
        try {
            const text = reader.result as string
            const parsed = JSON.parse(text)
            const importedStyles = Array.isArray(parsed) ? parsed : [parsed]
            mergeLineStyles(importedStyles)
            showPop('导入成功', 'success')
        } catch (e) {
            console.error(e)
            showPop('导入失败，请检查文件格式是否正确', 'failed')
        } finally {
            if (fileInputRef.value) fileInputRef.value.value = ''
        }
    }
    reader.onerror = () => {
        showPop('读取文件失败', 'failed')
        if (fileInputRef.value) fileInputRef.value.value = ''
    }
    reader.readAsText(file)
}

const maxLineStyles = 50

function mergeLineStyles(importedStyles: unknown[]) {
    if (!save.value) return
    save.value.lineStyles ??= []

    let addedCount = 0
    let skippedCount = 0

    for (const item of importedStyles) {
        if (!item || typeof item !== 'object') continue
        const style = item as Partial<LineStyle> & Record<string, unknown>
        if (!Array.isArray(style.layers)) continue

        // 升级旧版格式
        upgradeLineStyle(style as LineStyle)

        if (save.value.lineStyles.length >= maxLineStyles) {
            skippedCount++
            continue
        }

        const newStyle: LineStyle = {
            ...style as LineStyle,
            id: saveStore.getNewId()
        }
        save.value.lineStyles.push(newStyle)
        addedCount++
    }

    if (skippedCount > 0) {
        showPop(`数量上限 ${maxLineStyles} 个`, 'warning')
    }
}
</script>

<template>
<div class="lineStylesReuseBody">
    <p class="smallNote">
        线路样式导入/导出功能可以将线路样式从一个存档导出，并导入到另一个存档，这对于创建新存档，或者将线路样式与他人共享非常有用
    </p>

    <div class="exportList" v-if="save?.lineStyles && save.lineStyles.length > 0">
        <div class="listHeader">
            <label class="checkboxLabel">
                <input type="checkbox" v-model="allSelected" />
                <span>全选</span>
            </label>
            <span class="listTitle">选择要导出的样式</span>
        </div>
        <div class="listBody">
            <label v-for="s in save.lineStyles" :key="s.id" class="checkboxLabel listItem">
                <input type="checkbox" :value="s.id" v-model="selectedIds" />
                <span class="styleName">{{ s.name || `样式 #${s.id}` }}</span>
            </label>
        </div>
    </div>
    <div v-else class="noStyles">当前没有线路样式</div>

    <div class="btnGroup">
        <button @click="exportToClipboard" class="ok">导出到剪切板</button>
        <button @click="exportToFile" class="ok">导出到json文件</button>
    </div>
    <div class="btnGroup" v-if="uploaderAvailable">
        <button @click="uploadAsResource" class="ok">上传为资源</button>
    </div>
    <p class="smallNote" v-if="uploaderAvailable">
        上传为资源后（每条选中的样式各成为一个资源），可在"文件"页收藏它们，并在任意存档的"数据源"中引入，实现跨存档共享
    </p>
    <p class="smallNote">
        导入时，新样式会追加到样式列表尾部，不会覆盖同名的样式
    </p>
    <div class="btnGroup">
        <button @click="importFromClipboard">从剪切板导入</button>
        <button @click="importFromFile">从文件导入</button>
    </div>
    <input v-if="wantToImport" v-model="importedJson" placeholder="请粘贴在此"
        @change="handleInputChange"/>
    <input
        ref="fileInputRef"
        type="file"
        accept=".txt,.json"
        style="display: none"
        @change="handleFileChange"
    />
</div>
</template>

<style scoped>
.lineStylesReuseBody{
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
}
.smallNote{
    font-size: 12px;
    color: #666;
    margin: 0;
}
.exportList{
    width: 100%;
    border: 1px solid #ddd;
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 4px;
}
.listHeader{
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background-color: #f5f5f5;
    border-bottom: 1px solid #ddd;
    font-weight: bold;
    font-size: 14px;
}
.listTitle{
    color: #333;
}
.listBody{
    max-height: 300px;
    overflow-y: auto;
    background-color: #fff;
}
.checkboxLabel{
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 13px;
}
.listItem{
    padding: 6px 10px;
    border-bottom: 1px solid #eee;
}
.listItem:last-child{
    border-bottom: none;
}
.listItem:hover{
    background-color: #f9f9f9;
}
.styleName{
    color: #333;
    word-break: break-all;
}
.noStyles{
    font-size: 13px;
    color: #999;
    padding: 10px;
}
.btnGroup{
    display: flex;
    justify-content: space-between;
    width: 100%;
    gap: 8px;
}
.btnGroup button{
    flex: 1;
}
</style>
