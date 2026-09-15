import { PopCallback } from "aarc-core/components/common/types/pop";
import { WaitCallback } from "aarc-core/components/common/types/wait";
import { CloudSvgUploader, initCloudSvgUploader } from "aarc-core/models/save/cloudSvgOps";
import { PinyinConvertProvider, initPinyinConvertProvider } from "aarc-core/components/composables/usePinyinConvert";
import { SaveInfoProvider, initSaveInfoProvider } from "aarc-core/components/sidebars/export/composables/useImageExport";
import { SiteLinks, initSiteLinks } from "aarc-core/app/siteLinks";
import { RouteGuardRegistrar, initRouteGuardRegistrar } from "aarc-core/utils/eventUtils/preventLeavingUnsaved";
import { UserFileResourceUploader, initUserFileUploader } from "aarc-core/models/save/lineStyleResourceOps";
import { useUniqueComponentsStore } from "aarc-core/app/globalStores/uniqueComponents";

/**
 * core 需要宿主提供的服务汇总（decoupling-step17.md 工作包 B）。
 * 新增宿主（如 tauri）时实现本接口即完成装配 checklist；
 * 各 init* 低层入口保留，可单独调用（见 aarc-core/README.md）。
 */
export interface CoreHostServices {
    /** 全局弹窗 */
    pop: PopCallback
    /** 等待遮罩 */
    wait: WaitCallback
    /** 存档缩略 SVG 云上传 */
    cloudSvgUploader: CloudSvgUploader
    /** 拼音转换 */
    pinyinConvert: PinyinConvertProvider
    /** 存档信息读取（导出图片用） */
    saveInfo: SaveInfoProvider
    /** 站点内链接；不注入则对应链接隐藏 */
    siteLinks?: SiteLinks
    /** “未保存离开”路由守卫；无路由的宿主可不注入（window.onbeforeunload 部分由 core 自理） */
    routeGuardRegistrar?: RouteGuardRegistrar
    /** UserFile 资源上传（线路样式分享）；不注入则编辑器内隐藏"上传为资源"入口 */
    userFileResourceUploader?: UserFileResourceUploader
}

/** 一次性注册全部宿主服务（内部依次调用既有各 init*） */
export function initCoreHostServices(services: CoreHostServices) {
    useUniqueComponentsStore().initCallbacks({
        popCallback: services.pop,
        waitCallback: services.wait
    })
    initCloudSvgUploader(services.cloudSvgUploader)
    initPinyinConvertProvider(services.pinyinConvert)
    initSaveInfoProvider(services.saveInfo)
    if (services.siteLinks)
        initSiteLinks(services.siteLinks)
    if (services.routeGuardRegistrar)
        initRouteGuardRegistrar(services.routeGuardRegistrar)
    if (services.userFileResourceUploader)
        initUserFileUploader(services.userFileResourceUploader)
}
