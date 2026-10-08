import { defineStore } from "pinia";
import { ref } from "vue";
import { localConfigKeyPrefix } from "aarc-core/app/localConfig/common/keyPrefix";

export const useHomePageLocalConfigStore = defineStore('homePageLocalConfig', ()=>{
    const upgradeGuideDisplay = ref<boolean>(true)
    /** 首页 hero 轮播自动播放完成的时间戳（ms），0 表示尚未播放完 */
    const heroAutoPlayedAt = ref<number>(0)
    return {
        upgradeGuideDisplay,
        heroAutoPlayedAt
    }
},
{
    persist:{
        key: `${localConfigKeyPrefix}-homePage`
    }
})
