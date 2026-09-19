using AARC.Collab;

namespace AARC.Collab.Test;

/// <summary>
/// 房主生命周期修订（backend-plan.md §7.1 ②③，2026-09 修订）：
/// 房主主动关房 CloseRoom（仅房主、幂等）、房主断连宽限期
/// （OwnerOfflineGraceSeconds 内重连恢复 / 超时视同关房广播 RoomClosed）
/// </summary>
public class CollabRoomManagerCloseTests
{
    private const int SaveId = 1;

    [Fact]
    public void CloseRoom_ByOwner_ClosesRoomAndSnapshot()
    {
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1);
        TestRooms.Join(mgr, SaveId, 2);
        mgr.UploadSnapshot(1, new CollabSnapshotUpload { SaveId = SaveId, Seq = 0, Payload = "x" });

        var closed = mgr.CloseRoom(SaveId, 1);

        Assert.True(closed);
        Assert.False(mgr.HasRoom(SaveId));
        // 快照缓存随房间回收
        Assert.Throws<CollabException>(() => mgr.GetSnapshot(SaveId, 2));
    }

    [Fact]
    public void CloseRoom_ByNonOwner_ThrowsAndRoomKept()
    {
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1, saveOwnerUserId: 1);
        TestRooms.Join(mgr, SaveId, 2, saveOwnerUserId: 1);

        var ex = Assert.Throws<CollabException>(() => mgr.CloseRoom(SaveId, 2));
        Assert.Equal("仅房主可关闭房间", ex.Message);
        Assert.True(mgr.HasRoom(SaveId));
    }

    [Fact]
    public void CloseRoom_RoomAbsent_IdempotentSilent()
    {
        var mgr = TestRooms.NewManager();

        // 房间不存在：静默成功（Hub 不广播），无异常
        Assert.False(mgr.CloseRoom(SaveId, 1));
    }

    [Fact]
    public void OwnerDisconnect_WithOthersInRoom_EntersGraceKeepsEverything()
    {
        var mgr = TestRooms.NewManager(o => o.OwnerOfflineGraceSeconds = 60);
        TestRooms.Join(mgr, SaveId, 1);
        TestRooms.Join(mgr, SaveId, 2);
        mgr.TryAcquireLock(SaveId, 1, "user1", "conn-1", "k1");
        mgr.AppendOp(SaveId, 1, "user1", "op-1", "{}", 0);

        // 房主断连（未发主动关房信号）→ 宽限期
        var leaves = mgr.LeaveAllRooms("conn-1");

        var res = Assert.Single(leaves).Value;
        Assert.True(res.OwnerOffline);
        Assert.Empty(res.ReleasedLocks);    // 房主锁保留（§7.1 ③）
        Assert.Null(res.LeftMember);        // 房主成员保留
        Assert.True(mgr.HasRoom(SaveId));
        // 前缀租约保留：新房主进房拿到的是 3 而不是 1
        Assert.Equal(3, TestRooms.Join(mgr, SaveId, 3, saveOwnerUserId: 1).IdPrefix);
        // 房主锁仍在：他人抢不走
        Assert.False(mgr.TryAcquireLock(SaveId, 3, "user3", "conn-3", "k1"));
        // 期间加入者能看到房主处于离线状态
        Assert.True(TestRooms.Join(mgr, SaveId, 4, saveOwnerUserId: 1).OwnerOffline);
    }

    [Fact]
    public void OwnerReconnect_WithinGrace_ResumesWithSamePrefix()
    {
        var mgr = TestRooms.NewManager(o => o.OwnerOfflineGraceSeconds = 60);
        TestRooms.Join(mgr, SaveId, 1);
        TestRooms.Join(mgr, SaveId, 2);
        mgr.TryAcquireLock(SaveId, 1, "user1", "conn-1", "k1");
        mgr.LeaveAllRooms("conn-1");

        // 房主重连（JoinRoom 幂等）：恢复房主身份、前缀租约不变
        var res = TestRooms.Join(mgr, SaveId, 1, connectionId: "conn-1b");

        Assert.True(res.OwnerReconnected);
        Assert.False(res.OwnerOffline);
        Assert.Equal(1, res.OwnerUserId);
        Assert.Equal(1, res.IdPrefix);
        Assert.True(mgr.HasRoom(SaveId));
        // 房主重连后锁恢复仲裁：同一连接重复加锁幂等
        Assert.True(mgr.TryAcquireLock(SaveId, 1, "user1", "conn-1b", "k1"));
    }

    [Fact]
    public async Task GraceTimeout_ClosesRoomAndNotifies()
    {
        var notified = new List<int>();
        var mgr = TestRooms.NewManager(o => o.OwnerOfflineGraceSeconds = 0);
        mgr.GraceCloseNotifier = saveId => { lock (notified) notified.Add(saveId); return Task.CompletedTask; };
        TestRooms.Join(mgr, SaveId, 1);
        TestRooms.Join(mgr, SaveId, 2);
        mgr.TryAcquireLock(SaveId, 2, "user2", "conn-2", "k2");
        mgr.LeaveAllRooms("conn-1");

        // 宽限期（0 秒）超时：视同主动关房（等通知而非 HasRoom——回收先发生于广播）
        await WaitUntil(() => { lock (notified) return notified.Count > 0; });
        Assert.False(mgr.HasRoom(SaveId));

        lock (notified)
            Assert.Equal([SaveId], notified);
        // 剩余成员的连接映射被清理：其断连不再产生任何结果
        Assert.Empty(mgr.LeaveAllRooms("conn-2"));
        // 房间已关：再进房视为全新房间
        Assert.Equal(1, TestRooms.Join(mgr, SaveId, 5).IdPrefix);
    }

    [Fact]
    public async Task OwnerReconnect_WithinGrace_CancelsTimeout()
    {
        var notified = new List<int>();
        var mgr = TestRooms.NewManager(o => o.OwnerOfflineGraceSeconds = 1);
        mgr.GraceCloseNotifier = saveId => { lock (notified) notified.Add(saveId); return Task.CompletedTask; };
        TestRooms.Join(mgr, SaveId, 1);
        TestRooms.Join(mgr, SaveId, 2);
        mgr.LeaveAllRooms("conn-1");
        TestRooms.Join(mgr, SaveId, 1, connectionId: "conn-1b");   // 宽限期内重连

        await Task.Delay(1500);   // 等原超时点过去

        Assert.True(mgr.HasRoom(SaveId));
        lock (notified)
            Assert.Empty(notified);
    }

    [Fact]
    public void CloseRoom_DuringGrace_ClosesImmediately()
    {
        var mgr = TestRooms.NewManager(o => o.OwnerOfflineGraceSeconds = 60);
        TestRooms.Join(mgr, SaveId, 1, connectionId: "conn-1a");
        TestRooms.Join(mgr, SaveId, 2);
        mgr.LeaveAllRooms("conn-1a");   // 房主断连 → 宽限期

        // 房主从另一连接主动关房
        Assert.True(mgr.CloseRoom(SaveId, 1));

        Assert.False(mgr.HasRoom(SaveId));
    }

    private static async Task WaitUntil(Func<bool> cond, int timeoutMs = 3000)
    {
        var start = DateTime.Now;
        while (!cond())
        {
            if ((DateTime.Now - start).TotalMilliseconds > timeoutMs)
                throw new TimeoutException("等待超时");
            await Task.Delay(10);
        }
    }
}
