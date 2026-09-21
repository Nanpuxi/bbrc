import { defineStore, storeToRefs } from "pinia";
import { useSaveStore } from "./saveStore";
import { computed, ref } from "vue";
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

export const useIconStore = defineStore('iconStore', ()=>{
    const saveStore = useSaveStore()
    const { save } = storeToRefs(saveStore)
    const data = ref(new Map<number, TextTagIconData>())
    const accessBlocked = ref(false)
    async function ensureAllLoaded():Promise<number[]>{
        const proms:Promise<void>[] = []
        const icons = save.value?.textTagIcons ?? []
        let triedIds:number[] = []
        for(const ic of icons){
            let imgData = data.value.get(ic.id)
            if(!imgData){
                imgData = {status:'loading'}
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
    const prefixes = computed<string[]>(()=>{
        const res = new Set<string>()
        let hasUngrouped = false
        save.value?.textTagIcons?.forEach(i=>{
            const prefix = getPrefixFromIconName(i.name)
            if(prefix){
                res.add(prefix)
            }else{
                hasUngrouped = true
            }
        })
        const resArr = [...res]
        resArr.sort()
        if(hasUngrouped || res.size === 0)
            resArr.push(noPrefix)
        return resArr
    })
    const prefixSelected = ref<string>()
    const prefixedIcons = computed<TextTagIconDisplayItem[]>(()=>{
        const icons = save.value?.textTagIcons?.filter(x=>{
            const prefix = getPrefixFromIconName(x.name)
            if(prefix === null){
                return prefixSelected.value === noPrefix
            }
            return prefix == prefixSelected.value
        }) ?? []
        const res:TextTagIconDisplayItem[] = []
        icons.forEach(i=>{
            const data = getDataByIconId(i.id)
            res.push({
                i,
                data
            })
        })
        res.sort((a,b)=> (a.i.name??"").localeCompare(b.i.name??""))
        return res
    })

    function getPrefixFromIconName(iName?:string):string|null{
        if(iName?.includes(sep)){
            return iName.split(sep).at(0) || null
        }
        return null
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
        const prefix = getPrefixFromIconName(icon.name)
        prefixSelected.value = prefix ?? noPrefix
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
    }

    return {
        ensureAllLoaded,
        getDataByIconId,
        clearItems,
        prefixes,
        prefixedIcons,
        prefixSelected,
        ensurePrefixSelectedValid,
        enforcePrefixSelectedTo,
        accessBlocked
    }
})