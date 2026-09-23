<script setup lang="ts">
import { TextTagIconData } from 'aarc-core/models/stores/iconStore';

const props = defineProps<{data?:TextTagIconData}>();
</script>

<template>
<div class="iconPreview" v-if="props.data">
    <img v-if="props.data.status=='loaded' && props.data.img?.src" :src="props.data.img?.src"/>
    <div v-else-if="props.data.status=='loading'" class="previewNote">检查中…</div>
    <div v-else class="previewErr">{{ props.data.errmsg ?? '加载失败' }}</div>
</div>
</template>

<style scoped lang="scss">
.iconPreview{
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    img{
        width: 44px;
        height: 44px;
        object-fit: contain;
    }
    .previewNote{
        color: #666;
        font-size: 13px;
    }
    .previewErr{
        color: red;
        font-size: 13px;
    }
}
</style>
