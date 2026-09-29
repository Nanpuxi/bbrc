using AARC.Collab;

namespace AARC.Collab.Test;

/// <summary>
/// 每个测试 new 一个全新 CollabRoomManager 实例获得隔离（不依赖 DI 单例）
/// </summary>
internal static class TestRooms
{
    public static CollabRoomManager NewManager(Action<CollabOptions>? configure = null)
    {
        var options = new CollabOptions();
        configure?.Invoke(options);
        return new CollabRoomManager(options);
    }

    /// <summary>
    /// 加入房间。saveOwnerUserId 省略时以 userId 自身为存档所有者——既有用例都是
    /// 首个进房者当房主；"非所有者不能开房"的用例显式传 saveOwnerUserId（见 CollabRoomManagerOwnerTests）
    /// </summary>
    public static JoinCollabRoomResult Join(CollabRoomManager mgr, int saveId, int userId, string? connectionId = null, int? saveOwnerUserId = null)
        => mgr.JoinRoom(saveId, userId, $"user{userId}", connectionId ?? $"conn-{userId}", saveOwnerUserId ?? userId, out _);
}
