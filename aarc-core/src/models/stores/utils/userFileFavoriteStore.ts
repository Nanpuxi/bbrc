import { UserFileDto } from "aarc-core/models/types/apiShapes";
import { defineStore } from "pinia";
import { ref } from "vue";

export const useUserFileFavoriteStore = defineStore('userFileFavorite', ()=>{
    const openFavoritesSidebarImpl = ref<()=>void>()
    let openFavoritesSidebarWarned = false
    /** 由宿主注入“打开收藏夹侧栏”的实现（web 在 UserFileFavorites.vue 注册） */
    function initOpenFavoritesSidebar(cb: ()=>void){
        openFavoritesSidebarImpl.value = cb
        openFavoritesSidebarWarned = false
    }
    function openFavoritesSidebar(){
        if(openFavoritesSidebarImpl.value){
            openFavoritesSidebarImpl.value()
        }else if(!openFavoritesSidebarWarned){
            console.warn('openFavoritesSidebar 未注入，宿主需调用 initOpenFavoritesSidebar 注册')
            openFavoritesSidebarWarned = true
        }
    }
    const onFavoriteFileSelected = ref<(userFile:UserFileDto)=>void>(()=>{})
    return {
        initOpenFavoritesSidebar,
        openFavoritesSidebar,
        onFavoriteFileSelected
    }
})
