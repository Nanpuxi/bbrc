// 存档备份导出：把全部存档打包为 aarc-app-backup.zip
// （zip 内为 index.json 清单 + 每个存档一个 <id>.json，与磁盘 saves/ 目录内容一致）
// - 安卓：写入公共下载目录 Download/AARC/ 后调起系统"分享"面板，把 zip 发到其他应用
//   （分享要求 content:// URI，应用私有目录的文件无法直接分享，故走公共目录副本）
// - 桌面（Win/Mac）：弹目录选择对话框，zip 写入所选目录（对话框选中路径自动获得 fs 运行时 scope）
// 任何环节的异常都 Pop 出具体错误信息；用户取消对话框不算失败，不提示
import { isTauri } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { zipSync, strToU8 } from 'fflate'
import { isAndroid, createNewPublicFile, writeFile as afsWriteFile, showShareFileAppChooser, PublicGeneralPurposeDir } from 'tauri-plugin-android-fs-api'
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents'
import { saveStorage } from './saveStorage'

export const backupZipName = 'aarc-app-backup.zip'

async function buildBackupZip(): Promise<Uint8Array> {
    const [saves, groups] = await Promise.all([saveStorage.list(), saveStorage.listGroups()])
    const files: Record<string, Uint8Array> = {
        'index.json': strToU8(JSON.stringify({ saves, groups }))
    }
    for (const s of saves)
        files[`${s.id}.json`] = strToU8(JSON.stringify(await saveStorage.load(s.id)))
    return zipSync(files)
}

function errMsg(e: unknown): string {
    return e instanceof Error ? e.message : String(e)
}

async function exportOnAndroid(data: Uint8Array): Promise<boolean> {
    // 同名文件由系统自动追加序号，不会覆盖
    const uri = await createNewPublicFile(PublicGeneralPurposeDir.Download, `AARC/${backupZipName}`, 'application/zip')
    await afsWriteFile(uri, data)
    await showShareFileAppChooser(uri)
    useUniqueComponentsStore().showPop('备份已生成，请选择要分享到的应用', 'success')
    return true
}

async function exportOnDesktop(data: Uint8Array): Promise<boolean> {
    const dir = await open({ directory: true, title: '选择备份保存位置' })
    if (!dir)
        return false // 用户主动取消，不提示
    const path = await join(dir, backupZipName)
    await writeFile(path, data)
    useUniqueComponentsStore().showPop(`备份已保存到 ${path}`, 'success')
    return true
}

/** 打包全部存档为 zip 并导出；返回是否完成（用户取消返回 false） */
export async function exportSavesBackup(): Promise<boolean> {
    const pop = useUniqueComponentsStore().showPop
    if (!isTauri()) {
        pop('打包导出仅在应用内可用', 'warning')
        return false
    }
    try {
        const data = await buildBackupZip()
        if (isAndroid())
            return await exportOnAndroid(data)
        return await exportOnDesktop(data)
    } catch (e) {
        console.error('备份导出失败', e)
        pop(`备份导出失败：${errMsg(e)}`, 'failed')
        return false
    }
}
