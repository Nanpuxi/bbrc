import { RouteLocationRaw, useRouter } from "vue-router"
import { loginName, passwordResetName, passwordResetQAEditName, registerName, userEmailBindName, userListName } from "./routesNames"

export const useIdentitiesRoutesJump = ()=>{
    const router = useRouter()
    function loginRoute(backAfterSuccess:boolean = true):RouteLocationRaw{
        return {
            name:loginName,
            params:{
                backAfterSuccess: backAfterSuccess ? 'backAfterSuccess' : undefined
            }
        }
    }
    function loginRouteJump(backAfterSuccess:boolean=true){
        router.push(loginRoute(backAfterSuccess))
    }
    function registerRoute():RouteLocationRaw{
        return {
            name:registerName
        }
    }
    function userListRoute(search?:string){
        return {
            name:userListName,
            query:{
                search
            }
        }
    }
    function userEmailBindRoute(isChange?:boolean):RouteLocationRaw{
        return {
            name:userEmailBindName,
            query:{
                isChange: isChange ? '1' : undefined
            }
        }
    }
    function passwordResetRoute():RouteLocationRaw{
        return {
            name:passwordResetName
        }
    }
    function passwordResetQAEditRoute(fromEmailBind?:boolean):RouteLocationRaw{
        return {
            name:passwordResetQAEditName,
            query:{
                fromEmailBind: fromEmailBind ? '1' : undefined
            }
        }
    }
    return { loginRoute, loginRouteJump, registerRoute, userListRoute, userEmailBindRoute, passwordResetRoute, passwordResetQAEditRoute }
}