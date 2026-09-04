<script setup lang="ts">
// 存档管理器 Modal（设计见 docs/fs-save-manager.md §3.3）：
// 由 Editor.vue 的"离开"按钮打开；点击列表项加载存档，支持新建/重命名/删除。
// 本组件只管存档清单的读写（saveStorage），实际加载由父组件经 select 事件完成。
import { onBeforeUnmount, ref } from 'vue';
import { saveStorage, newSaveId, SaveIndexEntry } from '../saves/saveStorage';
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents';

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
const busy = ref(false)

async function refresh() {
    try {
        saves.value = await saveStorage.list()
    } catch (e) {
        console.warn('[存档] 读取存档清单失败', e)
        showPop('读取存档清单失败', 'failed')
    }
}

async function open() {
    visible.value = true
    renamingId.value = undefined
    window.addEventListener('keydown', onKeydown)
    await refresh()
}
function close() {
    visible.value = false
    window.removeEventListener('keydown', onKeydown)
}
function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape')
        close()
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

async function removeSave(entry: SaveIndexEntry) {
    if (busy.value) return
    if (entry.id === props.currentSaveId)
        return // 当前正在编辑的存档不可删除（按钮已禁用，这里兜底）
    if (!window.confirm(`确定删除存档"${entry.name}"？此操作不可撤销`))
        return
    busy.value = true
    try {
        await saveStorage.remove(entry.id)
        await refresh()
        showPop('已删除', 'success')
    } catch (e) {
        console.warn('[存档] 删除失败', e)
        showPop('删除失败', 'failed')
    } finally {
        busy.value = false
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
            <div class="title">存档管理器</div>
            <div class="list">
                <div v-for="s in saves" :key="s.id" class="item"
                    :class="{ current: s.id === currentSaveId }" @click="select(s)">
                    <div v-if="renamingId === s.id" class="renaming">
                        <input v-model="renameText" @click.stop
                            @keyup.enter="confirmRename(s)" @keyup.esc.stop="renamingId = undefined"
                            v-focus />
                        <button class="ok" @click.stop="confirmRename(s)">确定</button>
                        <button class="cancel" @click.stop="renamingId = undefined">取消</button>
                    </div>
                    <template v-else>
                        <div class="info">
                            <div class="name">
                                {{ s.name }}<span v-if="s.id === currentSaveId" class="currentTag">当前</span>
                            </div>
                            <div class="time">最后保存：{{ formatTime(s.updatedAt) }}</div>
                        </div>
                        <div class="ops">
                            <button class="lite confirm" @click.stop="startRename(s)">重命名</button>
                            <button class="lite cancel" :disabled="s.id === currentSaveId"
                                @click.stop="removeSave(s)">删除</button>
                        </div>
                    </template>
                </div>
                <div v-if="saves.length === 0" class="empty">暂无存档</div>
            </div>
            <div class="footer">
                <button class="confirm" :disabled="busy" @click="createSave">新建存档</button>
                <button class="minor" @click="close">关闭</button>
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
    max-height: 80vh;
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
.list {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 100px;
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
    gap: 4px;
    button:disabled {
        color: #ccc;
        cursor: not-allowed;
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
.empty {
    text-align: center;
    color: #999;
    padding: 30px 0;
}
.footer {
    display: flex;
    justify-content: center;
    gap: 10px;
}
</style>
