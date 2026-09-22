using AARC.WebApi.Models.Db.Context;
using AARC.WebApi.Models.Db.Context.Specific;
using AARC.WebApi.Models.DbModels.Enums;
using AARC.WebApi.Models.DbModels.Enums.AuthGrantTypes;
using AARC.WebApi.Models.DbModels.Files;
using AARC.WebApi.Models.DbModels.Identities;
using AARC.WebApi.Models.DbModels.Saves;
using AARC.WebApi.Services.App.HttpAuthInfo;
using AARC.WebApi.Services.App.Mapping;
using AARC.WebApi.Services.Files;
using AARC.WebApi.Services.Identities.AuthGrants;
using AutoMapper;
using AutoMapper.QueryableExtensions;
using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;

namespace AARC.WebApi.Repos.Files
{
    public class UserFileRepo(
        AarcContext context,
        UserFileService userFileService,
        HttpUserIdProvider httpUserIdProvider,
        UserFavoriteRepo userFavoriteRepo,
        IMapper mapper,
        AuthGrantCheckService authGrantCheckService
        ) : Repo<UserFile>(context)
    {
        private const int fileSizeLimitMB = 3;
        private const int fileSizeLimitKBOfSvg = 1024;
        private readonly static string[] extAllowed 
            = [".png", ".jpg", ".jpeg", ".svg", ".webp", ".json"];
        public void Add(
            IFormFile? f,
            IFormFile? thumb,
            string? displayName,
            string? intro,
            UserFileType type = UserFileType.Icon)
        {
            if (f is null)
                throw new RqEx("上传失败");
            CheckModel(displayName, intro);
            var uid = httpUserIdProvider.RequireUserId();
            CheckFile(f);
            userFileService.Write(
                f.OpenReadStream(), f.FileName,
                thumb?.OpenReadStream(),
                out var storeName, out int size);
            UserFile userFile = new()
            {
                DisplayName = displayName ?? Path.GetRandomFileName(),
                StoreName = storeName,
                UniqueName = GenerateUniqueName(),
                Intro = intro,
                OwnerUserId = uid,
                Size = size,
                Type = type
            };
            Add(userFile);
        }

        /// <summary>
        /// 生成 16 位 0-9A-Z 随机串，作为资源的稳定公开标识
        /// </summary>
        private static string GenerateUniqueName()
        {
            const string chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
            return new string(Enumerable.Range(0, 16)
                .Select(_ => chars[RandomNumberGenerator.GetInt32(chars.Length)])
                .ToArray());
        }

        public void Edit(int id, string? displayName, string? intro)
        {
            CheckModel(displayName, intro);
            var uid = httpUserIdProvider.RequireUserId();
            var model = base.Get(id) ?? throw new RqEx("找不到指定数据");
            if (model.OwnerUserId != uid) throw new RqEx("无权操作");
            model.DisplayName = displayName ?? Path.GetRandomFileName();
            model.Intro = intro;
            base.Update(model, true);
        }

        /// <summary>
        /// 覆盖已有资源的文件内容：不新建/删除实体，仅写新文件并更新 StoreName 等字段。
        /// </summary>
        public void Overwrite(int id, IFormFile? f, IFormFile? thumb, string? intro)
        {
            if (f is null)
                throw new RqEx("上传失败");
            var uid = httpUserIdProvider.RequireUserId();
            var model = base.Get(id) ?? throw new RqEx("找不到指定数据");
            if (model.OwnerUserId != uid) throw new RqEx("无权操作");
            if (intro is not null && intro.Length >= UserFile.introMaxLength)
                throw new RqEx("简介过长");
            CheckFile(f);
            var oldStoreName = model.StoreName;
            userFileService.Write(
                f.OpenReadStream(), f.FileName,
                thumb?.OpenReadStream(),
                out var storeName, out int size);
            if (oldStoreName != storeName
                && !Existing.Any(x => x.StoreName == oldStoreName && x.Id != model.Id))
                userFileService.DeletePhysical(oldStoreName);
            model.StoreName = storeName;
            model.Size = size;
            if (intro is not null)
                model.Intro = intro;
            base.Update(model, true);
        }

        /// <summary>
        /// 按 uniqueName 获取文件的存储信息（匿名内容输出用：与 /userfile 静态路径等价，仅多一步 uniqueName → StoreName 解析）
        /// </summary>
        public (string StoreName, DateTime LastActive)? GetContentInfo(string uniqueName)
        {
            var model = Existing.AsNoTracking()
                .Where(x => x.UniqueName == uniqueName)
                .Select(x => new { x.StoreName, x.LastActive })
                .FirstOrDefault();
            if (model is null)
                return null;
            return (model.StoreName, model.LastActive);
        }

        /// <summary>
        /// 查找当前用户名下同类型、同名的资源（preflight，用于覆盖确认）
        /// </summary>
        public UserFileDto? FindExisting(string displayName, UserFileType type)
        {
            var uid = httpUserIdProvider.RequireUserId();
            // DisplayName 大小写不敏感；sqlite 默认敏感，拉到内存再比较
            var model = Existing
                .Where(x => x.OwnerUserId == uid && x.Type == type)
                .AsEnumerable()
                .FirstOrDefault(x =>
                    string.Equals(x.DisplayName, displayName, StringComparison.OrdinalIgnoreCase));
            if (model is null)
                return null;
            var dto = mapper.Map<UserFile, UserFileDto>(model);
            dto.UrlThumb = userFileService.GetUrl(dto.StoreName, thumb: true);
            dto.UrlOriginal = userFileService.GetUrl(dto.StoreName, thumb: false);
            return dto;
        }

        private static void CheckFile(IFormFile f)
        {
            var extLower = Path.GetExtension(f.FileName)?.ToLower();
            if (string.IsNullOrWhiteSpace(extLower))
                throw new RqEx("文件必须有后缀名");
            if (!extAllowed.Contains(extLower))
                throw new RqEx("不支持这种后缀名");
            if (f.Length > fileSizeLimitMB * 1024 * 1024)
                throw new RqEx($"文件不能大于 {fileSizeLimitMB}MB\n请调低质量或尺寸");
            if (extLower == ".svg")
            {
                if (f.Length > fileSizeLimitKBOfSvg * 1024)
                    throw new RqEx($"svg文件不能大于 {fileSizeLimitKBOfSvg}KB\n请勾选转换位图");
            }
        }

        public void Delete(int id)
        {
            var uid = httpUserIdProvider.RequireUserId();
            var model = base.Get(id) ?? throw new RqEx("找不到指定数据");
            if (model.OwnerUserId != uid) throw new RqEx("无权操作");
            base.FakeRemove(model);
            // TODO: 清理失去引用的文件
        }

        public List<UserFileDto> GetUserFiles(
            int skip, int take, string? nameSearch, string? orderby = null)
        {
            var q = Existing;
                
            //暂时只能看自己的
            var uid = httpUserIdProvider.RequireUserId();
            q = q.Where(x => x.OwnerUserId == uid);
            
            if (!string.IsNullOrWhiteSpace(nameSearch))
            {
                //sqlite默认大小写敏感，此处强制转为不敏感的（应该不怎么影响性能）
                q = Context is AarcSqliteContext
                    ? q.Where(x => x.DisplayName.ToLower().Contains(nameSearch.ToLower()))
                    : q.Where(x => x.DisplayName.Contains(nameSearch));
            }
            q = orderby?.ToLower() switch
            {
                "time" => q.OrderByDescending(x => x.LastActive),
                "name" => q.OrderBy(x => x.DisplayName),
                _ => q
            };
            if (skip > 0)
                q = q.Skip(skip);
            take = Math.Clamp(take, 1, 50);
            q = q.Take(take);
            var temp = (
                from f in q 
                join u in Context.Users
                on f.OwnerUserId equals u.Id
                select new
                {
                    UserFile = f,
                    OwnerName = u.Name
                }).ToList();
            List<UserFileDto> res = [];
            foreach (var t in temp)
            {
                var dto = mapper.Map<UserFile, UserFileDto>(t.UserFile);
                dto.OwnerUserName = t.OwnerName;
                dto.UrlThumb = userFileService.GetUrl(dto.StoreName, thumb: true);
                dto.UrlOriginal = userFileService.GetUrl(dto.StoreName, thumb: false);
                res.Add(dto);
            }
            var ids = res.Select(x => x.Id).ToList();
            var favMap = userFavoriteRepo.GetFavoriteIdMap(UserFavoriteType.UserFile, ids);
            foreach (var dto in res)
            {
                if (favMap.TryGetValue(dto.Id, out var favId) && favId > 0)
                {
                    dto.IsFavorited = true;
                    dto.FavoriteId = favId;
                }
            }
            return res;
        }

        public List<string> GetPrefixes()
        {
            var uid = httpUserIdProvider.RequireUserId();
            var names = Existing
                .Where(x => x.OwnerUserId == uid)
                .Select(x => x.DisplayName)
                .Where(x => !string.IsNullOrWhiteSpace(x) && x.Contains('-'))
                .ToList();
            return names
                .Select(x => x!.Split('-'))
                .Where(x => x.Length >= 2)
                .Select(x => x[0])
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x!)
                .Distinct()
                .OrderBy(x => x)
                .ToList();
        }

