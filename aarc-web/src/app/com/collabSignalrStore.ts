import { defineStore } from "pinia"
import { HubConnectionBuilder, HubConnection, HubConnectionState, LogLevel } from "@microsoft/signalr"
import { compressToBase64, decompressFromBase64 } from "lz-string"
import { useApiStore } from "./apiStore"
import { useUserInfoStore } from "../globalStores/userInfo"
import { ApiException } from "./apiGenerated"
import {
    CollabMemberInfo, CollabOpMsg, CollabSnapshotInfo, CollabTransport,
    CollabTransportHandlers, JoinCollabRoomInfo, SyncCollabOpsInfo,
    initCollabTransport
} from "aarc-core/models/collab/collabTransport"

/**
 * 协作传输层的 SignalR 实现（core 侧接口见 aarc-core models/collab/collabTransport.ts，
 * 协议见 aarc-core/docs/multiplayer/backend-plan.md §7/§10）。
 *
 * - Hub 端点 /collab：op 收发、锁、成员/房主事件、快照请求转发
 * - 快照直传走 HTTP（CollabController，可达 MB 级，不走 SignalR 消息体积限制），
 *   payload 用 LZString base64 压缩/解压（对 core 透明，先例见 SaveDiffs.vue）
 * - 事件/返回值的 JSON 均为 camelCase（SignalR 默认序列化），这里映射成 core 的 DTO
 * - 自动重连耗尽后 onclose → onDisconnected（会话层据此禁止编辑，由用户决定退出/重进）
 */

/** 服务器 CollabOpDto 的线上形态（camelCase，多一个 sentAt，忽略） */
interface CollabOpWire extends CollabOpMsg { sentAt?: string }
interface CollabMemberWire extends CollabMemberInfo { joinedAt?: string }

