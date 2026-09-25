// 从 aarc-tauri 的构建产物目录复制产物到 AARC.WebApi/Data/ClientApp 供 WebApi 下发：
// - exe 压缩为 zip（zipName 指定包内文件名），apk 原样复制
// - 并写出元数据 json clientArtifacts.json（更新时间、git提交ID、文件大小、sha256，均为产物本体的值）
// 文件名带 -YYYYMMDD-HHmm 时间戳（取产物文件创建时间），多版本可共存。
// 幂等：产物未变化（sha256 已有记录）时不复制、不追加条目。
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { ZipArchive } from 'archiver'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const webDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(webDir, '..')
const clientAppDir = join(repoRoot, 'AARC.WebApi', 'Data', 'ClientApp')
const jsonPath = join(clientAppDir, 'clientArtifacts.json')

const artifacts = [
    {
        type: 'exe',
        src: join(repoRoot, 'aarc-tauri', 'src-tauri', 'target', 'release', 'app.exe'),
        baseName: 'aarc',
        zipName: 'aarc.exe',
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

// 最小封装：把单个文件打成 zip，返回 Buffer
function zipAsBuffer(name, srcPath){
    return new Promise((resolve, reject)=>{
        const archive = new ZipArchive({ zlib: { level: 9 } })
        const chunks = []
        archive.on('data', (c)=>chunks.push(c))
        archive.on('end', ()=>resolve(Buffer.concat(chunks)))
        archive.on('error', reject)
        archive.file(srcPath, { name })
        archive.finalize()
    })
}

async function buildDest(art, fileTime){
    const ext = art.zipName ? '.zip' : (art.type === 'exe' ? '.exe' : '.apk')
    const destName = `${art.baseName}-${fmtStamp(fileTime)}${ext}`
    const data = art.zipName ? await zipAsBuffer(art.zipName, art.src) : readFileSync(art.src)
    return { destName, data }
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

mkdirSync(clientAppDir, { recursive: true })

let changedAny = false
for (const art of artifacts) {
    if (!existsSync(art.src)) {
        console.warn(`[syncClientArtifacts] 未找到产物，跳过：${art.src}`)
        continue
    }
    const srcStat = statSync(art.src)
    const srcHash = sha256Of(art.src)
    const fileTime = srcStat.birthtime ?? srcStat.mtime
    const existing = entries.find((e)=>e.type === art.type && e.sha256 === srcHash)
    if (existing) {
        const destPath = join(clientAppDir, existing.fileName)
        if (existsSync(destPath)) {
            console.log(`[syncClientArtifacts] ${art.type} 产物未更新，跳过：${existing.fileName}`)
            continue
        }
        writeFileSync(destPath, (await buildDest(art, fileTime)).data)
        changedAny = true
        console.log(`[syncClientArtifacts] ${art.type} 产物文件缺失，已按记录的文件名补齐：${existing.fileName}`)
        continue
    }
    const { destName, data } = await buildDest(art, fileTime)
    writeFileSync(join(clientAppDir, destName), data)
    entries.push({
        type: art.type,
        fileName: destName,
        url: `/api/clientApp/download?type=${art.type}`,
        updatedAt: fileTime.toISOString(),
        gitCommitId,
        sizeBytes: data.length, // 展示的是实际下载文件的大小（exe 为 zip 的大小）
        sha256: srcHash, // 产物本体的 sha256（zip 为包内 exe 的）
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
