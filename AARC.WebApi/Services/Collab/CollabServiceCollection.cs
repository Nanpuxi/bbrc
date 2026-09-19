using AARC.Collab;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;

namespace AARC.WebApi.Services.Collab;

public static class CollabServiceCollection
{
    public static IServiceCollection AddCollabServices(this IServiceCollection services, IConfiguration config)
    {
        services.Configure<CollabOptions>(config.GetSection("Collab"));
        services.AddSingleton(sp =>
        {
            var rooms = new CollabRoomManager(
                sp.GetRequiredService<IOptions<CollabOptions>>().Value);
            // 房主断网宽限期超时关房（backend-plan.md §7.1 ③）：管理器零依赖不持有 IHubContext，
            // 由这里装配广播回调（锁外触发；到点时房主连接必已不在组内，组广播即"仍在房成员"）
            rooms.GraceCloseNotifier = saveId =>
                sp.GetRequiredService<IHubContext<CollabHub>>()
                    .Clients.Group(saveId.ToString())
                    .SendAsync("RoomClosed", saveId);
            return rooms;
        });
        return services;
    }
}
