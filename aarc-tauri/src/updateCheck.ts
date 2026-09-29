// "检查更新"：向 WebApi 询问当前平台（桌面=exe / 安卓=apk）最新产物的发布时间，
// 与本机 gitInfo（构建时的提交 ID）比对判断是否最新；下载页地址亦由此导出。
import { getGitInfo } from 'aarc-core/utils/gitInfo/gitInfoGet'

export interface LatestArtifact {
    type: string
    fileName: string
    url: string
    updatedAt: string
    gitCommitId: string
    sizeBytes: number
    sha256: string
    version?: string
}

export type UpdateCheckResult =
    | { state: 'latest', artifact: LatestArtifact }
    | { state: 'update-available', artifact: LatestArtifact }
    | { state: 'error', message: string }

// 平台判定与 WebView userAgent 一致：安卓 webview 的 UA 含 "Android"
const clientType = /android/i.test(navigator.userAgent) ? 'apk' : 'exe'
const apiBase = import.meta.env.VITE_ApiUrlBase ?? ''

export async function checkForUpdate(): Promise<UpdateCheckResult> {
    let artifact: LatestArtifact
    try {
        const res = await fetch(`${apiBase}/api/clientApp/latest?type=${clientType}`)
        if (!res.ok)
            return { state: 'error', message: `服务器响应异常（HTTP ${res.status}）` }
        artifact = await res.json()
    } catch {
        return { state: 'error', message: `无法连接 ${apiBase || '(未配置后端地址)'}` }
    }
    const gitInfo = await getGitInfo()
    if (!gitInfo)
        return { state: 'error', message: '无法读取本机版本信息（缺少 gitInfo.json）' }
    // 同一发布 = 同一提交：服务端记录完整提交 ID，本地为 8 位短 ID
    if (artifact.gitCommitId?.startsWith(gitInfo.commitId))
        return { state: 'latest', artifact }
    return { state: 'update-available', artifact }
}

// 下载页（ClientDownload.vue 路由）地址；apiBase 在生产指向线上站点，dev 指向本地 WebApi（其 wwwroot 即站点产物）
export function clientDownloadPageUrl(): string {
    return `${apiBase}/#/client-download`
}
