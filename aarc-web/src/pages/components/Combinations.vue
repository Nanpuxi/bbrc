<script setup lang="ts">
import { computed } from 'vue';
import TwinCarousel from './TwinCarousel.vue';
import convert from 'color-convert';

/** 由背景色推导 border 色：饱和度略升、亮度略降 */
function borderColor(hex: string): string {
    const [h, s, l] = convert.hex.hsl.raw(hex);
    return '#' + convert.hsl.hex(h, Math.min(100, s * 1.25 + 5), l * 0.72);
}

/** 由主题色推导卡片背景色：饱和度调低、亮度调高（与 TwinCarousel 侧块一致） */
function soften(hex: string): string {
    const [h, s, l] = convert.hex.hsl.raw(hex);
    return '#' + convert.hsl.hex(h, s * 0.6, Math.min(95, l + (100 - l) * 0.5));
}

interface ShellItem {
    emoji: string
    title: string
    code: string
    color: string
    /** 全宽展示，滑到时上半两侧补出「其他工具」 */
    wide?: boolean
}

const topItems: ShellItem[] = [
    { emoji: '⚙️', title: '官方编辑器核心', code: 'aarc-core', color: '#c2e9fb' },
    { emoji: '⚙️', title: '定制版编辑器核心', code: 'my-aarc-core', color: '#fd746c' },
];

const bottomItems: ShellItem[] = [
    { emoji: '🌐', title: '官方网站外壳', code: 'aarc-web', color: '#c2e9fb' },
    { emoji: '📱', title: '官方应用外壳', code: 'aarc-tauri', color: '#e0c3fc' },
    { emoji: '🧰', title: '自定义多工具平台', code: 'my-tool-collection', color: '#fccb90', wide: true },
    { emoji: '🌍', title: '定制网站外壳', code: 'my-aarc-web', color: '#84fab0' },
    { emoji: '📱', title: '定制应用外壳', code: 'my-aarc-tauri', color: '#fbc2eb' },
];

const bottomSlides = computed(() => bottomItems.map(x => ({
    wide: x.wide,
    sideColor: x.color,
})));

interface ShellCard extends ShellItem {
    bg: string
    border: string
}

function toCards(items: ShellItem[]): ShellCard[] {
    return items.map(x => {
        const bg = soften(x.color);
        return { ...x, bg, border: borderColor(bg) };
    });
}

const topCards = toCards(topItems);
const bottomCards = toCards(bottomItems);
</script>

<template>
<div class="combinations">
    <TwinCarousel :top-count="topItems.length" :bottom-slides="bottomSlides">
        <template #top="{ index }">
            <div
                class="demo-card card-top"
                :style="{ background: topCards[index].bg, borderColor: topCards[index].border }"
            >
                <span class="emoji">{{ topCards[index].emoji }}</span>
                <span class="title">{{ topCards[index].title }}</span>
                <span class="code">{{ topCards[index].code }}</span>
            </div>
        </template>
        <template #bottom="{ index }">
            <div
                class="demo-card card-bottom"
                :style="{ background: bottomCards[index].bg, borderColor: bottomCards[index].border }"
            >
                <span class="emoji">{{ bottomCards[index].emoji }}</span>
                <span class="title">{{ bottomCards[index].title }}</span>
                <span class="code">{{ bottomCards[index].code }}</span>
            </div>
        </template>
    </TwinCarousel>
</div>
</template>

<style scoped lang="scss">
.combinations {
    max-width: 600px;
    margin: 20px auto;
    padding: 0 10px;
    text-align: center;

    .sectionTitle {
        font-size: 24px;
        margin: 12px 0 4px;
    }

    .pageHint {
        font-size: 13px;
        opacity: 0.7;
        margin-bottom: 24px;
    }

    .demo-card {
        flex: 1;
        min-width: 0;
        border-style: solid;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        color: #1c1c22;

        &.card-top {
            /* 上半：左、右、上；下半：左、右、下 —— 交界处无横边，两半正好相接 */
            border-width: 1px 1px 0;
            border-radius: 12px 12px 0 0;
        }

        &.card-bottom {
            border-width: 0 1px 1px;
            border-radius: 0 0 12px 12px;
        }

        .emoji {
            font-size: 22px;
            line-height: 1.1;
        }

        .title {
            font-size: 13px;
            font-weight: 500;
            line-height: 1.2;
        }

        .code {
            font-family: ui-monospace, Consolas, monospace;
            font-size: 11px;
            opacity: 0.75;
        }
    }
}
</style>
