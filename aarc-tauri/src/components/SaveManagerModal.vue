<script setup lang="ts">
// 存档管理器 Modal（设计见 docs/fs-save-manager.md §3.3）：
// 由 Editor.vue 的"离开"按钮打开；点击列表项加载存档，支持新建/重命名/删除。
// 本组件只管存档清单的读写（saveStorage），实际加载由父组件经 select 事件完成。
import { computed, onBeforeUnmount, ref } from 'vue';
import { saveStorage, newSaveId, SaveIndexEntry, SaveGroup } from '../saves/saveStorage';
import { exportSavesBackup } from '../saves/backupExport';
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents';
import foldIcon from 'aarc-core/assets/ui/fold.svg';
import groupIcon from '../assets/ui/group.svg';
import renameIcon from '../assets/ui/rename.svg';
import deleteIcon from '../assets/ui/delete.svg';
import moveUpIcon from '../assets/ui/moveUp.svg';
import moveDownIcon from '../assets/ui/moveDown.svg';
import backupIcon from '../assets/ui/backup.svg';

const props = defineProps<{
    currentSaveId: string
}>()
const emit = defineEmits<{
    (e: 'select', id: string, name: string): void
}>()

const { showPop } = useUniqueComponentsStore()

// 输入框自动聚焦（模板中 v-focus 解析到此局部指令）
const vFocus = {
    mounted(el: HTMLElement) {
        el.focus()
    }
}

const visible = ref(false)
const saves = ref<SaveIndexEntry[]>([])
const groups = ref<SaveGroup[]>([])
const busy = ref(false)
const searchText = ref('')

// 分组折叠状态存 localStorage（纯 UI 态，不进 index.json）
const collapsedKey = 'aarc-tauri-save-groups-collapsed'
function loadCollapsed(): Set<string> {
    try {
        const arr = JSON.parse(localStorage.getItem(collapsedKey) ?? '')
        if (arr instanceof Array)
            return new Set(arr.filter(x => typeof x === 'string'))
    } catch { /* 忽略损坏的折叠状态 */ }
    return new Set()
}
const collapsedIds = ref<Set<string>>(loadCollapsed())
function toggleCollapse(key: string) {
    if (collapsedIds.value.has(key))
        collapsedIds.value.delete(key)
    else
        collapsedIds.value.add(key)
    localStorage.setItem(collapsedKey, JSON.stringify([...collapsedIds.value]))
}

interface SaveSection {
    key: string        // 分组 id，或 'ungrouped'
    group?: SaveGroup
    saves: SaveIndexEntry[]
}
// 未分组永远排在所有分组之后；指向已删除分组的脏 groupId 在此兜底进未分组
const sections = computed<SaveSection[]>(() => {
    const groupIds = new Set(groups.value.map(g => g.id))
    const byGroup = new Map<string, SaveIndexEntry[]>()
    const ungrouped: SaveIndexEntry[] = []
    for (const s of saves.value) {
        if (s.groupId && groupIds.has(s.groupId)) {
            const arr = byGroup.get(s.groupId) ?? []
            arr.push(s)
            byGroup.set(s.groupId, arr)
        } else {
            ungrouped.push(s)
        }
    }
    const result: SaveSection[] = groups.value.map(g => ({
        key: g.id, group: g, saves: byGroup.get(g.id) ?? []
    }))
    if (ungrouped.length > 0)
        result.push({ key: 'ungrouped', saves: ungrouped })
    return result
})

const filteredSaves = computed(() => {
    const kw = searchText.value.trim().toLowerCase()
    if (!kw) return saves.value
    return saves.value.filter(x => x.name.toLowerCase().includes(kw))
})

// 列表渲染行：搜索时扁平为纯存档行；否则为"组头 + 组内存档"的混合序列
type Row =
    | { type: 'header', key: string, sec: SaveSection, groupIndex: number }
    | { type: 'item', key: string, save: SaveIndexEntry }
const rows = computed<Row[]>(() => {
    if (searchText.value.trim())
        return filteredSaves.value.map(s => ({ type: 'item', key: s.id, save: s }))
    const out: Row[] = []
    sections.value.forEach((sec, gi) => {
        out.push({ type: 'header', key: `h-${sec.key}`, sec, groupIndex: gi })
        if (!collapsedIds.value.has(sec.key))
            for (const s of sec.saves)
                out.push({ type: 'item', key: s.id, save: s })
    })
    return out
})

