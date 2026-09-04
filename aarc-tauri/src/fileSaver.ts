// tauri 原生文件保存：弹系统"另存为"对话框并写盘，替代浏览器 <a download> 下载
//（仅在 tauri 环境注入，浏览器 dev 模式仍走 core 的默认下载兜底）
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { FileSaver } from 'aarc-core/components/sidebars/export/composables/useImageExport'

export const tauriFileSaver: FileSaver = async (blob, fileName) => {
    const path = await save({ defaultPath: fileName })
    if (!path)
        return false // 用户取消
    const data = new Uint8Array(await blob.arrayBuffer())
    await writeFile(path, data)
    return true
}
