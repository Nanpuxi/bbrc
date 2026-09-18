using AARC.WebApi.Services.Collab;

namespace AARC.WebApi.Test.Collab;

public class CollabRoomManagerSnapshotTests
{
    private const int SaveId = 1;

    private static CollabSnapshotUpload Upload(int saveId = SaveId, long seq = 7, string payload = "payload")
        => new() { SaveId = saveId, Seq = seq, Payload = payload };

    [Fact]
    public void UploadSnapshot_OnlyOwnerAllowed()
    {
        // Arrange：u1 房主，u2 成员
        var mgr = TestRooms.NewManager();
        TestRooms.Join(mgr, SaveId, 1);
        TestRooms.Join(mgr, SaveId, 2);

        // Act & Assert：非房主上传被拒
        Assert.Throws<RqEx>(() => mgr.UploadSnapshot(2, Upload()));

        // 房主上传成功，成员可下载
        mgr.UploadSnapshot(1, Upload());
        var got = mgr.GetSnapshot(SaveId, 2);
        Assert.NotNull(got);
        Assert.Equal(7, got!.Seq);
        Assert.Equal("payload", got.Payload);
        Assert.Equal("user1", got.FromUserName);
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
        Assert.Throws<RqEx>(() => mgr.GetSnapshot(SaveId, 99));
        Assert.Throws<RqEx>(() => mgr.GetSnapshot(999, 1));
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
        Assert.Throws<RqEx>(() => mgr.UploadSnapshot(1, Upload(payload: "abcd")));
    }

    [Fact]
    public void UploadSnapshot_RoomMissing_Throws()
    {
        // Arrange
        var mgr = TestRooms.NewManager();

        // Act & Assert
        Assert.Throws<RqEx>(() => mgr.UploadSnapshot(1, Upload(saveId: 999)));
    }
}
