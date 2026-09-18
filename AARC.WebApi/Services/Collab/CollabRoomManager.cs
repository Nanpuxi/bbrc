using Microsoft.Extensions.Options;
using System.Collections.Concurrent;

namespace AARC.WebApi.Services.Collab
{
    /// 协作功能限流与容量配置（appsettings.json 的 "Collab" 节可覆盖，默认硬编码）
    public class CollabOptions
    {
        /// 每房间操作队列条数上限（超过即从头出队）
        public int MaxOpsPerRoom { get; set; } = 500;
        /// 操作保留时长（分钟，超过即从头出队）
        public int OpRetentionMinutes { get; set; } = 30;
        /// 单条 patch 大小上限（按 string.Length 计）
        public int MaxPatchLength { get; set; } = 256 * 1024;
        /// 每房间成员上限
        public int MaxRoomMembers { get; set; } = 10;
        /// id 前缀上限（前端 collabIdPrefixMax）；租约制下前缀随离房回收，耗尽即无空闲前缀时拒绝加入
        public int MaxIdPrefix { get; set; } = 2047;
        /// 快照缓存 TTL（秒）
        public int SnapshotTtlSeconds { get; set; } = 60;
        /// 快照 payload 大小上限（按 string.Length 计）
        public int MaxSnapshotPayloadLength { get; set; } = 8 * 1024 * 1024;
        /// Hub 层每连接令牌桶：每秒补充的令牌数
        public double RateLimitPerSecond { get; set; } = 20;
        /// Hub 层每连接令牌桶：突发容量
        public int RateLimitBurst { get; set; } = 40;
    }

    /// <summary>
    /// 协作房间状态管理器：持有全部房间状态，负责序号分配、入队、修剪、成员管理、
    /// 空房回收、对象锁仲裁（first-write-wins）与 id 前缀租约分发、快照缓存。
    /// 注册为 DI 单例；不使用 static 字段，测试可 new 新实例获得隔离。
    /// </summary>
    public class CollabRoomManager
    {
        private readonly ConcurrentDictionary<int, CollabRoom> _rooms = new();  // key = saveId
        // 每个连接加入了哪些房间，用于断开时自动移出所有房间
        private readonly ConcurrentDictionary<string, ConcurrentDictionary<int, byte>> _connectionRooms = new();
        // 每房间缓存的房主快照（可被更新的快照覆盖，TTL 到期失效）
        private readonly ConcurrentDictionary<int, CollabSnapshotEntry> _snapshots = new();
        private readonly CollabOptions _options;
        public CollabOptions Options => _options;

        public CollabRoomManager(IOptions<CollabOptions> options)
        {
            _options = options.Value;
        }

        /// <summary>
        /// 加入房间：登记成员与连接、分配 id 前缀（租约制：分配最小空闲前缀，离房回收）。
        /// 历史 id 撞号由客户端进房时的存档扫描设种子兜底（id-allocation.md §7.1）。
        /// 重复加入幂等（已加入时返回原前缀，newMember 输出 null 表示无需广播 UserJoined）。
        /// </summary>
        public JoinCollabRoomResult JoinRoom(
            int saveId, int userId, string userName, string connectionId,
            out CollabMemberDto? newMember)
        {
            while (true)
            {
                var room = _rooms.GetOrAdd(saveId, _ => new CollabRoom());
                lock (room.SyncRoot)
                {
                    // 该房间实例刚被空房回收，重试拿新实例
                    if (!_rooms.TryGetValue(saveId, out var current) || !ReferenceEquals(current, room))
                        continue;

                    newMember = null;
                    if (!room.MemberIdPrefixes.TryGetValue(userId, out int prefix))
                    {
                        if (room.Members.Count >= _options.MaxRoomMembers)
                            throw new RqEx("协作房间人数已满");
                        prefix = AllocFreePrefix(room);
                        room.MemberIdPrefixes[userId] = prefix;
                    }
                    if (!room.Members.ContainsKey(userId))
                    {
                        newMember = new CollabMemberDto
                        {
                            UserId = userId,
                            UserName = userName,
                            JoinedAt = DateTime.Now
                        };
                        room.Members[userId] = newMember;
                    }
                    room.ConnectionUsers[connectionId] = userId;
                    room.LastActiveAt = DateTime.Now;
                    var result = new JoinCollabRoomResult
                    {
                        LatestSeq = room.LatestSeq,
                        IdPrefix = prefix,
                        OwnerUserId = OwnerOf(room)?.UserId ?? 0,
                        Members = room.Members.Values
                            .OrderBy(x => x.JoinedAt).ThenBy(x => x.UserId).ToList(),
                        Locks = room.Locks
                            .Select(x => new CollabLockDto { Key = x.Key, Holder = x.Value.Holder })
                            .ToList()
                    };
                    _connectionRooms
                        .GetOrAdd(connectionId, _ => new ConcurrentDictionary<int, byte>())
                        [saveId] = 1;
                    return result;
                }
            }
        }

