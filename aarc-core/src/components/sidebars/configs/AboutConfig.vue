<script setup lang="ts">
import { onMounted, ref } from 'vue';
import ConfigSection from './shared/ConfigSection.vue';
import { getGitInfo } from 'aarc-core/utils/gitInfo/gitInfoGet';
import { GitInfo } from 'aarc-core/utils/gitInfo/gitInfo';

const licenseText = ref('')
const loadFailed = ref(false)
const gitInfo = ref<GitInfo>()

function processLicenseText(text: string){
    const lines = text.split('\n').map((line)=>line.trimStart())
    const merged: string[] = []
    for (const line of lines) {
        if(!line){
            merged.push('')
        }
        else if(merged.length && merged[merged.length-1] !== ''){
            merged[merged.length-1] += ' ' + line
        }
        else{
            merged.push(line)
        }
    }
    return merged.join('\n')
}

onMounted(()=>{
    fetch('/LICENSE.txt').then((res)=>{
        if(!res.ok)
            throw new Error(`HTTP ${res.status}`)
        return res.text()
    }).then((text)=>{
        licenseText.value = processLicenseText(text)
    }).catch(()=>{
        loadFailed.value = true
    })
    getGitInfo().then((info)=>{
        gitInfo.value = info
    })
})
</script>

<template>
<ConfigSection :title="'关于'">
    <div v-if="gitInfo" class="gitInfo">
        <div>
            分支 {{ gitInfo.branchName }}
            <span class="ver">{{ gitInfo.commitId }}</span>
        </div>
        <div>
            构建于
            <span class="ver">{{ gitInfo.builtAt }}</span>
        </div>
    </div>
    <h3>源码</h3>
    <div class="sources">
        https://github.com/Aurouscia/aarc<br/>
        https://gitee.com/au114514/aarc
    </div>
    <h3>开源许可证</h3>
    <pre v-if="licenseText" class="license">{{ licenseText }}</pre>
    <div v-else-if="loadFailed" class="explain">LICENSE.txt 加载失败</div>
    <div v-else class="explain">加载中……</div>
</ConfigSection>
</template>

<style scoped lang="scss">
.gitInfo{
    text-align: left;
    &>div{
        margin: 10px 0px 10px 0px;
        font-weight: bold;
        font-size: 16px;
    }
    .ver{
        font-size: 14px;
        color: gray;
        font-weight: normal;
    }
}
h3{
    font-size: 16px;
    font-weight: bold;
}
.sources{
    line-height: 2em;
    color: gray;
    font-size: 14px;
}
.license{
    font-size: 14px;
    font-family: lucida console, monospace;
    white-space: pre-wrap;
    word-break: break-all;
    text-align: left;
    max-height: 300px;
    overflow-y: auto;
    margin: 10px 0px 30px;
}
</style>