        public List<UserFileDto> SearchAccessible(string? search, string? orderby, int skip, int take)
        {
            take = Math.Clamp(take, 1, 50);
            var q = Existing.AsNoTracking();
            if (!string.IsNullOrWhiteSpace(search))
            {
                q = Context is AarcSqliteContext
                    ? q.Where(x => x.DisplayName.ToLower().Contains(search.ToLower()))
                    : q.Where(x => x.DisplayName.Contains(search));
            }
            q = orderby?.ToLower() switch
            {
                "time" => q.OrderByDescending(x => x.LastActive),
                "name" => q.OrderBy(x => x.DisplayName),
                _ => q.OrderByDescending(x => x.LastActive)
            };
            const int candidatePoolSize = 300;
            var candidates = q
                .Take(candidatePoolSize)
                .Select(x => new { x.Id, x.OwnerUserId })
                .ToList();
            if (candidates.Count == 0)
                return [];
            var candidateIds = candidates.Select(x => x.Id).ToList();
            var accessible = authGrantCheckService
                .CalculateFor(AuthGrantOn.UserFile, candidateIds, (byte)AuthGrantTypeOfUserFile.View, defaultAllow: false);
            var accessibleOrderedIds = candidates
                .Where((x, i) => accessible.ElementAtOrDefault(i))
                .Select(x => x.Id)
                .Skip(skip)
                .Take(take)
                .ToList();
            return GetUserFileDtosByIds(accessibleOrderedIds);
        }

