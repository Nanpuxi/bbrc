using System.Net;

namespace AARC.Collab;

/// <summary>
/// 协作请求非法（房间不存在、非成员、人数已满、前缀耗尽等）。
/// 与 AARC.WebApi 的 RequestInvalidException 同形，由 ApiExceptionFilter 映射为 HTTP 状态码；
/// SignalR 侧异常消息原样透传给调用方客户端。
/// </summary>
public class CollabException(
    string? msg = null,
    HttpStatusCode statusCode = HttpStatusCode.Forbidden
) : Exception(msg ?? "未知错误")
{
    public HttpStatusCode StatusCode { get; set; } = statusCode;
}
