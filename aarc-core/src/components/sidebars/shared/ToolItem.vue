<script setup lang="ts">
import { ref } from 'vue';
import foldIcon from 'aarc-core/assets/ui/fold.svg';

const show = ref(false)
</script>

<template>
<div class="toolItem">
    <div class="toolMain">
        <div class="toolControls">
            <slot></slot>
        </div>
        <div class="toolFold" :class="{shown: show}" @click="show = !show">
            <img :src="foldIcon"/>
        </div>
    </div>
    <div v-if="show" class="toolExplain">
        <slot name="explain"></slot>
    </div>
</div>
</template>

<style scoped lang="scss">
.toolItem{
    border-bottom: 1px solid #ddd;
    padding: 12px;
}
.toolMain{
    display: flex;
    align-items: center;
    gap: 8px;
}
.toolControls{
    flex-grow: 1;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 3px;
}
.toolFold{
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    cursor: pointer;
    user-select: none;
    img{
        width: 100%;
        height: 100%;
        transform: rotate(90deg);
    }
    &.shown img{
        transform: rotate(0deg);
        filter: brightness(0);
    }
}
.toolExplain{
    margin-top: 8px;
    border-top: 1px dashed #ddd;
    padding-top: 8px;
}
</style>
