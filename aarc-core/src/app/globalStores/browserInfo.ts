import Bowser from "bowser"
import { defineStore } from "pinia"
import { computed, ref } from "vue"

export const useBrowserInfoStore = defineStore('browserInfo',()=>{
    const ua = typeof window !== 'undefined' ? window.navigator.userAgent : ''
    //Bowser.parse 不接受空ua；无窗口环境（如单元测试）下为 undefined
    const browserInfo = ref<ReturnType<typeof Bowser.parse>|undefined>(ua ? Bowser.parse(ua) : undefined)
    const isWebkit = computed<boolean>(()=>browserInfo.value?.engine.name?.toLowerCase()=='webkit')
    const isWindows = computed<boolean>(()=>browserInfo.value?.os.name?.toLowerCase()=='windows')
    const isMobile = computed<boolean>(()=>{
        const type = browserInfo.value?.platform.type ?? ''
        return type.toLowerCase().includes('mobile')
    })
    const isIPhoneOrIPad = computed<boolean>(()=>{
        const vendor = browserInfo.value?.platform.vendor ?? ''
        const type = browserInfo.value?.platform.type ?? ''
        const isApple = vendor.toLowerCase().includes('apple')
        const isMobile = type.toLowerCase().includes('mobile')
        const isTablet = type.toLowerCase().includes('tablet')
        return isApple && (isMobile || isTablet)
    })
    const isBaiduApp = ua.includes('baiduboxapp')
    const isQQBuiltIn = ua.includes(' QQ/')
    const isWxBuiltIn = ua.includes('MicroMessenger')
    return {
        browserInfo,
        isWebkit,
        isWindows,
        isMobile,
        isIPhoneOrIPad,
        ua,
        isBaiduApp,
        isQQBuiltIn,
        isWxBuiltIn
    }
})