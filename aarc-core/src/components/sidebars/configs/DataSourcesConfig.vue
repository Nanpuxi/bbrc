<script setup lang="ts">
import { DataSource } from 'aarc-core/models/save';
import { useSaveStore } from 'aarc-core/models/stores/saveStore';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import ConfigSection from './shared/ConfigSection.vue';
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents';
import { useIconStore } from 'aarc-core/models/stores/iconStore';
import { useEnvStore } from 'aarc-core/models/stores/envStore';
import { fetchDataSource, mergeDataSourceItems, mergeColorSourceItems, applyColorSourceMerges } from 'aarc-core/models/save/dataSourceOps';
import { useExternalColorSetsStore, type ExternalColorSetEntry } from 'aarc-core/app/localConfig/externalColorSets';
import { useUserFileFavoriteStore } from 'aarc-core/models/stores/utils/userFileFavoriteStore';
import { useResourceAccessStore } from 'aarc-core/models/stores/utils/resourceAccessStore';
import Prompt from 'aarc-core/components/common/Prompt.vue';

const saveStore = useSaveStore()
const { save } = storeToRefs(saveStore)
const { showPop } = useUniqueComponentsStore()
const iconStore = useIconStore()
const envStore = useEnvStore()
const { dataSourcesAccessNotice } = storeToRefs(useResourceAccessStore())

const typeLabel: Record<DataSource['type'], string> = {
    lineStyles: '线路样式',
    textTagIcons: '文本标签图标',
    patterns: '纹理',
    colorSets: '颜色集'
}

const externalColorSetsStore = useExternalColorSetsStore()
const userFileFavoriteStore = useUserFileFavoriteStore()
const creating = ref<DataSource>({ id: 0, url: '', type: 'lineStyles' })
const createAllowed = ref(false)
const linkModalShow = ref(false)
const attrModalShow = ref(false)

function openLinkModal() {
    creating.value = { id: 0, url: '', type: 'lineStyles', autoUpdate: true, overwriteSameName: false }
    createAllowed.value = false
    linkModalShow.value = true
}

// 从收藏的线路样式资源选取：使用宿主拼好的按 uniqueName 的固定链接（覆盖上传后仍指向最新内容）
function pickFromFavorites() {
    userFileFavoriteStore.openFavoritesSidebar({
        fileType: 'lineStyle',
        closeOnSelect: true,
        onSelected: (f, contentUrl) => {
            if (!contentUrl) {
                showPop('该资源缺少固定链接，无法作为数据源', 'failed')
                return
            }
            creating.value = {
                id: 0,
                name: f.displayName ?? '',
                url: contentUrl,
                type: 'lineStyles',
                autoUpdate: true,
                overwriteSameName: false
            }
            attrModalShow.value = true
        }
    })
}

function validateCreating() {
    const c = creating.value
    createAllowed.value = !!c.url.trim() && !!c.name?.trim()
}

// 链接是否已存在同链接数据源（不阻塞添加，只提示会覆盖）
const sameUrlExisting = computed(() => {
    const url = creating.value.url.trim()
    if (!url) return undefined
    return save.value?.dataSources?.find(x => x.url === url)
})

function addDataSource() {
    if (!save.value) return
    const url = creating.value.url.trim()
    if (!url) return
    const type = creating.value.type
    save.value.dataSources ??= []
    const existing = sameUrlExisting.value
    let ds: DataSource
    if (existing) {
        // 同链接：沿用原 id 和位置，只覆盖属性
        existing.name = creating.value.name?.trim()
        existing.type = type
        existing.autoUpdate = creating.value.autoUpdate
        existing.overwriteSameName = creating.value.overwriteSameName
        ds = existing
    } else {
        ds = {
            id: saveStore.getNewId(),
            name: creating.value.name?.trim(),
            url,
            type,
            autoUpdate: creating.value.autoUpdate,
            overwriteSameName: creating.value.overwriteSameName
        }
        save.value.dataSources.push(ds)
    }
    linkModalShow.value = false
    attrModalShow.value = false
    creating.value = { id: 0, url: '', type: 'lineStyles' }
    createAllowed.value = false
    setTimeout(() => loadDataSource(ds), 500)
}

