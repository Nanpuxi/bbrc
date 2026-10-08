import { defineStore } from "pinia";
import { ref } from "vue";
import { localConfigKeyPrefix } from "aarc-core/app/localConfig/common/keyPrefix";

export const useHomePageLocalConfigStore = defineStore('homePageLocalConfig', ()=>{
    const upgradeGuideDisplay = ref<boolean>(true)
    const coopRulesDisplay = ref<boolean>(true)
    return {
        upgradeGuideDisplay,
        coopRulesDisplay
    }
},
{
    persist:{
        key: `${localConfigKeyPrefix}-homePage`
    }
})
