<script setup lang="ts">
import Pop from './components/common/Pop.vue';
import Wait from './components/common/Wait.vue';
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents';
import { storeToRefs } from 'pinia';
import TopbarParent from './components/common/topbar/TopbarParent.vue';
import Footer from './components/common/Footer.vue';
import { onMounted, useTemplateRef } from 'vue';
import { useApiStore } from './app/com/apiStore';
import { initCloudSvgUploader } from 'aarc-core/models/save/cloudSvgOps';
import { initPinyinConvertProvider } from 'aarc-core/components/composables/usePinyinConvert';
import { initSaveInfoProvider } from 'aarc-core/components/sidebars/export/composables/useImageExport';
import { initSiteLinks } from 'aarc-core/app/siteLinks';
import { useRouter } from 'vue-router';
import { aboutName } from './pages/identities/routes/routesNames';
import { forkAarcName } from './pages/etc/routes/routesNames';

const uniq = useUniqueComponentsStore()
const { topbarShow } = storeToRefs(uniq)
const api = useApiStore()
const router = useRouter()

const pop = useTemplateRef('pop')
const wait = useTemplateRef('wait')
onMounted(()=>{
    uniq.initCallbacks({
        popCallback: (msg, type)=>{
            pop.value?.show(msg, type)
        },
        waitCallback: (reason, value)=>{
            wait.value?.setShowing(reason, value)
        }
    })
    initCloudSvgUploader(async (saveId, svgBlob)=>{
        const res = await api.saveSvg.upload(saveId, {data: svgBlob, fileName: 'latest.svg'})
        return res === true
    })
    initPinyinConvertProvider(req => api.saveUtils.pinyinConvert(req))
    initSaveInfoProvider(saveId => api.save.loadInfo(saveId))
    initSiteLinks({
        about: router.resolve({ name: aboutName }).href,
        forkAarc: router.resolve({ name: forkAarcName }).href
    })
})
</script>

<template>
<TopbarParent v-if="topbarShow"></TopbarParent>
<div class="mainOuter">
    <div class="main">
        <RouterView></RouterView>
        <Footer v-if="topbarShow"></Footer>
    </div>
</div>
<Pop ref="pop"></Pop>
<Wait ref="wait"></Wait>
</template>

<style scoped lang="scss">
@use '@/styles/globalValues';

.mainOuter{
    width: 100vw;
    position: absolute; //只能absolute不能fixed
    top: globalValues.$topbar-height;
    height: globalValues.$body-height;
    transition: 0s;
    overflow: auto;
}

.main{
    width: calc(100vw - 2 * globalValues.$mainDivLRMargin);
    margin: auto;
    margin-top: 0px;
    height: globalValues.$body-height;
    box-sizing: border-box;
    max-width: 1400px;
    transition: 0s;
}
</style>