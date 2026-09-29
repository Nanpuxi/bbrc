<script setup lang="ts">
import Cvs from 'aarc-core/components/Cvs.vue';
import Menu from 'aarc-core/components/Menu.vue';
import UnsavedLeavingWarning from '@/components/common/UnsavedLeavingWarning.vue';
import DontUseWeirdBrowser from './components/DontUseWeirdBrowser.vue';
import { useSaveStore } from 'aarc-core/models/stores/saveStore';
import { useEnvStore } from 'aarc-core/models/stores/envStore';
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents';
import { storeToRefs } from 'pinia';
import { computed, nextTick, onBeforeMount, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { devSave } from '@/data/dev/devSave';
import { useApiStore } from '@/app/com/apiStore';
import { usePreventLeavingUnsavedStore, initRouteGuardRegistrar } from 'aarc-core/utils/eventUtils/preventLeavingUnsaved';
import { useMainCvsDispatcher } from 'aarc-core/models/cvs/dispatchers/mainCvsDispatcher';
import { loadSaveIntoEditor, disposeEditor, prepareSavePayload, DataSourceUpdateEvents } from 'aarc-core/app/editorSession';
import rfdc from 'rfdc';
import { useUserInfoStore } from '@/app/globalStores/userInfo';
import { ShortcutListener } from '@aurouscia/keyboard-shortcut'
import { useMiniatureCvsDispatcher } from 'aarc-core/models/cvs/dispatchers/miniatureCvsDispatcher';
import { useCachePreventer } from '@/utils/timeUtils/cachePreventer';
import { DocumentHiddenLongWatcher } from '@/utils/eventUtils/documentHiddenLong';
import HiddenLongWarnPrompt from './components/HiddenLongWarnPrompt.vue';
import HeartbeatFailWarnPrompt from './components/HeartbeatFailWarnPrompt.vue';
import { useHeartbeatStatusStore } from '@/app/globalStores/heartbeatStatus';
import WarnRulePrompts from './components/WarnRulePrompts.vue';
import ChatRoom from '@/pages/chat/ChatRoom.vue';
import UserFileFavorites from '@/components/common/userFile/UserFileFavorites.vue';
import { useTemplateRef } from 'vue';
import { compressObjectToGzip } from '@/utils/dataUtils/compressObjectToGzip';
import { useLoadedSave } from '@/models/stores/utils/loadedSave';
import { setCurrentSaveIdRaw } from 'aarc-core/models/save/currentSaveId';
import { decodeSaveId } from '@/utils/dataUtils/saveIdCodec';
import { HttpUserInfo, SaveDto, SavePreflightStatus } from '@/app/com/apiGenerated';
import { useSavingDisabledWarningStore } from './components/savingDisabledWarningStore';
import SavingDisabledWarning from './components/SavingDisabledWarning.vue';
import { useSavesRoutesJump } from '../saves/routes/routesJump';
import { useEnteredCanvasFromStore } from '@/app/globalStores/enteredCanvasFrom';
import { useSignalrStore } from '@/app/com/signalrStore';
import { useCollabSessionStore } from 'aarc-core/models/collab/collabSessionStore';
import { initAfterRemoteSaveApplied } from 'aarc-core/models/collab/remoteOpApplier';
import { hasUnsavedSaveDataRevision, markSaveDataSaved } from 'aarc-core/models/collab/saveDataRevision';
import CollabStatusOverlay from './components/CollabStatusOverlay.vue';
import CollabPanel from './components/CollabPanel.vue';
import { useKickedFromCanvasStore } from '@/app/globalStores/kickedFromCanvas';
import { KICK_PROMPT_WAIT_MS } from '@/pages/chat/consts';
import { throttle } from '@/utils/lang/throttle';
import { useUndoStore } from 'aarc-core/models/stores/utils/undoStore';
import { isFocusingInput } from 'aarc-core/utils/domUtils/focusingInput';
import { renderAndUploadCloudSvg } from 'aarc-core/models/save/cloudSvgOps';
import { kickedName } from './routes/routesNames.ts';

const heartbeatIntervalSecs = 3 * 60 // 每3分钟心跳一次
const heartbeatOnEditMinIntervalMs = 60 * 1000 // 编辑活动触发的心跳，一分钟内最多一次

const props = defineProps<{saveId:string}>()
// 路由参数可能是新版编码串或旧版纯数字，统一解码为数值id（demo 等非数值场景为 NaN）
const saveIdNum = computed(()=>decodeSaveId(props.saveId) ?? NaN)
// 把当前存档 id 提供给 core（core 不直接读 route）；能解码出数值id时传数字字符串，否则原样传（如 demo）
watch(() => props.saveId, id => {
    const num = decodeSaveId(id)
    setCurrentSaveIdRaw(num === undefined ? id : String(num))
}, { immediate: true })
const router = useRouter()
// 把路由守卫注册能力注入 core（core 不直接用 vue-router）
initRouteGuardRegistrar(guard => router.beforeEach(guard))
const { someonesSavesRoute } = useSavesRoutesJump()
const enteredFromStore = useEnteredCanvasFromStore()
const { goBackToWhereWeEntered } = enteredFromStore
const uniq = useUniqueComponentsStore()
const { showPop } = uniq
const { topbarShow } = storeToRefs(uniq)
const saveStore = useSaveStore()
const envStore = useEnvStore()
const undoStore = useUndoStore()
const api = useApiStore()
const userInfoStore = useUserInfoStore()
const signalrStore = useSignalrStore()
const kickedFromCanvasStore = useKickedFromCanvasStore()
const chatRoom = useTemplateRef('chatRoom')
const collabPanel = useTemplateRef('collabPanel')
const { loadedSave } = storeToRefs(useLoadedSave())
const loadComplete = ref(false)
const mainCvsDispatcher = useMainCvsDispatcher()
const miniatureCvsDispatcher = useMiniatureCvsDispatcher()
const isDemo = computed(()=>props.saveId.toLowerCase() == 'demo')
const viewOnly = ref(false)
const loadError = ref<string>()
const ownerUserInfo = ref<{userId: number, userName: string}>()
const savingDisabledWarningStore = useSavingDisabledWarningStore()

const saveStatus = ref<SaveDto>()
const chatEnabled = computed(() => saveStore.save?.meta.chatEnabled === true)
const isSaveOwner = computed(() => {
    const currentUserId = userInfoStore.userInfo?.id
    return !!currentUserId && currentUserId === ownerUserInfo.value?.userId
})
function enableChat(){
    if(!saveStore.save) return
    saveStore.save.meta.chatEnabled = true
    signalrStore.clearDisabledRoom(saveIdNum.value.toString())
    preventLeaving()
}
async function disableChat(){
    if(!window.confirm('确认关闭聊天功能？')) return
    if(!saveStore.save) return
    const success = await signalrStore.disableChat(saveIdNum.value.toString())
    if(!success) return
    saveStore.save.meta.chatEnabled = false
    await saveData(false)
}
function onKicked(){
    releasePreventLeaving()
    router.replace({name:kickedName})
}
async function handleSaveAndKick(){
    if(await saveData(false)){
        onKicked()
    }
}

async function load() {
    if(!isNaN(saveIdNum.value)){
        if(kickedFromCanvasStore.isStillKicked(saveIdNum.value, KICK_PROMPT_WAIT_MS)){
            router.replace({name: kickedName})
            return
        }
    }
    loadedSave.value = true
    if(!isNaN(saveIdNum.value)){
        const userInfo = await userInfoStore.getIdentityInfo(true)
        const preRes = await api.save.preflight(saveIdNum.value)
        if(!preRes)
            return
        ownerUserInfo.value = { userId: preRes.ownerUserId ?? 0, userName: preRes.ownerName ?? ''}
        if(preRes.status == SavePreflightStatus.NotFound){
            loadError.value = '未找到指定存档，请核对链接是否正确'
            return
        }
        if(preRes.status == SavePreflightStatus.ViewBlocked){
            loadError.value = '根据权限设置，无法查看本存档'
            return
        }
        if(preRes.status == SavePreflightStatus.ViewOnly){
            if(!viewOnly.value){
                console.log('根据preflight结果，已设为viewOnly模式')
                viewOnly.value = true
            }
            savingDisabledWarningStore.setWarning('当前为仅浏览模式，无法保存更改', true)
        }
        // Occupied（他人在编辑）时的协作判定（backend-plan §7.1）：协作房间只能由存档所有者开启，
        // 房间存在 ⟺ 持有心跳者在房内协作。开关开 + preflight 报告房间活跃 → 以协作者身份加入；
        // 开关开但无房间 → 持有心跳者是独占编辑的 solo 用户（如非所有者先进入占用心跳），
        // 此时开房/加入均无意义且会错误接管保存权 → 回退协作前的仅浏览；
        // 开关关或未启用协作 → 仅浏览；房间加入失败时也回退仅浏览

        await checkLoginLeftTime(userInfo)
        
        const notOwner = !userInfo.id || userInfo.id !== ownerUserInfo.value?.userId
        let resp
        try{
            // Occupied 时不能用 forEdit 加载（会触发 Initialization 心跳抢占）：
            // 协作者不触碰心跳，加载数据后通过协作房间同步编辑内容
            const loadForEdit = !viewOnly.value && preRes.status != SavePreflightStatus.Occupied
            resp = await api.save.loadData(saveIdNum.value, loadForEdit)
        }
        catch{
            return // http失败：中止加载，避免cvs出现
        }
        try{
            const obj = resp ? JSON.parse(resp) : undefined
            const collabJoinable = obj?.meta?.collabEnabled === true && preRes.collabRoomActive === true
            if(preRes.status == SavePreflightStatus.Occupied && !collabJoinable){
                if(!viewOnly.value){
                    console.log('他人编辑中且未启用多人协作，已设为viewOnly模式')
                    viewOnly.value = true
                }
                savingDisabledWarningStore.setWarning(`当前有其他用户在编辑，无法保存更改\n占用者：${preRes.editingByUserName ?? '??'}`)
                savingDisabledWarningStore.editingUserId = preRes.editingByUserId ?? 0
            }
            //浏览模式且不是所有者：文案即屏蔽理由，三处可各给各的，这里暂时共用
            await loadSaveIntoEditor(obj, {
                visitorMode: viewOnly.value || notOwner,
                iconAccessNotice: (viewOnly.value && notOwner) ? '抱歉，本栏目仅限编辑者或所有者查看' : undefined,
                dataSourcesAccessNotice: notOwner ? '抱歉，本栏目仅限所有者使用' : undefined,
                uploadAccessNotice: notOwner ? '抱歉，本栏目仅限所有者使用' : undefined,
                onDataSourceEvent: dataSourceEventLoggers
            })
            loadComplete.value = true
            // 数据版本基线：此刻加载的数据即云端状态；其后协作追赶应用的 op 才算未保存改动
            markSaveDataSaved()
        }catch{
            showPop('存档损坏，请联系管理员', 'failed')
            return
        }
        if(viewOnly.value){
            preventLeavingDisabled.value = true //浏览模式，不阻止未保存退出
        }
        else{
            if(preRes.status != SavePreflightStatus.Occupied)
                startHeartbeat() // loadData(forEdit) 已完成 Initialization 心跳
            // 仅当存档启用了多人协作功能时才加入协作房间（开关见 CollabPanel）；
            // Occupied 时只有"开关开 + 房间活跃"才会走到这里（无房间已在上方回退仅浏览，不会误开房）；
            // 非所有者在 preflight 报告无活跃房间时也不尝试进房：服务器必拒绝（仅存档所有者可开房），
            // 徒增一次 SignalR 连接建立，且失败会误触发"会话异常结束"刷新
            if(saveStore.save?.meta.collabEnabled === true && (!notOwner || preRes.collabRoomActive === true))
                await joinCollabRoom()
        }
        // 加载完成后获取状态（warn/rule信息）
        const statusRes = await api.save.loadStatus(saveIdNum.value, true)
        if(statusRes && !enteredFromStore.isCommentPromptChecked(saveIdNum.value)){
            saveStatus.value = statusRes
        }
        // loadStatus 完成后再启动 SignalR，避免 negotiate 与关键加载请求竞争 HTTP 连接
        await nextTick()
        chatRoom.value?.initChatConnection()
    }
    else if(isDemo.value){
        await loadSaveIntoEditor(deepClone(devSave), {
            visitorMode: false,
            onDataSourceEvent: dataSourceEventLoggers
        })
        loadComplete.value = true
        savingDisabledWarningStore.setWarning('此处为体验环境，不能保存\n如需创作，请注册账户并新建存档', true)
        preventLeavingDisabled.value = true //demo环境，不阻止未保存退出
    }
}

const dataSourceEventLoggers: DataSourceUpdateEvents = {
    onLoad: (ds) => {
        console.log('[Editor] 自动更新加载:', ds.name, 'type:', ds.type)
    },
    onDone: (ds, report) => {
        console.log('[Editor] 自动更新完成:', ds.name, 'report:', report)
    },
    onError: (ds, errmsg)=>{
        console.warn(`[数据源自动更新]"${ds.name}"失败: ${errmsg}`)
    }
}

const deepClone = rfdc()
const preventLeaveStore = usePreventLeavingUnsavedStore()
const { preventLeaving, releasePreventLeaving } = preventLeaveStore
const { showUnsavedWarning, preventLeavingDisabled } = storeToRefs(preventLeaveStore)
let lastSavedTime = 0
async function saveData(mustBackup:boolean):Promise<boolean>{
    //协作会话的保存门：保存责任人 = 房主（心跳持有者）
    if(collabSession.isInSession){
        if(!collabSession.isOwner){
            showPop('多人协作中，由房主负责保存', 'failed')
            return false
        }
        if(!heartbeatActive){
            showPop('正在接管保存权，请稍后再试', 'failed')
            return false
        }
    }
    if(lastSavedTime + 1000 > Date.now()){
        console.warn('保存过于频繁（1秒内），已忽略本次保存请求')
        return false
    }
    lastSavedTime = Date.now()
    const savePayload = prepareSavePayload() // core 侧：配置写回 + 站名坐标截断
    if(isNaN(saveIdNum.value)){
        if(import.meta.env.DEV){
            const saveCopy = deepClone(savePayload)
            console.log(saveCopy)
        }
        showPop('此处不能保存', 'failed')
        return false
    }
    const staCount = saveStore.getStaCount()
    const lineCount = saveStore.getLineCount()

    let resp:boolean|undefined = false
    let blob:Blob|'notSupported';
    try{  
        blob = await compressObjectToGzip(savePayload??{})
    }
    catch(err){
        blob = 'notSupported'
        console.warn('存档数据压缩失败，使用原版保存机制', err)
    }
    if(blob instanceof Blob && blob.size > 0){
        resp = await api.save.updateDataCompressed(saveIdNum.value, {fileName:'data', data:blob}, staCount, lineCount, mustBackup)
    }
    else{
        //若blob不是Blob（浏览器不支持压缩或出了问题）则直接明文保存
        const data = JSON.stringify(savePayload??{})
        resp = await api.save.updateData(saveIdNum.value, false, data, staCount, lineCount, mustBackup)
    }
    if(resp){
        releasePreventLeaving()
        markSaveDataSaved() // 数据版本基线：当前数据已落库，之后的版本递增才算未保存
        chatRoom.value?.resetSaveReminderTimer()
        showPop('保存成功', 'success')
        collabSession.notifySaved() // 协作中我是房主：广播"已保存"，其他人弹窗

        //次要任务：更新缩略图，无论是否成功都不影响主流程
        const miniCvs = miniatureCvsDispatcher.renderMiniatureCvs({sideLength: 256, lineWidth: 2})
        const miniBlob = await miniCvs.convertToBlob()
        await api.save.updateMiniature(saveIdNum.value, {data:miniBlob, fileName:'mini.png'})

        //次要任务：根据设置自动更新云端SVG，不影响主流程
        if(saveStore.save?.meta.autoUpdateCloudSvg?.enabled === true){
            await renderAndUploadCloudSvg(saveIdNum.value)
            showPop('已更新云端SVG', 'success')
        }

        //重新初始化心跳定时器周期，因为“保存”本身会触发一次心跳续约
        endHeartbeat()
        startHeartbeat()
        return true
    }
    return false
}

const notLogin = ref<boolean>()
async function checkLoginLeftTime(userInfo:HttpUserInfo){
    const nearExpireMsg = '登录即将过期\n尽快重新登录'
    const noLoginMsg = '当前没有登录\n不能保存'
    if(!userInfo.leftHours){
        notLogin.value = true
        savingDisabledWarningStore.setWarning(noLoginMsg, true)
        savingDisabledWarningStore.notLogin = true
        preventLeavingDisabled.value = true //未登录：不阻止未保存退出（也没法保存）
    }
    else if(userInfo.leftHours <= 6){
        showPop(nearExpireMsg, 'warning')
        savingDisabledWarningStore.setWarning(nearExpireMsg)
        window.setTimeout(()=>{
            showPop('否则将无法保存', 'warning')
        }, 3000)
    }
}

function setLeavingPreventing(){
    //将“主画布重新渲染”当成“存档信息变化”，当主画布重新渲染时，阻止用户离开/刷新页面/关闭页面
    //（undo 入栈已由 core 在 notifyMainCvsRendered 内处理）
    // 保存责任人 = 房主（见下方协作接线）：协作中的非房主既不显示保存按钮也不阻止离开，
    // 未保存标记仅由房主承担（协作者的更改经 op 同步给房主保存）
    const preventLeavingIfSaveResponsible = () => {
        if(!collabSession.isInSession || collabSession.isOwner)
            preventLeaving()
    }
    // 协作会话内"渲染 ≠ 改动"：补渲染迟到（远程 op 的渲染被节流推迟到保存之后）、
    // 图标/参考图加载完成等都会触发无关渲染，须以数据版本为准，避免未保存标记被重新置位
    const preventLeavingIfUnsavedAndResponsible = () => {
        if(collabSession.isInSession && !hasUnsavedSaveDataRevision())
            return
        preventLeavingIfSaveResponsible()
    }
    mainCvsDispatcher.initAfterMainCvsRendered(() =>{
        if(savingDisabledWarningStore.needToWarn){
            savingDisabledWarningStore.onFirstEdit()
        }
        preventLeavingIfUnsavedAndResponsible()
        heartbeatOnEdit?.()
    })
    // 远程 op 数据应用即时、渲染被 remoteRenderScheduler 节流（≤idleMs/交互结束才补渲染）——
    // 未保存标记直接跟随数据应用（保存按钮/红点即时出现），不等被推迟的那次渲染
    initAfterRemoteSaveApplied(() => {
        if(savingDisabledWarningStore.needToWarn){
            savingDisabledWarningStore.onFirstEdit()
        }
        preventLeavingIfSaveResponsible() // 远程 op 应用即真实数据变化（版本号已递增）
    })
}

let heartbeatTimer = 0
// 心跳当前是否由我持有（协作协作者不持有心跳；onBeforeUnmount 据此决定是否释放）
let heartbeatActive = false
const heartbeatFailWarnMs = 6 * 60 * 1000 // 距上次成功心跳超过该时长后再失败则弹出警告
const showHeartbeatFailWarn = ref(false)
const heartbeatStolenWarn = ref(false) // true：心跳已被他人接管；false：网络问题导致多次失败
const heartbeatStatusStore = useHeartbeatStatusStore()
// 所有续约心跳的统一入口：记录上次成功时间；失败时先鉴别原因，再分别处理
async function renewHeartbeat(){
    const ok = await api.save.heartbeatRenewal(saveIdNum.value)
    if(ok){
        heartbeatStatusStore.markSuccess()
        return
    }
    if(await isHeartbeatStolen()){
        // 心跳已被他人抢走：续约不可能再成功，停止心跳以免持续报错，并弹出“被接管”警告
        // （与被所有者请出语义不同，不复用 onKicked，留在原页面以便用户自行备份未保存内容）
        endHeartbeat()
        heartbeatStolenWarn.value = true
        showHeartbeatFailWarn.value = true
        return
    }
    // 其他失败（断网等）：距上次成功过久时弹出警告
    if(heartbeatStatusStore.sinceLastSuccessMs() > heartbeatFailWarnMs){
        showHeartbeatFailWarn.value = true
    }
}
// 续约失败时鉴别是否“心跳已被抢”：loadStatus 能查到“他人在编辑”即为被抢；
// 查不到占用者（或 loadStatus 本身也失败）则说明是网络等其他问题
async function isHeartbeatStolen():Promise<boolean>{
    const status = await api.save.loadStatus(saveIdNum.value, false)
    if(!status || !status.editingByUserId)
        return false
    return status.editingByUserId !== userInfoStore.userInfo?.id
}
// 编辑活动本身也是在场证明：画布重新渲染（即发生编辑）时触发一次续约心跳，
// 防止定时器被 webview/系统冻结导致的心跳误判（一分钟内最多一次）
// 仅在 startHeartbeat 时（即确定处于可编辑模式后）才赋值，未赋值说明不可编辑，无需发送
let heartbeatOnEdit: (() => void) | undefined
function startHeartbeat(){
    // 开始心跳续约周期（不需要立即执行一次，因为loadData相当于已经执行过一次）
    heartbeatActive = true
    heartbeatStatusStore.markSuccess()
    heartbeatTimer = window.setInterval(async()=>{
        await renewHeartbeat()
    }, heartbeatIntervalSecs * 1000)
    heartbeatOnEdit ??= throttle(()=>{
        renewHeartbeat()
    }, heartbeatOnEditMinIntervalMs)
    document.addEventListener('visibilitychange', onVisibleHeartbeat)
}
function endHeartbeat(){
    // 结束心跳续约周期
    heartbeatActive = false
    window.clearInterval(heartbeatTimer)
    document.removeEventListener('visibilitychange', onVisibleHeartbeat)
}
function onVisibleHeartbeat(){
    // 页面重新可见时立即补发一次续约心跳（隐藏期间定时器可能已被 webview/系统冻结）
    if(document.visibilityState === 'visible')
        renewHeartbeat()
}

// ---- 多人协作接线（步骤四 4.6）----
// 规则：保存责任人 = 房主（collabSession.isOwner）；房主 = 心跳持有者，二者保持同步——
// 是房主但没心跳 → ensureOwnerHeartbeat 轮询接管；不是房主却有心跳 → 释放
const collabSession = useCollabSessionStore()
let leavingEditor = false // 卸载中的 leave 不触发"会话异常结束"处理
let collabWarningSet = false // 当前警告条是本模块设置的（clearWarning 才不误清别的警告）
let ownerHeartbeatRetryTimer: number|undefined

async function joinCollabRoom(){
    if(await tryJoinCollabRoom())
        return
    // 加入失败（无权限/房间满/服务器不支持等）：回退仅浏览
    console.error('[协作]加入房间失败，回退仅浏览')
    viewOnly.value = true
    preventLeavingDisabled.value = true
    savingDisabledWarningStore.setWarning('加入协作房间失败，已转为仅浏览（刷新可重试）', true)
    showPop('加入协作房间失败', 'failed')
}

/** 加入协作房间；失败返回 false（调用方决定回退策略） */
async function tryJoinCollabRoom(): Promise<boolean>{
    try{
        await collabSession.join(saveIdNum.value)
    }catch(e){
        const msg = e instanceof Error ? e.message : String(e)
        if(msg.includes('仅存档所有者可开启协作')){
            // 预期拒绝（backend-plan §7.1）：协作开关开着但房间未启动（所有者不在线）。
            // 非所有者不启动协作机制：已持心跳（非 Occupied 正常打开）按普通编辑继续；
            // 未持心跳（如 Occupied 回退加载）维持下方"回退仅浏览"逻辑
            if(heartbeatActive){
                console.info('[协作]协作房间未启动（所有者不在线），以普通编辑模式继续')
                updateCollabWarning()
                return true
            }
        }
        console.error('[协作]加入房间失败', e)
        return false
    }
    if(collabSession.isOwner){
        // 通常心跳已在 loadData(forEdit) 时持有；空房但心跳未过期被他人残留占用时走接管
        await ensureOwnerHeartbeat()
    }
    else if(heartbeatActive){
        // 防御：协作者不持有心跳（如 loadData 意外给了心跳），释放让房主接管
        endHeartbeat()
        api.save.heartbeatRelease(saveIdNum.value).catch(()=>{})
    }
    if(!collabSession.isOwner){
        // 以协作者身份进房：保存责任在房主，清掉进房前可能残留的未保存标记
        // （不显示保存按钮、不阻止离开；房主侧不受此影响）
        releasePreventLeaving()
    }
    updateCollabWarning()
    return true
}

// ---- 协作功能开关（CollabPanel 触发，存于 save.meta.collabEnabled）----
let disablingCollabLocally = false // 本地开关触发的关闭（区别于远程 op 应用导致的关闭）

async function enableCollab(){
    const save = saveStore.save
    if(!save)
        return
    save.meta.collabEnabled = true
    preventLeaving()
    // 先持久化开关、成功后再开房：他人加载存档靠存档内的 collabEnabled 判定能否协作，
    // 若先开房后保存，期间加载的人看到旧值会回退仅浏览。
    // saveData 有 1 秒节流，刚保存过则稍候，避免节流误伤导致开房被拦
    const throttleWaitMs = lastSavedTime + 1000 - Date.now()
    if(throttleWaitMs > 0)
        await new Promise(r => window.setTimeout(r, throttleWaitMs))
    if(!(await saveData(false))){
        save.meta.collabEnabled = false
        showPop('保存失败，无法启用多人协作', 'failed')
        return
    }
    if(!(await tryJoinCollabRoom())){
        save.meta.collabEnabled = false
        showPop('启动多人协作失败', 'failed')
    }
}

async function disableCollab(){
    if(!window.confirm('确认关闭多人协作？所有协作成员将被断开'))
        return
    const save = saveStore.save
    if(!save || disablingCollabLocally)
        return
    disablingCollabLocally = true
    const wasInSession = collabSession.isInSession
    try{
        save.meta.collabEnabled = false
        preventLeaving()
        // 先把开关变更作为 op 广播给房间内其他成员（他们据此断开并提示），再离房。
        // meta 变更不触发画布渲染，须手动 capture；flush 设超时兜底，失败则其他成员随离房兜底
        collabSession.captureLocalOp()
        await Promise.race([collabSession.flushLocalOps(), new Promise(r => window.setTimeout(r, 5000))])
        await collabSession.leave()
        if(wasInSession)
            collabPanel.value?.notifyCollabClosed()
        // 持久化开关状态（尽力：无心跳时服务器拒绝，静默失败）
        if(!(await saveData(false)))
            showPop('关闭状态未能保存到云端，刷新后可能恢复为启用', 'warning')
    }
    finally{
        disablingCollabLocally = false
    }
}

/** 协作被所有者关闭/房间被关后即将强跳首页：解除未保存离开拦截并禁止重新置位——
 * 离房后 isInSession 转 false，渲染回调会把拦截按普通编辑重新置位（回归默认行为），
 * 导致协作者点"我知道了"跳转被路由守卫拦下。仅对无法再保存的用户（协作者等未持心跳者）生效；
 * 房主仍保留拦截，以免丢失自己可保存的改动 */
function releaseLeavingBeforeForcedLeave(){
    if(heartbeatActive)
        return
    releasePreventLeaving()
    preventLeavingDisabled.value = true
}

/** 远程 op 应用导致开关被关（他端所有者关闭）：断开连接并弹窗提示 */
async function handleCollabDisabledRemotely(){
    if(disablingCollabLocally)
        return // 本地开关触发的关闭走 disableCollab 的主动流程
    if(!collabSession.isInSession)
        return // 未在会话中（如启动失败回退），无需处理
    await collabSession.leave()
    releaseLeavingBeforeForcedLeave()
    collabPanel.value?.notifyCollabClosed()
}

watch(() => saveStore.save?.meta.collabEnabled, (now, was) => {
    if(was === true && now === false)
        void handleCollabDisabledRemotely()
})

// 房间被关闭（backend-plan.md §7.1 ②③：房主关房或断网超宽限期）：弹窗并跳首页。
// 同一会话先收到"已关闭协作"时（meta op 先行应用，collabEnabled 已 false）以前者为准，不重复弹
watch(() => collabSession.roomClosedNotice, () => {
    if(collabSession.roomClosedNotice === 0)
        return
    releaseLeavingBeforeForcedLeave()
    if(saveStore.save?.meta.collabEnabled === false)
        collabPanel.value?.notifyCollabClosed()
    else
        collabPanel.value?.notifyRoomClosed()
})

/** 房主但没有心跳：等旧占用者心跳过期后借 loadData(forEdit) 的 Initialization 副作用接管（数据丢弃） */
async function ensureOwnerHeartbeat(){
    window.clearTimeout(ownerHeartbeatRetryTimer)
    if(!collabSession.isInSession || !collabSession.isOwner || heartbeatActive)
        return
    const status = await api.save.loadStatus(saveIdNum.value, false)
    if(!collabSession.isInSession || !collabSession.isOwner || heartbeatActive)
        return // 等待期间状态已变（离房/卸任/已接管）
    const holder = status?.editingByUserId
    if(!holder || holder === userInfoStore.userInfo?.id){
        try{
            await api.save.loadData(saveIdNum.value, true)
            startHeartbeat()
            updateCollabWarning()
            return
        }catch{ /* 抢占竞态失败（他人抢先初始化），走重试 */ }
    }
    // 旧房主心跳有效期 10 分钟，期间每 30 秒探测一次
    ownerHeartbeatRetryTimer = window.setTimeout(()=>{ void ensureOwnerHeartbeat() }, 30*1000)
}

/** 协作状态下的保存提示：协作者显示"由房主保存"；继任房主显示"接管中" */
function updateCollabWarning(){
    if(!collabSession.isInSession)
        return
    if(!collabSession.isOwner){
        const ownerName = collabSession.members.find(m => m.userId === collabSession.ownerUserId)?.userName ?? '??'
        savingDisabledWarningStore.setWarning(`多人协作中：由房主 ${ownerName} 负责保存`)
        collabWarningSet = true
    }
    else if(!heartbeatActive){
        savingDisabledWarningStore.setWarning('你已继任房主，正在接管保存权（旧占用过期后自动生效）')
        collabWarningSet = true
    }
    else if(collabWarningSet){
        savingDisabledWarningStore.clearWarning()
        collabWarningSet = false
    }
}

watch(() => collabSession.isOwner, () => {
    if(!collabSession.isInSession)
        return
    // OwnerChanged：我继任房主 → 接管心跳与保存权；房主换成他人 → 更新提示
    if(!collabSession.isOwner){
        // 保存责任已移交他人：解除未保存标记（保存按钮回"离开"、不阻止离开），
        // 继任侧由后续编辑/远程 op 按需重新置位
        releasePreventLeaving()
    }
    void ensureOwnerHeartbeat()
    updateCollabWarning()
})
watch(() => collabSession.isInSession, (inSession, wasInSession) => {
    if(inSession || !wasInSession)
        return
    // 进房从未到达过稳态（如被"仅存档所有者可开启协作"拒绝、房间已满）：不算"会话异常结束"，
    // 不刷新页面，由调用方自己的回退逻辑处理
    if(!collabSession.hasEverSynced())
        return
    if(collabWarningSet){
        savingDisabledWarningStore.clearWarning()
        collabWarningSet = false
    }
    // 房间被房主关闭（含断网超宽限期）：弹窗+跳首页由 roomClosedNotice watch 编排，不刷新
    if(collabSession.roomClosedNotice > 0)
        return
    // 所有者关闭协作导致的离房：不刷新（弹窗已提示）；非心跳持有者此后无法保存，给出警告
    if(saveStore.save?.meta.collabEnabled === false){
        if(!heartbeatActive && !viewOnly.value)
            savingDisabledWarningStore.setWarning('多人协作已关闭，当前更改无法保存，请刷新页面', true)
        return
    }
    // 会话异常结束（同步兜底失败等，handleSyncExhausted 已弹窗提示）：
    // 本地存档已与房间脱节，继续编辑无意义，沿用项目惯例刷新页面重进
    if(!leavingEditor && loadComplete.value && !isDemo.value)
        window.setTimeout(()=>window.location.reload(), 2000)
})

watch(props, async()=>{
    // 一旦画布id发生变化，刷新浏览器（否则无法保证状态清理干净）
    window.location.reload()
})

const saveShortcutListener = new ShortcutListener(()=>{ saveData(false) }, {code:'KeyS', ctrl:true})
const deleteShortcutListener = new ShortcutListener(()=>{
    if(isFocusingInput()){
        // 如果正在输入文字：不prevent浏览器默认行为（delete键确实有用）且不进行删除操作
        return { dontPrevent: true }
    }
    else{
        // 不是正在输入文字：进行删除操作
        envStore.delActivePt(true, true)
        envStore.delActiveTextTag(true)
    }
}, {code:'Delete'})
const undoShortcutListener = new ShortcutListener(()=>{
    if(isFocusingInput())
        return { dontPrevent: true }
    else
        undoStore.undo()
}, {code:'KeyZ', ctrl:true})
const redoShortcutListener = new ShortcutListener(()=>{
    if(isFocusingInput())
        return { dontPrevent: true }
    else
        undoStore.redo()
}, {code:'KeyZ', ctrl:true, shift:true})
const cachePreventerInputId = 'cachePreventerInput'
const { cachePreventStart, cachePreventStop } = useCachePreventer(cachePreventerInputId)
const showHiddenLongWarn = ref(false)
const hiddenLongWatcher = new DocumentHiddenLongWatcher(30*1000, ()=>{
    if(!isDemo.value && !viewOnly.value)
        showHiddenLongWarn.value = true
}) 
onBeforeMount(async()=>{
    topbarShow.value = false
    // 一旦发现之前加载过其他画布，刷新浏览器（否则无法保证状态清理干净）
    if(loadedSave.value){
        window.location.reload()
        return
    }
    setLeavingPreventing()
    await load()
    saveShortcutListener.start()
    deleteShortcutListener.start()
    undoShortcutListener.start()
    redoShortcutListener.start()
    cachePreventStart()
    hiddenLongWatcher.startWatching()
})
onBeforeUnmount(()=>{
    leavingEditor = true
    window.clearTimeout(ownerHeartbeatRetryTimer)
    // 仅在“我持有心跳”时释放（协作协作者从不持有心跳，不能误调 release）
    const releaseHeartbeat = heartbeatActive
    endHeartbeat()
    if(releaseHeartbeat){
        api.save.heartbeatRelease(saveIdNum.value)
           .then(()=>{console.log('心跳释放成功')})
           .catch((e)=>{console.error('心跳释放失败', e)})
    }
    void collabSession.leave() // 协作会话清理（含离房通知、清锁、清前缀；未在会话中则直返）
    disposeEditor()
    topbarShow.value = true
    saveShortcutListener.dispose()
    deleteShortcutListener.dispose()
    undoShortcutListener.dispose()
    redoShortcutListener.dispose()
    cachePreventStop()
    hiddenLongWatcher.stopWatching()
})
</script>

<template>
    <div v-if="loadError" class="load-error">
        {{ loadError }}
        <RouterLink v-if="ownerUserInfo?.userId" :to="someonesSavesRoute(ownerUserInfo.userId)">
            看看作者 {{ ownerUserInfo.userName }} 的其他作品</RouterLink>
        <button class="minor" @click="goBackToWhereWeEntered">点击返回</button>
    </div>
    <Cvs v-if="loadComplete"></Cvs>
    <Menu v-if="loadComplete" @save-data="saveData" @leave="goBackToWhereWeEntered"></Menu>
    <CollabStatusOverlay @leave="goBackToWhereWeEntered"></CollabStatusOverlay>
    <UnsavedLeavingWarning v-if="showUnsavedWarning" :release="releasePreventLeaving"
        :save="async()=>{ await saveData(false) }" @ok="showUnsavedWarning=false"></UnsavedLeavingWarning>
    <HiddenLongWarnPrompt v-if="showHiddenLongWarn" @ok="showHiddenLongWarn=false"></HiddenLongWarnPrompt>
    <HeartbeatFailWarnPrompt v-if="showHeartbeatFailWarn" :stolen="heartbeatStolenWarn" @ok="showHeartbeatFailWarn=false"></HeartbeatFailWarnPrompt>
    <WarnRulePrompts :save-status="saveStatus"></WarnRulePrompts>
    <SavingDisabledWarning></SavingDisabledWarning>
    <div class="cache-preventer"><input :id="cachePreventerInputId"/></div>
    <DontUseWeirdBrowser></DontUseWeirdBrowser>
    <div v-if="loadComplete && !isNaN(saveIdNum)" class="chatRoomWrap">
        <CollabPanel ref="collabPanel" :isOwner="isSaveOwner" :viewOnly="viewOnly" @enable="enableCollab" @disable="disableCollab" />
        <ChatRoom ref="chatRoom" :saveId="saveIdNum" :saveIdDisplay="saveId" :enabled="chatEnabled" :isOwner="isSaveOwner" :viewOnly="viewOnly" @enable="enableChat" @disable="disableChat" @kicked="onKicked" @save="handleSaveAndKick" />
    </div>
    <UserFileFavorites ref="userFileFavorites" />
</template>

<style scoped lang="scss">
.load-error{
    background-color: white;
    position: fixed;
    left: 0px; top: 0px;
    width: 100vw; height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    font-size: 22px;
    color: #999;
    gap: 20px;
    a { color: inherit }
    a, button { font-size: 16px; }
}
.cache-preventer{
    position: fixed;
    z-index: -1;
    top: -100px; //藏起来
}
.chatRoomWrap{
    position: fixed;
    top: calc(10px + env(safe-area-inset-top, 0px));
    right: calc(10px + env(safe-area-inset-right, 0px));
    z-index: 499;
    display: flex;
    gap: 10px;
    align-items: flex-start;
}
</style>