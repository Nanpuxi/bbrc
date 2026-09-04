import { ref } from 'vue';
import { useBrowserInfoStore } from 'aarc-core/app/globalStores/browserInfo';
import { useExportLocalConfigStore } from 'aarc-core/app/localConfig/exportLocalConfig';
import { SaveDto } from 'aarc-core/models/types/apiShapes';
import { useSaveStore } from 'aarc-core/models/stores/saveStore';
import { getCurrentSaveIdRaw } from 'aarc-core/models/save/currentSaveId';
import { timeStr } from 'aarc-core/utils/timeUtils/timeStr';
import { storeToRefs } from 'pinia';

/** 存档信息提供者，由宿主注入（web 用后端 HTTP 接口，tauri 可读本地文件） */
export type SaveInfoProvider = (saveId: number) => Promise<SaveDto|null|undefined>

let saveInfoProvider: SaveInfoProvider | undefined

export function initSaveInfoProvider(p: SaveInfoProvider) {
    saveInfoProvider = p
}

/** 宿主是否已注入存档信息提供者；未注入时导出文件名退化为存档id */
export function hasSaveInfoProvider(): boolean {
    return !!saveInfoProvider
}

/**
 * 文件保存实现，由宿主注入（tauri 用原生"另存为"对话框 + 写文件）。
 * 返回 true 表示已保存；用户取消或失败返回 false。
 * 未注入时 triggerDownload 退化为浏览器 <a download> 下载。
 */
export type FileSaver = (blob: Blob, fileName: string) => Promise<boolean>

let fileSaver: FileSaver | undefined

export function initFileSaver(s: FileSaver) {
    fileSaver = s
}

/** 宿主是否已注入文件保存实现；未注入时使用浏览器下载兜底 */
export function hasFileSaver(): boolean {
    return !!fileSaver
}

export function useImageExport() {
    const { browserInfo, isIPhoneOrIPad, isWebkit } = storeToRefs(useBrowserInfoStore())
    const exportLocalConfig = useExportLocalConfigStore()
    const { fileNameStyle } = storeToRefs(exportLocalConfig)
    const saveStore = useSaveStore()
    
    const exporting = ref<boolean>(false)
    const exported = ref<boolean>(false)
    const exportFailedMsg = ref<false | string>(false)

    const downloadAnchorElementId = 'downloadAnchor'

    function getDownloadAnchor(): HTMLElement | null {
        return document.getElementById(downloadAnchorElementId)
    }

    function canEncodeWebP(): boolean {
        const c = document.createElement('canvas');
        return c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    }

    async function cvsToDataUrl(
        cvs: OffscreenCanvas, 
        fileFormat: 'png' | 'webp' | 'jpeg' | 'svg', 
        fileQuality: number
    ): Promise<string> {
        let mime = 'image/png'
        if (fileFormat == 'webp')
            mime = 'image/webp'
        else if (fileFormat == 'jpeg')
            mime = 'image/jpeg'

        if (mime == 'image/webp' && !canEncodeWebP()) {
            const bi = browserInfo.value
            let msg = "当前环境不支持webp格式，请咨询管理员"
            if (isIPhoneOrIPad.value)
                msg = `当前设备（iPhone/iPad）不支持webp格式`
            else if (isWebkit.value)
                msg = `当前浏览器（${bi?.browser.name}，${bi?.engine.name}内核）不支持webp格式`
            throw new Error(msg)
        }

        const blob = await cvs.convertToBlob({ type: mime, quality: fileQuality });
        return URL.createObjectURL(blob);
    }

    async function triggerDownload(url: string, fileName: string): Promise<void> {
        if (fileSaver) {
            //宿主注入了文件保存实现（如 tauri）：把 url 取回为 Blob 交给宿主落盘
            try {
                const blob = await (await fetch(url)).blob()
                if (await fileSaver(blob, fileName))
                    exported.value = true
            } catch (e) {
                console.error('文件保存失败', e)
            }
            return
        }
        const link = getDownloadAnchor()
        if (link && 'href' in link) {
            exported.value = true
            link.href = url;
            if ('download' in link)
                (link as HTMLAnchorElement).download = fileName
            link.click();
        }
    }

    function resetExportState(): void {
        exported.value = false
        exporting.value = false
        exportFailedMsg.value = false
    }

    function startExport(): void {
        exported.value = false
        exporting.value = true
        exportFailedMsg.value = false
    }

    function finishExport(): void {
        exporting.value = false
    }

    function setExportFailed(msg: string): void {
        exportFailedMsg.value = msg
        exporting.value = false
    }

    async function getExportFileName(ext?: string, suffix?: string): Promise<string | undefined> {
        const saveId = getCurrentSaveIdRaw() ?? ''
        const saveIdNum = parseInt(saveId)
        let saveName: string
        if (isNaN(saveIdNum))
            saveName = saveId
        else {
            if(!saveInfoProvider){
                //宿主未注入存档信息提供者：退化为用存档id命名，不阻断导出
                saveName = saveId
            }else{
                const info = await saveInfoProvider(saveIdNum)
                saveName = info?.name ?? '??'
            }
        }
        let name = ''
        const style = fileNameStyle.value
        if (style == 'date')
            name = `${saveName}-${timeStr('date')}`
        else if (style == 'dateTime')
            name = `${saveName}-${timeStr('dateTime')}`
        else if (style == 'lineCount') {
            const lineCount = saveStore.getLineCount()
            const staCount = saveStore.getStaCount()
            name = `${saveName}-${lineCount}线${staCount}站`
        } else {
            name = saveName ?? '未命名'
        }
        if (suffix) {
            name = `${name}-${suffix}`
        }
        if (ext) {
            return `${name}.${ext}`
        }
        return name
    }

    return {
        // state
        exporting,
        exported,
        exportFailedMsg,
        // constants
        downloadAnchorElementId,
        // methods
        getDownloadAnchor,
        canEncodeWebP,
        cvsToDataUrl,
        triggerDownload,
        getExportFileName,
        resetExportState,
        startExport,
        finishExport,
        setExportFailed
    }
}