function removeDataSource(id: number) {
    if (!save.value?.dataSources) return
    const idx = save.value.dataSources.findIndex(x => x.id === id)
    if (idx >= 0) {
        if (!window.confirm('确定要删除这个数据源吗？')) return
        save.value.dataSources.splice(idx, 1)
        showPop('删除成功', 'success')
    }
}

const loadingIds = ref<Set<number>>(new Set())

interface DsLoadResult {
    msg: string
    type: 'success' | 'warning' | 'error'
}
const dsResults = ref<Map<number, DsLoadResult>>(new Map())
const dsResultTimers = ref<Map<number, number>>(new Map())

function setDsResult(dsId: number, msg: string, type: DsLoadResult['type']) {
    const existingTimer = dsResultTimers.value.get(dsId)
    if (existingTimer !== undefined) {
        clearTimeout(existingTimer)
        dsResultTimers.value.delete(dsId)
    }
    dsResults.value.set(dsId, { msg, type })
    if (type !== 'error') {
        const timerId = window.setTimeout(() => {
            dsResultTimers.value.delete(dsId)
            clearDsResult(dsId)
        }, 5000)
        dsResultTimers.value.set(dsId, timerId)
    }
}
function clearDsResult(dsId: number) {
    dsResults.value.delete(dsId)
}



async function loadDataSource(ds: DataSource) {
    if (!save.value) return
    loadingIds.value.add(ds.id)
    clearDsResult(ds.id)
    try {
        console.log('[loadDataSource] 开始加载:', ds.name, 'type:', ds.type, 'url:', ds.url)
        const result = await fetchDataSource(ds.url)
        console.log('[loadDataSource] fetch 结果:', { ok: result.ok, hasData: result.data !== undefined, errmsg: result.errmsg })
        if (!result.ok || result.data === undefined) {
            setDsResult(ds.id, result.errmsg || '加载失败', 'error')
            return
        }
        let report: { added: number, overwritten: number, skipped: number, errors: string[] }
        if (ds.type === 'colorSets') {
            console.log('[loadDataSource] 处理 colorSets 类型')
            const mergeReport = mergeColorSourceItems(ds, result.data, externalColorSetsStore.getGroup(ds.url))
            const items = (mergeReport as typeof mergeReport & { _items?: ExternalColorSetEntry[] })._items
            const url = (mergeReport as typeof mergeReport & { _url?: string })._url
            console.log('[loadDataSource] items:', items?.length, 'url:', url)
            if (items && url) {
                applyColorSourceMerges(url, items)
            }
            report = mergeReport
        } else {
            report = mergeDataSourceItems(save.value, saveStore.getNewId, ds, result.data)
        }
        const detailMsgs: string[] = []
        if (ds.type === 'colorSets') {
            const total = report.added + report.overwritten
            if (total > 0) detailMsgs.push(`共 ${total} 个颜色集`)
        } else {
            if (report.added > 0) detailMsgs.push(`新增 ${report.added} 项`)
            if (report.overwritten > 0) detailMsgs.push(`覆盖 ${report.overwritten} 项`)
        }
        if (report.skipped > 0) detailMsgs.push(`跳过 ${report.skipped} 项`)
        if (report.errors.length > 0) detailMsgs.push(...report.errors)

        const hasError = report.errors.length > 0
        const hasChange = ds.type === 'colorSets'
            ? (report.added + report.overwritten) > 0
            : report.added > 0 || report.overwritten > 0
        if (hasError) {
            setDsResult(ds.id, detailMsgs.join('，'), 'error')
        } else if (hasChange) {
            setDsResult(ds.id, detailMsgs.join('，'), 'success')
        } else {
            setDsResult(ds.id, detailMsgs.join('，') || '无变化', 'warning')
        }

        if (ds.type === 'textTagIcons') {
            await iconStore.ensureAllLoaded()
        }
        if (ds.type === 'lineStyles' || ds.type === 'patterns') {
            envStore.rerender()
        }
    } finally {
        loadingIds.value.delete(ds.id)
    }
}

