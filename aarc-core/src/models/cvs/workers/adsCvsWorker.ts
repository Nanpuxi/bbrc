import { defineStore } from "pinia";
import { CvsContext } from "../common/cvsContext";
import { useSaveStore } from "aarc-core/models/stores/saveStore";
import { AdsRenderType } from "aarc-core/app/localConfig/exportLocalConfig";
import { getCoreConfig } from "aarc-core/app/coreConfig";

export const useAdsCvsWorker = defineStore('adsCvsWorker',()=>{
    const saveStore = useSaveStore()
    function renderAds(ctx:CvsContext, type?:AdsRenderType){
        if(!type || type == 'no')
            return
        const { adsTextLess, adsTextMore } = getCoreConfig()
        const h = saveStore.cvsHeight
        ctx.textAlign = 'left'
        ctx.textBaseline = 'bottom'
        ctx.globalAlpha = 0.5
        ctx.fillStyle = 'black'
        const fontSize = Math.max(saveStore.cvsWidth/70, 28)
        ctx.font = {fontSize: fontSize, font:'sans-serif'}
        const margin = fontSize/3
        if(type == 'less'){
            if(adsTextLess)            
                ctx.fillText(adsTextLess, margin, h-margin)
        }else if(type == 'more'){
            if(adsTextMore)
                ctx.fillText(adsTextMore, margin, h-margin)
        }
        ctx.globalAlpha = 1
    }
    return {
        renderAds
    }
})