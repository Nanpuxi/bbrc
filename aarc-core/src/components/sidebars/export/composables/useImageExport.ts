import { ref } from 'vue';
import { useBrowserInfoStore } from 'aarc-core/app/globalStores/browserInfo';
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents';
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

/**
 * 浏览器兜底路径当前持有的 blob URL。模块级：兜底用的 <a> 全页只有一个，
 * 而 useImageExport 会被多个组件各自实例化。
 */
let lastBlobUrl: string | undefined

/**
 * 上一个 URL 的释放延迟。批量导出各时间点只隔 200ms，此时上一次的 click
 * 可能还没被浏览器完全接管，立即 revoke 有中断那次下载的风险。
 */
const BLOB_URL_GRACE = 5000

export function useImageExport() {
    const { browserInfo, isIPhoneOrIPad, isWebkit } = storeToRefs(useBrowserInfoStore())
    const { showPop } = useUniqueComponentsStore()
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

    async function cvsToBlob(
        cvs: OffscreenCanvas, 
        fileFormat: 'png' | 'webp' | 'jpeg' | 'svg', 
        fileQuality: number
    ): Promise<Blob> {
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

        return await cvs.convertToBlob({ type: mime, quality: fileQuality });
    }

    /**
     * 交出 Blob 由宿主落盘；未注入宿主实现时退化为浏览器 `<a download>`。
     * 这里刻意不接受 URL：blob URL 只能用 fetch 取回数据，白绕一圈还受 CSP connect-src 约束。
     */
    async function triggerDownload(blob: Blob, fileName: string): Promise<void> {
        if (fileSaver) {
            try {
                if (await fileSaver(blob, fileName))
                    exported.value = true
            } catch (e) {
                //宿主实现的异常都在宿主内提示过，这里兜住其余情况：
                //静默会让用户看到"点了没反应"，故必须弹出
                console.error('文件保存失败', e)
                showPop(`文件保存失败：${e instanceof Error ? e.message : String(e)}`, 'failed')
            }
            return
        }
        const link = getDownloadAnchor()
        if (link && 'href' in link) {
            exported.value = true
            const staleUrl = lastBlobUrl
            const url = URL.createObjectURL(blob)
            link.href = url
            if ('download' in link)
                (link as HTMLAnchorElement).download = fileName
            link.click();
            // 只留最近一个：上一次的已被新 href 顶掉，"点击此处"重试链接也指向新的。
            // 当前这个不释放，留给模板里的兜底重试链接用，最多挂住一个 blob 而不是每次导出一个。
            if (staleUrl)
                setTimeout(() => URL.revokeObjectURL(staleUrl), BLOB_URL_GRACE)
            lastBlobUrl = url
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
        cvsToBlob,
        triggerDownload,
        getExportFileName,
        resetExportState,
        startExport,
        finishExport,
        setExportFailed
    }
}
