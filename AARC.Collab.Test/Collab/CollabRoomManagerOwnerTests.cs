using AARC.Collab;

namespace AARC.Collab.Test;

/// <summary>
/// 仅存档所有者可创建房间（backend-plan.md §7.1 ①，2026-09 修订）：
/// 房内无成员时拒绝非所有者加入（其他人进入不启动协作机制）；
/// 房间已存在时协作者加入不受限；拒绝不得残留空房（HasRoom 误报可协作）
/// </summary>
public class CollabRoomManagerOwnerTests
{
    private const int SaveId = 1;

    [Fact]
    public void JoinRoom_RoomAbsent_NonOwnerRejected()
    {
        var mgr = TestRooms.NewManager();

        // 非存档所有者（存档归 user1）试图在无房时进房
        var ex = Assert.Throws<CollabException>(() => TestRooms.Join(mgr, SaveId, 2, saveOwnerUserId: 1));
        Assert.Equal("仅存档所有者可开启协作", ex.Message);
    }

    [Fact]
    public void JoinRoom_RoomAbsent_WrongOwnerIdAlsoRejected()
    {
        var mgr = TestRooms.NewManager();

        // 首个进房者也不是存档所有者（传错归属）：同样拒绝——判定是严格相等
        Assert.Throws<CollabException>(() => TestRooms.Join(mgr, SaveId, 1, saveOwnerUserId: 2));
    }

    [Fact]
    public void JoinRoom_RoomAbsent_SaveOwnerCreatesRoom()
    {
        var mgr = TestRooms.NewManager();

        var res = TestRooms.Join(mgr, SaveId, 1, saveOwnerUserId: 1);

        Assert.True(mgr.HasRoom(SaveId));
        Assert.Equal(1, res.OwnerUserId);
    }

    [Fact]
    public void JoinRoom_RoomExists_NonOwnerCanJoinAsCollaborator()
    {
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1, saveOwnerUserId: 1);

        // 房间已存在：非所有者可加入，但房主仍是存档所有者
        var res = TestRooms.Join(mgr, SaveId, 2, saveOwnerUserId: 1);

        Assert.Equal(2, res.Members.Count);
        Assert.Equal(1, res.OwnerUserId);
    }

    [Fact]
    public void JoinRoom_RejectedNonOwnerLeavesNoEmptyRoom()
    {
        var mgr = TestRooms.NewManager();

        Assert.Throws<CollabException>(() => TestRooms.Join(mgr, SaveId, 2, saveOwnerUserId: 1));
        // 拒绝不得残留空房（否则 HasRoom 误报"可协作"，徽章假亮）
        Assert.False(mgr.HasRoom(SaveId));

        // 此后存档所有者仍可正常开房，其他成员可加入
        TestRooms.Join(mgr, SaveId, 1, saveOwnerUserId: 1);
        TestRooms.Join(mgr, SaveId, 2, saveOwnerUserId: 1);
        Assert.True(mgr.HasRoom(SaveId));
    }

    [Fact]
    public async Task JoinRoom_ConcurrentNonOwners_RacingRejectionsLeaveNoRoom()
    {
        var mgr = TestRooms.NewManager();

        // 多个非所有者并发试图进无房存档：全部拒绝，且不留空房
        var tasks = Enumerable.Range(2, 8).Select(u => Task.Run(() =>
        {
            try
            {
                TestRooms.Join(mgr, SaveId, u, saveOwnerUserId: 1);
                return false; // 不应有人成功
            }
            catch (CollabException)
            {
                return true;
            }
        }));
        var results = await Task.WhenAll(tasks);

        Assert.All(results, Assert.True);
        Assert.False(mgr.HasRoom(SaveId));
    }

    [Fact]
    public async Task JoinRoom_ConcurrentWithOwner_OwnerAlwaysEndsUpRoomOwner()
    {
        var mgr = TestRooms.NewManager();

        // 存档所有者与非所有者同时进房：非所有者要么先于房主开房被拒，要么随后加入；
        // 任何时序下房主都必须是 user1
        var tasks = new List<Task>
        {
            Task.Run(() => TestRooms.Join(mgr, SaveId, 1, saveOwnerUserId: 1))
        };
        tasks.AddRange(Enumerable.Range(2, 5).Select(u => Task.Run(() =>
        {
            try { TestRooms.Join(mgr, SaveId, u, saveOwnerUserId: 1); }
            catch (CollabException) { /* 先于房主开房被拒属合法竞态结果 */ }
        })));
        await Task.WhenAll(tasks);

        Assert.True(mgr.HasRoom(SaveId));
        var res = TestRooms.Join(mgr, SaveId, 9, saveOwnerUserId: 1);
        Assert.Equal(1, res.OwnerUserId);
    }
}