async function refresh() {
    try {
        const [s, g] = await Promise.all([saveStorage.list(), saveStorage.listGroups()])
        saves.value = s
        groups.value = g
    } catch (e) {
        console.warn('[存档] 读取存档清单失败', e)
        showPop('读取存档清单失败', 'failed')
    }
}

// 打包导出：全部存档打包为 aarc-app-backup.zip（实现与平台分流见 backupExport.ts）
async function exportBackup() {
    if (busy.value) return
    busy.value = true
    try {
        await exportSavesBackup()
    } finally {
        busy.value = false
    }
}

async function open() {
    visible.value = true
    renamingId.value = undefined
    renamingGroupId.value = undefined
    groupModalFor.value = undefined
    confirmDelete.value = undefined
    searchText.value = ''
    window.addEventListener('keydown', onKeydown)
    await refresh()
}
function close() {
    visible.value = false
    window.removeEventListener('keydown', onKeydown)
}
function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        if (confirmDelete.value)
            confirmDelete.value = undefined
        else if (groupModalFor.value)
            groupModalFor.value = undefined
        else
            close()
    }
}

function select(entry: SaveIndexEntry) {
    if (busy.value) return
    if (entry.id !== props.currentSaveId)
        emit('select', entry.id, entry.name)
    close()
}

// 新建：以默认名创建空白存档并立即切入（加载走父组件，core 会按全新存档初始化）
async function createSave() {
    if (busy.value) return
    busy.value = true
    try {
        const existingNames = new Set(saves.value.map(x => x.name))
        let name = '新存档'
        for (let i = 2; existingNames.has(name); i++)
            name = `新存档 ${i}`
        const id = newSaveId()
        await saveStorage.store(id, name, {})
        emit('select', id, name)
        close()
    } catch (e) {
        console.warn('[存档] 新建存档失败', e)
        showPop('新建存档失败', 'failed')
    } finally {
        busy.value = false
    }
}

const renamingId = ref<string>()
const renameText = ref('')
function startRename(entry: SaveIndexEntry) {
    renamingId.value = entry.id
    renameText.value = entry.name
}
async function confirmRename(entry: SaveIndexEntry) {
    const name = renameText.value.trim()
    renamingId.value = undefined
    if (!name || name === entry.name)
        return
    try {
        await saveStorage.rename(entry.id, name)
        await refresh()
    } catch (e) {
        console.warn('[存档] 重命名失败', e)
        showPop('重命名失败', 'failed')
    }
}

// ---------- 删除确认（统一 Modal，覆盖在最上层） ----------

interface ConfirmDeleteTarget {
    kind: 'save' | 'group'
    id: string
    name: string
}
const confirmDelete = ref<ConfirmDeleteTarget>()
// 删除组时组内存档数（>0 时在确认 Modal 里追加提示）
const confirmDeleteGroupCount = computed(() => {
    const t = confirmDelete.value
    if (!t || t.kind !== 'group')
        return 0
    return saves.value.filter(x => x.groupId === t.id).length
})

function removeSave(entry: SaveIndexEntry) {
    if (busy.value) return
    if (entry.id === props.currentSaveId)
        return // 当前正在编辑的存档不可删除（按钮已禁用，这里兜底）
    confirmDelete.value = { kind: 'save', id: entry.id, name: entry.name }
}

function removeGroup(g: SaveGroup) {
    confirmDelete.value = { kind: 'group', id: g.id, name: g.name }
}

async function confirmDeleteYes() {
    const target = confirmDelete.value
    if (!target || busy.value) return
    busy.value = true
    confirmDelete.value = undefined
    try {
        if (target.kind === 'save') {
            await saveStorage.remove(target.id)
            showPop('已删除', 'success')
        } else {
            await saveStorage.removeGroup(target.id)
            showPop('已删除分组', 'success')
        }
        await refresh()
    } catch (e) {
        console.warn('[存档] 删除失败', e)
        showPop('删除失败', 'failed')
    } finally {
        busy.value = false
    }
}

// ---------- 分组管理 ----------

async function moveGroup(g: SaveGroup, delta: number) {
    try {
        await saveStorage.moveGroup(g.id, delta)
        await refresh()
    } catch (e) {
        console.warn('[存档] 调整分组顺序失败', e)
        showPop('调整分组顺序失败', 'failed')
    }
}

