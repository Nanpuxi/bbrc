// tauri 原生文件保存：
// - 安卓：图片经 MediaStore 写入系统相册（Pictures/<相册名>/，子目录名即相册名）；
//   不支持进相册的格式（svg/txt 等）用 Pop 报错，不落盘
// - 桌面（Win/Mac）：弹系统"另存为"对话框并写盘
// 任何环节的异常都 Pop 出具体错误信息（真机无 logcat 时也能定位问题）
//（仅在 tauri 环境注入，浏览器 dev 模式仍走 core 的默认下载兜底）
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { isAndroid, createNewPublicImageFile, writeFile as afsWriteFile, scanPublicFile } from 'tauri-plugin-android-fs-api'
import { FileSaver } from 'aarc-core/components/sidebars/export/composables/useImageExport'
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents'
import { safeFileNamePart } from './fsFileName'

const ALBUM_NAME = 'AARC'
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i
const EXT_RE = /\.([a-z0-9]+)$/i
const FALLBACK_BASE = 'aarc导出'
const EXT_MIME: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
}

// 按扩展名显式映射 MIME（blob.type 可能为空），避免个别相册应用识别异常
function mimeOf(fileName: string, blob: Blob): string | null {
    const ext = fileName.split('.').pop()?.toLowerCase()
    return (ext && EXT_MIME[ext]) || blob.type || null
}

function errMsg(e: unknown): string {
    return e instanceof Error ? e.message : String(e)
}

/** 拆分主干与扩展名，只清洗主干（扩展名由 core 按导出格式拼好，原样保留） */
function safeName(fileName: string): string {
    const ext = EXT_RE.exec(fileName)?.[0] ?? ''
    const base = ext ? fileName.slice(0, -ext.length) : fileName
    return `${safeFileNamePart(base, FALLBACK_BASE)}${ext}`
}

async function saveToAlbum(blob: Blob, fileName: string): Promise<boolean> {
    const pop = useUniqueComponentsStore().showPop
    if (!IMAGE_EXT.test(fileName)) {
        console.error('不支持的格式：', fileName)
        pop(`无法保存到相册\n不支持该格式（${fileName}）`, 'failed')
        return false
    }
    // 同名文件由系统自动追加序号，不会覆盖
    const uri = await createNewPublicImageFile('Pictures', `${ALBUM_NAME}/${fileName}`, mimeOf(fileName, blob))
    await afsWriteFile(uri, new Uint8Array(await blob.arrayBuffer()))
    // 触发媒体扫描，让相册应用立即刷新显示（否则部分机型要重启相册才可见）
    await scanPublicFile(uri)
    pop(`已保存到相册 ${ALBUM_NAME}`, 'success')
    return true
}

export const tauriFileSaver: FileSaver = async (blob, rawFileName) => {
    // 存档名可含文件系统非法字符，会让 Windows 侧对话框构建失败（且不报错），先清洗
    const fileName = safeName(rawFileName)
    try {
        if (isAndroid())
            return await saveToAlbum(blob, fileName)
        const ext = EXT_RE.exec(fileName)?.[1]?.toLowerCase()
        const path = await save({
            defaultPath: fileName,
            // 给出过滤器，Windows 据此补全/校验扩展名
            filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined
        })
        if (!path) {
            // 系统对话框把"构建失败"和"用户取消"折叠成同一个 null，JS 侧无法区分，只留日志线索
            console.warn('另存为未返回路径（用户取消，或系统对话框创建失败）', fileName)
            return false // 用户主动取消，不提示
        }
        const data = new Uint8Array(await blob.arrayBuffer())
        await writeFile(path, data)
        return true
    } catch (e) {
        console.error('文件保存失败', e)
        useUniqueComponentsStore().showPop(`文件保存失败：${errMsg(e)}`, 'failed')
        return false
    }
}
