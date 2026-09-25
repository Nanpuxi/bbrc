<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import PaneCarousel from './PaneCarousel.vue';
import convert from 'color-convert';

/** 由 sideColor 推导侧块背景色：饱和度调低、亮度调高 */
function sideBackground(hex: string): string {
    const [h, s, l] = convert.hex.hsl.raw(hex);
    return '#' + convert.hsl.hex(h, s * 0.6, Math.min(95, l + (100 - l) * 0.5));
}

/** 由背景色推导 border 色：饱和度略升、亮度略降 */
function borderColor(hex: string): string {
    const [h, s, l] = convert.hex.hsl.raw(hex);
    return '#' + convert.hsl.hex(h, Math.min(100, s * 1.25 + 5), l * 0.72);
}

interface TwinSlide {
    /** 全宽展示；滑到该 slide 时，上半两侧补出「其他工具」 */
    wide?: boolean
    /** 该 slide 处于当前位时「其他工具」侧块的原色（背景与 border 色自动推导） */
    sideColor?: string
}

const props = withDefaults(
    defineProps<{
        topCount?: number
        bottomSlides?: TwinSlide[]
    }>(),
    { topCount: 3, bottomSlides: () => [] },
);

const currentBottom = ref<TwinSlide | undefined>(props.bottomSlides[0]);
const showSides = computed(() => !!currentBottom.value?.wide);

const topSlides = computed(() => Array.from({ length: props.topCount }, () => ({}) as const));

const sideStyle = computed(() => {
    const color = currentBottom.value?.sideColor;
    if (!color) return undefined;
    const background = sideBackground(color);
    return {
        background,
        borderColor: borderColor(background),
    };
});

/* 自动滚动：上半每 2s 前进一位（循环），归位时下半也前进一位（循环）；
   用户拖动后暂停 4s，再从用户当前所在位置继续 */
const AUTO_MS = 2000;
const RESUME_MS = 4000;

const topPane = ref<InstanceType<typeof PaneCarousel>>();
const bottomPane = ref<InstanceType<typeof PaneCarousel>>();
let timer: ReturnType<typeof setTimeout> | undefined;

function schedule(delay: number) {
    clearTimeout(timer);
    timer = setTimeout(tick, delay);
}

function tick() {
    const top = topPane.value;
    const bottom = bottomPane.value;
    if (!top || !bottom) {
        schedule(AUTO_MS);
        return;
    }
    if (top.isDragging() || bottom.isDragging()) {
        schedule(500);
        return;
    }
    const next = (top.getIndex() + 1) % Math.max(props.topCount, 1);
    top.goTo(next);
    if (next === 0) bottom.goTo(bottom.getIndex() + 1);
    schedule(AUTO_MS);
}

function onInteraction() {
    schedule(RESUME_MS);
}

onMounted(() => schedule(AUTO_MS));
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
<div class="twin-carousel">
    <div class="pane pane-top">
        <PaneCarousel ref="topPane" :slides="topSlides" v-slot="{ index }" @interaction="onInteraction">
            <slot name="top" :index="index" />
        </PaneCarousel>
        <Transition name="sides">
            <div v-if="showSides" class="sides">
                <div class="side side-left" :style="sideStyle">你的工具</div>
                <div class="side side-right" :style="sideStyle">其他工具</div>
            </div>
        </Transition>
    </div>
    <div class="pane">
        <PaneCarousel ref="bottomPane" :slides="bottomSlides" v-slot="{ index }" @change="currentBottom = $event" @interaction="onInteraction">
            <slot name="bottom" :index="index" />
        </PaneCarousel>
    </div>
</div>
</template>

<style scoped lang="scss">
.twin-carousel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;

    .pane {
        flex: none;
        height: 100px;
        display: flex;
    }

    .pane-top {
        position: relative;
    }

    /* 覆盖层：填进上半 70% 卡片两侧空出的 15% + 15%，下缘贴分割线 */
    .sides {
        position: absolute;
        inset: 0;
        display: flex;
        justify-content: space-between;
        padding: 0 var(--tc-gutter, 24px);
        pointer-events: none;

        .side {
            width: calc(100% * 0.15);
            box-sizing: border-box;
            display: flex;
            align-items: center;
            justify-content: center;
            writing-mode: vertical-lr;
            font-size: 11px;
            letter-spacing: 2px;
            color: #1c1c22;
            background: #ececf1;
            border-style: solid;
            border-color: #c6c6d0;
            border-bottom: 0;
            border-radius: 12px 12px 0 0;
        }

        /* 与上半卡片紧贴：相邻一侧不设边框、不设圆角，避免双线缝隙 */
        .side-left {
            border-width: 1px 0 1px 1px;
        }

        .side-right {
            border-width: 1px 1px 1px 0;
        }
    }

    .sides-enter-active,
    .sides-leave-active {
        transition: opacity 250ms ease;
    }

    .sides-enter-from,
    .sides-leave-to {
        opacity: 0;
    }
}
</style>
