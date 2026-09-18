using AARC.Collab;
using System.Collections.Concurrent;

namespace AARC.Collab.Test;

/// <summary>
/// 前缀租约语义（id-allocation.md §7.1）：在房期间唯一、离房/断连回收、回收后可复用
/// </summary>
public class CollabRoomManagerPrefixTests
{
    private const int SaveId = 1;

    [Fact]
    public async Task JoinRoom_ConcurrentJoins_PrefixesNeverDoubleAllocated()
    {
        // Arrange
        var mgr = TestRooms.NewManager();

        // Act：10 个用户（房间上限）并发首次进房
        var prefixes = new ConcurrentBag<int>();
        await Task.WhenAll(Enumerable.Range(1, 10).Select(u => Task.Run(() =>
            prefixes.Add(TestRooms.Join(mgr, SaveId, u).IdPrefix))));

        // Assert：前缀互不重复，且都在合法范围内
        Assert.Equal(10, prefixes.Distinct().Count());
        Assert.All(prefixes, p => Assert.InRange(p, 1, mgr.Options.MaxIdPrefix));
    }

    [Fact]
    public void JoinRoom_RejoinSameUser_IdempotentSamePrefix()
    {
        // Arrange
        var mgr = TestRooms.NewManager();
        var first = mgr.JoinRoom(SaveId, 1, "user1", "conn-1a", out var firstMember);

        // Act：同一用户第二个连接进房
        var second = mgr.JoinRoom(SaveId, 1, "user1", "conn-1b", out var secondMember);

        // Assert：前缀不变；首个连接广播 UserJoined，后续连接不广播
        Assert.Equal(first.IdPrefix, second.IdPrefix);
        Assert.NotNull(firstMember);
        Assert.Null(secondMember);
    }

    [Fact]
    public void LeaveRoom_PrefixRecycled_NewMemberReusesLowestFree()
    {
        // Arrange：u1=前缀1，u2=前缀2
        var mgr = TestRooms.NewManager();
        Assert.Equal(1, TestRooms.Join(mgr, SaveId, 1).IdPrefix);
        Assert.Equal(2, TestRooms.Join(mgr, SaveId, 2).IdPrefix);

        // Act：u1 离房，u3 进房
        var leave = mgr.LeaveRoom(SaveId, "conn-1");
        var rejoined = TestRooms.Join(mgr, SaveId, 3);

        // Assert：前缀 1 被回收并复用
        Assert.NotNull(leave?.LeftMember);
        Assert.Equal(1, rejoined.IdPrefix);
    }

    [Fact]
    public void LeaveRoom_PartialConnection_PrefixKeptUntilLastConnectionLeaves()
    {
        // Arrange：u1 两个连接（前缀 1），u2（前缀 2）
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1, "conn-1a");
        TestRooms.Join(mgr, SaveId, 1, "conn-1b");
        TestRooms.Join(mgr, SaveId, 2);

        // Act：u1 只断开一个连接，u3 进房
        var partial = mgr.LeaveRoom(SaveId, "conn-1a");
        var whileKept = TestRooms.Join(mgr, SaveId, 3);

        // Assert：成员保留、前缀 1 不回收，u3 只能拿 3
        Assert.Null(partial?.LeftMember);
        Assert.Equal(3, whileKept.IdPrefix);

        // Act：u1 最后一个连接离开，u4 进房
        var full = mgr.LeaveRoom(SaveId, "conn-1b");
        var afterRelease = TestRooms.Join(mgr, SaveId, 4);

        // Assert：前缀 1 此刻才回收复用
        Assert.NotNull(full?.LeftMember);
        Assert.Equal(1, afterRelease.IdPrefix);
    }

    [Fact]
    public void LeaveAllRooms_PrefixRecycled()
    {
        // Arrange
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1);

        // Act：断连
        var leaves = mgr.LeaveAllRooms("conn-1");

        // Assert
        Assert.Single(leaves);
        Assert.Equal(1, TestRooms.Join(mgr, SaveId, 2).IdPrefix);
    }

    [Fact]
    public void JoinRoom_RoomFull_Throws()
    {
        // Arrange：默认上限 10 人
        var mgr = TestRooms.NewManager();
        foreach (var u in Enumerable.Range(1, 10))
            TestRooms.Join(mgr, SaveId, u);

        // Act & Assert
        Assert.Throws<CollabException>(() => TestRooms.Join(mgr, SaveId, 11));
    }

    [Fact]
    public void JoinRoom_PrefixExhausted_Throws()
    {
        // Arrange：防御性分支——放宽人数上限、压缩前缀空间
        var mgr = TestRooms.NewManager(o => { o.MaxRoomMembers = 100; o.MaxIdPrefix = 2; });
        TestRooms.Join(mgr, SaveId, 1);
        TestRooms.Join(mgr, SaveId, 2);

        // Act & Assert：无空闲前缀时拒绝加入
        Assert.Throws<CollabException>(() => TestRooms.Join(mgr, SaveId, 3));
    }
}
