<script lang="ts" setup>
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents'
import { convertToProxyUrlIfNeeded } from 'aarc-core/utils/urlUtils/proxyUrl'
import copy from 'copy-to-clipboard'

const gameUrl = 'http://ms.jowei19.com'
const gitUrl = 'https://gitee.com/au114514/metro-shuttle'
const qqGroup = '1082281846'

function cardImg(path: string) {
    return convertToProxyUrlIfNeeded(`http://ms.jowei19.com/card-images/static/${path}`, 'icon')
}

const cards = [
    cardImg('nanjing/station-2.webp'),
    cardImg('shanghai-longterm/station-12.webp'),
    cardImg('beijing/station-7.webp'),
    cardImg('shanghai-longterm/card-back.webp'),
    cardImg('shanghai-longterm/draw3.webp'),
    cardImg('shanghai-longterm/discardTwoDrawThree.webp')
]

const { showPop } = useUniqueComponentsStore()
async function copyQQGroup() {
    const success = await copy(qqGroup)
    if (success)
        showPop('已复制群号', 'success')
    else
        showPop('复制失败，请改用正规浏览器', 'failed')
}
</script>

<template>
    <div class="derive-page">
        <header class="hero">
            <h1 class="hero-title">MetroShuttle</h1>
            <p class="hero-subtitle">属于地铁爱好者的 UNO</p>
            <p class="hero-desc">
                一款网页端 2-10 人实时对战卡牌游戏，卡牌即为地铁线网中的换乘站。拥有同一线路的卡牌可以“接上”或是成为“顺子”。玩家需要合理规划打出和留存的手牌，在与其他玩家的复杂博弈中取得优势。
            </p>
            <div class="hero-actions">
                <a class="btn primary" :href="gameUrl" target="_blank" rel="noopener">前往游玩</a>
                <a class="btn" :href="gitUrl" target="_blank" rel="noopener">代码仓库</a>
                <a class="btn" @click="copyQQGroup">加入 QQ 群 {{ qqGroup }}</a>
            </div>
        </header>

        <section class="section">
            <h2 class="section-title">卡牌示例</h2>
            <div class="poker-grid">
                <div v-for="(src, i) in cards" :key="i" class="poker-frame">
                    <img class="poker-card" :src="src" :alt="`卡牌 ${i + 1}`" />
                </div>
            </div>
        </section>

        <footer class="footer">
            <p>游戏设计：武定门-3 及其团队</p>
            <p>网站版实现：Au</p>
            <p>约对局、添加牌组设计：请加 QQ 群
                <a href="javascript:void(0)" @click="copyQQGroup">{{ qqGroup }}</a>
            </p>
        </footer>
    </div>
</template>

<style scoped lang="scss">
@use './styles/derive-intro-pages.scss';

.hero-subtitle {
    font-size: 1.1rem;
    font-weight: 500;
    color: #2563eb;
    margin: 0 0 16px;
}

.poker-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 20px;

    .poker-frame {
        // 扑克牌长宽比，圆角取短边（宽度）的 10%，竖直半径换算为高度的百分比
        aspect-ratio: 5 / 7;
        overflow: hidden;
        border-radius: 10% / 7.15%;
        box-shadow: 0 6px 14px rgba(0, 0, 0, 0.15);
        background: #f3f4f6;
        transition: transform 0.2s ease, box-shadow 0.2s ease;

        &:hover {
            transform: translate(6px, 6px);
            box-shadow: 0 14px 32px rgba(0, 0, 0, 0.3);
        }

        .poker-card {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }
    }
}

@media (max-width: 768px) {
    .poker-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}
</style>
