import { defineStore } from "pinia";
import { ref } from "vue";

/** 路由守卫注册器，由宿主注入（web 用 router.beforeEach 实现）；传入守卫函数，返回移除守卫的函数 */
export type RouteGuardRegistrar = (guard: () => boolean) => () => void

let routeGuardRegistrar: RouteGuardRegistrar | undefined

export function initRouteGuardRegistrar(r: RouteGuardRegistrar) {
    routeGuardRegistrar = r
}

const aLongTimeForUnsavedStatusMs = 3*60*1000 //三分钟
export const usePreventLeavingUnsavedStore = defineStore('preventLeavingUnsaved', ()=>{
    const preventingLeaving = ref<boolean>(false);
    const showUnsavedWarning = ref<boolean>(false);
    const unsavedForALongTime = ref<boolean>(false);
    const preventLeavingDisabled = ref<boolean>(false);
    let lastSaved:number = 0;
    function leavingHandler(){
        return "未保存"
    }
    let removeRouteGuard:(()=>void)|undefined;
    
    function preventLeaving(){
        if(preventingLeaving.value || preventLeavingDisabled.value){
            return;
        }
        console.log("限制离开")
        window.onbeforeunload = leavingHandler
        removeRouteGuard = routeGuardRegistrar?.(()=>{
            showUnsavedWarning.value = true;
            return false;
        });
        preventingLeaving.value = true;
        lastSaved = Date.now()
        unsavedForALongTime.value = false;
    }
    function releasePreventLeaving(){
        if(!preventingLeaving.value){
            return;
        }
        console.log("解除限制离开")
        window.onbeforeunload = null
        if(removeRouteGuard){
            removeRouteGuard()
            removeRouteGuard = undefined;
        }
        preventingLeaving.value = false;
        lastSaved = Date.now()
        unsavedForALongTime.value = false;
    }
    window.setInterval(()=>{
        if(!preventingLeaving.value){
            unsavedForALongTime.value = false
            return
        }else{
            const now = Date.now()
            unsavedForALongTime.value = now-lastSaved > aLongTimeForUnsavedStatusMs
        }
    }, 1000)
    return { preventLeaving, releasePreventLeaving, preventingLeaving, showUnsavedWarning, unsavedForALongTime, preventLeavingDisabled }
})