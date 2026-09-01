import { UserFileDto } from "aarc-core/models/types/apiShapes";
import { defineStore } from "pinia";
import { ref } from "vue";

export const useUserFileFavoriteStore = defineStore('userFileFavorite', ()=>{
    const openFavoritesSidebar = ref<()=>void>(()=>{})
    const onFavoriteFileSelected = ref<(userFile:UserFileDto)=>void>(()=>{})
    return {
        openFavoritesSidebar,
        onFavoriteFileSelected
    }
})
