import { useConfigStore } from "aarc-core/models/stores/configStore";
import { storeToRefs } from "pinia";
import { computed, ref, Ref } from "vue";
import { convertPinyinLocal, toPinyinOptions, type PinyinConvertOptions } from "./pinyinConverter";
import { resolvePinyinConvert } from "aarc-core/models/pinyinPreset";
import { useUniqueComponentsStore } from "aarc-core/app/globalStores/uniqueComponents";

type TargetRef = Ref<string|undefined|null>
/**
 * @param getPresetRef 返回当前站名/标签引用的拼音转换预设名。
 * undefined 表示跟随存档默认设置，null 表示此项不转换。
 * 必须在调用时读取（选项面板会就地改同一个活对象，且 targetPtId 会变），所以传闭包而不是值。
 */
export const usePinyinConvert = (source:TargetRef, dest:TargetRef, afterDone:()=>void, getPresetRef?:()=>string|null|undefined)=>{
    const { config } = storeToRefs(useConfigStore())
    const { showPop } = useUniqueComponentsStore()
    const overridingForSource = ref<string>()
    const overridingToDest = ref<string>()
    const overridingReady = computed<boolean>(()=>!!source.value && overridingForSource.value === source.value)
    const options = computed<PinyinConvertOptions|undefined>(()=>{
        const c = resolvePinyinConvert(
            getPresetRef?.(),
            config.value.pinyinConvertPresets,
            config.value.pinyinConvert)
        if(!c)
            return undefined
        return toPinyinOptions(c)
    })
    const pinyinBlocked = computed(()=>getPresetRef !== undefined && !options.value)
    async function convertPinyin(){
        if(!source.value)
            return
        const opt = options.value
        if(!opt){
            showPop('此项设置为不转换', 'info')
            return
        }
        let res:string|undefined|null
        if(overridingReady.value && overridingToDest.value){
            //若现在已经是二次点击，则无需重新转换
            res = overridingToDest.value
        }
        else{
            res = await convertPinyinLocal(source.value, opt)
        }
        const apply = ()=>{
            overridingForSource.value = undefined
            overridingToDest.value = undefined
            dest.value = res
            afterDone()
        }
        if(res){
            if(dest.value){
                //目标Ref已经有值，判断是否覆盖
                if(res === dest.value){
                    return //目标Ref的值和结果一样：什么都不做
                }
                if(!overridingReady.value){
                    //“确认”值和源不同：把“确认”值设为源（要求二次点击）
                    overridingForSource.value = source.value
                    overridingToDest.value = res //记录结果，可避免重复获取
                }else{
                    //“确认”值和源相同：应用
                    apply()
                }
            }else{
                //目标Ref没值，应用
                apply()
            }
        }
    }
    return {
        convertPinyin,
        pinyinOverriding: overridingReady,
        pinyinBlocked
    }
}
