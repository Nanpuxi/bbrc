using AARC.Collab;
using Microsoft.Extensions.Options;

namespace AARC.WebApi.Services.Collab;

public static class CollabServiceCollection
{
    public static IServiceCollection AddCollabServices(this IServiceCollection services, IConfiguration config)
    {
        services.Configure<CollabOptions>(config.GetSection("Collab"));
        services.AddSingleton(sp => new CollabRoomManager(
            sp.GetRequiredService<IOptions<CollabOptions>>().Value));
        return services;
    }
}
