namespace AARC.Collab
{
    /// 一次协作操作（服务器分配的 Seq 为房间内全序）
    public class CollabOpDto
    {
        public string OpId { get; set; } = string.Empty;    // 客户端生成，用于客户端去重/对账
        public int SaveId { get; set; }
        public long Seq { get; set; }                       // 服务器分配，房间级单调递增，从 1 开始
        public int UserId { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string Patch { get; set; } = string.Empty;   // 不透明负载：已序列化的 JSON（或压缩后 base64），服务器不解析
        public long BaseSeq { get; set; }                   // 客户端生成 patch 时基于的 Seq（v1 仅记录，不校验）
        public DateTime SentAt { get; set; }
    }

    /// 房间成员（presence）
    public class CollabMemberDto
    {
        public int UserId { get; set; }
        public string UserName { get; set; } = string.Empty;
        public DateTime JoinedAt { get; set; }
    }

    /// 一条对象锁（软锁，服务器按 first-write-wins 仲裁；锁键带类型前缀："pt:5"/"line:3"/"tag:7"）
    public class CollabLockDto
    {
        public string Key { get; set; } = string.Empty;
        public string Holder { get; set; } = string.Empty;  // 持有者用户名（前端直接用于"被 XX 编辑中"提示）
    }

    /// JoinRoom 返回值
    public class JoinCollabRoomResult
    {
        public long LatestSeq { get; set; }                 // 当前房间最新序号（房间刚创建时为 0）
        public int IdPrefix { get; set; }                   // 服务器分配的会话 id 前缀（租约制：在房期间唯一，离房回收；历史 id 撞号由客户端扫存档设种子兜底）
        public int OwnerUserId { get; set; }                // 房主 = 首个加入者，唯一保存责任人；房主离开时按 JoinedAt 最早的在房成员自动继任
        public List<CollabMemberDto> Members { get; set; } = [];
        public List<CollabLockDto> Locks { get; set; } = []; // 当前锁表快照（后进房者据此渲染他人锁）
        public bool OwnerOffline { get; set; }              // 房主正处于断网宽限期（§7.1 ③；后进房者也须显示离线蒙层）
        public bool OwnerReconnected { get; set; }          // 本次加入恢复了离线房主（§7.1 ③；Hub 向其他成员广播 OwnerReconnected）
        public int MyConnectionCount { get; set; }          // 该用户在房连接数（含本次）：客户端据此判定"独房"（同用户多连接/多设备不算独房）
    }

    /// SyncOps 返回值
    public class SyncCollabOpsResult
    {
        public List<CollabOpDto> Ops { get; set; } = [];    // Seq > afterSeq 的全部操作，按 Seq 升序
        public long LatestSeq { get; set; }
        public bool Gap { get; set; }                       // true = 队列已被修剪，afterSeq 之前的操作丢失，客户端必须走快照流程重建
    }

    /// 房间成员上传的存档快照（POST /collab/snapshot；正常流程由现任房主上传，
    /// 房主无存活连接时任何在房成员可兜底，backend-plan.md §7.1 ③；Payload 为 LZString 压缩后的 base64）
    public class CollabSnapshotUpload
    {
        public int SaveId { get; set; }
        public long Seq { get; set; }                       // 房主已应用的最大 op 序号（水位）
        public string Payload { get; set; } = string.Empty;
    }

    /// GET /collab/snapshot?saveId= 返回（快照未就绪时 404，调用方轮询）
    public class CollabSnapshotResult
    {
        public long Seq { get; set; }
        public string Payload { get; set; } = string.Empty;
        public string FromUserName { get; set; } = string.Empty;
    }
}
