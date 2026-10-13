import { defineStore } from "pinia";
import { computed, onScopeDispose, ref, watch } from "vue";
import { localConfigKeyPrefix } from "aarc-core/app/localConfig/common/keyPrefix";

export type SaveListOrderBy = 'active'|'sta'
export const defaultOrderby:SaveListOrderBy = 'sta'
export type AutoRefreshNewest = true | false | 'auto'
export const defaultAutoRefreshNewest: AutoRefreshNewest = 'auto'

export type NewestSavesSource = 'newest' | 'favorite'
export const defaultNewestSavesSource: NewestSavesSource = 'newest'

export type FolderOrderBy = 'active' | 'name' | 'custom'
export const defaultFolderOrderby: FolderOrderBy = 'custom'

// 存档创建限额：与后端 SaveController.Add 的 [RateLimit()] 成对，
// 改任一侧都要同步另一侧（后端注释指回本文件）
export const createQuotaWindowMinutes = 10
export const createQuotaMaxSaves = 3

export const useSaveListLocalConfigStore = defineStore('saveListLocalConfig', ()=>{
    const searchOrderby = ref<SaveListOrderBy>(defaultOrderby)
    const autoRefreshNewest = ref<AutoRefreshNewest>(defaultAutoRefreshNewest)
    const newestSavesSource = ref<NewestSavesSource>(defaultNewestSavesSource)
    const folderOrderby = ref<FolderOrderBy>(defaultFolderOrderby)
    const simpleCoopRulesDisplay = ref<boolean>(true)
    const readRuleCommentIds = ref<Record<number, number>>({})
    const readMultiUserEditRuleUpdated = ref<string>('')
    const favoriteGroup = ref<string>('')
    // 存档创建限额：createSaveTimes 为最近限额窗口内的创建时间戳（毫秒，持久化）
    const createSaveTimes = ref<number[]>([])
    const createQuotaWindowMs = createQuotaWindowMinutes * 60_000
    const nowMs = ref(Date.now())
    const inCreateQuotaWindow = (t: number) => t > nowMs.value - createQuotaWindowMs
    createSaveTimes.value = createSaveTimes.value.filter(inCreateQuotaWindow)

    // 与 RateLimit 中间件的 queue.Count >= maxReq 对齐：达到上限即视为超额
    const createQuotaExceeded = computed(() =>
        createSaveTimes.value.filter(inCreateQuotaWindow).length >= createQuotaMaxSaves)
    const createQuotaNoticeText = computed(
        () => `${createQuotaWindowMinutes}分钟内最多新建${createQuotaMaxSaves}个存档，超出会遇到限制，请先对新建的存档进行创作`)

    let createQuotaTicker: ReturnType<typeof setInterval> | undefined
    const stopCreateQuotaTicker = () => {
        if (createQuotaTicker !== undefined) {
            clearInterval(createQuotaTicker)
            createQuotaTicker = undefined
        }
    }
    // 超额期间每秒刷新 nowMs，让 Notice 在最后一条记录过期时自动收起
    watch(createQuotaExceeded, exceeded => {
        if (exceeded && createQuotaTicker === undefined) {
            nowMs.value = Date.now()
            createQuotaTicker = setInterval(() => { nowMs.value = Date.now() }, 1000)
        } else if (!exceeded) {
            stopCreateQuotaTicker()
        }
    }, { immediate: true })
    onScopeDispose(stopCreateQuotaTicker)

    function recordSaveCreate() {
        nowMs.value = Date.now()
        createSaveTimes.value = [...createSaveTimes.value.filter(inCreateQuotaWindow), nowMs.value]
    }

    return {
        searchOrderby,
        autoRefreshNewest,
        newestSavesSource,
        folderOrderby,
        simpleCoopRulesDisplay,
        readRuleCommentIds,
        readMultiUserEditRuleUpdated,
        favoriteGroup,
        createSaveTimes,
        createQuotaExceeded,
        createQuotaNoticeText,
        recordSaveCreate
    }
},
{
    persist:{
        key: `${localConfigKeyPrefix}-saveList`
    }
})