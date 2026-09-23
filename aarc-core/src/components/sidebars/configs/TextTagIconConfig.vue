<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue';

import ConfigSection from './shared/ConfigSection.vue';
import IconPreview from './shared/IconPreview.vue';
import SideBar from 'aarc-core/components/common/SideBar.vue';
import { useIconStore, useIconUrlPreview } from 'aarc-core/models/stores/iconStore';
import { useMainCvsDispatcher } from 'aarc-core/models/cvs/dispatchers/mainCvsDispatcher';
import { useResourceAccessStore } from 'aarc-core/models/stores/utils/resourceAccessStore';
import { TextTagIcon } from 'aarc-core/models/save';
import { useSaveStore } from 'aarc-core/models/stores/saveStore';
import { useUserFileFavoriteStore } from 'aarc-core/models/stores/utils/userFileFavoriteStore';
import { debounce } from 'aarc-core/utils/lang/debounce';
import { storeToRefs } from 'pinia';
import foldIcon from 'aarc-core/assets/ui/fold.svg';

const saveStore = useSaveStore()
const iconStore = useIconStore()
const userFileFavoriteStore = useUserFileFavoriteStore()
const mainCvs = useMainCvsDispatcher()
const rr = ()=>mainCvs.renderMainCvs({})
const debouncedRr = debounce(rr, 600)
const { ensureAllLoaded, ensurePrefixSelectedValid, enforcePrefixSelectedTo,
    toggleGroupExpanded, revealGroupOfIcon, getDataByIconId } = iconStore
const { iconGroups, expandedGroups } = storeToRefs(iconStore)
const { iconAccessNotice } = storeToRefs(useResourceAccessStore())

const creatingIcon = ref<TextTagIcon>({id:0})
const addSidebar = useTemplateRef('addSidebar')
const {preview: creatingPreview, check: checkCreatingUrl} = useIconUrlPreview()
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
    const newId = i.id
    creatingIcon.value = {id:0}
    await checkCreatingUrl() //表单已清空，顺带清掉预览
    await ensureAllLoaded()
    enforcePrefixSelectedTo(newId)
    revealGroupOfIcon(newId)
}

const editSidebar = useTemplateRef('editSidebar')
const editingId = ref<number>()
const editingIcon = computed<TextTagIcon|undefined>(()=>
    saveStore.save?.textTagIcons?.find(x=>x.id===editingId.value))
//已有图标的预览直接用 store 里的加载结果，不必另存一份
const editingPreview = computed(()=> editingId.value===undefined
    ? undefined
    : getDataByIconId(editingId.value))
function openEditor(iconId:number){
    editingId.value = iconId
    editSidebar.value?.extend()
}
function editNameBlur(){
    if(editingId.value===undefined)
        return
    //改名可能使图标换组，跟着换组选中并展开，免得它"消失"在收起的组里
    enforcePrefixSelectedTo(editingId.value)
    revealGroupOfIcon(editingId.value)
}
async function urlInputBlurHandler(){
    const triedIds = await ensureAllLoaded()
    rerenderIfNeeded(triedIds)
}
async function rerenderIfNeeded(iconIds:number[]) {
    if(iconIds.length>0){
        const usedIcons = saveStore.save?.textTags.map(x=>x.icon) ?? []
        if(iconIds.some(id=>usedIcons.includes(id))){
            rr()
        }
    }
}

// 图标数据的任何变化（本组件的增删改、收藏取用、数据源加载等）都要算作“未保存”的编辑。
// 图标不一定被画布上已有的标签引用，因此不能只靠各处按需重绘，统一由这个 watch 触发重绘
watch(()=>saveStore.save?.textTagIcons, ()=>debouncedRr(), {deep:true})

const ok = ref(false)
onMounted(async()=>{
    await ensureAllLoaded()
    ensurePrefixSelectedValid()
    ok.value = true
})
</script>

