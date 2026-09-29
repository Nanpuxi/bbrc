namespace AARC.WebApi.Utils
{
    public static class CorsConfigure
    {
        public const string corsPolicyName = "aarcCors";
        // 客户端产物信息/下载专用：纯匿名公开接口（无 cookie），供 tauri 本地版（tauri://localhost）、
        // 浏览器 dev 等任意异源环境调用（检查更新、跳转下载页），故允许任意来源
        public const string clientAppCorsPolicyName = "clientAppCors";
        public static IServiceCollection AddCors(this IServiceCollection services, IConfiguration config)
        {
            var originsConfig = config.GetSection("Cors:Origins");
            var origins = new List<string>();
            originsConfig.Bind(origins);
            services.AddCors(options =>
            {
                options.AddPolicy(corsPolicyName, b =>
                {
                    b.WithOrigins([.. origins])
                        .AllowAnyMethod()
                        .AllowAnyHeader()
                        .AllowCredentials();
                });
                options.AddPolicy(clientAppCorsPolicyName, b =>
                {
                    b.AllowAnyOrigin()
                        .AllowAnyMethod()
                        .AllowAnyHeader();
                });
            });
            return services;
        }
        public static WebApplication UseConfiguredCors(this WebApplication app)
        {
            app.UseCors(corsPolicyName);
            return app;
        }
    }
}
