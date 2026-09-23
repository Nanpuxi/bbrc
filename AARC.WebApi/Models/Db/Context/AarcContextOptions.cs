namespace AARC.WebApi.Models.Db.Context
{
    public class AarcContextOptions
    {
        public string? ConnStr { get; set; }
        public string? Type { get; set; }
        /// <summary>仅 sqlserver 生效；EF Core 使用的兼容等级，不填用 provider 默认值(150)</summary>
        public int? CompatibilityLevel { get; set; }
    }
}
