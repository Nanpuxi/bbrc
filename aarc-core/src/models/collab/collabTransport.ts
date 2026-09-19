/**
 * 协作传输层接口（步骤四 4.5.1）。
 *
 * core 只定义接口并消费事件，不依赖任何具体实现；
 * SignalR 实现属宿主职责（aarc-web 的 collabSignalrStore，参照 signalrStore.ts）。
 * 事件语义与后端协议一一对应（docs/multiplayer/backend-plan.md §7），
 * 编排逻辑（缓冲/快照/补齐/种子扫描）在 models/stores/collabSessionStore.ts。
 *
 * 序列化约定：
 * - op 的 patch 为 SaveDiff 的 JSON 字符串（服务器不透传不解析）
 * - 快照 payload 为存档 JSON 字符串；压缩（LZString base64）是传输层内部细节，core 不感知
 */

/** 一条协作操作（seq 为房间内全序，服务器分配） */
export interface CollabOpMsg {
    opId: string
    saveId: number
    seq: number
    userId: number
    userName: string
    patch: string
    baseSeq: number
}

export interface CollabMemberInfo {
    userId: number
    userName: string
}

export interface CollabLockInfo {
    key: string
    holder: string
}

export interface JoinCollabRoomInfo {
    latestSeq: number
    idPrefix: number
    ownerUserId: number
    members: CollabMemberInfo[]
    locks: CollabLockInfo[]
}

export interface SyncCollabOpsInfo {
    ops: CollabOpMsg[]
    latestSeq: number
    /** true = 队列已被修剪，afterSeq 之前的 op 丢失，必须走快照流程重建 */
    gap: boolean
}

export interface CollabSnapshotInfo {
    /** 房主已应用的最大 seq（水位）；快照只含 ≤ 水线的变更 */
    seq: number
    /** 存档 JSON 字符串（传输层已解压） */
    payload: string
    fromUserName: string
}

/** 传输层 → 会话层的事件回调（由 collabSessionStore 在 join 时注册） */
export interface CollabTransportHandlers {
    onOp(op: CollabOpMsg): void
    onLockAcquired(lock: CollabLockInfo): void
    onLockReleased(key: string): void
    onUserJoined(member: CollabMemberInfo): void
    onUserLeft(member: CollabMemberInfo): void
    onOwnerChanged(member: CollabMemberInfo): void
    onSnapshotRequested(saveId: number): void
    /** 房主已保存（仅其他人会收到；userName 为房主名） */
    onSaved(userName: string): void
    /** 传输层自动重连中（此时不应编辑/提交） */
    onReconnecting(): void
    /** 重连成功（会话层须 rejoin + 增量补齐） */
    onReconnected(): void
    /** 连接彻底断开（传输层内部重试已耗尽） */
    onDisconnected(): void
}

export interface CollabTransport {
    /** 当前登录用户 id（宿主从身份信息提供；未登录返回 0） */
    myUserId(): number
    /** 注册事件回调（重复调用以最后一次为准；会话层在每次 join 前设置） */
    setHandlers(handlers: CollabTransportHandlers): void
    /** 加入房间（含建立连接）；失败抛错 */
    join(saveId: number): Promise<JoinCollabRoomInfo>
    /** 离开房间；断线等失败场景应静默（服务器断连兜底清理） */
    leave(saveId: number): Promise<void>
    /** 提交 op；返回值即服务器分配的 seq（ack）；失败抛错 */
    submitOp(saveId: number, opId: string, patch: string, baseSeq: number): Promise<number>
    syncOps(saveId: number, afterSeq: number): Promise<SyncCollabOpsInfo>
    /** 返回值 = 是否获得（false = 被他人持有）；失败抛错 */
    acquireLock(saveId: number, key: string): Promise<boolean>
    releaseLock(saveId: number, key: string): Promise<void>
    /** 让服务器转发快照请求给现任房主；房主不在线时抛错（调用方稍后重试） */
    requestSnapshot(saveId: number): Promise<void>
    /** 房主上传快照（payload 为存档 JSON 字符串，压缩由传输层负责） */
    uploadSnapshot(saveId: number, seq: number, payload: string): Promise<void>
    /** 成员下载快照；未就绪返回 null（调用方轮询） */
    getSnapshot(saveId: number): Promise<CollabSnapshotInfo | null>
    /** 房主宣布已保存（服务器校验房主身份后向其他人广播 Saved；失败抛错） */
    notifySaved(saveId: number): Promise<void>
}

let transport: CollabTransport | undefined

/** 宿主在应用启动期注入协作传输实现（web：collabSignalrStore） */
export function initCollabTransport(t: CollabTransport): void {
    transport = t
}

/** 未注入返回 undefined（协作功能不可用时会话层应在 join 时报错而非静默） */
export function getCollabTransport(): CollabTransport | undefined {
    return transport
}
