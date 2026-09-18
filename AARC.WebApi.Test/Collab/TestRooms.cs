using AARC.WebApi.Services.Collab;
using Microsoft.Extensions.Options;

namespace AARC.WebApi.Test.Collab;

/// <summary>
/// 每个测试 new 一个全新 CollabRoomManager 实例获得隔离（不依赖 DI 单例）
/// </summary>
internal static class TestRooms
{
    public static CollabRoomManager NewManager(Action<CollabOptions>? configure = null)
    {
        var options = new CollabOptions();
        configure?.Invoke(options);
        return new CollabRoomManager(Options.Create(options));
    }

    public static JoinCollabRoomResult Join(CollabRoomManager mgr, int saveId, int userId, string? connectionId = null)
        => mgr.JoinRoom(saveId, userId, $"user{userId}", connectionId ?? $"conn-{userId}", out _);
}
