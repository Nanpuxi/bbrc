import { useMainCvsDispatcher } from "aarc-core/models/cvs/dispatchers/mainCvsDispatcher";

/** 云端SVG上传实现，由宿主注入（web 用 HTTP 上传，tauri 可写本地文件） */
export type CloudSvgUploader = (saveId: number, svgBlob: Blob) => Promise<boolean>

let uploader: CloudSvgUploader | undefined

export function initCloudSvgUploader(u: CloudSvgUploader) {
    uploader = u
}

/** 宿主是否已注入云端SVG上传实现；未注入时 core 隐藏相关入口 */
export function hasCloudSvgUploader(): boolean {
    return !!uploader
}

export async function renderAndUploadCloudSvg(saveId: number): Promise<boolean> {
    const mainCvsDispatcher = useMainCvsDispatcher()
    try {
        const svgBlob = await mainCvsDispatcher.renderMainCvsToSvgBlob({
            withAds: 'no',
            withBgRefImage: false,
            withGridLayer: 'none'
        })
        if (!uploader) {
            console.error('云端SVG上传实现未注入')
            return false
        }
        return await uploader(saveId, svgBlob)
    } catch (e) {
        console.error('渲染或上传云端SVG失败', e)
        return false
    }
}
