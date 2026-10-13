using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace AARC.WebApi.Services.App.HttpAuthInfo
{
    public class HttpUserIdProvider
    {
        public Lazy<int> UserIdLazy { get; }
        private readonly IHttpContextAccessor _httpContextAccessor;
        public HttpUserIdProvider(IHttpContextAccessor httpContextAccessor)
        {
            UserIdLazy = new(GetUserId);
            _httpContextAccessor = httpContextAccessor;
        }
        private int GetUserId()
        {
            return GetUserIdFrom(_httpContextAccessor.HttpContext?.User);
        }

        /// <summary>
        /// 从已认证的 ClaimsPrincipal 中取用户 Id，未登录返回 0。
        /// 本服务注册为 Scoped，中间件构造函数注入不了，故留静态入口供其复用，保证 uid 判定口径一致。
        /// </summary>
        public static int GetUserIdFrom(ClaimsPrincipal? user)
        {
            if (user is null)
                return 0;
            var idClaim = user.Claims.FirstOrDefault(x
                => x.Type.Contains(JwtRegisteredClaimNames.NameId));
            if (idClaim is null)
                return 0;
            else
            {
                if (int.TryParse(idClaim.Value, out int id))
                    return id;
            }
            return 0;
        }

        /// <summary>
        /// 获取用户Id，未获取到则抛出RqEx
        /// </summary>
        /// <returns>用户Id</returns>
        public int RequireUserId()
        {
            var uid = UserIdLazy.Value;
            if (uid <= 0)
                throw new RqEx("请登录后重试");
            return uid;
        }
    }
}
