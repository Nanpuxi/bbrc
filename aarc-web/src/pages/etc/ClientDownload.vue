<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue'
import copy from 'copy-to-clipboard'
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents'

interface ClientArtifact {
    type: string
    fileName: string
    url: string
    updatedAt: string
    gitCommitId: string
    sizeBytes: number
    sha256: string
    version?: string
}

const artifactTypes = [
    { type: 'exe', title: 'Windows 绿色版', fileDesc: 'aarc.exe（解压即用，无需安装）' },
    { type: 'msi', title: 'Windows 安装版（MSI）', fileDesc: 'aarc-setup.msi（安装后从开始菜单启动）' },
    { type: 'apk', title: 'Android（arm64）', fileDesc: 'aarc-arm64.apk' },
]

interface NoticeItem { text: string, linkText?: string, linkHref?: string, suffix?: string }
interface NoticeGroup { title: string, items: NoticeItem[] }

const noticeGroups: NoticeGroup[] = [
    {
        title: '通用',
        items: [
            { text: '当前本地版仅为技术验证，部分功能可能存在问题或缺失。' },
            {
                text: '下载或使用代表你同意',
                linkText: 'Apache-2.0 许可证',
                linkHref: '/LICENSE.txt',
                suffix: '。',
            },
            { text: '仅从你信任的网站/个人那里获取 exe 或 apk，来源不明的不要点开，谨防恶意病毒软件。' },
            { text: '问题反馈渠道：qq群962984700私聊群主 / 18971501210@189.cn' },
            { text: '本地版界面依赖设备内置的 WebView 渲染：如果你通过 Edge/Chrome 使用在线版时就遇到白屏、无法拖动等异常现象，本地版大概率也无法使用（通常是设备的 WebView 版本过旧，或受到厂商定制篡改所致）。' },
            { text: '图片导出边长上限（一般为 16000）可能依然无法绕过' },
            { text: '重大功能更新或重大 bug 修复时，本地版会同步发布，建议更新到最新版' },
        ],
    },
    {
        title: 'Windows（绿色版与 MSI 安装版）',
        items: [
            { text: '存档与设置存储在 %APPDATA%\\com.jowei19.aarc（即 C:\\Users\\你的用户名\\AppData\\Roaming\\com.jowei19.aarc），删除 exe 或卸载 MSI 都不会清除该目录，需要手动决定保留还是清理。' },
            { text: 'MSI 安装版与绿色版的数据目录完全相同、存档通用，但请勿同时运行两个客户端，以免写坏存档。' },
            { text: '如何更新：绿色版用新版 aarc.exe 直接覆盖旧的即可；MSI 运行新版安装包直接覆盖安装。两者都会保留已有存档与设置。' },
            { text: 'MSI 覆盖安装要求新版本号不低于已安装版本（降级需先卸载旧版再装，存档在数据目录不受影响）。' },
            { text: 'MSI 安装时需要管理员权限（UAC 弹窗），默认安装到 Program Files。' },
            { text: '程序未做数字签名，首次运行 exe 或 msi 可能触发 Windows SmartScreen 拦截，请点击"更多信息→仍要运行"。' },
        ],
    },
    {
        title: 'Android',
        items: [
            { text: '存档存储在应用私有目录（/Android/data/com.jowei19.aarc），卸载后会一同消失，如有需要请使用“导出备份”功能保留，或访问系统文件管理进行保存。' },
            { text: '如何更新：安装新版 apk 直接覆盖旧版，会保留已有存档与设置。' },
            { text: '覆盖安装要求 apk 签名一致，签名不同的需先卸载（会清除数据，请先导出备份）。' },
        ],
    },
    {
        title: 'iOS / macOS',
        items: [
            { text: '由于作者缺少苹果开发者资质（Apple Developer Program 付费账号），mac 和 iOS 版无法完成签名与分发，暂不提供，有需要请自行编译。' },
        ],
    },
]

const artifacts = ref<ClientArtifact[]>()
const loadFailed = ref(false)

const apiBase = import.meta.env.VITE_ApiUrlBase ?? ''

onMounted(()=>{
    fetch(`${apiBase}/api/clientApp/info`).then((res)=>{
        if(!res.ok)
            throw new Error(`HTTP ${res.status}`)
        return res.json()
    }).then((json)=>{
        artifacts.value = json
    }).catch(()=>{
        loadFailed.value = true
    })
})

