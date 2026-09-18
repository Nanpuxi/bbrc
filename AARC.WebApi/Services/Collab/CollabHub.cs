using AARC.WebApi.Models.Db.Context;
using AARC.WebApi.Models.DbModels.Enums;
using AARC.WebApi.Models.DbModels.Enums.AuthGrantTypes;
using AARC.WebApi.Models.DbModels.Identities;
using AARC.WebApi.Services.Identities.AuthGrants;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using System.IdentityModel.Tokens.Jwt;

namespace AARC.WebApi.Services.Collab
{
    /// <summary>
    /// 多人实时协作 Hub（端点 /collab）：只负责鉴权、参数校验、限流、调用管理器、广播；无状态。
    /// 房间状态全部在 CollabRoomManager 中；广播一律在房间 SyncRoot 锁外进行。
    /// </summary>
    [Authorize]
    public class CollabHub : Hub
    {
        private readonly AarcContext _db;
        private readonly ILogger<CollabHub> _logger;
        private readonly CollabRoomManager _rooms;
        private readonly AuthGrantCheckService _authGrantCheckService;
        private const string TokenBucketKey = "collabTokenBucket";

        public CollabHub(AarcContext db, ILogger<CollabHub> logger, CollabRoomManager rooms,
            AuthGrantCheckService authGrantCheckService)
        {
            _db = db;
            _logger = logger;
            _rooms = rooms;
            _authGrantCheckService = authGrantCheckService;
        }

        public override async Task OnConnectedAsync()
        {
            _logger.LogInformation("[CollabHub] 连接建立 connectionId={ConnectionId}, user={UserName}", Context.ConnectionId, Context.User?.Identity?.Name ?? "?");
            await base.OnConnectedAsync();
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            _logger.LogInformation("[CollabHub] 连接断开 connectionId={ConnectionId}, reason={Reason}", Context.ConnectionId, exception?.Message ?? "无");
            // 移出所有房间：清该连接全部锁并逐条广播 LockReleased、广播 UserLeft、房主继任广播 OwnerChanged、空房回收
            var leaves = _rooms.LeaveAllRooms(Context.ConnectionId);
            foreach (var (saveId, res) in leaves)
                await BroadcastLeave(saveId, res);
            await base.OnDisconnectedAsync(exception);
        }

        /// <summary>
        /// 加入协作房间：校验存档编辑权限（与编辑器打开存档同一标准）；分配 id 前缀（单调不回收）；首个加入者即房主。
        /// 重复加入幂等（已加入时返回原前缀）。
        /// </summary>
        public async Task<JoinCollabRoomResult> JoinRoom(int saveId)
        {
            var user = GetCurrentUser();
            _authGrantCheckService.CheckFor(AuthGrantOn.Save, saveId, (byte)AuthGrantTypeOfSave.Edit, false,
                user.Id, user.Type >= UserType.Admin, user.Type >= UserType.Member);
            var result = _rooms.JoinRoom(saveId, user.Id, user.Name, Context.ConnectionId, out var newMember);
            await Groups.AddToGroupAsync(Context.ConnectionId, RoomGroupName(saveId));
            if (newMember is not null)
                await Clients.OthersInGroup(RoomGroupName(saveId)).SendAsync("UserJoined", newMember);
            _logger.LogInformation("[CollabHub] 加入房间 saveId={SaveId}, user={UserName}, prefix={IdPrefix}", saveId, user.Name, result.IdPrefix);
            return result;
        }

        /// <summary>
        /// 离开协作房间：移出成员与 group、释放该连接全部锁；房主离开时按 JoinedAt 最早继任
        /// </summary>
        public async Task LeaveRoom(int saveId)
        {
            var res = _rooms.LeaveRoom(saveId, Context.ConnectionId);
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, RoomGroupName(saveId));
            if (res is not null)
                await BroadcastLeave(saveId, res);
        }

        /// <summary>
        /// 提交一条协作操作：锁内分配 Seq + 入队，锁外广播给其他成员；返回值即 ack
        /// </summary>
        public async Task<long> SubmitOp(int saveId, string opId, string patch, long baseSeq)
        {
            var user = GetCurrentUser();
            if (user.Type < UserType.Member)
                throw new RqEx("仅正式用户可提交协作操作");
            Throttle();
            if (string.IsNullOrEmpty(patch))
                throw new RqEx("patch 不能为空");
            if (patch.Length > _rooms.Options.MaxPatchLength)
                throw new RqEx("patch 过大");
            var op = _rooms.AppendOp(saveId, user.Id, user.Name, opId, patch, baseSeq);
            await Clients.OthersInGroup(RoomGroupName(saveId)).SendAsync("ReceiveOp", op);
            return op.Seq;
        }

