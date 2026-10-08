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
    /** 箭头显示策略：'always' 总是显示；'never' 从不显示；数字表示屏幕宽度达到该值（px）时才显示 */
    showArrows?: 'always' | 'never' | number,
    /** 为 true 时，幻灯片进入时淡入（opacity 0→1）、移出时淡出（1→0） */
    fade?: boolean,
    /**
     * fade 模式下拖动淡出的死区，占视口宽度的比例（0~0.5）。
     * 拖动距离在死区内时保持不变淡；越过死区后线性淡出，拖到一半宽度处完全透明
     */
    fadeDeadZone?: number,
    /** 初始定位到第几张（0 起），首帧即在该位置，无滚动动画 */
    initialIndex?: number,
}>(), {
    autoPlay: false,
    autoIntervalMs: 1600,
    showDots: true,
    showArrows: 'never',
    fade: false,
    fadeDeadZone: 0,
    initialIndex: 0,
});

const emit = defineEmits<{
    change: [index: number],
    /** 用户拖拽/点击箭头/点击圆点等主动操作时触发（自动滚动应据此停止） */
    interaction: [],
    /** 自动滚动推进到最后一张时触发（被用户打断或手动翻到最后一张不算） */
    autoDone: [],
}>();

const viewport = ref<HTMLElement>();
const index = ref(Math.min(Math.max(props.initialIndex, 0), props.count - 1));
const offset = ref(0);
const dragging = ref(false);

let startX = 0;
let startY = 0;
let decided = false;
let horizontal = false;

/** 拖拽末尾的采样点（用于估算松手时的速度） */
let moveSamples: { x: number, t: number }[] = [];
/** 速度估算只取最近这么多毫秒内的位移 */
const VELOCITY_WINDOW_MS = 120;
/** 超过该速度（px/ms）视为快速甩动，即使位移不足也翻页 */
const FLICK_VELOCITY = 0.45;

/** 手动切换（拖拽松手/箭头/圆点）的翻页动画时长 */
const TRANSITION_MS = 350;
/** 自动滚动的翻页动画时长 */
const AUTO_TRANSITION_MS = TRANSITION_MS * 2;
/** 当前翻页是否由自动滚动触发（决定动画时长） */
const autoAnimating = ref(false);

const trackStyle = computed(() => ({
    transform: `translate3d(calc(${index.value * -100}% + ${offset.value}px), 0, 0)`,
    transition: dragging.value
        ? 'none'
        : `transform ${autoAnimating.value ? AUTO_TRANSITION_MS : TRANSITION_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)`,
}));

/**
 * fade 模式下每张幻灯片的透明度样式。
 * 拖动中与拖动距离挂钩：死区内不变淡，越过死区后当前页线性淡出、
 * 拖动方向上的相邻页同步淡入，拖到一半宽度处完成交替；
 * 松手后 offset 归零/翻页，改由 transition 按时间平滑过渡到终态。
 */
/** 拖到视口宽度的该比例处完全透明 */
const FULL_FADE_AT = 0.5;

function slideStyle(i: number) {
    if (!props.fade) return undefined;
    const width = viewport.value?.clientWidth || 1;
    const dz = Math.min(Math.max(props.fadeDeadZone, 0), FULL_FADE_AT);
    const p = dragging.value ? Math.abs(offset.value) / width : 0;
    // fade: 0 = 当前页全显，1 = 完全切到相邻页
    const fade = p <= dz ? 0 : Math.min((p - dz) / (FULL_FADE_AT - dz), 1);
    let opacity: number;
    if (i === index.value) {
        opacity = 1 - fade;
    }
    else if (fade > 0 && i === index.value + (offset.value < 0 ? 1 : -1)) {
        opacity = fade;
    }
    else {
        opacity = 0;
    }
    return {
        opacity,
        transition: dragging.value
            ? 'none'
            : `opacity ${autoAnimating.value ? AUTO_TRANSITION_MS : TRANSITION_MS}ms ease`,
    };
}

const windowWidth = ref(window.innerWidth);
function onResize() {
    windowWidth.value = window.innerWidth;
}
const arrowsVisible = computed(() => {
    const s = props.showArrows;
    if (s === 'always') return true;
    if (s === 'never') return false;
    return windowWidth.value >= s;
});

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
            autoAnimating.value = true;
            setIndex(index.value + 1);
            if (index.value >= props.count - 1) emit('autoDone');
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
    autoAnimating.value = false;
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
    moveSamples = [{ x: e.clientX, t: performance.now() }];
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
    moveSamples.push({ x: e.clientX, t: performance.now() });
    if (moveSamples.length > 20) moveSamples.shift();
}

/** 估算松手瞬间的水平速度（px/ms，向左为负），采样不足时返回 0 */
function releaseVelocity(endX: number) {
    const now = performance.now();
    const samples = [...moveSamples, { x: endX, t: now }];
    moveSamples = [];
    let first = samples[0]!;
    for (const s of samples) {
        if (now - s.t > VELOCITY_WINDOW_MS) first = s;
        else break;
    }
    const last = samples[samples.length - 1]!;
    const dt = last.t - first.t;
    if (dt < 20) return 0;
    return (last.x - first.x) / dt;
}

function endDrag(e: PointerEvent) {
    if (!dragging.value) return;
    dragging.value = false;
    if (horizontal) {
        userInteraction();
        const width = viewport.value?.clientWidth ?? 1;
        const v = releaseVelocity(e.clientX);
        // 快速甩动：即使位移不足阈值也翻页，方向以甩动方向为准
        if (Math.abs(v) >= FLICK_VELOCITY) {
            setIndex(index.value + (v < 0 ? 1 : -1));
        }
        else if (Math.abs(offset.value) > width * 0.2) {
            setIndex(index.value + (offset.value < 0 ? 1 : -1));
        }
    }
    else {
        moveSamples = [];
    }
    offset.value = 0;
    horizontal = false;
}

onMounted(() => {
    window.addEventListener('resize', onResize);
    if (props.count > 1) scheduleAuto();
});
onBeforeUnmount(() => {
    window.removeEventListener('resize', onResize);
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
            v-if="arrowsVisible && count > 1"
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
                <div v-for="i in count" :key="i" class="slide" :style="slideStyle(i - 1)">
                    <slot :index="i - 1" :active="i - 1 === index" />
                </div>
            </div>
        </div>
        <button
            v-if="arrowsVisible && count > 1"
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
