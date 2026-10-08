<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = withDefaults(defineProps<{
    /** 幻灯片数量，内容通过默认插槽按 index 传入 */
    count: number,
    /** 自动从第 1 张逐张滚到最后一张并停住（被用户操作打断时停止，不循环） */
    autoPlay?: boolean,
    /** 自动滚动间隔毫秒数 */
    autoIntervalMs?: number,
    showDots?: boolean,
    showArrows?: boolean,
    /** 为 true 时，幻灯片进入时淡入（opacity 0→1）、移出时淡出（1→0） */
    fade?: boolean,
}>(), {
    autoPlay: false,
    autoIntervalMs: 2000,
    showDots: true,
    showArrows: true,
    fade: false,
});

const emit = defineEmits<{
    change: [index: number],
    /** 用户拖拽/点击箭头/点击圆点等主动操作时触发（自动滚动应据此停止） */
    interaction: [],
}>();

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

let autoTimer: ReturnType<typeof setTimeout> | undefined;
let autoStopped = false;

function stopAuto() {
    autoStopped = true;
    if (autoTimer !== undefined) {
        clearTimeout(autoTimer);
        autoTimer = undefined;
    }
}

function scheduleAuto() {
    if (!props.autoPlay || autoStopped) return;
    if (index.value >= props.count - 1) return;
    autoTimer = setTimeout(() => {
        autoTimer = undefined;
        if (autoStopped || dragging.value) return;
        if (index.value < props.count - 1) {
            setIndex(index.value + 1);
            scheduleAuto();
        }
    }, props.autoIntervalMs);
}

function setIndex(i: number) {
    const next = Math.min(Math.max(i, 0), props.count - 1);
    if (next !== index.value) {
        index.value = next;
        emit('change', next);
    }
}

/** 用户主动操作：终止自动滚动并通知宿主 */
function userInteraction() {
    stopAuto();
    emit('interaction');
}

function goTo(i: number, byUser = false) {
    if (byUser) userInteraction();
    setIndex(i);
}

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
        if (horizontal) userInteraction();
    }
    if (!horizontal) return;
    let d = dx;
    const atStart = index.value === 0 && d > 0;
    const atEnd = index.value >= props.count - 1 && d < 0;
    if (atStart || atEnd) d *= 0.3;
    offset.value = d;
}

function endDrag() {
    if (!dragging.value) return;
    dragging.value = false;
    if (horizontal) {
        userInteraction();
        const width = viewport.value?.clientWidth ?? 1;
        if (Math.abs(offset.value) > width * 0.2) {
            setIndex(index.value + (offset.value < 0 ? 1 : -1));
        }
    }
    offset.value = 0;
    horizontal = false;
}

onMounted(() => {
    if (props.count > 1) scheduleAuto();
});
onBeforeUnmount(() => {
    stopAuto();
});

defineExpose({
    goTo,
    getIndex: () => index.value,
    isDragging: () => dragging.value,
});
</script>

<template>
<div class="carousel">
    <div class="body">
        <button
            v-if="showArrows && count > 1"
            class="arrow prev"
            :disabled="index === 0"
            @click="goTo(index - 1, true)"
        >‹</button>
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
                <div v-for="i in count" :key="i" class="slide" :class="{ active: i - 1 === index, fade }">
                    <slot :index="i - 1" :active="i - 1 === index" />
                </div>
            </div>
        </div>
        <button
            v-if="showArrows && count > 1"
            class="arrow next"
            :disabled="index >= count - 1"
            @click="goTo(index + 1, true)"
        >›</button>
    </div>
    <div v-if="showDots && count > 1" class="dots">
        <button
            v-for="i in count"
            :key="i"
            class="dot"
            :class="{ active: i - 1 === index }"
            @click="goTo(i - 1, true)"
        ></button>
    </div>
</div>
</template>

<style scoped lang="scss">
.carousel {
    display: flex;
    flex-direction: column;
    gap: 10px;

    .body {
        position: relative;
        display: flex;
        align-items: stretch;
    }

    .viewport {
        flex: 1;
        min-width: 0;
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
        width: 100%;
        display: flex;
        will-change: transform;
    }

    .slide {
        flex: 0 0 100%;
        min-width: 0;
        display: flex;
        box-sizing: border-box;

        &.fade {
            opacity: 0;
            transition: opacity 350ms ease;

            &.active {
                opacity: 1;
            }
        }
    }

    .arrow {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        z-index: 2;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: none;
        background: rgba(255, 255, 255, 0.85);
        box-shadow: 0 1px 6px rgba(0, 0, 0, 0.25);
        color: #333;
        font-size: 22px;
        line-height: 1;
        cursor: pointer;

        &.prev { left: 8px; }
        &.next { right: 8px; }

        &:disabled {
            opacity: 0.35;
            cursor: default;
        }
    }

    /* 触屏设备与窄屏不显示箭头，靠拖拽/滑动切换 */
    @media (hover: none), (max-width: 768px) {
        .arrow {
            display: none;
        }
    }

    .dots {
        display: flex;
        justify-content: center;
        gap: 8px;

        .dot {
            width: 8px;
            height: 8px;
            padding: 0;
            border-radius: 999px;
            border: none;
            background: #ccc;
            cursor: pointer;
            transition: width 0.25s ease, background 0.25s ease;

            &.active {
                width: 22px;
                background: #aaa //linear-gradient(90deg, #667eea, #9b7bd8);
            }
        }
    }
}
</style>