async function loadAll() {
    const dss = save.value?.dataSources
    if (!dss || dss.length === 0) return
    let successCount = 0
    let failCount = 0
    for (const ds of dss) {
        await loadDataSource(ds)
        const result = dsResults.value.get(ds.id)
        if (result?.type === 'error') {
            failCount++
        } else {
            // success 和 warning（如跳过/无变化）都算成功
            successCount++
        }
    }
    showPop(`成功 ${successCount} 个，失败 ${failCount} 个`, failCount > 0 ? 'warning' : 'success')
}
</script>

<template>
<ConfigSection :title="'数据源'">
<div v-if="dataSourcesAccessNotice">{{ dataSourcesAccessNotice }}</div>
<div v-else class="dataSources">
    <div class="smallNote" style="text-align: center;">
        添加返回 JSON 数组的 URL，可一键导入线路样式、纹理、颜色集
    </div>

    <div class="dsOps">
        <button v-if="userFileFavoriteStore.hasOpenFavoritesSidebar" @click="pickFromFavorites">从收藏添加</button>
        <button @click="openLinkModal">从链接添加</button>
    </div>

    <div v-for="ds in save?.dataSources" :key="ds.id" class="dsItem">
        <div class="dsHead">
            <span class="dsName">{{ ds.type == 'colorSets' ? '暂时停用' : (ds.name || '未命名') }}</span>
            <span class="dsType">{{ typeLabel[ds.type] }}</span>
        </div>
        <div class="dsUrl">{{ ds.url }}</div>
        <div class="dsFlags">
            <span
                class="flag"
                :class="{ off: !ds.autoUpdate }"
                @click="ds.autoUpdate = !ds.autoUpdate">
                自动更新{{ ds.autoUpdate ? '开' : '关' }}
            </span>
            <span
                class="flag"
                :class="{ off: !ds.overwriteSameName }"
                @click="ds.overwriteSameName = !ds.overwriteSameName">
                覆盖同名{{ ds.overwriteSameName ? '开' : '关' }}
            </span>
        </div>
        <div v-if="dsResults.get(ds.id)" class="dsResult" :class="dsResults.get(ds.id)!.type">
            {{ dsResults.get(ds.id)!.msg }}
        </div>
        <div class="dsOps">
            <button
                class="lite"
                :class="loadingIds.has(ds.id) ? 'off' : 'ok'"
                :disabled="loadingIds.has(ds.id)"
                @click="loadDataSource(ds)">
                {{ loadingIds.has(ds.id) ? '加载中...' : '加载' }}
            </button>
            <button class="lite cancel" @click="removeDataSource(ds.id)">删除</button>
        </div>
    </div>

    <div v-if="save?.dataSources && save.dataSources.length > 1" class="dsOps" style="justify-content: center;">
        <button class="lite ok" @click="loadAll">全部加载一次</button>
    </div>

    <Prompt v-if="attrModalShow" :bg-click-close="true" @close="attrModalShow = false">
        <div class="dsModal">
            <div class="dsModalTitle">添加数据源</div>
            <div class="dsModalName">{{ creating.name || '未命名' }}</div>
            <div class="dsChecks">
                <label>
                    <input type="checkbox" v-model="creating.autoUpdate" />
                    启动时自动更新
                </label>
                <label>
                    <input type="checkbox" v-model="creating.overwriteSameName" />
                    覆盖同名项目
                </label>
            </div>
            <div v-if="sameUrlExisting" class="dsWarn">将会覆盖同链接数据源</div>
            <div class="dsOps">
                <button class="cancel" @click="attrModalShow = false">取消</button>
                <button class="ok" @click="addDataSource">添加</button>
            </div>
        </div>
    </Prompt>

    <Prompt v-if="linkModalShow" :bg-click-close="true" @close="linkModalShow = false">
        <div class="dsModal">
            <div class="dsModalTitle">添加数据源</div>
            <div class="dsField">
                <span>名称</span><input v-model="creating.name" @input="validateCreating" placeholder="必填"/>
            </div>
            <div class="dsField">
                <span>链接</span><input v-model="creating.url" @input="validateCreating" placeholder="https://..."/>
            </div>
            <div class="dsField typeField">
                <select v-model="creating.type">
                    <option value="lineStyles">线路样式</option>
                    <option value="patterns">纹理</option>
                    <option value="colorSets">颜色集</option>
                </select>
            </div>
            <div class="dsChecks">
                <label>
                    <input type="checkbox" v-model="creating.autoUpdate" />
                    启动时自动更新
                </label>
                <label>
                    <input type="checkbox" v-model="creating.overwriteSameName" />
                    覆盖同名项目
                </label>
            </div>
            <div v-if="sameUrlExisting" class="dsWarn">将会覆盖同链接数据源</div>
            <div class="dsOps">
                <button class="cancel" @click="linkModalShow = false">取消</button>
                <button :class="createAllowed ? 'ok' : 'off'" :disabled="!createAllowed" @click="addDataSource">添加</button>
            </div>
        </div>
    </Prompt>
