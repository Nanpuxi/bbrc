using AARC.Collab;
using System.Collections.Concurrent;

namespace AARC.Collab.Test;

public class CollabRoomManagerOpTests
{
    private const int SaveId = 1;

    [Fact]
    public async Task AppendOp_Concurrent_SeqsAreExactlyOneToN()
    {
        // Arrange：5 个成员
        var mgr = TestRooms.NewManager();
        foreach (var u in Enumerable.Range(1, 5))
            TestRooms.Join(mgr, SaveId, u);

        // Act：并发提交 50 条 op
        var seqs = new ConcurrentBag<long>();
        await Task.WhenAll(Enumerable.Range(0, 50).Select(i => Task.Run(() =>
        {
            var userId = i % 5 + 1;
            var op = mgr.AppendOp(SaveId, userId, $"user{userId}", $"op-{i}", "{}", 0);
            seqs.Add(op.Seq);
        })));

        // Assert：Seq 恰好是 1..50 各一次（无重复无缺失）
        Assert.Equal(Enumerable.Range(1, 50).Select(x => (long)x), seqs.OrderBy(x => x));
    }

    [Fact]
    public void SyncOps_QueueOrderMatchesSeqOrder()
    {
        // Arrange
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1);
        for (var i = 0; i < 5; i++)
            mgr.AppendOp(SaveId, 1, "user1", $"op-{i}", "{}", 0);

        // Act
        var sync = mgr.SyncOps(SaveId, 0);

        // Assert：出队顺序即 Seq 升序，opId 与 Seq 一一对应
        Assert.Equal(new long[] { 1, 2, 3, 4, 5 }, sync.Ops.Select(x => x.Seq));
        Assert.Equal(Enumerable.Range(0, 5).Select(i => $"op-{i}"), sync.Ops.Select(x => x.OpId));
        Assert.False(sync.Gap);
        Assert.Equal(5, sync.LatestSeq);
    }

    [Fact]
    public void SyncOps_Incremental_OnlyAfterGivenSeq()
    {
        // Arrange
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1);
        for (var i = 0; i < 3; i++)
            mgr.AppendOp(SaveId, 1, "user1", $"op-{i}", "{}", 0);

        // Act
        var sync = mgr.SyncOps(SaveId, 2);

        // Assert
        Assert.Equal(new long[] { 3 }, sync.Ops.Select(x => x.Seq));
        Assert.False(sync.Gap);
    }

    [Fact]
    public void SyncOps_TrimmedByCount_GapOnlyWhenNeededOpsLost()
    {
        // Arrange：条数上限 3，超出从头出队
        var mgr = TestRooms.NewManager(o => o.MaxOpsPerRoom = 3);
        TestRooms.Join(mgr, SaveId, 1);
        for (var i = 0; i < 5; i++)
            mgr.AppendOp(SaveId, 1, "user1", $"op-{i}", "{}", 0);

        // Act & Assert：afterSeq=1 需要 seq2（已丢）→ Gap；afterSeq=2 需要 seq3（还在）→ 无 Gap
        var gapped = mgr.SyncOps(SaveId, 1);
        Assert.True(gapped.Gap);
        Assert.Equal(new long[] { 3, 4, 5 }, gapped.Ops.Select(x => x.Seq));

        var intact = mgr.SyncOps(SaveId, 2);
        Assert.False(intact.Gap);
        Assert.Equal(new long[] { 3, 4, 5 }, intact.Ops.Select(x => x.Seq));
    }

    [Fact]
    public void SyncOps_TrimmedByAge_AllOpsEvictedAndGap()
    {
        // Arrange：负的保留时长使全部 op 立即过期（确定性触发时间修剪）
        var mgr = TestRooms.NewManager(o => o.OpRetentionMinutes = -1);
        TestRooms.Join(mgr, SaveId, 1);
        for (var i = 0; i < 3; i++)
            mgr.AppendOp(SaveId, 1, "user1", $"op-{i}", "{}", 0);

        // Act
        var sync = mgr.SyncOps(SaveId, 0);

        // Assert：队列空但 LatestSeq 保留 → Gap
        Assert.Empty(sync.Ops);
        Assert.Equal(3, sync.LatestSeq);
        Assert.True(sync.Gap);
    }

    [Fact]
    public void SyncOps_RoomMissing_ReturnsEmptyWithLatestSeqZero()
    {
        // Arrange
        var mgr = TestRooms.NewManager();

        // Act & Assert：房间不存在视为无任何 op；afterSeq>0 时按 Gap 处理
        var fresh = mgr.SyncOps(999, 0);
        Assert.Equal(0, fresh.LatestSeq);
        Assert.False(fresh.Gap);

        var stale = mgr.SyncOps(999, 5);
        Assert.True(stale.Gap);
    }

    [Fact]
    public void AppendOp_NotMemberOrRoomMissing_Throws()
    {
        // Arrange
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1);

        // Act & Assert
        Assert.Throws<CollabException>(() => mgr.AppendOp(SaveId, 99, "ghost", "op-x", "{}", 0));
        Assert.Throws<CollabException>(() => mgr.AppendOp(999, 1, "user1", "op-x", "{}", 0));
    }
}
