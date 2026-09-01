<script lang="ts" setup>
import { Line } from 'aarc-core/models/save';
import { useEnvStore } from 'aarc-core/models/stores/envStore';
import { useCvsFrameStore } from 'aarc-core/models/stores/cvsFrameStore';
import { useSaveStore } from 'aarc-core/models/stores/saveStore';
import { computed } from 'vue';
import settingsIcon from 'aarc-core/assets/ui/settings.svg';
import branchIcon from 'aarc-core/assets/ui/editor/branch.svg';
import branchSeperateIcon from 'aarc-core/assets/ui/editor/branchSeperate.svg';
import slicesIcon from 'aarc-core/assets/ui/slices.svg';
import searchIcon from 'aarc-core/assets/ui/search.svg';
import lockIcon from 'aarc-core/assets/ui/editor/lock.svg';
import unlockIcon from 'aarc-core/assets/ui/editor/unlock.svg';

const envStore = useEnvStore()
const cvs = useCvsFrameStore()
const saveStore = useSaveStore()

const props = withDefaults(defineProps<{
    mouseDownLineArrange: (e: MouseEvent | TouchEvent, id: number) => void,
    delLineStart: (l: Line) => void,
    editInfoOfLine: (l: Line) => void,
    editSlicesOfLine?: (l: Line) => void,
    showChildrenOf: (l: Line) => void,
    leaveParent: (l: Line) => void,
    arrangingId: number,
    l: Line,
    lineTypeCalled: string,
    showingBtns?:'children'|'arrange'
    isInChildrenList?:boolean
}>(), {
    editSlicesOfLine: ()=>{}
})

const emit = defineEmits<{
    (e:'closeSidebar'):void
}>()

function centerOnLine(){
    const firstPtId = props.l.pts.at(0)
    if(!firstPtId) return
    const pt = saveStore.getPtById(firstPtId)
    if(!pt) return
    cvs.focusViewToPos(pt.pos)
    envStore.activeLine = props.l
    envStore.activePt = pt;
    envStore.cursorPos = [...pt.pos]
    emit('closeSidebar')
}

function toggleLock(){
    props.l.locked = !props.l.locked || undefined
    envStore.lineInfoChanged(props.l)
}

const mode = computed<'A'|'B'>(()=>{
    if(props.showingBtns=='arrange')
        return 'B'
    return 'A'
})

const childrenCount = computed<number>(()=>{
    if(props.l.parent !== undefined && props.l.parent !== null)
        return 0
    const children = saveStore.getLinesByParent(props.l.id)
    return children?.length || 0
})
</script>

<template>
    <div class="names">
        <input v-model="l.name" :placeholder="`输入${lineTypeCalled}名`" @blur="envStore.lineInfoChanged(l)" />
        <input v-model="l.nameSub" :placeholder="`输入${lineTypeCalled}副名`" @blur="envStore.lineInfoChanged(l)" />
    </div>
    <div class="sqrBtn" @click="editInfoOfLine(l)">
        <img class="btn-icon btn-icon-bigger" :src="settingsIcon"/>
    </div>
    <div v-if="mode==='A' && !isInChildrenList" class="sqrBtn sqrBtn-relative" @click="showChildrenOf(l)">
        <img class="btn-icon" :src="branchIcon"/>
        <span v-if="childrenCount > 0" class="children-count">{{ childrenCount }}</span>
    </div>
    <div v-if="mode==='A' && isInChildrenList" class="sqrBtn" @click="leaveParent(l)">
        <img class="btn-icon" :src="branchSeperateIcon"/>
    </div>
    <div v-if="mode==='A'" class="sqrBtn" @click="editSlicesOfLine(l)">
        <img class="btn-icon" :src="slicesIcon"/>
    </div>
    <div v-if="mode==='B'" class="sqrBtn moveBtn" :class="{ sqrActive: arrangingId === l.id }" @mousedown="e => mouseDownLineArrange(e, l.id)"
        @touchstart="e => mouseDownLineArrange(e, l.id)">
        ⇅
    </div>
    <div v-if="mode==='B'" class="sqrBtn" @click="delLineStart(l)">
        ×
    </div>
    <div class="lock-icon" :class="{locked: l.locked}"
        @click="toggleLock" :title="l.locked ? '点击解锁该线路' : '点击锁定该线路（锁定后无法选中）'">
        <img :src="l.locked ? lockIcon : unlockIcon"/>
    </div>
    <img :src="searchIcon" class="search-icon" @click="centerOnLine" title="点击寻找该线路的位置"/>
</template>

<style scoped lang="scss">
.btn-icon{
    width: 20px;
    height: 20px;
    margin: 5px;
    filter: brightness(0) contrast(1000%); // 变纯黑
    &.btn-icon-bigger{
        width: 22px;
        height: 22px;
        margin: 4px;
    }
}

.sqrBtn-relative{
    position: relative;
}
.children-count{
    position: absolute;
    right: 1px;
    bottom: 1px;
    height: 12px;
    line-height: 12px;
    font-size: 12px;
    font-weight: bold;
    color: black;
    pointer-events: none;
}
.search-icon{
    // 需要外层线路卡片是 position 非 static 才能正确定位
    position: absolute;
    right: -10px;
    top: -10px;
    width: 14px;
    height: 14px;
    padding: 5px;
    border-radius: 5px 0px 0px 5px;
    background-color: white;
    box-shadow: 0 0 4px 0 rgba(0, 0, 0, 0.2);
    cursor: pointer;
    z-index: 10;
    &:hover{
        filter: brightness(0.8);
    }
}
.lock-icon{
    // 同 search-icon，位于其左侧
    position: absolute;
    right: 18px;
    top: -10px;
    // 总尺寸与原 img 一致：内容 18 + 原 padding 3*2 = 24
    width: 24px;
    height: 24px;
    border-radius: 5px;
    background-color: white;
    box-shadow: 0 0 4px 0 rgba(0, 0, 0, 0.2);
    cursor: pointer;
    z-index: 10;
    user-select: none;
    display: flex;
    align-items: center;
    justify-content: center;
    img{
        width: 18px;
        height: 18px;
    }
    &:hover{
        filter: brightness(0.8);
    }
    &.locked{
        background-color: #f0d878;
        // 滤镜只作用于内层 img，避免连同背景一起变白
        img{
            filter: brightness(0) invert(1); // 图标变为纯白
        }
    }
}
</style>