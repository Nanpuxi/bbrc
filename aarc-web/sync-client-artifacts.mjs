// 从 aarc-tauri 的构建产物目录复制 exe/apk 到 public/downloads，
// 并追加记录到 public/clientArtifacts.json（更新时间、git提交ID、文件大小、sha256）。
// 文件名带 -YYYYMMDD-HHmm 时间戳，多版本可共存。
// 幂等：产物未变化（sha256 已有记录）时不复制、不追加条目。
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const webDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(webDir, '..')
const downloadsDir = join(webDir, 'public', 'downloads')
const jsonPath = join(webDir, 'public', 'clientArtifacts.json')

const artifacts = [
    {
        type: 'exe',
        src: join(repoRoot, 'aarc-tauri', 'src-tauri', 'target', 'release', 'app.exe'),
        baseName: 'aarc',
    },
    {
        type: 'apk',
        src: join(repoRoot, 'aarc-tauri', 'src-tauri', 'gen', 'android', 'app', 'build', 'outputs', 'apk', 'arm64', 'release', 'app-arm64-release.apk'),
        baseName: 'aarc-arm64',
    },
]

function sha256Of(path){
    return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function fmtStamp(d){
    const p = (n)=>String(n).padStart(2, '0')
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

let gitCommitId = ''
try {
    gitCommitId = execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim()
}
catch {
    console.warn('[syncClientArtifacts] 获取 git 提交 ID 失败，将留空')
}

let entries = []
if (existsSync(jsonPath)) {
    entries = JSON.parse(readFileSync(jsonPath, 'utf8'))
}

mkdirSync(downloadsDir, { recursive: true })

let changedAny = false
for (const art of artifacts) {
    if (!existsSync(art.src)) {
        console.warn(`[syncClientArtifacts] 未找到产物，跳过：${art.src}`)
        continue
    }
    const srcStat = statSync(art.src)
    const srcSize = srcStat.size
    const srcHash = sha256Of(art.src)
    const fileTime = srcStat.birthtime ?? srcStat.mtime
    const existing = entries.find((e)=>e.type === art.type && e.sha256 === srcHash)
    if (existing) {
        const destPath = join(downloadsDir, existing.fileName)
        if (existsSync(destPath) && statSync(destPath).size === srcSize) {
            console.log(`[syncClientArtifacts] ${art.type} 产物未更新，跳过：${existing.fileName}`)
            continue
        }
        copyFileSync(art.src, destPath)
        changedAny = true
        console.log(`[syncClientArtifacts] ${art.type} 产物文件缺失，已按记录的文件名补齐：${existing.fileName}`)
        continue
    }
    const destName = `${art.baseName}-${fmtStamp(fileTime)}${art.type === 'exe' ? '.exe' : '.apk'}`
    copyFileSync(art.src, join(downloadsDir, destName))
    entries.push({
        type: art.type,
        fileName: destName,
        url: `/downloads/${destName}`,
        updatedAt: fileTime.toISOString(),
        gitCommitId,
        sizeBytes: srcSize,
        sha256: srcHash,
    })
    changedAny = true
    console.log(`[syncClientArtifacts] ${art.type} 产物已更新：${destName}`)
}

if (changedAny) {
    writeFileSync(jsonPath, JSON.stringify(entries, null, 2) + '\n')
    console.log(`[syncClientArtifacts] 已写出 ${jsonPath}`)
}
else {
    console.log('[syncClientArtifacts] 无变化，未执行任何操作')
}