const renamingGroupId = ref<string>()
const renameGroupText = ref('')
function startRenameGroup(g: SaveGroup) {
    renamingGroupId.value = g.id
    renameGroupText.value = g.name
}
async function confirmRenameGroup(g: SaveGroup) {
    const name = renameGroupText.value.trim()
    renamingGroupId.value = undefined
    if (!name || name === g.name)
        return
    try {
        await saveStorage.renameGroup(g.id, name)
        await refresh()
    } catch (e) {
        console.warn('[存档] 重命名分组失败', e)
        showPop('重命名分组失败', 'failed')
    }
}

// ---------- 存档移动分组（独立 Modal，覆盖在管理器上层） ----------

const groupModalFor = ref<SaveIndexEntry>()
const newGroupName = ref('')
function openGroupModal(entry: SaveIndexEntry) {
    groupModalFor.value = entry
    newGroupName.value = ''
}
async function setGroup(entry: SaveIndexEntry, groupId?: string) {
    groupModalFor.value = undefined
    try {
        await saveStorage.setSaveGroup(entry.id, groupId)
        await refresh()
    } catch (e) {
        console.warn('[存档] 移动分组失败', e)
        showPop('移动分组失败', 'failed')
    }
}
async function createGroupFor(entry: SaveIndexEntry) {
    const name = newGroupName.value.trim()
    if (!name) return
    try {
        const g = await saveStorage.createGroup(name)
        groupModalFor.value = undefined
        await saveStorage.setSaveGroup(entry.id, g.id)
        await refresh()
    } catch (e) {
        console.warn('[存档] 新建分组失败', e)
        showPop('新建分组失败', 'failed')
    }
}

function formatTime(ts: number) {
    return new Date(ts).toLocaleString()
}

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown)
})

defineExpose({ open })
</script>

