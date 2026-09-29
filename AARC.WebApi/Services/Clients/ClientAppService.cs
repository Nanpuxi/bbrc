using System.Text.Json;

namespace AARC.WebApi.Services.Clients
{
    /// <summary>
    /// 客户端产物下载服务<br/>
    /// 产物文件（exe 的 zip、apk）、元数据 json、下载统计 json 均放在 ContentRoot/Data/ClientApp，
    /// 由 aarc-web 的 sync-client-artifacts.mjs 生成产物与元数据<br/>
    /// 元数据与统计 json 的读写共用一把锁，保证并发安全（单实例部署前提下）
    /// </summary>
    public class ClientAppService(IWebHostEnvironment env)
    {
        public const string baseDir = "Data/ClientApp";
        public const string infoFileName = "clientArtifacts.json";
        public const string statsFileName = "clientDownloadStats.json";
        private static readonly object fileLock = new();
        private static readonly JsonSerializerOptions jsonOpts = new()
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = true,
        };

        public class ArtifactInfo
        {
            public string Type { get; set; } = "";
            public string FileName { get; set; } = "";
            public string Url { get; set; } = "";
            public DateTime UpdatedAt { get; set; }
            public string GitCommitId { get; set; } = "";
            public long SizeBytes { get; set; }
            public string Sha256 { get; set; } = "";
        }

        public List<ArtifactInfo> GetInfos()
        {
            lock (fileLock)
                return ReadJson<List<ArtifactInfo>>(InfoPath()) ?? [];
        }

        public ArtifactInfo? GetLatest(string type)
            => GetInfos().Where(x => x.Type == type).MaxBy(x => x.UpdatedAt);

        public Dictionary<string, int> GetStats()
        {
            lock (fileLock)
                return ReadJson<Dictionary<string, int>>(StatsPath()) ?? [];
        }

        public void RecordDownload(string type)
        {
            lock (fileLock)
            {
                var stats = ReadJson<Dictionary<string, int>>(StatsPath()) ?? [];
                stats.TryGetValue(type, out var count);
                stats[type] = count + 1;
                File.WriteAllText(StatsPath(), JsonSerializer.Serialize(stats, jsonOpts));
            }
        }

        public string GetPhysicalPath(string fileName)
            => Path.Combine(env.ContentRootPath, baseDir, fileName);

        private string InfoPath() => Path.Combine(env.ContentRootPath, baseDir, infoFileName);
        private string StatsPath() => Path.Combine(env.ContentRootPath, baseDir, statsFileName);

        private static T? ReadJson<T>(string path)
        {
            if (!File.Exists(path))
                return default;
            try
            {
                return JsonSerializer.Deserialize<T>(File.ReadAllText(path), jsonOpts);
            }
            catch
            {
                return default;
            }
        }
    }
}
