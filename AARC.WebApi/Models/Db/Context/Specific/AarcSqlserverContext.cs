using Microsoft.EntityFrameworkCore;

namespace AARC.WebApi.Models.Db.Context.Specific
{
    public class AarcSqlserverContext : AarcContext
    {
        private readonly AarcContextOptions _options;
        private const string acceptDbType = "sqlserver";
        public AarcSqlserverContext(AarcContextOptions options)
        {
            if (options.Type?.ToLower() != acceptDbType)
                throw new Exception($"数据库类型配置异常，应为:{acceptDbType}");
            _options = options;
        }
        protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
        {
            var level = _options.CompatibilityLevel;
            if (level is < 60 or > 200)
                throw new Exception($"SQL Server 兼容性等级(配置项Db:CompatibilityLevel)不合法: {level}");
            optionsBuilder.UseSqlServer(_options.ConnStr,
                b =>
                {
                    if (level is int l)
                        b.UseCompatibilityLevel(l);
                });
        }
    }
}
