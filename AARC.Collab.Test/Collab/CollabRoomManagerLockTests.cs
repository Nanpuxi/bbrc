using AARC.Collab;
using System.Collections.Concurrent;

namespace AARC.Collab.Test;

public class CollabRoomManagerLockTests
{
    private const int SaveId = 1;

    [Fact]
    public async Task TryAcquireLock_ConcurrentContention_ExactlyOneWinner()
    {
        // Arrange：10 个成员同时在房内
        var mgr = TestRooms.NewManager();
        var conns = Enumerable.Range(1, 10).ToArray();
        foreach (var u in conns)
            TestRooms.Join(mgr, SaveId, u);

        // Act：10 个连接并发抢同一把锁
        var results = new ConcurrentBag<bool>();
        await Task.WhenAll(conns.Select(u => Task.Run(() =>
            results.Add(mgr.TryAcquireLock(SaveId, u, $"user{u}", $"conn-{u}", "pt:1")))));

        // Assert：恰好一个胜者
        Assert.Equal(1, results.Count(x => x));
        Assert.Equal(9, results.Count(x => !x));
    }

    [Fact]
    public void TryAcquireLock_SameConnectionTwice_IdempotentTrue()
    {
        // Arrange
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1);

        // Act & Assert
        Assert.True(mgr.TryAcquireLock(SaveId, 1, "user1", "conn-1", "pt:1"));
        Assert.True(mgr.TryAcquireLock(SaveId, 1, "user1", "conn-1", "pt:1"));
    }

    [Fact]
    public void TryAcquireLock_HeldByOther_ReturnsFalseUntilReleased()
    {
        // Arrange
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1);
        TestRooms.Join(mgr, SaveId, 2);
        mgr.TryAcquireLock(SaveId, 1, "user1", "conn-1", "pt:1");

        // Act & Assert：他人拿不到
        Assert.False(mgr.TryAcquireLock(SaveId, 2, "user2", "conn-2", "pt:1"));
        // 非持有者释放无效
        Assert.False(mgr.ReleaseLock(SaveId, "conn-2", "pt:1"));
        Assert.False(mgr.TryAcquireLock(SaveId, 2, "user2", "conn-2", "pt:1"));
        // 持有者释放后他人可获得
        Assert.True(mgr.ReleaseLock(SaveId, "conn-1", "pt:1"));
        Assert.True(mgr.TryAcquireLock(SaveId, 2, "user2", "conn-2", "pt:1"));
    }

    [Fact]
    public void TryAcquireLock_NotMember_Throws()
    {
        // Arrange
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1);

        // Act & Assert
        Assert.Throws<CollabException>(() => mgr.TryAcquireLock(SaveId, 99, "ghost", "conn-99", "pt:1"));
        Assert.Throws<CollabException>(() => mgr.TryAcquireLock(999, 1, "user1", "conn-1", "pt:1"));
    }

    [Fact]
    public void JoinRoom_LocksSnapshot_ContainsExistingLocks()
    {
        // Arrange：u1 持有两把锁
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1);
        mgr.TryAcquireLock(SaveId, 1, "user1", "conn-1", "pt:1");
        mgr.TryAcquireLock(SaveId, 1, "user1", "conn-1", "line:3");

        // Act：u2 后进房
        var result = mgr.JoinRoom(SaveId, 2, "user2", "conn-2", saveOwnerUserId: 1, out _);

        // Assert：锁表快照带给后进房者
        Assert.Equal(2, result.Locks.Count);
        Assert.Contains(result.Locks, x => x.Key == "pt:1" && x.Holder == "user1");
        Assert.Contains(result.Locks, x => x.Key == "line:3" && x.Holder == "user1");
    }
}
