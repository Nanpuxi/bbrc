<script setup lang="ts">
import { computed, ref } from 'vue';
import { UserFileDto, UserFavoriteType, UserFileType } from '@/app/com/apiGenerated';
import { useApiStore } from '@/app/com/apiStore';
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents';
import SideBar from 'aarc-core/components/common/SideBar.vue';
import { useUserFileFavoriteStore } from 'aarc-core/models/stores/utils/userFileFavoriteStore';

const api = useApiStore()
const { showPop } = useUniqueComponentsStore()
const userFileFavoriteStore = useUserFileFavoriteStore()
const sidebar = ref<InstanceType<typeof SideBar>>()
const search = ref('')
const files = ref<UserFileDto[]>()
const loading = ref(false)
const urlBase = import.meta.env.VITE_ApiUrlBase

// core 打开收藏夹时传入的过滤类型（fileType 字符串 → 后端枚举）
const fileTypeFilter = computed<UserFileType | undefined>(() => {
    const ft = userFileFavoriteStore.pickFileType
    if (ft === 'lineStyle')
        return UserFileType.LineStyle
    if (ft === 'icon')
        return UserFileType.Icon
    return undefined
})
const fileTypeFilterLabel = computed(() => {
    if (fileTypeFilter.value === UserFileType.LineStyle)
        return '仅显示线路样式资源'
    if (fileTypeFilter.value === UserFileType.Icon)
        return '仅显示图标资源'
    return undefined
})
let lastLoadedFilter: UserFileType | undefined

async function load() {
    loading.value = true
    lastLoadedFilter = fileTypeFilter.value
    const searchVal = search.value.trim() || undefined
    const res = await api.userFavorite.getUserFiles(
        UserFavoriteType.UserFile, searchVal, 0, 30, fileTypeFilter.value ?? null)
    if (res) {
        files.value = res
    }
    loading.value = false
}

function open() {
    sidebar.value?.extend()
    if (!files.value || lastLoadedFilter !== fileTypeFilter.value) {
        load()
    }
}

userFileFavoriteStore.initOpenFavoritesSidebar(open)

function onSearchInput() {
    if (!search.value.trim()) {
        load()
    }
}

function select(file: UserFileDto) {
    // 一次性取用意图（如"选为数据源"）优先；否则走 core 注册的全局回调（图标）
    const consumed = userFileFavoriteStore.notifyFileSelected(file)
    if (!consumed)
        showPop('已添加', 'success')
    // 消费方要求时取用后立即关闭；否则保持打开以连续取用
    if (userFileFavoriteStore.pickCloseOnSelect)
        sidebar.value?.fold()
}

defineExpose({ open })
</script>

<template>
    <SideBar ref="sidebar">
        <h1>收藏的资源</h1>
        <div v-if="fileTypeFilterLabel" class="filter-tip">{{ fileTypeFilterLabel }}</div>
        <div class="search-control">
            <input
                v-model="search"
                @input="onSearchInput"
                @blur="load"
                @keyup.enter="load"
                placeholder="搜索收藏的资源"
            />
        </div>
        <div v-if="loading" class="loading-tip">加载中...</div>
        <div v-else class="file-list">
            <div v-if="files?.length === 0" class="empty-state">暂无收藏的资源</div>
            <div v-for="file in files" :key="file.id" class="file-item">
                <img class="file-thumb" :src="urlBase + file.urlThumb" :alt="file.displayName" />
                <span class="file-name" :title="file.displayName">{{ file.displayName || '未命名文件' }}</span>
                <button class="lite confirm" @click="select(file)">取用</button>
            </div>
        </div>
    </SideBar>
</template>

<style scoped lang="scss">
.filter-tip {
    font-size: 12px;
    color: #666;
    margin-bottom: 6px;
}
.search-control {
    margin-bottom: 10px;
    input {
        width: 100%;
        box-sizing: border-box;
    }
}
.loading-tip {
    text-align: center;
    padding: 40px 0;
    color: #999;
}
.empty-state {
    text-align: center;
    padding: 40px 0;
    color: #999;
}
.file-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.file-item {
    display: flex;
    align-items: center;
    gap: 10px;
}
.file-thumb {
    width: 30px;
    height: 30px;
    object-fit: cover;
    flex-shrink: 0;
}
.file-name {
    width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-grow: 1;
}
</style>
