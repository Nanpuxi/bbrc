using AARC.WebApi.Models.DbModels.Enums;
using AARC.WebApi.Models.DbModels.Identities;
using AARC.WebApi.Repos.Files;
using AARC.WebApi.Services.App.ActionFilters;
using AARC.WebApi.Services.Files;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;

namespace AARC.WebApi.Controllers.Files
{
    [Authorize]
    [ApiController]
    [Route(ApiConsts.routePattern)]
    public class UserFileController(
        UserFileRepo userFileRepo,
        UserFileService userFileService
        ) : Controller
    {
        [HttpPost]
        [UserCheck(UserType.Member)]
        public bool Upload(
            IFormFile? userFile,
            IFormFile? userFileThumb,
            [FromForm]string? displayName,
            [FromForm]string? intro,
            [FromForm]UserFileType type = UserFileType.Icon,
            [FromForm]int? overwriteId = null)
        {
            if (overwriteId.HasValue)
                userFileRepo.Overwrite(overwriteId.Value, userFile, userFileThumb, intro);
            else
                userFileRepo.Add(userFile, userFileThumb, displayName, intro, type);
            return true;
        }

        [HttpGet]
        [UserCheck(UserType.Member)]
        public UserFileDto? FindExisting([FromQuery]string displayName, [FromQuery]UserFileType type)
        {
            return userFileRepo.FindExisting(displayName, type);
        }

        [HttpPost]
        [UserCheck(UserType.Member)]
        public bool Edit(
            [FromForm] int id,
            [FromForm] string? displayName,
            [FromForm] string? intro)
        {
            userFileRepo.Edit(id, displayName, intro);
            return true;
        }

        [HttpDelete]
        [UserCheck(UserType.Member)]
        public bool Delete([FromForm] int id)
        {
            userFileRepo.Delete(id);
            return true;
        }
        
        [HttpGet]
        public List<UserFileDto> Get(int skip = 0, int take = 50, string? search = null, string? orderby = null)
        {
            return userFileRepo.GetUserFiles(skip, take, search, orderby);
        }

        [HttpGet]
        public List<string> GetPrefixes()
        {
            return userFileRepo.GetPrefixes();
        }

        [AllowAnonymous]
        [HttpGet]
        public List<UserFileDto> Search(string search, string? orderby = null, int skip = 0, int take = 50)
        {
            return userFileRepo.SearchAccessible(search, orderby, skip, take);
        }

        /// <summary>
        /// 按 id 输出文件内容（匿名可访问，与 /userfile 静态路径等价）。<br/>
        /// 覆盖上传后物理文件（md5 URL）会变，但本路径按 id 解析、始终指向最新内容，
        /// 适合作为存档数据源的长期引用。<br/>
        /// 缓存策略：ETag 取内容 md5（StoreName），并要求每次回源校验（no-cache），
        /// 内容未变时由 ETag/LastModified 命中 304，变化时客户端能拿到新版。
        /// </summary>
        [AllowAnonymous]
        [HttpGet]
        public IActionResult Content(int id)
        {
            var info = userFileRepo.GetContentInfo(id);
            if (info is null)
                return NotFound();
            var (storeName, lastActive) = info.Value;
            var path = userFileService.GetPhysicalPath(storeName);
            if (!global::System.IO.File.Exists(path))
                return NotFound();
            var contentType = Path.GetExtension(storeName).ToLowerInvariant() switch
            {
                ".json" => "application/json",
                ".svg" => "image/svg+xml",
                ".png" => "image/png",
                ".jpg" or ".jpeg" => "image/jpeg",
                ".webp" => "image/webp",
                _ => "application/octet-stream"
            };
            Response.Headers.CacheControl = "no-cache";
            var etag = new EntityTagHeaderValue($"\"{storeName}\"");
            return PhysicalFile(path, contentType, lastActive, etag, true);
        }
    }
}
