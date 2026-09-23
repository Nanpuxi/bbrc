import { defineStore, storeToRefs } from "pinia";
import { useSaveStore } from "./saveStore";
import { computed, reactive, ref } from "vue";
import { TextTagIcon } from "../save";
import { convertToProxyUrlIfNeeded } from "aarc-core/utils/urlUtils/proxyUrl";
import { checkUrlIsImage } from "aarc-core/utils/urlUtils/checkUrl";
import { useUserFileFavoriteStore } from "./utils/userFileFavoriteStore";
import { UserFileDto } from "aarc-core/models/types/apiShapes";

export interface TextTagIconData{
    img?:HTMLImageElement
    naturalWidth?:number
    naturalHeight?:number
    status?:'loading'|'loaded'|'failed',
    errmsg?:string
}
export interface TextTagIconDisplayItem{
    i:TextTagIcon,
    data?:TextTagIconData
}
export interface TextTagIconGroup{
    prefix:string,
    icons:TextTagIconDisplayItem[]
}

const maxLoadWaitMs = 8000

/**
 * 把存档里写的图标链接换算成实际可请求的地址（站内相对路径补 origin，站外走代理）
 */
export function resolveIconUrl(url: string): string {
    if (url.startsWith('/'))
        return window.location.origin + url
    return convertToProxyUrlIfNeeded(url, 'icon')
}

/**
 * 检查并加载一个图标，结果就地写入 data（img 会在确认链接可用后立即挂上，供预览/列表复用）
 * @param src 已由 resolveIconUrl 换算过的地址
 */
export function loadIconImage(src: string, name: string, data: TextTagIconData): Promise<void> {
    return new Promise((res) => {
        data.status = 'loading'
        checkUrlIsImage(src).then(checkErr => {
            if (checkErr) {
                data.status = 'failed'
                data.errmsg = checkErr
                console.warn(`[icon]"${name}"(${src})${checkErr}`)
                res()
                return
            }
            const img = new Image()
            data.img = img
            img.src = src
            let timer = window.setTimeout(() => {
                data.status = 'failed'
                data.errmsg = '加载超时'
                console.warn(`[icon]"${name}"(${src})数据加载超时`)
                res()
            }, maxLoadWaitMs)
            img?.addEventListener('load', () => {
                window.clearTimeout(timer)
                data.status = 'loaded'
                data.errmsg = undefined
                data.naturalWidth = img.naturalWidth
                data.naturalHeight = img.naturalHeight
                console.log(`[icon]"${name}"(${src})数据加载成功`)
                res()
            })
            img?.addEventListener('error', () => {
                window.clearTimeout(timer)
                data.status = 'failed'
                data.errmsg = '加载失败'
                console.warn(`[icon]"${name}"(${src})数据加载失败`)
                res()
            })
        })
    })
}

/**
 * 表单里"链接一改就检查并预览"的状态。用于还没有存档 id 的新图标，
 * 已有图标直接把 store 缓存里的 TextTagIconData 交给预览即可
 */
export function useIconUrlPreview(){
    const preview = ref<TextTagIconData>()
    let checkedSrc = ''
    async function check(url?:string){
        if(!url){
            preview.value = undefined
            checkedSrc = ''
            return
        }
        const src = resolveIconUrl(url)
        if(src === checkedSrc)
            return
        preview.value = reactive<TextTagIconData>({status:'loading'})
        await loadIconImage(src, url, preview.value)
    }
    return {preview, check}
}