<template>
<ConfigSection :title="'文本标签图标'">
    <div v-if="iconAccessNotice">{{ iconAccessNotice }}</div>
    <div v-else-if="ok" class="ttIconConfig">
        <div class="iconAddRow">
            <button v-if="userFileFavoriteStore.hasOpenFavoritesSidebar" @click="userFileFavoriteStore.openFavoritesSidebar({ fileType: 'icon' })">从收藏取用资源</button>
            <button @click="addSidebar?.extend()">从图片链接添加</button>
        </div>
        <div class="iconGroups">
            <div class="iconGroup" :class="{shown:expandedGroups.has(g.prefix)}" v-for="g in iconGroups" :key="g.prefix">
                <div class="groupHeader" @click="toggleGroupExpanded(g.prefix)">
                    <img class="groupFoldIcon" :src="foldIcon"/>
                    <div class="groupName">{{ g.prefix }}</div>
                    <div class="groupCount">{{ g.icons.length }} 个</div>
                </div>
                <div class="groupBody" v-if="expandedGroups.has(g.prefix)">
                    <div class="iconItem" v-for="item in g.icons" :key="item.i.id">
                        <IconPreview :data="item.data"/>
                        <div class="iconWidth">
                            宽度<input v-model.number="item.i.width" :min="10" :max="1000" :step="10"
                                @blur="rerenderIfNeeded([item.i.id])"/>
                        </div>
                        <button @click="openEditor(item.i.id)" class="lite">编辑</button>
                    </div>
                </div>
            </div>
            <div v-if="iconGroups.length===0" class="noIcons">
                还没有图标，用上面的按钮添加
            </div>
            <div v-else class="smallNote">使用：“工具-创建文本标签”，然后在标签的设置中启用并选择图标</div>
        </div>
    </div>
    <div v-else>加载图标文件中，请稍后</div>
</ConfigSection>

<SideBar ref="addSidebar">
    <h1>从图片链接添加</h1>
    <div class="iconForm">
        <div class="iconKV">
            名称<input v-model="creatingIcon.name" :placeholder="'组名-图标名'"/>
        </div>
        <div class="iconKV">
            链接<input v-model.trim="creatingIcon.url" style="font-size: 12px;" @blur="checkCreatingUrl(creatingIcon.url)"/>
        </div>
        <IconPreview class="centerPreview" :data="creatingPreview"/>
        <button @click="createIcon" :class="createAllowed ? 'ok':'off'">添加</button>
    </div>
</SideBar>

<SideBar ref="editSidebar">
    <h1>图标编辑</h1>
    <div class="iconForm" v-if="editingIcon">
        <IconPreview class="centerPreview" :data="editingPreview"/>
        <div class="iconKV">
            宽度<input v-model.number="editingIcon.width" :min="10" :max="1000" :step="10"
                @blur="rerenderIfNeeded([editingIcon.id])"/>
        </div>
        <div class="iconKV">
            名称<input v-model.lazy="editingIcon.name" :placeholder="'组名-图标名'" @blur="editNameBlur"/>
        </div>
        <div class="iconKV">
            链接<input v-model.trim="editingIcon.url" style="font-size: 12px;" @blur="urlInputBlurHandler"/>
        </div>
        <div class="smallNote" style="text-align: center;">名称中的“组名-”前缀决定它属于哪个图标组</div>
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
.iconGroups{
    padding: 5px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    .iconGroup{
        display: flex;
        flex-direction: column;
        align-items: stretch;
        border-radius: 10px;
        box-shadow: 0px 0px 5px 0px #ccc;
        background-color: #eee;
        border: 2px solid #eee;
        overflow: visible;
        &:first-child{
            margin-top: 0px;
        }
        &.shown{
            border-color: #666;
            .groupFoldIcon{
                transform: rotate(180deg);
            }
        }
    }
    .groupHeader{
        display: flex;
        align-items: center;
        gap: 6px;
        height: 30px;
        padding: 5px;
        color: #333;
        font-size: 16px;
        cursor: pointer;
        user-select: none;
        .groupFoldIcon{
            width: 20px;
            height: 20px;
        }
        .groupName{
            flex: 1;
            word-break: break-all;
        }
        .groupCount{
            font-size: 12px;
            color: #666;
        }
    }
    .groupBody{
        background-color: white;
        padding: 8px;
        border-radius: 0px 0px 8px 8px; // 外层容器的radius - 边框宽度
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 6px;
        .iconItem{
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 6px;
            border-radius: 8px;
            .iconWidth{
                display: flex;
                align-items: center;
                gap: 2px;
                flex: 1;
                font-size: 13px;
                color: #aaa;
                input{
                    width: 70px;
                    border-radius: 0px;
                    border: 0px;
                    border-bottom: 1px solid #ccc;
                    margin: 0px;
                }
            }
        }
    }
    .noIcons{
        font-size: 13px;
        color: #999;
        padding: 10px;
    }
}
.iconForm{
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0px;
    .iconKV{
        display: flex;
        align-items: center;
        gap: 4px;
        input{
            flex: 1;
            min-width: 0;
        }
    }
    input::placeholder{
        color: #bbb;
    }
}
.centerPreview{
    align-self: center;
    margin: 10px 0px;
}
</style>