function latestOf(type: string){
    // 与后端 GetLatest 行为对齐：按 updatedAt 取最新，而非数组末尾
    const list = (artifacts.value ?? []).filter((x)=>x.type === type)
    return list.reduce<ClientArtifact | undefined>(
        (max, x)=>(!max || x.updatedAt > max.updatedAt ? x : max),
        undefined)
}
const latest = computed(()=>{
    const map: Record<string, ClientArtifact> = {}
    for (const t of artifactTypes) {
        const l = latestOf(t.type)
        if (l)
            map[t.type] = l
    }
    return map
})
const availableTypes = computed(()=>artifactTypes.filter((t)=>t.type in latest.value))

function fmtSize(bytes: number){
    if (bytes >= 1024 * 1024 * 1024)
        return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
function fmtTime(iso: string){
    // updatedAt 为 UTC ISO 字符串，按本地时间显示
    const d = new Date(iso)
    const p = (n: number)=>String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const { showPop } = useUniqueComponentsStore()
async function copyShasum(item: ClientArtifact){
    const success = await copy(item.sha256)
    if (success)
        showPop('已复制 shasum', 'success')
    else
        showPop('复制失败，请改用正规浏览器', 'failed')
}
</script>

<template>
    <div class="derive-page">
        <header class="hero">
            <img class="hero-logo" src="/aarc-logo.svg" alt="AARC" />
            <h1 class="hero-title">客户端下载</h1>
            <p class="hero-desc">
                AARC 本地版，离线使用编辑器并本地保存作品。
            </p>
        </header>

        <section class="section">
            <div v-if="loadFailed" class="hint">下载信息加载失败，请稍后再试</div>
            <div v-else-if="!artifacts" class="hint">加载中……</div>
            <div v-else-if="!availableTypes.length" class="hint">暂无下载，敬请期待</div>
            <div v-else class="card-grid download-grid">
                <div v-for="t in availableTypes" :key="t.type" class="card download-card">
                    <div class="card-body">
                        <h3 class="card-title">{{ t.title }}</h3>
                        <p class="card-sub">{{ t.fileDesc }}</p>
                        <a class="btn primary" :href="latest[t.type].url" :download="latest[t.type].fileName">下载</a>
                        <div class="info">
                            <div>更新时间 <span class="val">{{ fmtTime(latest[t.type].updatedAt) }}</span></div>
                            <div>文件大小 <span class="val">{{ fmtSize(latest[t.type].sizeBytes) }}</span></div>
                            <div v-if="latest[t.type].version">
                                版本 <span class="val">{{ latest[t.type].version }}</span>
                            </div>
                            <div>
                                提交
                                <span class="val">{{ latest[t.type].gitCommitId.slice(0, 8) || '未知' }}</span>
                            </div>
                            <div class="sha-row">
                                <span class="sha">{{ latest[t.type].sha256 }}</span>
                                <button class="btn lite" @click="copyShasum(latest[t.type])">复制 shasum</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <section class="section">
            <h2 class="section-title">注意事项</h2>
            <details v-for="g in noticeGroups" :key="g.title" class="notice-group" open>
                <summary class="notice-group-title">{{ g.title }}</summary>
                <ul class="notices">
                    <li v-for="n in g.items" :key="n.text">
                        {{ n.text }}
                        <a v-if="n.linkHref" :href="n.linkHref" target="_blank" rel="noopener">{{ n.linkText }}</a>
                        {{ n.suffix }}
                    </li>
                </ul>
            </details>
        </section>
    </div>
</template>

<style scoped lang="scss">
@use './styles/derive-intro-pages.scss';

.download-grid {
    grid-template-columns: repeat(3, 1fr);
}

.notice-group {
    margin: 12px 0;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 4px 16px;

    .notice-group-title {
        cursor: pointer;
        font-weight: 600;
        color: #111827;
        padding: 10px 0;
        user-select: none;
    }
}

.notices {
    text-align: left;
    padding-left: 20px;
    color: #4b5563;

    li {
        margin: 8px 0px;
    }

    a {
        color: #2563eb;
        text-decoration: none;

        &:hover {
            text-decoration: underline;
        }
    }
}

.download-card {
    .card-body {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .btn {
        align-self: flex-start;
        cursor: pointer;
    }
}

.info {
    text-align: left;
    font-size: 0.9rem;
    color: #4b5563;

    .val {
        color: #111827;
    }

    &>div {
        margin: 4px 0px;
    }
}

.sha-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.sha {
    font-family: monospace;
    font-size: 10px;
    word-break: break-all;
    color: #6b7280;
}

.btn.lite {
    padding: 4px 12px;
    font-size: 0.85rem;
}

.hint {
    text-align: center;
    color: #6b7280;
}

@media (max-width: 768px) {
    .download-grid {
        grid-template-columns: 1fr;
    }
}
</style>