        public List<UserFileDto> GetUserFileDtosByIds(List<int> ids)
        {
            if (ids.Count == 0)
                return [];
            var temp = (
                from f in Existing.Where(x => ids.Contains(x.Id))
                join u in Context.Users on f.OwnerUserId equals u.Id
                select new { UserFile = f, OwnerName = u.Name }
            ).ToList();
            var dtoMap = temp.ToDictionary(
                t => t.UserFile.Id,
                t =>
                {
                    var dto = mapper.Map<UserFile, UserFileDto>(t.UserFile);
                    dto.OwnerUserName = t.OwnerName;
                    dto.UrlThumb = userFileService.GetUrl(dto.StoreName, thumb: true);
                    dto.UrlOriginal = userFileService.GetUrl(dto.StoreName, thumb: false);
                    return dto;
                });
            var res = ids.Select(id => dtoMap.TryGetValue(id, out var dto) ? dto : null)
                .Where(x => x is not null)
                .Cast<UserFileDto>()
                .ToList();
            var favMap = userFavoriteRepo.GetFavoriteIdMap(UserFavoriteType.UserFile, res.Select(x => x.Id).ToList());
            foreach (var dto in res)
            {
                if (favMap.TryGetValue(dto.Id, out var favId) && favId > 0)
                {
                    dto.IsFavorited = true;
                    dto.FavoriteId = favId;
                }
            }
            return res;
        }

        private static void CheckModel(string? displayName, string? intro)
        {
            if (displayName is null)
                throw new RqEx("名称不能为空");
            if (displayName.Length >= UserFile.displayNameMaxLength)
                throw new RqEx("名称过长");
            if (intro is not null && intro.Length >= UserFile.introMaxLength)
                throw new RqEx("简介过长");
        }
    }

    public class UserFileDto
    {
        public int Id { get; set; }
        public string? DisplayName { get; set; }
        public string? StoreName { get; set; }
        public string? UniqueName { get; set; }
        public string? UrlThumb { get; set; }
        public string? UrlOriginal { get; set; }
        public int OwnerUserId { get; set; }
        public string? OwnerUserName { get; set; }
        public string? Intro { get; set; }
        public int Size { get; set; }
        public string? LastActive { get; set; }
        public bool IsFavorited { get; set; }
        public int FavoriteId { get; set; }
    }

    public class UserFileProfile : Profile
    {
        public UserFileProfile()
        {
            CreateMap<UserFileDto, UserFile>()
                .IgnoreLastActive();
            CreateMap<UserFile, UserFileDto>()
                .ForMember(
                    destinationMember: x => x.LastActive,
                    memberOptions: mem => mem.MapFrom(source => source.LastActive.ToString("yyyy-MM-dd HH:mm")));
        }
    }
}
