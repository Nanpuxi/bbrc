import { RouteLocationRaw } from "vue-router"
import { editorName, editorParamNameSaveId } from "./routesNames"
import { encodeSaveId, shouldEncodeSaveId } from "@/utils/dataUtils/saveIdCodec"

export const useEditorsRoutesJump = ()=>{
    function editorRoute(saveId:number):RouteLocationRaw{
        return {
            name:editorName,
            params:{
                [editorParamNameSaveId]: shouldEncodeSaveId(saveId) ? encodeSaveId(saveId) : String(saveId)
            }
        }
    }
    return { editorRoute }
}