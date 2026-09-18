using AARC.WebApi.Models.Db.Context;
using AARC.WebApi.Models.DbModels.Enums.AuthGrantTypes;
using AARC.WebApi.Models.DbModels.Identities;
using AARC.WebApi.Repos;
using AARC.WebApi.Services.App.HttpAuthInfo;

namespace AARC.WebApi.Services.Identities.AuthGrants;

public class AuthGrantCheckService(
    AarcContext context,
    HttpUserInfoService userInfoService,
    HttpUserIdProvider userIdProvider,
    AuthGrantOwnerService authGrantOwnerService)
{
    public void CheckFor(AuthGrantOn on, int onId, byte type, bool defaultAllow)
    {
        var res = CalculateFor(on, [onId], type).FirstOrDefault();
        if (res == AuthGrantCheckResult.Reject
            || (!defaultAllow && res == AuthGrantCheckResult.Default))
            throw new RqEx("拒绝访问");
    }
    /// <summary>
    /// 供 SignalR Hub 等非 HTTP 场景使用（此时 IHttpContextAccessor 取不到 HttpContext）：
    /// 身份信息由调用方显式提供，判定逻辑与 HTTP 场景完全一致
    /// </summary>
    public void CheckFor(AuthGrantOn on, int onId, byte type, bool defaultAllow, int uid, bool isAdmin, bool isMember)
    {
        var res = CalculateFor(on, [onId], type, uid, isAdmin, isMember).FirstOrDefault();
        if (res == AuthGrantCheckResult.Reject
            || (!defaultAllow && res == AuthGrantCheckResult.Default))
            throw new RqEx("拒绝访问");
    }
    public List<bool> CalculateFor(AuthGrantOn on, List<int> onIds, byte type, bool defaultAllow)
    {
        return CalculateFor(on, onIds, type)
            .ConvertAll(x =>
            {
                if (x == AuthGrantCheckResult.Allow)
                    return true;
                if (x == AuthGrantCheckResult.Reject)
                    return false;
                return defaultAllow;
            });
    }
    public List<AuthGrantCheckResult> CalculateFor(AuthGrantOn on, List<int> onIds, byte type)
    {
        // 先从 HttpUserIdProvider 安全读取 uid（未登录时为 0）
        int uid = userIdProvider.UserIdLazy.Value;
        bool isAdmin = false;
        bool isMember = false;
        if (uid > 0)
        {
            // 仅对已登录用户读取身份信息，避免未登录时抛出异常
            isAdmin = userInfoService.IsAdmin;
            isMember = userInfoService.IsMember;
        }
        return CalculateFor(on, onIds, type, uid, isAdmin, isMember);
    }
    /// 核心计算：身份信息显式传入（HTTP 场景由上方重载从 HttpContext 读取后委托到这里）
    public List<AuthGrantCheckResult> CalculateFor(AuthGrantOn on, List<int> onIds, byte type, int uid, bool isAdmin, bool isMember)
    {
        var isSaveEditing = 
            on == AuthGrantOn.Save 
            && type == (byte)AuthGrantTypeOfSave.Edit;

        // 如果是管理员，且不是“存档编辑”，直接allow所有
        if (isAdmin && !isSaveEditing)
        { 
            return Enumerable.Repeat(AuthGrantCheckResult.Allow, onIds.Count).ToList();
        }

        // 加载每个onId的所有者，以及所有相关的authGrant对象
        var owners = authGrantOwnerService.GetOwnerOf(on, onIds);
        var allGrants = Existing
            .Where(x => x.On == on && x.Type == type)
            .Where(x => owners.Contains(x.UserId) || onIds.Contains(x.OnId))
            .ToList();
        
        // 准备结果数组，遍历每一个onId
        var res = new List<AuthGrantCheckResult>(onIds.Count);
        for (int i = 0; i < onIds.Count; i++)
        {
            AuthGrantCheckResult result = AuthGrantCheckResult.Default;
            var owner = owners[i];
            var onId =  onIds[i];
            if(owner == uid)
                result = AuthGrantCheckResult.Allow;
            else
            {
                var grants = allGrants.FindAll(x => x.UserId == owner || x.OnId == onId);
                grants = OrderByCascadingRule(grants);
                foreach (var ag in grants)
                {
                    bool match =
                        ag.To == AuthGrantTo.All
                        || ag.To == AuthGrantTo.AllMembers && isMember
                        || ag.To == AuthGrantTo.User && uid == ag.ToId;
                    if (match)
                        result = ag.Flag ? AuthGrantCheckResult.Allow : AuthGrantCheckResult.Reject;
                }
            }
            res.Add(result);
        }
        return res;
    }

    private static List<AuthGrant> OrderByCascadingRule(List<AuthGrant> authGrants)
    {
        List<AuthGrant> onUser = [];
        List<AuthGrant> onEntity = [];
        foreach (var ag in authGrants)
        {
            if(ag.UserId > 0)
                onUser.Add(ag);
            else
                onEntity.Add(ag);
        }
        // priority大的排后面，升序排序
        onUser.Sort((x, y) => x.Priority - y.Priority);
        onEntity.Sort((x, y) => x.Priority - y.Priority);
        return [..onUser, ..onEntity]; // 用户默认的排前面，本体的排后面
    }

    private IQueryable<AuthGrant> Existing => context.AuthGrants.Existing();
}

public enum AuthGrantCheckResult
{
    Default = 0,
    Reject = 1,
    Allow = 2
}