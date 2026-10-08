<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import RecentUpdates from './RecentUpdates.vue';

const innerRef = ref<HTMLElement>();
// 折叠状态不持久化：刷新后总是回到折叠态
const expanded = ref(false);
const collapsible = ref(false);

function maxCollapsedHeightPx() {
    return window.innerHeight * 0.5;
}

function measure() {
    const el = innerRef.value;
    if (!el) return;
    collapsible.value = el.scrollHeight > maxCollapsedHeightPx() + 1;
}

let ro: ResizeObserver | undefined;
onMounted(() => {
    ro = new ResizeObserver(measure);
    if (innerRef.value) ro.observe(innerRef.value);
    window.addEventListener('resize', measure);
    measure();
});
onBeforeUnmount(() => {
    ro?.disconnect();
    window.removeEventListener('resize', measure);
});
</script>

<template>
<div class="recent-updates-collapsible">
    <div class="clamp" :class="{ collapsed: collapsible && !expanded }">
        <div ref="innerRef">
            <RecentUpdates></RecentUpdates>
        </div>
        <div v-if="collapsible && !expanded" class="fadeMask"></div>
    </div>
    <button v-if="collapsible" class="lite expandBtn" @click="expanded = !expanded">
        {{ expanded ? '收起▲' : '查看全部▼' }}
    </button>
</div>
</template>

<style scoped lang="scss">
.recent-updates-collapsible{
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
}
.clamp{
    position: relative;
    width: 100%;
    &.collapsed{
        max-height: 50vh;
        overflow: hidden;
    }
}
.fadeMask{
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 80px;
    background: linear-gradient(to bottom, transparent, white);
    pointer-events: none;
}
.expandBtn{
    margin: 8px auto 0;
    padding: 6px 20px;
    border: none;
    border-radius: 999px;
    color: #fff;
    background: linear-gradient(135deg, #667eea, #764ba2);
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.35);
    cursor: pointer;
}
</style>
