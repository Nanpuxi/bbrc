<script setup lang="ts">
import { onMounted, useTemplateRef } from 'vue';
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents';
import Pop from './components/Pop.vue';
import Wait from './components/Wait.vue';

const pop = useTemplateRef('pop')
const wait = useTemplateRef('wait')

onMounted(()=>{
    // minimal 阶段只注册 pop/wait（其余 provider 暂不注入），
    // 故不用聚合入口 initCoreHostServices，直接调底层 initCallbacks
    useUniqueComponentsStore().initCallbacks({
        popCallback: (msg, type)=>{
            pop.value?.show(msg, type)
        },
        waitCallback: (reason, value)=>{
            wait.value?.setShowing(reason, value)
        }
    })
})
</script>

<template>
    <div class="placeholder">
        aarc-tauri minimal host（占位：编辑器宿主组件待实现）
    </div>
    <Pop ref="pop"/>
    <Wait ref="wait"/>
</template>

<style scoped lang="scss">
.placeholder{
    padding: 20px;
    text-align: center;
    color: #666;
}
</style>
