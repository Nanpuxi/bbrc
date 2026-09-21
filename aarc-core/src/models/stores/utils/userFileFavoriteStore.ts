import { UserFileDto } from "aarc-core/models/types/apiShapes";
import { defineStore } from "pinia";
import { computed, ref } from "vue";

/**
 * 打开收藏夹时的一次性取用意图（由消费方在 openFavoritesSidebar 时传入）
 */
export interface FavoritesPickIntent {
    /** 本次取用的回调（优先于全局 onFavoriteFileSelected），被消费一次后失效 */
    onSelected?: (userFile: UserFileDto) => void
    /** 按资源类型过滤收藏列表（如 'icon' / 'lineStyle'）；具体枚举由宿主映射 */
    fileType?: string
    /** 取用一次后立即关闭侧栏；缺省 false（允许连续取用多个） */
    closeOnSelect?: boolean
}

export const useUserFileFavoriteStore = defineStore('userFileFavorite', ()=>{
    const openFavoritesSidebarImpl = ref<()=>void>()
    /** 宿主是否已注入“打开收藏夹侧栏”实现；未注入时 core 隐藏相关入口 */
    const hasOpenFavoritesSidebar = computed(()=>!!openFavoritesSidebarImpl.value)
    let openFavoritesSidebarWarned = false
    /** 由宿主注入“打开收藏夹侧栏”的实现（web 在 UserFileFavorites.vue 注册） */
    function initOpenFavoritesSidebar(cb: ()=>void){
        openFavoritesSidebarImpl.value = cb
        openFavoritesSidebarWarned = false
    }
    /** 本次取用的一次性回调（宿主选中文件时优先消费） */
    const pendingOnSelected = ref<(userFile: UserFileDto)=>void>()
    /** 本次打开的列表过滤类型（宿主映射为后端枚举；下次打开时重置） */
    const pickFileType = ref<string>()
    /** 本次打开是否"取用后立即关闭侧栏"（宿主消费；下次打开时重置） */
    const pickCloseOnSelect = ref(false)
    function openFavoritesSidebar(intent?: FavoritesPickIntent){
        pendingOnSelected.value = intent?.onSelected
        pickFileType.value = intent?.fileType
        pickCloseOnSelect.value = intent?.closeOnSelect ?? false
        if(openFavoritesSidebarImpl.value){
            openFavoritesSidebarImpl.value()
        }else if(!openFavoritesSidebarWarned){
            console.warn('openFavoritesSidebar 未注入，宿主需调用 initOpenFavoritesSidebar 注册')
            openFavoritesSidebarWarned = true
        }
    }
    const onFavoriteFileSelected = ref<(userFile:UserFileDto)=>void>(()=>{})
    /**
     * 宿主在用户选中收藏文件时调用；
     * 返回 true 表示被本次意图的 onSelected 消费，否则走全局 onFavoriteFileSelected
     */
    function notifyFileSelected(userFile: UserFileDto): boolean{
        const cb = pendingOnSelected.value
        pendingOnSelected.value = undefined
        if(cb){
            cb(userFile)
            return true
        }
        onFavoriteFileSelected.value(userFile)
        return false
    }
    return {
        initOpenFavoritesSidebar,
        hasOpenFavoritesSidebar,
        openFavoritesSidebar,
        pickFileType,
        pickCloseOnSelect,
        onFavoriteFileSelected,
        notifyFileSelected
    }
})
