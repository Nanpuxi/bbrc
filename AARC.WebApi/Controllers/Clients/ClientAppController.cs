using AARC.WebApi.Services.Clients;
using AARC.WebApi.Utils;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using System.Net;

namespace AARC.WebApi.Controllers.Clients
{
    /// <summary>
    /// 客户端产物（PC 绿色版 zip / PC 安装版 msi / 安卓 apk）下载与信息
    /// </summary>
    [ApiController]
    [Route(ApiConsts.routePattern)]
    [AllowAnonymous]
    [EnableCors(CorsConfigure.clientAppCorsPolicyName)]
    public class ClientAppController(
        ClientAppService clientAppService
        ) : ControllerBase
    {
        private static readonly Dictionary<string, string> contentTypesByExt = new(StringComparer.OrdinalIgnoreCase)
        {
            [".apk"] = "application/vnd.android.package-archive",
            [".msi"] = "application/x-msi",
            [".zip"] = "application/zip",
        };

        /// <summary>
        /// 下载指定类型的最新产物（返回物理文件，同时计一次下载量）
        /// </summary>
        [HttpGet]
        [RateLimit(60, 60)]
        public IActionResult Download(string type)
        {
            var info = clientAppService.GetLatest(type)
                ?? throw new RqEx("未找到该类型的客户端产物", HttpStatusCode.NotFound);
            var path = clientAppService.GetPhysicalPath(info.FileName);
            if (!global::System.IO.File.Exists(path))
                throw new RqEx("客户端产物文件缺失", HttpStatusCode.NotFound);
            clientAppService.RecordDownload(type);
            var contentType = contentTypesByExt.GetValueOrDefault(
                global::System.IO.Path.GetExtension(info.FileName),
                "application/octet-stream");
            return PhysicalFile(path, contentType, info.FileName, enableRangeProcessing: true);
        }

        /// <summary>
        /// 产物元数据列表（由 sync-client-artifacts.mjs 生成）
        /// </summary>
        [HttpGet]
        public List<ClientAppService.ArtifactInfo> Info()
            => clientAppService.GetInfos();

        /// <summary>
        /// 各类型累计下载量（暂不在前端展示）
        /// </summary>
        [HttpGet]
        public Dictionary<string, int> Stats()
            => clientAppService.GetStats();

        /// <summary>
        /// 指定类型最新产物信息（客户端"检查更新"用）
        /// </summary>
        [HttpGet]
        [RateLimit(60, 60)]
        public ClientAppService.ArtifactInfo Latest(string type)
            => clientAppService.GetLatest(type)
                ?? throw new RqEx("未找到该类型的客户端产物", HttpStatusCode.NotFound);
    }
}
