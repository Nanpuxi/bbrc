using AARC.Collab;

namespace AARC.Collab.Test;

public class CollabRoomManagerSnapshotTests
{
    private const int SaveId = 1;

    private static CollabSnapshotUpload Upload(int saveId = SaveId, long seq = 7, string payload = "payload")
        => new() { SaveId = saveId, Seq = seq, Payload = payload };

    [Fact]
    public void UploadSnapshot_MemberAllowed_OwnerPreferred()
    {
        // Arrange：u1 房主，u2 成员
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1);
        TestRooms.Join(mgr, SaveId, 2);

        // Act & Assert：任何在房成员均可上传（§7.1 ③：房主无存活连接时成员兜底）；
        // 后上传者覆盖先上传者，FromUserName 为实际上传者
        mgr.UploadSnapshot(1, Upload(payload: "owner"));
        mgr.UploadSnapshot(2, Upload(seq: 8, payload: "member"));

        var got = mgr.GetSnapshot(SaveId, 2);
        Assert.NotNull(got);
        Assert.Equal(8, got!.Seq);
        Assert.Equal("member", got.Payload);
        Assert.Equal("user2", got.FromUserName);
    }

    [Fact]
    public void GetSnapshot_NotUploaded_ReturnsNull()
    {
        // Arrange
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1);

        // Act & Assert
        Assert.Null(mgr.GetSnapshot(SaveId, 1));
    }

    [Fact]
    public void GetSnapshot_NotMember_Throws()
    {
        // Arrange
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1);
        mgr.UploadSnapshot(1, Upload());

        // Act & Assert
        Assert.Throws<CollabException>(() => mgr.GetSnapshot(SaveId, 99));
        Assert.Throws<CollabException>(() => mgr.GetSnapshot(999, 1));
    }

    [Fact]
    public void GetSnapshot_Expired_ReturnsNull()
    {
        // Arrange：负 TTL 使快照立即过期（确定性触发）
        var mgr = TestRooms.NewManager(o => o.SnapshotTtlSeconds = -1);
        TestRooms.Join(mgr, SaveId, 1);
        mgr.UploadSnapshot(1, Upload());

        // Act & Assert
        Assert.Null(mgr.GetSnapshot(SaveId, 1));
    }

    [Fact]
    public void UploadSnapshot_NewerOverwritesOlder()
    {
        // Arrange
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1);
        mgr.UploadSnapshot(1, Upload(seq: 7, payload: "old"));

        // Act
        mgr.UploadSnapshot(1, Upload(seq: 9, payload: "new"));

        // Assert
        var got = mgr.GetSnapshot(SaveId, 1);
        Assert.Equal(9, got?.Seq);
        Assert.Equal("new", got?.Payload);
    }

    [Fact]
    public void UploadSnapshot_OversizedPayload_Throws()
    {
        // Arrange
        var mgr = TestRooms.NewManager(o => o.MaxSnapshotPayloadLength = 3);
        TestRooms.Join(mgr, SaveId, 1);

        // Act & Assert
        Assert.Throws<CollabException>(() => mgr.UploadSnapshot(1, Upload(payload: "abcd")));
    }

    [Fact]
    public void UploadSnapshot_RoomMissing_Throws()
    {
        // Arrange
        var mgr = TestRooms.NewManager();

        // Act & Assert
        Assert.Throws<CollabException>(() => mgr.UploadSnapshot(1, Upload(saveId: 999)));
    }

    [Fact]
    public void GetSnapshotProviderConnectionIds_OwnerOnline_PrefersOwnerExcludesRequester()
    {
        // Arrange：u1 房主两个连接，u2/u3 成员
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1, "conn-1a");
        TestRooms.Join(mgr, SaveId, 1, "conn-1b");
        TestRooms.Join(mgr, SaveId, 2);
        TestRooms.Join(mgr, SaveId, 3);

        // Act：u2 请求快照
        var providers = mgr.GetSnapshotProviderConnectionIds(SaveId, 2, "conn-2");

        // Assert：优先房主的全部连接（房主在线时不麻烦成员）
        Assert.Equal(2, providers.Count);
        Assert.Contains("conn-1a", providers);
        Assert.Contains("conn-1b", providers);
        Assert.DoesNotContain("conn-2", providers);
    }

    [Fact]
    public void GetSnapshotProviderConnectionIds_OwnerOffline_FallsBackToMembers()
    {
        // Arrange：房主断连进入宽限期，u2/u3 在房
        var mgr = TestRooms.NewManager(o => o.OwnerOfflineGraceSeconds = 60);
        TestRooms.Join(mgr, SaveId, 1);
        TestRooms.Join(mgr, SaveId, 2);
        TestRooms.Join(mgr, SaveId, 3);
        mgr.LeaveAllRooms("conn-1");

        // Act：u2 请求快照（房主无存活连接）
        var providers = mgr.GetSnapshotProviderConnectionIds(SaveId, 2, "conn-2");

        // Assert：回退为其他成员（请求者自己排除）
        Assert.Equal(["conn-3"], providers);
    }

    [Fact]
    public void GetSnapshotProviderConnectionIds_OwnerRequesterExcludesSelf_ServedByMembers()
    {
        // Arrange：房主断连进入宽限期后重连（单一连接），随后自己走重建兜底
        var mgr = TestRooms.NewManager(o => o.OwnerOfflineGraceSeconds = 60);
        TestRooms.Join(mgr, SaveId, 1, "conn-1a");
        TestRooms.Join(mgr, SaveId, 2);
        mgr.LeaveAllRooms("conn-1a");                    // 房主断连 → 宽限期
        TestRooms.Join(mgr, SaveId, 1, "conn-1b");       // 房主重连（在线，单一连接）

        // Act：房主自己请求快照（resyncAfterReconnect 的回退路径）
        var providers = mgr.GetSnapshotProviderConnectionIds(SaveId, 1, "conn-1b");

        // Assert：排除请求者自己的连接后房主无其他存活连接 → 成员兜底
        Assert.Equal(["conn-2"], providers);
    }

    [Fact]
    public void GetSnapshotProviderConnectionIds_SoleMemberEmpty_ThrowsOnRequest()
    {
        // Arrange：只有请求者在房（房主离线、无其他成员）
        var mgr = TestRooms.NewManager(o => o.OwnerOfflineGraceSeconds = 60);
        TestRooms.Join(mgr, SaveId, 1);
        TestRooms.Join(mgr, SaveId, 2);
        mgr.LeaveAllRooms("conn-1");
        mgr.LeaveAllRooms("conn-2");   // u2 也断连 → 房内无存活连接

        // Act：u3 新进房后请求（房主成员保留但离线）
        TestRooms.Join(mgr, SaveId, 3, saveOwnerUserId: 1);
        var providers = mgr.GetSnapshotProviderConnectionIds(SaveId, 3, "conn-3");

        // Assert：无提供者（Hub 抛"暂无可提供快照的成员"）
        Assert.Empty(providers);
    }
}