        /// <summary>
        /// 某连接离开某房间：释放该连接持有的全部锁；该用户在房内无其他连接时移出成员。
        /// 返回 null 表示该连接不在此房间。
        /// </summary>
        public CollabLeaveResult? LeaveRoom(int saveId, string connectionId)
        {
            if (!_rooms.TryGetValue(saveId, out var room))
                return null;
            var res = LeaveRoomCore(saveId, room, connectionId);
            if (res is not null && _connectionRooms.TryGetValue(connectionId, out var roomsOfConn))
                roomsOfConn.TryRemove(saveId, out _);
            return res;
        }

        /// <summary>
        /// 连接断开时移出其加入的所有房间
        /// </summary>
        public List<KeyValuePair<int, CollabLeaveResult>> LeaveAllRooms(string connectionId)
        {
            var res = new List<KeyValuePair<int, CollabLeaveResult>>();
            if (!_connectionRooms.TryRemove(connectionId, out var roomsOfConn))
                return res;
            foreach (var saveId in roomsOfConn.Keys)
            {
                if (_rooms.TryGetValue(saveId, out var room))
                {
                    var r = LeaveRoomCore(saveId, room, connectionId);
                    if (r is not null)
                        res.Add(new(saveId, r));
                }
            }
            return res;
        }

        private CollabLeaveResult? LeaveRoomCore(int saveId, CollabRoom room, string connectionId)
        {
            CollabLeaveResult res;
            lock (room.SyncRoot)
            {
                if (!room.ConnectionUsers.Remove(connectionId, out var userId))
                    return null;
                res = new CollabLeaveResult();
                // 只清该连接持有的锁，避免同一用户多标签页互相误清
                foreach (var kv in room.Locks.Where(x => x.Value.ConnectionId == connectionId).ToList())
                {
                    room.Locks.Remove(kv.Key);
                    res.ReleasedLocks.Add(new CollabLockDto { Key = kv.Key, Holder = kv.Value.Holder });
                }
                // 同一用户还有其他连接在房内时，成员保留
                if (room.ConnectionUsers.ContainsValue(userId))
                    return res;
                var ownerBeforeId = OwnerOf(room)?.UserId;
                if (!room.Members.Remove(userId, out var member))
                    return res;
                room.MemberIdPrefixes.Remove(userId);   // 前缀租约回收，后续加入者可复用
                res.LeftMember = member;
                if (room.Members.Count == 0)
                {
                    // 空房回收：在锁内移除，确保没有并发加入者拿到此实例后被孤立
                    _rooms.TryRemove(new KeyValuePair<int, CollabRoom>(saveId, room));
                    _snapshots.TryRemove(saveId, out _);
                    res.RoomDestroyed = true;
                }
                else if (ownerBeforeId == userId)
                {
                    // 房主离开：按 JoinedAt 最早的在房成员继任，由 Hub 补一条 OwnerChanged
                    res.NewOwner = OwnerOf(room);
                }
            }
            return res;
        }