<template>
    <div v-if="visible" class="mask" @click.self="close">
        <div class="card">
            <div class="titleRow">
                <div class="title">存档管理器</div>
                <button class="lite backupBtn" title="打包导出备份（zip）" :disabled="busy"
                    @click="exportBackup"><img :src="backupIcon" /></button>
            </div>
            <div class="searchBar">
                <input v-model="searchText" placeholder="按名称搜索存档" />
            </div>
            <div class="list">
                <template v-for="row in rows" :key="row.key">
                    <div v-if="row.type === 'header'" class="groupHeader" @click="toggleCollapse(row.sec.key)">
                        <template v-if="row.sec.group && renamingGroupId === row.sec.group.id">
                            <input v-model="renameGroupText" @click.stop
                                @keyup.enter="confirmRenameGroup(row.sec.group)"
                                @keyup.esc.stop="renamingGroupId = undefined" v-focus />
                            <button class="ok" @click.stop="confirmRenameGroup(row.sec.group)">确定</button>
                            <button class="cancel" @click.stop="renamingGroupId = undefined">取消</button>
                        </template>
                        <template v-else>
                            <span class="foldArrow" :class="{ collapsed: collapsedIds.has(row.sec.key) }">
                                <img :src="foldIcon" />
                            </span>
                            <span class="groupName">{{ row.sec.group?.name ?? '未分组' }}</span>
                            <span class="groupCount">({{ row.sec.saves.length }})</span>
                            <span v-if="row.sec.group" class="groupOps">
                                <button class="lite" title="上移" :disabled="row.groupIndex === 0"
                                    @click.stop="moveGroup(row.sec.group, -1)"><img :src="moveUpIcon" /></button>
                                <button class="lite" title="下移" :disabled="row.groupIndex === groups.length - 1"
                                    @click.stop="moveGroup(row.sec.group, 1)"><img :src="moveDownIcon" /></button>
                                <button class="lite" title="重命名分组"
                                    @click.stop="startRenameGroup(row.sec.group)"><img :src="renameIcon" /></button>
                                <button class="lite cancel" title="删除分组"
                                    @click.stop="removeGroup(row.sec.group)"><img :src="deleteIcon" /></button>
                            </span>
                        </template>
                    </div>
                    <div v-else class="item" :class="{ current: row.save.id === currentSaveId }"
                        @click="select(row.save)">
                        <div v-if="renamingId === row.save.id" class="renaming">
                            <input v-model="renameText" @click.stop
                                @keyup.enter="confirmRename(row.save)" @keyup.esc.stop="renamingId = undefined"
                                v-focus />
                            <button class="ok" @click.stop="confirmRename(row.save)">确定</button>
                            <button class="cancel" @click.stop="renamingId = undefined">取消</button>
                        </div>
                        <template v-else>
                            <div class="info">
                                <div class="name">
                                    {{ row.save.name }}<span v-if="row.save.id === currentSaveId"
                                        class="currentTag">当前</span>
                                </div>
                                <div class="time">最后保存：{{ formatTime(row.save.updatedAt) }}</div>
                            </div>
                            <div class="ops">
                                <button class="lite" title="设置分组"
                                    @click.stop="openGroupModal(row.save)"><img :src="groupIcon" /></button>
                                <button class="lite confirm" title="重命名"
                                    @click.stop="startRename(row.save)"><img :src="renameIcon" /></button>
                                <button class="lite cancel" title="删除" :disabled="row.save.id === currentSaveId"
                                    @click.stop="removeSave(row.save)"><img :src="deleteIcon" /></button>
                            </div>
                        </template>
                    </div>
                </template>
                <div v-if="rows.length === 0" class="empty">
                    {{ searchText.trim() ? '无匹配的存档' : '暂无存档' }}
                </div>
            </div>
            <div class="footer">
                <button class="confirm" :disabled="busy" @click="createSave">新建存档</button>
                <button class="minor" @click="close">关闭</button>
            </div>
        </div>
    </div>
    <div v-if="groupModalFor" class="mask groupMask" @click.self="groupModalFor = undefined">
        <div class="card groupCard">
            <div class="title">为「{{ groupModalFor.name }}」设置分组</div>
            <div class="groupOptions">
                <div class="menuItem" :class="{ on: !groupModalFor.groupId }"
                    @click="setGroup(groupModalFor, undefined)">未分组</div>
                <div v-for="g in groups" :key="g.id" class="menuItem"
                    :class="{ on: groupModalFor.groupId === g.id }"
                    @click="setGroup(groupModalFor, g.id)">{{ g.name }}</div>
            </div>
            <div class="menuNew">
                <input v-model="newGroupName" placeholder="新分组名"
                    @keyup.enter="createGroupFor(groupModalFor)"
                    @keyup.esc.stop="groupModalFor = undefined" v-focus />
                <button class="ok" :disabled="!newGroupName.trim()"
                    @click="createGroupFor(groupModalFor)">新建</button>
            </div>
            <div class="footer">
                <button class="minor" @click="groupModalFor = undefined">取消</button>
            </div>
        </div>
    </div>
    <div v-if="confirmDelete" class="mask confirmMask" @click.self="confirmDelete = undefined">
        <div class="card confirmCard">
            <div class="title">确认删除「{{ confirmDelete.name }}」？</div>
            <div class="confirmDesc">本操作不可撤销</div>
            <div v-if="confirmDeleteGroupCount > 0" class="confirmDesc">
                {{ confirmDeleteGroupCount }}个存档将变为未分组状态
            </div>
            <div class="footer">
                <button class="cancel" :disabled="busy" @click="confirmDeleteYes">删除</button>
                <button class="minor" @click="confirmDelete = undefined">取消</button>
            </div>
        </div>
    </div>
</template>

