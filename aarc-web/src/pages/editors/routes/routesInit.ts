import { Router, RouteRecordRaw } from "vue-router";
import { addToRouter } from "@/app/router/addToRouter";
import { editorName, editorParamNameSaveId, kickedName } from "./routesNames";
import { encodeSaveId, shouldEncodeSaveId } from "@/utils/dataUtils/saveIdCodec";
import Editor from "../Editor.vue";
import Kicked from "../Kicked.vue";

export function addEditorsPages(r:Router){
    addToRouter(r, routes);
}

const routes: RouteRecordRaw[] = [
    {
        path:`/Editor/:${editorParamNameSaveId}`,
        props:true,
        component: Editor,
        name:editorName,
        beforeEnter: to => {
            // 旧版纯数字 id 链接：id 达到编码阈值时自动跳转为新版编码链接；低于阈值保持旧URL直接打开
            const raw = to.params[editorParamNameSaveId]
            if(typeof raw !== 'string' || !/^\d{1,9}$/.test(raw))
                return
            const id = parseInt(raw)
            if(shouldEncodeSaveId(id)){
                return {
                    name: editorName,
                    params: { [editorParamNameSaveId]: encodeSaveId(id) },
                    query: to.query
                }
            }
        }
    },
    {
        path:`/Kicked`,
        component: Kicked,
        name:kickedName
    }
]