export const useCollabSignalrStore = defineStore('collabSignalr', () => {
    const apiStore = useApiStore()
    const userInfoStore = useUserInfoStore()

    let connection: HubConnection | null = null
    let handlers: CollabTransportHandlers | undefined
    // 防止多个并发的 ensureConnected 各自启动一条新连接
    let connectingPromise: Promise<HubConnection> | null = null

    function getHubUrl(): string {
        const baseUrl = import.meta.env.VITE_ApiUrlBase as string | undefined
        if (!baseUrl)
            return '/collab'
        return `${baseUrl.replace(/\/$/, '')}/collab`
    }

    function setHandlers(h: CollabTransportHandlers): void {
        handlers = h
    }

    async function ensureConnected(): Promise<HubConnection> {
        if (connection?.state === HubConnectionState.Connected)
            return connection
        if (!apiStore.jwtToken)
            throw new Error('未登录，无法进行多人协作')
        if (connectingPromise)
            return await connectingPromise
        connectingPromise = startConnection().finally(() => { connectingPromise = null })
        return await connectingPromise
    }

    async function startConnection(): Promise<HubConnection> {
        if (connection) {
            try { await connection.stop() } catch { /* 忽略关闭异常 */ }
            connection = null
        }
        const conn = new HubConnectionBuilder()
            .withUrl(getHubUrl(), { accessTokenFactory: () => apiStore.jwtToken ?? '' })
            .withAutomaticReconnect()
            .configureLogging(LogLevel.Warning)
            .build()

        conn.on("ReceiveOp", (op: CollabOpWire) => handlers?.onOp(op))
        conn.on("LockAcquired", (lock: { key: string, holder: string }) => handlers?.onLockAcquired(lock))
        conn.on("LockReleased", (key: string) => handlers?.onLockReleased(key))
        conn.on("UserJoined", (m: CollabMemberWire) => handlers?.onUserJoined(m))
        conn.on("UserLeft", (m: CollabMemberWire) => handlers?.onUserLeft(m))
        conn.on("OwnerChanged", (m: CollabMemberWire) => handlers?.onOwnerChanged(m))
        conn.on("SnapshotRequested", (saveId: number) => handlers?.onSnapshotRequested(saveId))
        conn.on("Saved", (userName: string) => handlers?.onSaved(userName))

        conn.onreconnecting(err => {
            console.warn('[协作]正在重新连接', err?.message ?? '')
            handlers?.onReconnecting()
        })
        conn.onreconnected(() => {
            console.log('[协作]重新连接成功')
            handlers?.onReconnected()
        })
        conn.onclose(err => {
            // 自动重连已耗尽（服务器侧已把本连接移出所有房间）
            console.warn('[协作]连接已关闭', err?.message ?? '')
            connection = null
            handlers?.onDisconnected()
        })

        await conn.start()
        connection = conn
        console.log('[协作]连接已建立', conn.connectionId)
        return conn
    }

    async function join(saveId: number): Promise<JoinCollabRoomInfo> {
        const conn = await ensureConnected()
        const res = await conn.invoke<JoinCollabRoomInfo>("JoinRoom", saveId)
        console.log(`[协作]已加入房间 ${saveId}，前缀=${res.idPrefix}，水位=${res.latestSeq}`)
        return res
    }

    async function leave(saveId: number): Promise<void> {
        // 断线等失败场景静默：服务器断连兜底清理（OnDisconnectedAsync → LeaveAllRooms）
        try {
            if (connection?.state === HubConnectionState.Connected)
                await connection.invoke("LeaveRoom", saveId)
        }
        catch (e) {
            console.warn(`[协作]退出房间 ${saveId} 失败（由服务器断连清理兜底）`, e)
        }
    }

    async function submitOp(saveId: number, opId: string, patch: string, baseSeq: number): Promise<number> {
        const conn = await ensureConnected()
        const seq = await conn.invoke<number>("SubmitOp", saveId, opId, patch, baseSeq)
        return seq
    }

    async function syncOps(saveId: number, afterSeq: number): Promise<SyncCollabOpsInfo> {
        const conn = await ensureConnected()
        return await conn.invoke<SyncCollabOpsInfo>("SyncOps", saveId, afterSeq)
    }

    async function acquireLock(saveId: number, key: string): Promise<boolean> {
        const conn = await ensureConnected()
        return await conn.invoke<boolean>("AcquireLock", saveId, key)
    }

    async function releaseLock(saveId: number, key: string): Promise<void> {
        const conn = await ensureConnected()
        await conn.invoke("ReleaseLock", saveId, key)
    }

    async function requestSnapshot(saveId: number): Promise<void> {
        const conn = await ensureConnected()
        await conn.invoke("RequestSnapshot", saveId)
    }

    async function uploadSnapshot(saveId: number, seq: number, payload: string): Promise<void> {
        const res = await apiStore.collab.uploadSnapshot({
            saveId, seq, payload: compressToBase64(payload)
        })
        if (res !== true)
            throw new Error('快照上传失败')
    }

    async function getSnapshot(saveId: number): Promise<CollabSnapshotInfo | null> {
        try {
            const res = await apiStore.collab.downloadSnapshot(saveId)
            const payload = decompressFromBase64(res.payload ?? '')
            if (res.seq === undefined || !payload)
                throw new Error('快照数据不完整')
            return { seq: res.seq, payload, fromUserName: res.fromUserName ?? '' }
        }
        catch (e) {
            // 快照尚未就绪（404）属正常轮询流程，返回 null 让会话层继续轮询
            if (e instanceof ApiException && e.status === 404)
                return null
            throw e
        }
    }

    async function notifySaved(saveId: number): Promise<void> {
        const conn = await ensureConnected()
        await conn.invoke("NotifySaved", saveId)
    }

    return {
        myUserId: () => userInfoStore.userInfo?.id ?? 0,
        setHandlers,
        join,
        leave,
        submitOp,
        syncOps,
        acquireLock,
        releaseLock,
        requestSnapshot,
        uploadSnapshot,
        getSnapshot,
        notifySaved,
    }
})

/** 应用启动期装配：把 SignalR 实现注入 core（App.vue onMounted 调用） */
export function initWebCollabTransport(): void {
    initCollabTransport(useCollabSignalrStore() as CollabTransport)
}