<style scoped lang="scss">
.mask {
    position: fixed;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.5);
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
}
.card {
    background-color: white;
    border-radius: 10px;
    padding: 20px;
    width: 420px;
    max-width: 90vw;
    box-sizing: border-box;
    height: 80vh;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
}
.title {
    font-size: 18px;
    font-weight: bold;
    text-align: center;
}
// 标题行：标题保持居中，导出按钮绝对定位到最右侧
.titleRow {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    .backupBtn {
        position: absolute;
        right: 0;
        display: inline-flex;
        padding: 3px;
        border-radius: 3px;
        transition: 200ms;
        &:not(:disabled):hover {
            background-color: #eee;
        }
        img {
            width: 16px;
            height: 16px;
        }
        &:disabled {
            cursor: not-allowed;
            img {
                opacity: 0.3;
            }
            &:hover {
                text-decoration: none;
            }
        }
    }
}
.searchBar {
    input {
        width: 100%;
        box-sizing: border-box;
        padding: 6px 10px;
        border: none;
        background-color: #f6f6f6;
        border-radius: 6px;
        margin: 0px
    }
}
// 负边距让滚动区域撑满卡片宽度（抵消卡片 20px 内边距），内容左侧留卡片内边距的一半（10px）；
// scrollbar-gutter: stable 让滚动条槽位常驻，滚动条出现/消失不会改变列表项宽度
.list {
    overflow-y: auto;
    scrollbar-gutter: stable;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-height: 0;
    margin: 0 -20px;
    padding-left: 10px;
    // overlay 滚动条平台（macOS 默认、安卓/iOS）scrollbar-gutter 无效，
    // 右侧不会预留槽位，需补对称的右 padding，否则列表偏右贴边（检测见 main.ts）
    html.overlay-scrollbar & {
        padding-right: 10px;
    }
}
.groupHeader {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    cursor: pointer;
    user-select: none;
    color: #555;
    font-size: 14px;
    font-weight: bold;
    input {
        flex: 1;
        min-width: 0;
        padding: 2px 6px;
        border: 1px solid #aaa;
        border-radius: 4px;
    }
    .foldArrow {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
        img {
            width: 100%;
            height: 100%;
            transition: transform 0.15s;
        }
        &.collapsed img {
            transform: rotate(-90deg);
        }
    }
    .groupName {
        font-size: 16px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        user-select: none;
    }
    .groupCount {
        color: #999;
        font-weight: normal;
        font-size: 12px;
        user-select: none;
    }
    .groupOps {
        margin-left: auto;
        flex-shrink: 0;
        display: flex;
        gap: 6px;
        button {
            display: inline-flex;
            align-items: center;
            padding: 3px;
            border-radius: 3px;
            transition: 200ms;
            &:not(:disabled):hover {
                background-color: #eee;
            }
            img {
                width: 16px;
                height: 16px;
            }
        }
        button:disabled {
            cursor: not-allowed;
            img {
                opacity: 0.3;
            }
        }
    }
}
.item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border: 2px solid #ddd;
    border-radius: 8px;
    cursor: pointer;
    transition: border-color 0.2s;
    &:hover {
        border-color: cornflowerblue;
    }
    &.current {
        border-color: cornflowerblue;
        background-color: #f0f6ff;
    }
}
.info {
    min-width: 0;
    .name {
        font-weight: bold;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .currentTag {
        margin-left: 6px;
        font-size: 12px;
        color: cornflowerblue;
    }
    .time {
        font-size: 12px;
        color: #888;
    }
}
.ops {
    flex-shrink: 0;
    display: flex;
    gap: 6px;
    font-size: 14px;
    button {
        display: inline-flex;
        align-items: center;
        padding: 3px;
        border-radius: 3px;
        transition: 200ms;
        &:not(:disabled):hover {
            background-color: #eee;
        }
        img {
            width: 16px;
            height: 16px;
        }
    }
    button:disabled {
        cursor: not-allowed;
        img {
            opacity: 0.3;
        }
        &:hover {
            text-decoration: none;
        }
    }
}
.renaming {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    input {
        flex: 1;
        min-width: 0;
        padding: 4px 6px;
        border: 1px solid #aaa;
        border-radius: 4px;
    }
}
.groupMask {
    z-index: 100001;
}
.groupCard {
    width: 320px;
    height: auto;
    max-height: 80vh;
    .title {
        font-size: 16px;
    }
}
.groupOptions {
    overflow-y: auto;
    max-height: 40vh;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 60px;
}
.menuItem {
    padding: 8px 10px;
    border: 2px solid #ddd;
    border-radius: 8px;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: border-color 0.2s;
    &:hover {
        border-color: cornflowerblue;
    }
    &.on {
        border-color: cornflowerblue;
        background-color: #f0f6ff;
    }
}
.menuNew {
    display: flex;
    gap: 6px;
    input {
        flex: 1;
        min-width: 0;
        padding: 4px 6px;
        border: 1px solid #aaa;
        border-radius: 4px;
    }
}
.empty {
    text-align: center;
    color: #999;
    padding: 30px 0;
}
.confirmMask {
    z-index: 100002;
}
.confirmCard {
    width: 300px;
    height: auto;
    max-height: 80vh;
    .title {
        font-size: 16px;
    }
    .confirmDesc {
        text-align: center;
        color: #888;
        font-size: 14px;
    }
}
.footer {
    display: flex;
    justify-content: center;
    gap: 10px;
}
</style>
