<script setup lang="ts">
import { ref, computed } from 'vue';

interface PaneSlide {
    /** 全宽展示；缺省的 slide 宽度缩减 30% */
    wide?: boolean
}

const props = defineProps<{
    slides: PaneSlide[]
}>();

const emit = defineEmits<{ change: [slide: PaneSlide]; interaction: [] }>();

const viewport = ref<HTMLElement>();
const index = ref(0);
const offset = ref(0);
const dragging = ref(false);

let startX = 0;
let startY = 0;
let decided = false;
let horizontal = false;

const trackStyle = computed(() => ({
    transform: `translate3d(calc(${index.value * -100}% + ${offset.value}px), 0, 0)`,
    transition: dragging.value
        ? 'none'
        : 'transform 350ms cubic-bezier(0.22, 0.61, 0.36, 1)',
}));

function onPointerDown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging.value = true;
    decided = false;
    horizontal = false;
    startX = e.clientX;
    startY = e.clientY;
    offset.value = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
    if (!dragging.value) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!decided) {
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        decided = true;
        horizontal = Math.abs(dx) >= Math.abs(dy);
        if (horizontal) emit('interaction');
    }
    if (!horizontal) return;
    let d = dx;
    const atStart = index.value === 0 && d > 0;
    const atEnd = index.value >= props.slides.length - 1 && d < 0;
    if (atStart || atEnd) d *= 0.3;
    offset.value = d;
}

function endDrag() {
    if (!dragging.value) return;
    dragging.value = false;
    if (horizontal) {
        emit('interaction');
        const width = viewport.value?.clientWidth ?? 1;
        if (Math.abs(offset.value) > width * 0.2) {
            const next = Math.min(
                Math.max(index.value + (offset.value < 0 ? 1 : -1), 0),
                props.slides.length - 1,
            );
            if (next !== index.value) {
                index.value = next;
                emit('change', props.slides[next]);
            }
        }
    }
    offset.value = 0;
    horizontal = false;
}

function goTo(i: number) {
    const len = props.slides.length;
    if (!len) return;
    const next = ((i % len) + len) % len;
    index.value = next;
    emit('change', props.slides[next]);
}

defineExpose({
    goTo,
    getIndex: () => index.value,
    isDragging: () => dragging.value,
});
</script>

<template>
<div class="carousel-host">
    <div
        ref="viewport"
        class="viewport"
        :class="{ dragging }"
        @pointerdown.prevent="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="endDrag"
        @pointercancel="endDrag"
    >
        <div class="track" :style="trackStyle">
            <div
                v-for="(slide, i) in slides"
                :key="i"
                class="slide"
                :class="{ wide: slide.wide }"
            >
                <div class="card"><slot :index="i" /></div>
            </div>
        </div>
    </div>
</div>
</template>

<style scoped lang="scss">
/* 全链路用 flex 拉伸，不用百分比高度，父级给多大就用多大 */
.carousel-host {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;

    .viewport {
        flex: 1;
        min-height: 0;
        display: flex;
        overflow: hidden;
        touch-action: pan-y;
        user-select: none;
        -webkit-user-select: none;
        cursor: grab;

        &.dragging {
            cursor: grabbing;
        }
    }

    .track {
        flex: 1;
        min-width: 0;
        display: flex;
        will-change: transform;
    }

    /* 左右留出边距，上下不留，内容即紧贴相邻面板 */
    .slide {
        flex: 0 0 100%;
        min-width: 0;
        display: flex;
        justify-content: center;
        padding: 0 var(--tc-gutter, 24px);
        box-sizing: border-box;

        .card {
            flex: 0 1 70%;
            min-width: 0;
            display: flex;
        }

        &.wide .card {
            flex-basis: 100%;
        }
    }
}
</style>
