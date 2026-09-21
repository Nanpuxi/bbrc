<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue';

import ConfigSection from './shared/ConfigSection.vue';
import SideBar from 'aarc-core/components/common/SideBar.vue';
import { loadIconImage, resolveIconUrl, TextTagIconData, useIconStore } from 'aarc-core/models/stores/iconStore';
import { useMainCvsDispatcher } from 'aarc-core/models/cvs/dispatchers/mainCvsDispatcher';
import { TextTagIcon } from 'aarc-core/models/save';
import { useSaveStore } from 'aarc-core/models/stores/saveStore';
import { useUserFileFavoriteStore } from 'aarc-core/models/stores/utils/userFileFavoriteStore';
import { storeToRefs } from 'pinia';

const saveStore = useSaveStore()
const iconStore = useIconStore()
const userFileFavoriteStore = useUserFileFavoriteStore()
const mainCvs = useMainCvsDispatcher()
const rr = ()=>mainCvs.renderMainCvs({})
const { ensureAllLoaded, ensurePrefixSelectedValid, enforcePrefixSelectedTo } = iconStore
const { prefixes, prefixSelected, prefixedIcons, accessBlocked } = storeToRefs(iconStore)

const hideImgs = ref(false) //使img标签强制重新创建，否则无响应式效果
const creatingIcon = ref<TextTagIcon>({id:0})
const iconSidebar = useTemplateRef('iconSidebar')
const creatingPreview = ref<{src:string} & TextTagIconData>()
const createAllowed = computed<boolean>(()=>{
    const i = creatingIcon.value
    return !!i.name && !!i.url
})
async function createIcon(){
    const i = creatingIcon.value
    if(!createAllowed.value || !saveStore.save)
        return
    i.id = saveStore.getNewId()
    i.width = 50
    saveStore.save.textTagIcons ??= []
    saveStore.save.textTagIcons.push(i)
    creatingIcon.value = {id:0}
    creatingPreview.value = undefined
    hideImgs.value = true
    await ensureAllLoaded()
    await nextTick()
    enforcePrefixSelectedTo(i.id)
    hideImgs.value = false
}

async function urlInputBlurHandler(){
    const triedIds = await ensureAllLoaded()
    rerenderIfNeeded(triedIds)
}

async function checkCreatingUrl(){
    const rawUrl = creatingIcon.value.url
    const url = rawUrl?.trim()
    if(rawUrl !== url)
        creatingIcon.value.url = url
    if(!url){
        creatingPreview.value = undefined
        return
    }
    const src = resolveIconUrl(url)
    if(creatingPreview.value?.src === src)
        return
    //写入的是本次预览自己的对象，用户改链接后旧检查只会写到已弃用的对象上
    creatingPreview.value = {src, status:'loading'}
    await loadIconImage(src, url, creatingPreview.value)
}
async function rerenderIfNeeded(iconIds:number[]) {
    if(iconIds.length>0){
        const usedIcons = saveStore.save?.textTags.map(x=>x.icon) ?? []
        if(iconIds.some(id=>usedIcons.includes(id))){
            rr()
        }
    }
}

const ok = ref(false)
onMounted(async()=>{
    await ensureAllLoaded()
    ensurePrefixSelectedValid()
    ok.value = true
})
</script>

<template>
<ConfigSection :title="'文本标签图标'">
    <div v-if="accessBlocked">
        抱歉，本栏目仅限编辑者或所有者查看
    </div>
    <div v-else-if="ok" class="ttIconConfig">
        <div class="iconAddRow">
            <button v-if="userFileFavoriteStore.hasOpenFavoritesSidebar" @click="userFileFavoriteStore.openFavoritesSidebar({ fileType: 'icon' })">从收藏取用资源</button>
            <button @click="iconSidebar?.extend()">从图片链接添加</button>
        </div>
        <div class="ttIconPrefixSelect">
            图标组
            <select v-model="prefixSelected">
                <option v-for="p in prefixes" :value="p">{{ p }}</option>
            </select>
        </div>
        <div class="prefixedIconList">
            <div v-for="item in prefixedIcons" :key="item.i.id">
                <div class="prefixedIconImgAndWidth">
                    <div class="prefixedIconKV">
                        宽度<input v-model.number="item.i.width" style="width: 90px;" :min="10" :max="1000" :step="10"
                            @blur="rerenderIfNeeded([item.i.id])"/>
                    </div>
                    <template v-if="!hideImgs">
                        <img v-if="item.data?.img?.src"
                            :src="item.data?.img?.src"/>
                        <div v-else class="prefixedIconErrmsg">
                            {{ item.data?.errmsg ?? '未知错误' }}
                        </div>
                    </template>
                </div>
                <div class="prefixedIconKV">
                    名称<input v-model.lazy="item.i.name" @blur="enforcePrefixSelectedTo(item.i.id)"/>
                </div>
                <div class="prefixedIconKV">
                    链接<input v-model="item.i.url" style="font-size: 12px;" @blur="urlInputBlurHandler"/>
                </div>
            </div>
        </div>
    </div>
    <div v-else>加载图标文件中，请稍后</div>
</ConfigSection>

<SideBar ref="iconSidebar">
    <h1>从图片链接添加</h1>
    <div class="newIconForm">
        <div class="iconKV">
            名称<input v-model="creatingIcon.name" :placeholder="'组名-图标名'"/>
        </div>
        <div class="iconKV">
            链接<input v-model="creatingIcon.url" style="font-size: 12px;" @blur="checkCreatingUrl"/>
        </div>
        <div class="iconPreview" v-if="creatingPreview">
            <img v-if="creatingPreview.status=='loaded'" :src="creatingPreview.src"/>
            <div v-else-if="creatingPreview.status=='loading'" class="previewNote">检查中…</div>
            <div v-else class="previewErr">{{ creatingPreview.errmsg ?? '加载失败' }}</div>
        </div>
        <button @click="createIcon" :class="createAllowed ? 'ok':'off'">添加</button>
        <div class="smallNote">使用：“工具-创建文本标签”，然后在标签的设置中启用并选择图标</div>
    </div>
</SideBar>
</template>

<style scoped lang="scss">
.ttIconConfig{
    display: flex;
    flex-direction: column;
    align-items: stretch;
}
.iconAddRow{
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin: 10px 0;
    button{
        margin: 0;
        white-space: nowrap;
    }
}
.ttIconPrefixSelect{
    background-color: #ccc;
    color: white;
    align-self: stretch;
    width: unset;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 2px;
    padding: 10px;
    font-size: 18px;
    select{
        min-width: 100px;
        max-width: 180px;
        margin: 0px;
    }
}
.prefixedIconList{
    background-color: #eee;
    padding: 5px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    &>div{
        display: flex;
        align-items: center;
        flex-direction: column;
        border: 2px solid #666;
        padding: 4px;
        border-radius: 10px;
        .prefixedIconImgAndWidth{
            align-self: stretch;
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            .prefixedIconErrmsg{
                color: red;
                align-self: center;
                font-size: 13px;
            }
        }
        .prefixedIconKV{
            display: flex;
            align-items: center;
        }
        img{
            width: 40px;
            height: 40px;
            margin: 5px;
            object-fit: contain;
        }
    }
}
.newIconForm{
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    .iconKV{
        display: flex;
        align-items: center;
        gap: 4px;
        input{
            flex: 1;
            min-width: 0;
        }
    }
    .iconPreview{
        align-self: center;
        min-height: 50px;
        display: flex;
        align-items: center;
        justify-content: center;
        img{
            width: 50px;
            height: 50px;
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
    input::placeholder{
        color: #bbb;
    }
}
</style>