        /// <summary>
        /// 校验成员身份后入队一条操作：锁内分配 Seq + 入队，保证队列顺序即 Seq 顺序。
        /// 返回的 op 携带分配的 Seq（由 Hub 在锁外广播，返回值即 ack）。
        /// </summary>
        public CollabOpDto AppendOp(int saveId, int userId, string userName, string opId, string patch, long baseSeq)
        {
            if (!_rooms.TryGetValue(saveId, out var room))
                throw new RqEx("协作房间不存在");
            lock (room.SyncRoot)
            {
                if (!room.Members.ContainsKey(userId))
                    throw new RqEx("尚未加入协作房间");
                var op = new CollabOpDto
                {
                    OpId = opId,
                    SaveId = saveId,
                    Seq = ++room.LatestSeq,
                    UserId = userId,
                    UserName = userName,
                    Patch = patch,
                    BaseSeq = baseSeq,
                    SentAt = DateTime.Now
                };
                room.Ops.Enqueue(op);
                room.LastActiveAt = op.SentAt;
                TrimOps(room);
                return op;
            }
        }

        /// <summary>
        /// 增量补齐：返回 Seq > afterSeq 的全部操作；队列已被修剪时 Gap = true。
        /// 不要求调用者是成员（重连竞态下允许先 Sync 后 Join）。
        /// </summary>
        public SyncCollabOpsResult SyncOps(int saveId, long afterSeq)
        {
            if (!_rooms.TryGetValue(saveId, out var room))
            {
                // 房间不存在（无人或已回收）：无任何可同步的操作
                return new SyncCollabOpsResult { LatestSeq = 0, Gap = afterSeq > 0 };
            }
            lock (room.SyncRoot)
            {
                var gap = afterSeq < room.LatestSeq
                    && (room.Ops.Count == 0 || room.Ops.Peek().Seq > afterSeq + 1);
                return new SyncCollabOpsResult
                {
                    Ops = room.Ops.Where(x => x.Seq > afterSeq).ToList(),
                    LatestSeq = room.LatestSeq,
                    Gap = gap
                };
            }
        }

        /// <summary>
        /// 对象锁仲裁（first-write-wins）：锁键未被他人持有则获得并返回 true；
        /// 被他人持有返回 false；同一连接重复加锁幂等返回 true。
        /// </summary>
        public bool TryAcquireLock(int saveId, int userId, string userName, string connectionId, string key)
        {
            if (!_rooms.TryGetValue(saveId, out var room))
                throw new RqEx("协作房间不存在");
            lock (room.SyncRoot)
            {
                if (!room.Members.ContainsKey(userId))
                    throw new RqEx("尚未加入协作房间");
                if (room.Locks.TryGetValue(key, out var existing))
                    return existing.ConnectionId == connectionId;
                room.Locks[key] = (userName, connectionId);
                return true;
            }
        }

        /// <summary>
        /// 释放本连接持有的锁；不持有该锁时静默忽略（返回 false，无需广播）
        /// </summary>
        public bool ReleaseLock(int saveId, string connectionId, string key)
        {
            if (!_rooms.TryGetValue(saveId, out var room))
                return false;
            lock (room.SyncRoot)
            {
                if (room.Locks.TryGetValue(key, out var existing) && existing.ConnectionId == connectionId)
                {
                    room.Locks.Remove(key);
                    return true;
                }
                return false;
            }
        }

        /// <summary>
        /// 取现任房主的全部连接 Id（RequestSnapshot 转发用）；调用者必须是房间成员
        /// </summary>
        public List<string> GetOwnerConnectionIds(int saveId, int userId)
        {
            if (!_rooms.TryGetValue(saveId, out var room))
                throw new RqEx("协作房间不存在");
            lock (room.SyncRoot)
            {
                if (!room.Members.ContainsKey(userId))
                    throw new RqEx("尚未加入协作房间");
                var owner = OwnerOf(room);
                if (owner is null)
                    return [];
                return room.ConnectionUsers
                    .Where(x => x.Value == owner.UserId)
                    .Select(x => x.Key)
                    .ToList();
            }
        }

        /// <summary>
        /// 房主上传存档快照（仅现任房主可上传；按房间缓存，可被更新的快照覆盖）
        /// </summary>
        public void UploadSnapshot(int userId, CollabSnapshotUpload upload)
        {
            if (upload.Payload is null || upload.Payload.Length > _options.MaxSnapshotPayloadLength)
                throw new RqEx("快照过大");
            if (!_rooms.TryGetValue(upload.SaveId, out var room))
                throw new RqEx("协作房间不存在");
            string fromUserName;
            lock (room.SyncRoot)
            {
                var owner = OwnerOf(room);
                if (owner is null || owner.UserId != userId)
                    throw new RqEx("仅当前房主可上传快照");
                fromUserName = owner.UserName;
            }
            _snapshots[upload.SaveId] = new CollabSnapshotEntry
            {
                Seq = upload.Seq,
                Payload = upload.Payload,
                FromUserName = fromUserName,
                UploadedAt = DateTime.Now
            };
        }