</div>
</ConfigSection>
</template>

<style scoped lang="scss">
.dataSources{
    padding: 5px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.dsItem{
    border-radius: 10px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-shadow: 0px 0px 5px 0px #ccc;
    background-color: #eee;
    overflow: hidden;
    .dsHead{
        display: flex;
        justify-content: space-between;
        align-items: center;
        .dsName{
            font-weight: bold;
            font-size: 14px;
        }
        .dsType{
            font-size: 12px;
            color: #666;
            background: #eee;
            padding: 2px 6px;
            border-radius: 4px;
        }
    }
    .dsUrl{
        font-size: 12px;
        color: #666;
        word-break: break-all;
    }
    .dsOps{
        display: flex;
        justify-content: center;
        gap: 6px;
    }
}
.dsOps{
    display: flex;
    justify-content: center;
    gap: 6px;
}
.dsModal{
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 240px;
    .dsModalTitle{
        font-weight: bold;
        font-size: 14px;
        text-align: center;
    }
    .dsModalName{
        font-size: 13px;
        color: #666;
        text-align: center;
        word-break: break-all;
    }
    .dsField{
        display: flex;
        align-items: center;
        gap: 6px;
        input{
            width: 180px;
            font-size: 13px;
        }
        &.typeField{
            justify-content: center;
            select{
                width: 180px;
            }
        }
    }
    .dsChecks{
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 13px;
        color: #666;
        label{
            display: flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
        }
    }
    .dsWarn{
        font-size: 12px;
        color: #a70;
        background: #fff8e1;
        padding: 4px 6px;
        border-radius: 4px;
        text-align: center;
    }
}
.dsFlags{
    display: flex;
    gap: 6px;
    .flag{
        font-size: 11px;
        color: #fff;
        background: #666;
        padding: 1px 5px;
        border-radius: 4px;
        cursor: pointer;
        user-select: none;
        &.off{
            background: #eee;
            color: #666;
        }
    }
}
.dsResult{
    font-size: 12px;
    padding: 4px 6px;
    border-radius: 4px;
    &.success{
        color: #2a7;
        background: #e8f5e9;
    }
    &.warning{
        color: #a70;
        background: #fff8e1;
    }
    &.error{
        color: #c22;
        background: #ffebee;
    }
}
</style>
