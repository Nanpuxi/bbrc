namespace AARC.WebApi.Services.Clients
{
    public static class ClientsServices
    {
        public static IServiceCollection AddClientsServices(
            this IServiceCollection services)
        {
            services.AddSingleton<ClientAppService>();
            return services;
        }
    }
}
