// tauri 原生文件保存：
// - 安卓：图片经 MediaStore 写入系统相册（Pictures/<相册名>/，子目录名即相册名）；
//   不支持进相册的格式（svg/txt 等）用 Pop 报错，不落盘
// - 桌面（Win/Mac）：弹系统"另存为"对话框并写盘
// 任何环节的异常都 Pop 出具体错误信息（真机无 logcat 时也能定位问题）
//（仅在 tauri 环境注入，浏览器 dev 模式仍走 core 的默认下载兜底）
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { isAndroid, createNewPublicImageFile, writeFile as afsWriteFile } from 'tauri-plugin-android-fs-api'
import { FileSaver } from 'aarc-core/components/sidebars/export/composables/useImageExport'
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents'

const ALBUM_NAME = 'AARC'
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i

function errMsg(e: unknown): string {
    return e instanceof Error ? e.message : String(e)
}

async function saveToAlbum(blob: Blob, fileName: string): Promise<boolean> {
    const pop = useUniqueComponentsStore().showPop
    if (!IMAGE_EXT.test(fileName)) {
        console.error('不支持的格式：', fileName)
        pop(`无法保存到相册\n不支持该格式（${fileName}）`, 'failed')
        return false
    }
    // 同名文件由系统自动追加序号，不会覆盖
    const uri = await createNewPublicImageFile('Pictures', `${ALBUM_NAME}/${fileName}`, blob.type || null)
    await afsWriteFile(uri, new Uint8Array(await blob.arrayBuffer()))
    pop(`已保存到相册 ${ALBUM_NAME}`, 'success')
    return true
}

export const tauriFileSaver: FileSaver = async (blob, fileName) => {
    try {
        if (isAndroid())
            return await saveToAlbum(blob, fileName)
        const path = await save({ defaultPath: fileName })
        if (!path)
            return false // 用户主动取消，不提示
        const data = new Uint8Array(await blob.arrayBuffer())
        await writeFile(path, data)
        return true
    } catch (e) {
        console.error('文件保存失败', e)
        useUniqueComponentsStore().showPop(`文件保存失败：${errMsg(e)}`, 'failed')
        return false
    }
}