        /// <summary>
        /// 房间成员下载存档快照；快照未就绪或已过期时返回 null（调用方轮询）
        /// </summary>
        public CollabSnapshotResult? GetSnapshot(int saveId, int userId)
        {
            if (!_rooms.TryGetValue(saveId, out var room))
                throw new RqEx("协作房间不存在");
            lock (room.SyncRoot)
            {
                if (!room.Members.ContainsKey(userId))
                    throw new RqEx("仅房间成员可获取快照");
            }
            if (!_snapshots.TryGetValue(saveId, out var snap))
                return null;
            if (DateTime.Now - snap.UploadedAt > TimeSpan.FromSeconds(_options.SnapshotTtlSeconds))
            {
                _snapshots.TryRemove(saveId, out _);
                return null;
            }
            return new CollabSnapshotResult
            {
                Seq = snap.Seq,
                Payload = snap.Payload,
                FromUserName = snap.FromUserName
            };
        }

        // 房主 = Members 中 JoinedAt 最早者，不单独存字段
        private static CollabMemberDto? OwnerOf(CollabRoom room)
            => room.Members.Values.OrderBy(x => x.JoinedAt).ThenBy(x => x.UserId).FirstOrDefault();

        // 租约制前缀分配：取 [1, MaxIdPrefix] 内未被持有的最小前缀；成员数上限远小于前缀数，耗尽仅为防御性分支
        private int AllocFreePrefix(CollabRoom room)
        {
            for (int p = 1; p <= _options.MaxIdPrefix; p++)
            {
                if (!room.MemberIdPrefixes.ContainsValue(p))
                    return p;
            }
            throw new RqEx("协作房间 id 前缀已耗尽，请稍后重试");
        }

        // 双阈值修剪：条数超限或头部操作超出时间窗口即从头出队
        private void TrimOps(CollabRoom room)
        {
            while (room.Ops.Count > _options.MaxOpsPerRoom)
                room.Ops.Dequeue();
            var oldest = DateTime.Now - TimeSpan.FromMinutes(_options.OpRetentionMinutes);
            while (room.Ops.Count > 0 && room.Ops.Peek().SentAt < oldest)
                room.Ops.Dequeue();
        }

        internal class CollabRoom
        {
            public readonly object SyncRoot = new();     // 房间级锁：序号分配 + 入队 + 锁仲裁 + 前缀分发 + 读取快照
            public long LatestSeq;
            public readonly Queue<CollabOpDto> Ops = new();
            public readonly Dictionary<int, CollabMemberDto> Members = new();  // key = userId
            public readonly Dictionary<string, (string Holder, string ConnectionId)> Locks = new();  // 锁键 → 持有者
            public readonly Dictionary<string, int> ConnectionUsers = new();   // 房内连接 Id → userId（同一用户多连接时成员保留）
            public readonly Dictionary<int, int> MemberIdPrefixes = new();     // userId → 持有的前缀租约（离房/断连回收）
            public DateTime LastActiveAt;
        }

        private class CollabSnapshotEntry
        {
            public long Seq { get; set; }
            public string Payload { get; set; } = string.Empty;
            public string FromUserName { get; set; } = string.Empty;
            public DateTime UploadedAt { get; set; }
        }
    }

    /// LeaveRoom/断连清理的结果，Hub 据此在锁外广播
    public class CollabLeaveResult
    {
        /// 该连接释放的锁（逐条广播 LockReleased）
        public List<CollabLockDto> ReleasedLocks { get; set; } = [];
        /// 完全离开房间的成员（其所有连接均已离开）；null 表示该用户仍有其他连接在房内
        public CollabMemberDto? LeftMember { get; set; }
        /// 房主变更后的新房主；null 表示未变更
        public CollabMemberDto? NewOwner { get; set; }
        /// 房间已因无人而回收
        public bool RoomDestroyed { get; set; }
    }
}
