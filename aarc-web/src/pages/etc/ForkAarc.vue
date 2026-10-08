<script lang="ts" setup>
import { guideInfo } from 'aarc-core/app/guideInfo';
import { convertToProxyUrlIfNeeded } from 'aarc-core/utils/urlUtils/proxyUrl';
import { onMounted, ref } from 'vue';
import Combinations from '../components/Combinations.vue';
import SolutionsCompare from '../components/SolutionsCompare.vue';

const giteeUrl = 'https://gitee.com/au114514/aarc'
const githubUrl = 'https://github.com/Aurouscia/aarc'
const exampleUrl = 'http://aarc.maritel.jowei19.com'
const exampleLogo = convertToProxyUrlIfNeeded('http://maritel.jowei19.com/maritelLogo.png', 'icon')

const show = ref(false)
onMounted(()=>window.setTimeout(()=>{show.value = true}, 10))
</script>

<template>
    <div v-show="show" class="derive-page">
        <header class="hero">
            <h1 class="hero-title">Fork AARC</h1>
            <p class="hero-desc">
                AARC 开源免费，支持 Windows Server 或 Docker 部署
            </p>
            <p class="hero-desc">
                如果你和你的创作团队需要一个自主可控且不被打扰的环境，可以 Fork 一份本项目代码，根据自己的需求和喜好随意修改它，并把它运行在自己的服务器上。
            </p>
            <div class="hero-actions">
                <a class="btn primary" :href="giteeUrl" target="_blank" rel="noopener">Gitee 获取代码</a>
                <a class="btn" :href="githubUrl" target="_blank" rel="noopener">Github 获取代码</a>
                <a class="btn" :href="exampleUrl" target="_blank" rel="noopener">私服示范站点</a>
            </div>
        </header>

        <p style="text-align: center;">
            本系统由两部分组成，可自由组合替换
        </p>

        <Combinations />

        <section class="section features">
            <div class="feature">
                <span class="feature-icon">🔧</span>
                <h3 class="feature-title">自由定制</h3>
                <p class="feature-text">代码完全开源，可根据团队需求随意修改功能、样式与业务逻辑，可自由选择是否闭源或收费</p>
            </div>
            <div class="feature">
                <span class="feature-icon">🐳/🪟</span>
                <h3 class="feature-title">跨平台后端</h3>
                <p class="feature-text">提供 Dockerfile，支持在 Linux 或 Windows 部署，稍加修改即可<a href="https://learn.microsoft.com/zh-cn/ef/core/providers/?tabs=dotnet-core-cli">适配任意主流数据库</a></p>
            </div>
            <div class="feature">
                <span class="feature-icon">🔄</span>
                <h3 class="feature-title">持续维护</h3>
                <p class="feature-text">可从主分支同步，获取新功能和修复补丁</p>
            </div>
        </section>

        <section class="section">
            <h2 class="section-title">私服示范站点</h2>
            <div class="fork-list">
                <a
                    class="card fork-card"
                    :href="exampleUrl"
                    target="_blank"
                    rel="noopener"
                >
                    <img class="fork-logo" :src="exampleLogo" alt="平浪风云参设组专属 AARC" />
                    <div class="fork-info">
                        <h3 class="card-title">平浪风云参设组专属 AARC</h3>
                        <p class="card-sub">基于 AARC Fork 的私服实例</p>
                    </div>
                </a>
                <div class="card fork-card fork-placeholder">
                    <span class="fork-placeholder-plus">+</span>
                    <div class="fork-info">
                        <h3 class="card-title">你的网站</h3>
                        <p class="card-sub">要在此宣传你的网站，可联系本站管理员</p>
                    </div>
                </div>
            </div>
        </section>

        <section class="section">
            <h2 class="section-title">方案对比</h2>
            <SolutionsCompare></SolutionsCompare>
        </section>

        <footer class="footer">
            <p>开发/部署遇到问题：{{ guideInfo.findHelp }}</p>
        </footer>
    </div>
</template>

<style scoped lang="scss">
@use './styles/derive-intro-pages.scss';

a {
    color: cornflowerblue;
    text-decoration: underline;
}

.fork-placeholder {
    border: 2px dashed #9ca3af;
    color: #6b7280;
    cursor: default;

    &:hover {
        transform: none;
        box-shadow: none;
    }

    .fork-placeholder-plus {
        width: 56px;
        height: 56px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 32px;
        color: #9ca3af;
        border: 2px dashed #d1d5db;
        border-radius: 12px;
    }
}
</style>
