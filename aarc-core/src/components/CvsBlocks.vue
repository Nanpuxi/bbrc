<script setup lang="ts">
import { useCvsBlocksControlStore } from 'aarc-core/models/cvs/common/cvs';
import { storeToRefs } from 'pinia';
import { computed, CSSProperties } from 'vue';

const props = defineProps<{
    canvasIdPrefix:string,
    cvsClassName?:'mainCvs'|'activeCvs',
    insnif?:boolean
    invisible?:boolean
}>()
const classes = computed(()=>{
    const res:string[] = []
    if(props.cvsClassName)
        res.push(props.cvsClassName)
    if(props.insnif)
        res.push('insnif')
    if(props.invisible)
        res.push('invisible')
    return res
})
const cvsBlocksControlStore = useCvsBlocksControlStore()
const { blocksControl } = storeToRefs(cvsBlocksControlStore)
const blocks = computed<{id:string, styles:CSSProperties, w:number, h:number, key:number}[]>(()=>{
    return blocksControl.value.map(x=>{
        const styles:CSSProperties = {
            width: `${x.widthRatio*100}%`,
            height: `${x.heightRatio*100}%`,
            left: `${x.leftRatio*100}%`,
            top: `${x.topRatio*100}%`
        }
        return{
            id: `${props.canvasIdPrefix}${x.idx}`,
            styles,
            w: x.canvasWidth,
            h: x.canvasHeight,
            key:x.key
        }
    })
})
</script>

<template>
    <canvas v-for="b in blocks" :id="b.id" :style="b.styles" :key="b.key"
        :width="b.w" :height="b.h"
        :class="classes"></canvas>
</template>

<style scoped lang="scss">
canvas {
    width: 100%;
    height: 100%;
    position: absolute;
    inset: 0px;
    transition-timing-function: linear;
}
.mainCvs{
    transition-timing-function: cubic-bezier(0, 0.9, 0, 0.9);//出现地越快越好
    &.insnif{
        transition-timing-function: cubic-bezier(0.9, 0, 0.9, 0);//消失地越慢越好
        opacity: 0.4;
    }
}
.activeCvs{
    transition: 0s;//瞬间出现
    &.invisible{
        transition: 0.15s;
        transition-timing-function: cubic-bezier(0.5, 0, 0.5, 0);//慢速消失
        opacity: 0;
    }
}
</style>