export const useIconStore = defineStore('iconStore', ()=>{
    const saveStore = useSaveStore()
    const { save } = storeToRefs(saveStore)
    const data = ref(new Map<number, TextTagIconData>())
    async function ensureAllLoaded():Promise<number[]>{
        const proms:Promise<void>[] = []
        const icons = save.value?.textTagIcons ?? []
        let triedIds:number[] = []
        for(const ic of icons){
            let imgData = data.value.get(ic.id)
            if(!imgData){
                //必须存 reactive 对象：ref(Map) 里 set 进去的裸对象不会惰性包代理，
                //loadIconImage 完成后就地改 status 不会触发任何依赖，列表项会卡在“检查中”
                imgData = reactive({status:'loading'}) as TextTagIconData
                data.value.set(ic.id, imgData)
            }
            const icUrlFull = resolveIconUrl(ic.url ?? "")
            if(!imgData?.img || !ic.url || imgData?.img.src !== icUrlFull){
                triedIds.push(ic.id)
                if(!ic.url){
                    imgData.status = 'failed'
                    imgData.errmsg = '缺少链接'
                    console.warn(`[icon]"${ic.name}"(${ic.url})缺少链接`)
                }else{
                    proms.push(loadIconImage(icUrlFull, ic.name ?? '', imgData))
                }
            }
        }
        await Promise.all(proms)
        for(const item of data.value.values()){
            if(item.errmsg){
                item.img = undefined
            }
        }
        return triedIds
    }
    function getDataByIconId(id:number){
        return data.value.get(id)
    }
    function clearItems(){
        data.value.clear()
    }

    const sep = '-'
    const noPrefix = '其他'
    function getPrefixFromIconName(iName?:string):string|null{
        if(iName?.includes(sep)){
            return iName.split(sep).at(0) || null
        }
        return null
    }
    function groupNameOfIconName(iName?:string){
        return getPrefixFromIconName(iName) ?? noPrefix
    }
    const iconGroups = computed<TextTagIconGroup[]>(()=>{
        const groups = new Map<string,TextTagIconDisplayItem[]>()
        for(const i of save.value?.textTagIcons ?? []){
            const item:TextTagIconDisplayItem = {i, data: getDataByIconId(i.id)}
            const arr = groups.get(groupNameOfIconName(i.name))
            if(arr)
                arr.push(item)
            else
                groups.set(groupNameOfIconName(i.name), [item])
        }
        // “其他”始终排在最后，其余按组名排序
        const order = (p:string)=> p===noPrefix ? 1 : 0
        return [...groups.entries()]
            .sort((a,b)=> order(a[0])-order(b[0]) || a[0].localeCompare(b[0]))
            .map(([prefix,icons])=>({
                prefix,
                icons: icons.sort((a,b)=> (a.i.name??"").localeCompare(b.i.name??""))
            }))
    })
    const prefixes = computed<string[]>(()=>{
        const res = iconGroups.value.map(g=>g.prefix)
        return res.length ? res : [noPrefix]
    })
    const prefixSelected = ref<string>()
    const prefixedIcons = computed<TextTagIconDisplayItem[]>(()=>{
        return iconGroups.value.find(g=>g.prefix===prefixSelected.value)?.icons ?? []
    })

    const expandedGroups = ref(new Set<string>())
    function toggleGroupExpanded(groupName:string){
        if(expandedGroups.value.has(groupName))
            expandedGroups.value.delete(groupName)
        else
            expandedGroups.value.add(groupName)
    }
    function revealGroupOfIcon(iconId:number){
        const icon = save.value?.textTagIcons?.find(x=>x.id===iconId)
        if(icon)
            expandedGroups.value.add(groupNameOfIconName(icon.name))
    }
    function ensurePrefixSelectedValid(){
        if(!prefixSelected.value || !prefixes.value.includes(prefixSelected.value)){
            prefixSelected.value = prefixes.value.at(0)
        }
    }
    function enforcePrefixSelectedTo(iconId:number){
        if(!prefixSelected.value)
            prefixSelected.value = prefixes.value.at(0)
        const icon = save.value?.textTagIcons?.find(x=>x.id===iconId)
        if(!icon)
            return
        prefixSelected.value = groupNameOfIconName(icon.name)
    }

    const { onFavoriteFileSelected } = storeToRefs(useUserFileFavoriteStore())
    onFavoriteFileSelected.value = async (userFile:UserFileDto)=>{
        if(!save.value) return
        const name = userFile.displayName
        if(!name) return
        const url = userFile.urlOriginal
        if(!url) return
        const absoluteUrl = url.startsWith('/') ? window.location.origin + url : url
        save.value.textTagIcons ??= []
        const existing = save.value.textTagIcons.find(x=>x.name === name)
        let iconId:number
        if(existing){
            if(!window.confirm(`已存在${name}确认要覆盖吗？`))
                return
            existing.url = absoluteUrl
            iconId = existing.id
        }else{
            iconId = saveStore.getNewId()
            save.value.textTagIcons.push({
                id: iconId,
                name,
                url: absoluteUrl,
                width: 50
            })
        }
        await ensureAllLoaded()
        enforcePrefixSelectedTo(iconId)
        revealGroupOfIcon(iconId)
    }

    return {
        ensureAllLoaded,
        getDataByIconId,
        clearItems,
        iconGroups,
        expandedGroups,
        toggleGroupExpanded,
        revealGroupOfIcon,
        prefixes,
        prefixedIcons,
        prefixSelected,
        ensurePrefixSelectedValid,
        enforcePrefixSelectedTo
    }
})