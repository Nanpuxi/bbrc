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
}

const artifactTypes = [
    { type: 'exe', title: 'Windows 绿色版', fileDesc: 'aarc.exe（解压即用，无需安装）' },
    { type: 'apk', title: 'Android（arm64）', fileDesc: 'aarc-arm64.apk' },
]

const notices: Array<{ text: string, linkText?: string, linkHref?: string, suffix?: string }> = [
    { text: '当前本地版仅为技术验证，部分功能可能存在问题或缺失。' },
    {
        text: '下载或使用代表你同意',
        linkText: 'Apache-2.0 许可证',
        linkHref: '/LICENSE.txt',
        suffix: '。',
    },
    { text: '仅从你信任的网站/个人那里获取 exe 或 apk，来源不明的不要点开，谨防恶意病毒软件。' },
    { text: '由于作者缺少苹果开发者资质，暂不提供 mac 和 iOS 版，有需要请自行编译。' },
]

const artifacts = ref<ClientArtifact[]>()
const loadFailed = ref(false)

onMounted(()=>{
    fetch('/clientArtifacts.json').then((res)=>{
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
    const list = (artifacts.value ?? []).filter((x)=>x.type === type)
    return list[list.length - 1]
}
const latest = computed(()=>Object.fromEntries(artifactTypes.map((t)=>[t.type, latestOf(t.type)])))
const availableTypes = computed(()=>artifactTypes.filter((t)=>latest.value[t.type]))

function fmtSize(bytes: number){
    if (bytes >= 1024 * 1024 * 1024)
        return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
function fmtTime(iso: string){
    return iso.slice(0, 19).replace('T', ' ')
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
            <ul class="notices">
                <li v-for="n in notices" :key="n.text">
                    {{ n.text }}
                    <a v-if="n.linkHref" :href="n.linkHref" target="_blank" rel="noopener">{{ n.linkText }}</a>
                    {{ n.suffix }}
                </li>
            </ul>
        </section>
    </div>
</template>

<style scoped lang="scss">
@use './styles/derive-intro-pages.scss';

.download-grid {
    grid-template-columns: repeat(2, 1fr);
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