        /// <summary>
        /// 增量补齐：返回 Seq > afterSeq 的全部操作；队列已被修剪时 Gap = true。
        /// 不要求调用者是成员（重连竞态下允许先 Sync 后 Join）
        /// </summary>
        public Task<SyncCollabOpsResult> SyncOps(int saveId, long afterSeq)
        {
            GetCurrentUser();
            return Task.FromResult(_rooms.SyncOps(saveId, afterSeq));
        }

        /// <summary>
        /// 对象锁仲裁（first-write-wins）：获得锁则向其他人广播 LockAcquired 并返回 true；
        /// 被他人持有返回 false（不广播）；同一持有者重复加锁幂等返回 true
        /// </summary>
        public async Task<bool> AcquireLock(int saveId, string key)
        {
            var user = GetCurrentUser();
            Throttle();
            if (string.IsNullOrWhiteSpace(key))
                throw new RqEx("锁键不能为空");
            var acquired = _rooms.TryAcquireLock(saveId, user.Id, user.Name, Context.ConnectionId, key);
            if (acquired)
            {
                await Clients.OthersInGroup(RoomGroupName(saveId))
                    .SendAsync("LockAcquired", new CollabLockDto { Key = key, Holder = user.Name });
            }
            return acquired;
        }

        /// <summary>
        /// 释放本连接持有的锁并广播 LockReleased；不持有该锁时静默忽略
        /// </summary>
        public async Task ReleaseLock(int saveId, string key)
        {
            GetCurrentUser();
            Throttle();
            if (string.IsNullOrWhiteSpace(key))
                return;
            if (_rooms.ReleaseLock(saveId, Context.ConnectionId, key))
                await Clients.OthersInGroup(RoomGroupName(saveId)).SendAsync("LockReleased", key);
        }

        /// <summary>
        /// 请求现任房主生成存档快照（新成员初始化）；服务器向房主连接转发 SnapshotRequested
        /// </summary>
        public async Task RequestSnapshot(int saveId)
        {
            var user = GetCurrentUser();
            var ownerConnections = _rooms.GetOwnerConnectionIds(saveId, user.Id);
            if (ownerConnections.Count == 0)
                throw new RqEx("房主不在线，请稍后重试");
            _logger.LogInformation("[CollabHub] 转发快照请求 saveId={SaveId}, from={UserName}", saveId, user.Name);
            await Clients.Clients(ownerConnections).SendAsync("SnapshotRequested", saveId);
        }

        // 断连/离房后的锁外广播：清锁逐条 LockReleased → UserLeft → 房主变更 OwnerChanged
        private async Task BroadcastLeave(int saveId, CollabLeaveResult res)
        {
            var group = RoomGroupName(saveId);
            foreach (var l in res.ReleasedLocks)
                await Clients.Group(group).SendAsync("LockReleased", l.Key);
            if (res.LeftMember is not null)
                await Clients.Group(group).SendAsync("UserLeft", res.LeftMember);
            if (res.NewOwner is not null)
                await Clients.Group(group).SendAsync("OwnerChanged", res.NewOwner);
        }

        private static string RoomGroupName(int saveId) => saveId.ToString();

        // Hub 层每连接令牌桶限流（SubmitOp 与 AcquireLock/ReleaseLock 共用同一桶）
        private void Throttle()
        {
            if (!Context.Items.TryGetValue(TokenBucketKey, out var obj) || obj is not ConnectionTokenBucket bucket)
            {
                bucket = new ConnectionTokenBucket(
                    _rooms.Options.RateLimitPerSecond, _rooms.Options.RateLimitBurst);
                Context.Items[TokenBucketKey] = bucket;
            }
            if (!bucket.TryTake())
                throw new RqEx("操作过于频繁，请稍后再试");
        }

        private User GetCurrentUser()
        {
            var user = TryGetCurrentUserInfo();
            if (user is null)
                throw new RqEx("请登录后重试");
            return user;
        }

        private User? TryGetCurrentUserInfo()
        {
            var userIdClaim = Context.User?.Claims
                .FirstOrDefault(x => x.Type.Contains(JwtRegisteredClaimNames.NameId));
            if (userIdClaim is null || !int.TryParse(userIdClaim.Value, out int userId))
                return null;

            return _db.Users.FirstOrDefault(x => x.Id == userId && !x.Deleted);
        }

        private sealed class ConnectionTokenBucket(double ratePerSecond, int burst)
        {
            private double _tokens = burst;
            private DateTime _lastRefill = DateTime.UtcNow;
            public bool TryTake()
            {
                lock (this)
                {
                    var now = DateTime.UtcNow;
                    _tokens = Math.Min(burst, _tokens + (now - _lastRefill).TotalSeconds * ratePerSecond);
                    _lastRefill = now;
                    if (_tokens < 1)
                        return false;
                    _tokens -= 1;
                    return true;
                }
            }
        }
    }
}
