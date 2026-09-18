using AARC.WebApi.Services.Collab;

namespace AARC.WebApi.Test.Collab;

public class CollabRoomManagerMemberTests
{
    private const int SaveId = 1;

    [Fact]
    public void LeaveAllRooms_Disconnect_ReleasesAllLocksOfThatConnection()
    {
        // Arrange：u1 持 k1/k2，u2 持 k3
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1);
        TestRooms.Join(mgr, SaveId, 2);
        mgr.TryAcquireLock(SaveId, 1, "user1", "conn-1", "k1");
        mgr.TryAcquireLock(SaveId, 1, "user1", "conn-1", "k2");
        mgr.TryAcquireLock(SaveId, 2, "user2", "conn-2", "k3");

        // Act：u1 断连
        var leaves = mgr.LeaveAllRooms("conn-1");

        // Assert：k1/k2 释放并逐条出现在结果里；u1 成员移出
        var res = Assert.Single(leaves).Value;
        Assert.Equal(2, res.ReleasedLocks.Count);
        Assert.Contains(res.ReleasedLocks, x => x.Key == "k1");
        Assert.Contains(res.ReleasedLocks, x => x.Key == "k2");
        Assert.Equal(1, res.LeftMember?.UserId);
        // k1 现在可被他人获得；k3 仍被 u2 持有
        TestRooms.Join(mgr, SaveId, 3);
        Assert.True(mgr.TryAcquireLock(SaveId, 3, "user3", "conn-3", "k1"));
        Assert.False(mgr.TryAcquireLock(SaveId, 3, "user3", "conn-3", "k3"));
    }

    [Fact]
    public void LeaveRoom_MultiConnection_OnlyThatConnectionsLocksReleased()
    {
        // Arrange：同一用户两个连接各持一把锁
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1, "conn-1a");
        TestRooms.Join(mgr, SaveId, 1, "conn-1b");
        mgr.TryAcquireLock(SaveId, 1, "user1", "conn-1a", "k1");
        mgr.TryAcquireLock(SaveId, 1, "user1", "conn-1b", "k2");
        TestRooms.Join(mgr, SaveId, 2);

        // Act：只离开 conn-1a
        var res = mgr.LeaveRoom(SaveId, "conn-1a");

        // Assert：只清 k1，成员保留（LeftMember 为 null），k2 仍被持有
        Assert.NotNull(res);
        Assert.Equal("k1", Assert.Single(res!.ReleasedLocks).Key);
        Assert.Null(res.LeftMember);
        Assert.True(mgr.TryAcquireLock(SaveId, 2, "user2", "conn-2", "k1"));
        Assert.False(mgr.TryAcquireLock(SaveId, 2, "user2", "conn-2", "k2"));
    }

    [Fact]
    public void LeaveRoom_OwnerLeaves_EarliestRemainingMemberSucceeds()
    {
        // Arrange：u1 房主，u2、u3 随后加入
        var mgr = TestRooms.NewManager();
        var first = TestRooms.Join(mgr, SaveId, 1);
        TestRooms.Join(mgr, SaveId, 2);
        TestRooms.Join(mgr, SaveId, 3);
        Assert.Equal(1, first.OwnerUserId);

        // Act：房主离开
        var res = mgr.LeaveRoom(SaveId, "conn-1");

        // Assert：最早加入的剩余成员继任
        Assert.Equal(2, res?.NewOwner?.UserId);

        // Act：新房主再离开
        var res2 = mgr.LeaveRoom(SaveId, "conn-2");

        // Assert
        Assert.Equal(3, res2?.NewOwner?.UserId);
    }

    [Fact]
    public void LeaveRoom_NonOwnerLeaves_NoOwnerChange()
    {
        // Arrange
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1);
        TestRooms.Join(mgr, SaveId, 2);

        // Act
        var res = mgr.LeaveRoom(SaveId, "conn-2");

        // Assert
        Assert.NotNull(res?.LeftMember);
        Assert.Null(res?.NewOwner);
        Assert.False(res!.RoomDestroyed);
    }

    [Fact]
    public void LeaveRoom_LastMember_RoomDestroyedAndStateForgotten()
    {
        // Arrange：房内留有 op 与锁
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1);
        mgr.AppendOp(SaveId, 1, "user1", "op-0", "{}", 0);
        mgr.TryAcquireLock(SaveId, 1, "user1", "conn-1", "k1");

        // Act：最后的成员离开
        var res = mgr.LeaveRoom(SaveId, "conn-1");

        // Assert：房间回收；之后 SyncOps 视为全新房间，AppendOp 找不到房间
        Assert.True(res?.RoomDestroyed);
        Assert.Equal(0, mgr.SyncOps(SaveId, 0).LatestSeq);
        Assert.Throws<RqEx>(() => mgr.AppendOp(SaveId, 1, "user1", "op-1", "{}", 0));
    }

    [Fact]
    public void LeaveRoom_UnknownConnection_ReturnsNull()
    {
        // Arrange
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1);

        // Act & Assert
        Assert.Null(mgr.LeaveRoom(SaveId, "conn-unknown"));
        Assert.Null(mgr.LeaveRoom(999, "conn-1"));
        Assert.Empty(mgr.LeaveAllRooms("conn-unknown"));
    }

    [Fact]
    public void GetOwnerConnectionIds_ReturnsAllConnectionsOfOwner()
    {
        // Arrange：房主 u1 两个连接
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1, "conn-1a");
        TestRooms.Join(mgr, SaveId, 1, "conn-1b");
        TestRooms.Join(mgr, SaveId, 2);

        // Act
        var conns = mgr.GetOwnerConnectionIds(SaveId, 2);

        // Assert
        Assert.Equal(2, conns.Count);
        Assert.Contains("conn-1a", conns);
        Assert.Contains("conn-1b", conns);
        // 非成员调用抛错
        Assert.Throws<RqEx>(() => mgr.GetOwnerConnectionIds(SaveId, 99));
    }
}
