using AARC.Collab;
using AARC.WebApi.Services.App.ActionFilters;
using AARC.WebApi.Services.App.HttpAuthInfo;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Net;

namespace AARC.WebApi.Controllers
{
    /// <summary>
    /// 协作房间的存档快照直传（新成员初始化/重建兜底）：房主优先上传、任何在房成员可兜底上传，成员轮询下载。
    /// 快照可达 MB 级，不走 SignalR（MaximumReceiveMessageSize 限制），走 HTTP。
    /// </summary>
    [Authorize]
    [ApiController]
    public class CollabController(
        CollabRoomManager collabRoomManager,
        HttpUserIdProvider httpUserIdProvider
        ) : Controller
    {
        /// 上传存档快照（正常流程由现任房主上传；房主无存活连接时任何在房成员兜底，§7.1 ③。
        /// Payload 为 LZString 压缩后的 base64；客户端保证水位覆盖快照内容后才上传）
        [HttpPost("/collab/snapshot")]
        [UserCheck]
        [RequestSizeLimit(8 * 1024 * 1024)]
        public bool UploadSnapshot([FromBody] CollabSnapshotUpload upload)
        {
            var uid = httpUserIdProvider.RequireUserId();
            collabRoomManager.UploadSnapshot(uid, upload);
            return true;
        }

        /// 房间成员下载存档快照（仅房间成员；未就绪时 404，调用方轮询）
        [HttpGet("/collab/snapshot")]
        [UserCheck]
        public CollabSnapshotResult DownloadSnapshot(int saveId)
        {
            var uid = httpUserIdProvider.RequireUserId();
            return collabRoomManager.GetSnapshot(saveId, uid)
                ?? throw new RqEx("快照尚未就绪", HttpStatusCode.NotFound);
        }
    }
}
