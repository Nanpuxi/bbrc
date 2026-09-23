import { LineStyle } from "aarc-core/models/save"
import { renderLineStylePreviewBlob } from "aarc-core/models/cvs/common/lineStylePreview"
import { useUniqueComponentsStore } from "aarc-core/app/globalStores/uniqueComponents"

/**
 * 资源上传结果：ok 成功；canceled 用户在覆盖确认等环节主动取消；failed 失败
 */
export type UserFileResourceUploadResult = 'ok' | 'canceled' | 'failed'

/**
 * UserFile 资源上传实现，由宿主注入（web 用 api.userFile.upload）。
 * core 不接触 API 层，上传所需的 UserFileType 等枚举由宿主侧映射。
 * 同名资源的 preflight 与覆盖确认由宿主实现负责。
 */
export type UserFileResourceUploader = (req: {
    file: Blob
    fileName: string
    thumb?: Blob
    displayName: string
    intro?: string
    type: 'lineStyle'
}) => Promise<UserFileResourceUploadResult>

let uploader: UserFileResourceUploader | undefined
let uploaderWarned = false

export function initUserFileUploader(u: UserFileResourceUploader) {
    uploader = u
    uploaderWarned = false
}

export function hasUserFileUploader(): boolean {
    return !!uploader
}

/**
 * 把给定线路样式逐条上传为各自独立的 UserFile 资源：
 * 每条样式单独打包为 JSON（单元素数组，与 LineStylesConfigReuse 导出同格式），
 * 附带各自的预览图作缩略图，displayName 取各自样式名。
 * 同名资源的 preflight 与覆盖确认由宿主实现逐条处理（各自检测、各自覆盖）。
 * 任一条返回非 ok（取消/失败）即中止后续上传并返回该结果；
 * 若中止时还有未上传的样式，额外弹"已中止上传"提示。
 */
export async function uploadLineStylesAsResource(lineStyles: LineStyle[]): Promise<UserFileResourceUploadResult> {
    if(!uploader){
        if(!uploaderWarned){
            console.warn('UserFile 资源上传实现未注入，宿主需调用 initUserFileUploader 注册')
            uploaderWarned = true
        }
        return 'failed'
    }
    if(lineStyles.length === 0)
        return 'failed'
    for(let i = 0; i < lineStyles.length; i++){
        const style = lineStyles[i]
        const file = new Blob([JSON.stringify([style], null, 2)], { type: 'application/json' })
        const thumb = await renderLineStylePreviewBlob(style) ?? undefined
        const displayName = style.name?.trim() || '未命名线路样式'
        let res: UserFileResourceUploadResult
        try {
            res = await uploader({
                file,
                fileName: 'lineStyle.json',
                thumb,
                displayName,
                type: 'lineStyle'
            })
        } catch(e) {
            console.error('上传线路样式资源失败', e)
            res = 'failed'
        }
        if(res !== 'ok'){
            if(i < lineStyles.length - 1)
                useUniqueComponentsStore().showPop('已中止上传，其余样式不会继续上传', 'info')
            return res
        }
    }
    return 'ok'
}
