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
    /** 房主正处于断网宽限期（后进房者也须显示离线蒙层，backend-plan.md §7.1 ③） */
    ownerOffline?: boolean
    /** 本次加入恢复了离线房主（Hub 已向其他成员广播 OwnerReconnected） */
    ownerReconnected?: boolean
    /** 我在房的连接数（含本次）：据此判定"独房"（同用户多连接/多设备不算独房） */
    myConnectionCount?: number
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
    /** 房间被房主关闭（CloseRoom 或断网超宽限期；§7.1）：所有成员清理本地会话，
     *  非房主（含房主的其他连接）弹窗"所有者已关闭房间"后跳首页 */
    onRoomClosed(saveId: number): void
    /** 房主断连进入宽限期（§7.1 ③）：显示离线蒙层禁止编辑，等待重连或超时关房 */
    onOwnerOffline(saveId: number): void
    /** 房主宽限期内重连（§7.1 ③）：其他成员重走快照流程（整档重建）后解除蒙层 */
    onOwnerReconnected(saveId: number): void
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
    /** 房主主动关房（backend-plan.md §7.1 ②）：尽力而为，失败静默（服务器断连兜底宽限期） */
    closeRoom(saveId: number): Promise<void>
    /** 提交 op；返回值即服务器分配的 seq（ack）；失败抛错 */
    submitOp(saveId: number, opId: string, patch: string, baseSeq: number): Promise<number>
    syncOps(saveId: number, afterSeq: number): Promise<SyncCollabOpsInfo>
    /** 返回值 = 是否获得（false = 被他人持有）；失败抛错 */
    acquireLock(saveId: number, key: string): Promise<boolean>
    releaseLock(saveId: number, key: string): Promise<void>
    /** 让服务器转发快照请求给提供者（优先房主的其他连接，房主无存活连接时兜底转发给其他成员；
     *  §7.1 ③）；无可用提供者时抛错（调用方稍后重试） */
    requestSnapshot(saveId: number): Promise<void>
    /** 上传快照（payload 为存档 JSON 字符串，压缩由传输层负责）。
     *  正常流程由房主上传；房主无存活连接时任何成员可作兜底提供者（§7.1 ③） */
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
