# 多人实时协作 — 后端计划

本文描述"多人实时协作"功能的**后端部分**设计。核心思路：每个协作房间在内存中维护一个**带序号的操作（patch）队列**，新操作入队并广播给房间内其他用户；队列保留最近一系列操作，短暂断线的客户端重连后可按序号增量补齐，无需整档重载。

## 1. 目标与范围

- 同一存档（save）可被多个用户同时打开编辑，编辑操作以 patch 形式实时互相同步
- 服务器作为**有序中继 + 有界缓冲**：为操作分配房间级单调递增序号、保存最近 N 条操作、广播给房间内其他成员
- v1 服务器**不应用 patch、不维护存档副本、不改现有持久化流程**（存档落库仍走 `UpdateDataAndDiff` 全量保存）
- 本文只覆盖后端：SignalR Hub、内存队列、对象锁仲裁、id 前缀分发、权限、限流。前端应用 patch、冲突消解策略等不在本文范围

## 2. 现有 SignalR 用法分析

项目中已有一套 SignalR 聊天实现，可作为直接参照：

| 位置 | 内容 |
|------|------|
| `AARC.WebApi/Program.cs:39,58` | `AddSignalR()` 注册服务；`MapHub<ChatHub>("/chat")` 映射端点 |
| `AARC.WebApi/Services/Chat/ChatHub.cs` | 唯一 Hub，`[Authorize]`，房间名即 saveId 字符串 |
| `AARC.WebApi/Services/App/Authentication/JwtService.cs:28-41` | WebSocket 无法带请求头，从 `access_token` 查询字符串读 JWT，**目前只对 `/chat` 路径放行** |
| `aarc-web/src/app/com/signalrStore.ts` | 前端封装：`withAutomaticReconnect`、重连后 rejoin + SyncHistory、messageId 去重 |

ChatHub 已有的模式（协作功能可直接沿用）：

- **内存房间历史**：`_roomMessages: ConcurrentDictionary<string, ConcurrentQueue<ChatMessageDto>>`，每房 capped 50 条，`SyncHistory` 向 caller 全量补发
- **连接-房间映射**：`_connectionRooms` 记录每个连接加入的房间，`OnDisconnectedAsync` 时自动补发"离开房间"系统消息
- **用户解析**：从 JWT 的 `NameId` claim 查 `_db.Users`，未登录抛 `RqEx`
- **权限示例**：`SendMessage` 要求 `UserType.Member`

ChatHub 的局限（协作功能需要改进的点）：

- 消息**无房间级序号**，断线补齐只能全量重发最近 50 条，客户端靠 `messageId` 去重——patch 场景必须按序应用，需要严格单调的序号
- 状态是 Hub 内的 `static` 字段，无法单测、无法按房间做锁以外的精细控制
- 无成员列表（presence）概念

## 3. 总体架构

新增独立 Hub 与房间状态管理器，不复用 ChatHub（聊天与协作的生命周期、消息语义不同，共用一个 Hub 会互相污染；但两者可共存于同一前端连接策略之外，互不影响）：

```
客户端A ──SubmitOp(patch, baseSeq)──▶ CollabHub
                                        │ ① 校验：房间成员、权限、频率、大小
                                        │ ② CollabRoomManager.AppendOp()
                                        │    （房间锁内：Seq++ → 入队）
                                        │ ③ 返回值 = 分配的 Seq（作为 ack）
                                        ▼
客户端B/C ◀──ReceiveOp(op)── Clients.OthersInGroup(room)
```

- `CollabHub`（`AARC.WebApi/Services/Collab/CollabHub.cs`）：只负责鉴权、参数校验、调用管理器、广播；无状态
- `CollabRoomManager`（DI 单例，独立零依赖类库 `AARC.Collab/CollabRoomManager.cs`；Hub/Controller 胶水层留在 WebApi）：持有全部房间状态，负责序号分配、入队、修剪、成员管理、空房回收、**对象锁仲裁（first-write-wins）与 id 前缀租约分发**。**用 DI 单例而非 ChatHub 式 static 字段**，便于后续加单元测试
- patch 内容对服务器是**不透明负载**：服务器不解析、不应用、不合并，只做大小校验后原样转发

## 4. Patch 格式

> **更新（已实现）**：前端协作 patch 的生成/应用已落地为 `aarc-core/src/models/save/saveDiff.ts`，采用自定义的"应用导向"格式（`$set`/`$del`/`$add`/`$rm`/`$upd`/`$seq`，只携带新值、keyed 判定自动化、显式表达属性删除）。既然服务器对协作 op 完全透传（第 3 节），不再要求与 `AARC.Diff` 落库格式一致；下文保留作为落库 diff 的格式说明与传输层决策记录。

直接复用 `AARC.Diff` 的输出格式（即现有 `SaveDiff` 落库的同一种格式），避免引入第二套 patch 约定：

- 顶层是 `JsonObject`，键为 `/` 分隔的路径（如 `points`、`config/snapRayAngles`）
- 普通属性 / 短数组：`{ "old": ..., "new": ... }`
- 有主键数组（keyed array，如 `points`/`lines`）：`{ "add": [...], "remove": [...], "replace": [{old,new}...], "sequence": {old:[id...], new:[id...]} }`
- 长数组（如 `pointLinks`）：`{ "add": [...], "remove": [...], "replace": [{old,new}...] }`

数组分类配置见 `SaveDiffService.CreateOptions()`（`AARC.WebApi/Services/Saves/SaveDiffService.cs:72`），该处注释说明它与前端 `save.ts` 绑定。协作功能产生 patch 时（前端做 diff），必须复用同一配置，两端约定不变。

传输上 patch 以 **string**（已序列化的 JSON）为载体，服务器完全透传、零解析开销：

- 与"服务器不碰内容"的定位自洽：大小校验就是 `string.Length`，队列内存占用也比 `JsonNode` 的 DOM 更低
- **为压缩留路**：`SaveDiff` 落库已用 LZString 压缩（`SaveDiffService.cs:24`），实时 op 偶尔很大（自由绘制、批量粘贴）时可同样压缩后 base64 传输，string 是唯一可行的载体
- 已知代价：① 失去协议层的 JSON 有效性校验——畸形 patch 会被透传给全房间，接收方必须容错解析失败；② 未压缩时 JSON 字符串作为参数二次序列化有引号转义膨胀（约 15~25%），启用压缩后此问题消失；③ 将来若要在服务器端做冲突检测/合并（第 13 节开放问题），需届时再解析，不影响 DTO 契约
- 备选方案 `JsonNode`（内嵌原生 JSON、服务器 fail-fast 校验）被否决，理由是纯中继场景解析+再序列化纯属浪费

## 5. 数据模型

```csharp
// AARC.Collab/CollabDtos.cs

/// 一次协作操作（服务器分配的 Seq 为房间内全序）
public class CollabOpDto
{
    public string OpId { get; set; }        // 客户端生成，用于客户端去重/对账
    public int SaveId { get; set; }
    public long Seq { get; set; }           // 服务器分配，房间级单调递增，从 1 开始
    public int UserId { get; set; }
    public string UserName { get; set; }
    public string Patch { get; set; }       // 不透明负载：已序列化的 JSON（或压缩后 base64），格式见第 4 节
    public long BaseSeq { get; set; }       // 客户端生成 patch 时基于的 Seq（v1 仅记录，不校验）
    public DateTime SentAt { get; set; }
}

/// 房间成员（presence）
public class CollabMemberDto
{
    public int UserId { get; set; }
    public string UserName { get; set; }
    public DateTime JoinedAt { get; set; }
}

/// 一条对象锁（软锁，服务器按 first-write-wins 仲裁；锁键带类型前缀："pt:5"/"line:3"/"tag:7"）
public class CollabLockDto
{
    public string Key { get; set; }
    public string Holder { get; set; }      // 持有者用户名（前端直接用于"被 XX 编辑中"提示）
}

/// JoinRoom 返回值
public class JoinCollabRoomResult
{
    public long LatestSeq { get; set; }     // 当前房间最新序号（房间刚创建时为 0）
    public int IdPrefix { get; set; }       // 服务器分配的会话 id 前缀（id-allocation.md 方案 C，租约制：在房期间唯一、离房回收）
    public int OwnerUserId { get; set; }    // 房主 = 存档所有者（仅其可创建房间，见 §7.1 修订），唯一保存责任人（见第 8 节）；房主关房或断网超宽限期时房间关闭（继任保留但暂不使用）
    public List<CollabMemberDto> Members { get; set; }
    public List<CollabLockDto> Locks { get; set; }  // 当前锁表快照（后进房者据此渲染他人锁）
}

/// SyncOps 返回值
public class SyncCollabOpsResult
{
    public List<CollabOpDto> Ops { get; set; }  // Seq > afterSeq 的全部操作，按 Seq 升序
    public long LatestSeq { get; set; }
    public bool Gap { get; set; }           // true = 队列已被修剪，afterSeq 之前的操作丢失，客户端必须整档重载
}
```

## 6. 房间状态与内存队列

`CollabRoomManager` 内部：

```csharp
private readonly ConcurrentDictionary<int, CollabRoom> _rooms = new();  // key = saveId

internal class CollabRoom
{
    public readonly object SyncRoot = new();     // 房间级锁：序号分配 + 入队 + 锁仲裁 + 前缀分发 + 读取快照
    public long LatestSeq;
    public readonly Queue<CollabOpDto> Ops = new();
    public readonly Dictionary<int, CollabMemberDto> Members = new();  // key = userId
    public readonly Dictionary<string, (string Holder, string ConnectionId)> Locks = new();  // 锁键 → 持有者
    public readonly Dictionary<int, int> MemberIdPrefixes = new();  // userId → 持有的前缀租约（离房/断连回收）
    public DateTime LastActiveAt;
}
```

要点：

- **序号分配与入队必须原子**：在 `SyncRoot` 锁内完成 `Seq = ++LatestSeq` 和入队，保证队列顺序即 Seq 顺序。Hub 拿到 Seq 后再广播——广播在锁外进行（`Clients.OthersInGroup` 是异步 IO，持锁广播会阻塞同房间所有提交；顺序性由"入队先于广播、Seq 单调"保证，客户端若收到乱序到达的 op 可按 Seq 缓冲重排）
- **对象锁仲裁**：`AcquireLock`/`ReleaseLock` 同样在 `SyncRoot` 锁内判定——锁键已被他人持有则拒绝（first-write-wins），同一持有者重复加锁幂等成功。锁表记录持有连接 Id，断连时只清该连接的锁，避免同一用户多标签页互相误清
- **房主（保存责任人）**：房主 = **存档所有者**，不单独存字段（`Members` 中 JoinedAt 最早者即房主——在"仅存档所有者可开房"约束下二者恒等）。**仅存档所有者可创建房间**：`JoinRoom` 时房间不存在则要求调用者是存档所有者，否则拒绝（非 owner 进入不启动协作机制）；房间已存在时，其他有编辑权限者可加入为协作者，但永不成为房主。**房主主动关房（离开编辑器路由、切换 saveId，见 §7.1）时关闭整个房间**并广播 `RoomClosed`；房主断连不立即关房，走宽限期（§7.1）。原"房主离房/断连时剩余成员按 JoinedAt 继任 + 广播 `OwnerChanged`"的**实现保留但暂不使用**。空房回收后下一个开房者（必为存档所有者）即房主
- **id 前缀租约分发**：加入房间时在 `SyncRoot` 锁内分配 `[1, MaxIdPrefix]` 内未被持有的最小前缀（默认上限 2047，即前端 `collabIdPrefixMax`），成员离房/断连时**回收**；历史负 id 撞号由客户端进房扫存档设种子兜底（id-allocation.md §7.1）。租约制下耗尽要求 2047 个成员同时在房，而成员上限 10 人，实际不可达
- **容量修剪**：双阈值，超过任一即从头出队——
  - 条数上限：默认 500 条/房间（配置项）
  - 时间上限：默认 30 分钟，出队直到队列头部操作在窗口内
  - 修剪只丢"尾巴已被所有在线成员消费"这一假设不成立时的旧数据，被修剪侧通过 `SyncOps` 的 `Gap` 标记感知
  - 新加入成员**不依赖队列**补齐（走快照直传，第 10 节），修剪无需为新客保留从头开始的历史
- **连接-房间映射**：沿用 ChatHub 的 `_connectionRooms` 思路（`ConcurrentDictionary<string, HashSet<int>>`，连接 Id → saveId 集合），`OnDisconnectedAsync` 时自动移出所有房间并广播 `UserLeft`。**例外（2026-09 修订，§7.1）：房主断连且未先发 `CloseRoom` 时不立即移出**，房间进入宽限期（广播 `OwnerOffline`，房主宽限期内重连则恢复）；宽限期超时再按本条移出并关房广播 `RoomClosed`
- **空房回收**：最后一个成员离开时直接 `_rooms.TryRemove`（操作队列随房间销毁）。这意味着"房间无人后 patch 历史不保留"——可接受，因为权威数据始终是 DB 中的存档本身，队列只为在线同步服务
- **单实例前提**：与 ChatHub 一致，内存状态假定单实例部署；多实例需 Redis backplane + 分布式序号，列入开放问题

## 7. Hub API 设计

`CollabHub : Hub`，`[Authorize]`，端点 `/collab`（见第 8 节的 JWT 配置改动）。

### 客户端可调用的方法

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `JoinRoom` | `int saveId` | `JoinCollabRoomResult` | 校验存档编辑权限（见第 8 节）。**房间不存在时仅存档所有者可创建房间并成为房主**（非 owner 拒绝，不启动协作机制）；房间已存在时任何有编辑权限者可加入为协作者。分配 id 前缀（租约制：最小空闲前缀，离房回收）；加入 SignalR group、登记成员与连接映射；向其他人广播 `UserJoined`。重复加入幂等（已加入时返回原前缀） |
| `LeaveRoom` | `int saveId` | — | 移出调用者连接（成员与 group、释放该连接全部锁并广播 `LockReleased`、广播 `UserLeft`）；同一用户其他连接仍在房时成员保留。**普通成员离房不再触发继任**；空房触发回收。**房主的主动关房走 `CloseRoom`，本条对房主仅作连接级兜底** |
| `CloseRoom` | `int saveId` | — | **仅房主可调用**（2026-09 新增，§7.1）：房主主动关闭整个房间——回收房间与快照缓存、向全房间广播 `RoomClosed`（含房主自己，房主客户端据此清理本地会话）。幂等（房间不存在时静默成功）。房主离开编辑器路由/切换 saveId 时客户端先尽力调用本条，再走 `LeaveRoom`/断开 |
| `SubmitOp` | `int saveId, string opId, string patch, long baseSeq` | `long`（分配的 Seq） | 校验成员身份、patch 大小（`patch.Length`）、提交频率；锁内分配 Seq + 入队；锁外 `OthersInGroup` 广播 `ReceiveOp`。返回值即 ack，发送方据此确认服务器已受理 |
| `SyncOps` | `int saveId, long afterSeq` | `SyncCollabOpsResult` | 增量补齐。队列中最早 Seq > afterSeq 时正常返回；否则 `Gap = true`。不要求调用者是成员（重连竞态下允许先 Sync 后 Join） |
| `AcquireLock` | `int saveId, string key` | `bool` | 对象锁仲裁（first-write-wins）：锁键未被他人持有则获得、向其他人广播 `LockAcquired` 并返回 true；被他人持有返回 false（不广播）。同一持有者重复加锁幂等返回 true |
| `ReleaseLock` | `int saveId, string key` | — | 释放本连接持有的锁并广播 `LockReleased`；不持有该锁时静默忽略 |
| `RequestSnapshot` | `int saveId` | — | 请求现任房主生成存档快照（新成员初始化，第 10 节）；服务器向房主连接转发 `SnapshotRequested`。房主不在线时抛 `RqEx`（调用方稍后重试） |
| `NotifySaved` | `int saveId` | — | 房主宣布已保存：校验房主身份（非房主抛 `RqEx`）后向房间内其他人广播 `Saved`。轻量通知，服务器不落库、不校验存档、不参与限流（仅房主可调用，客户端保存路径本身有节流） |

### 服务器推送的事件

| 事件 | 负载 | 时机 |
|------|------|------|
| `ReceiveOp` | `CollabOpDto` | 房间内其他成员提交了操作 |
| `LockAcquired` | `CollabLockDto` | 房间内其他成员获得了对象锁 |
| `LockReleased` | `string key` | 房间内其他成员释放了对象锁，或其连接断开被服务器清锁 |
| `UserJoined` | `CollabMemberDto` | 有成员加入 |
| `UserLeft` | `CollabMemberDto` | 有成员离开或断连（其锁已全部释放并逐条广播 `LockReleased`，此事件作兜底） |
| `OwnerChanged` | `CollabMemberDto` | ~~房主离开/断连，在房最早加入者继任为新房主~~（2026-09 修订：继任保留但暂不使用，见 §7.1） |
| `RoomClosed` | `int saveId` | **房间被房主关闭**（§7.1）：房主主动 `CloseRoom`，或房主断连超宽限期。广播给全房间（含房主自己的其他连接）。所有成员弹窗"所有者已关闭房间"（区别于"所有者已关闭协作"），关闭弹窗后立即跳转首页 `/` |
| `OwnerOffline` | `int saveId` | 房主断连进入宽限期（§7.1）：房间保留但其他成员应显示蒙层禁止编辑，等待房主重连或宽限期超时 |
| `OwnerReconnected` | `int saveId` | 房主在宽限期内重连恢复（§7.1）：其他成员全部重新走第 10 节快照流程（重新以房主快照为底重建），完成后解除蒙层 |
| `SnapshotRequested` | `int saveId` | 有新成员请求存档快照（仅发给现任房主连接；房主序列化后走 HTTP 上传，第 10 节） |
| `Saved` | `string userName`（房主名） | 房主宣布已保存（`NotifySaved`，仅发给房间内其他人；客户端弹窗"房主已保存"） |

设计决策说明：

- **发送方不回收自己的 op**：广播用 `OthersInGroup`，发送方以 `SubmitOp` 的返回值（Seq）为 ack。客户端本地先乐观应用，收到 ack 后将本地 op 与 Seq 绑定；长时间无 ack 视为失败，走重同步
- **锁随连接存活**：`OnDisconnectedAsync` 释放该连接持有的全部锁并逐条广播 `LockReleased`。客户端重连后视为不持有任何锁，须清空本地 myLocks 并重新评估激活/选中对象（房主断连的宽限期例外见 §7.1：房主锁保留，重连后经快照重建重新仲裁）
- **`BaseSeq` v1 不做冲突校验**，只随 op 记录，供前端诊断与将来引入 OT/冲突检测时使用
- Hub 方法抛 `RqEx` 的风格沿用现有代码（`ChatHub` 同款）

### 房主生命周期：仅 owner 开房、关房与断网宽限（2026-09 修订，待实施）

本节取代此前"首个加入者即房主 + 房主离房/断连即继任"的语义。继任相关实现（`CollabLeaveResult.NewOwner`、`OwnerChanged` 广播、`ensureOwnerHeartbeat` 接管路径）**保留但暂不使用**，为未来放开"非 owner 开房"留路。

**① 仅存档所有者可启动协作**（2026-09 已实施，见 steps.md"待实施"清单对应条目）

- `JoinRoom` 时房间不存在：要求调用者是存档所有者（Hub 需查存档归属，用户解析已有 `_db`），否则抛 `RqEx`——**其他人进入时不启动协作机制**（按协作出现前的原有行为打开存档）
- `JoinRoom` 时房间已存在：任何有编辑权限者可加入为协作者；房主恒为存档所有者（首个加入者即存档所有者）
- 已知取舍（记入第 13 节开放问题，已实施缓解）：`collabEnabled` 持久化开着但无房间时，非 owner 可以普通编辑者身份进入并持有心跳；此后存档所有者再进入会被 `Occupied` 挡住。缓解（2026-09 已实施）：preflight 响应新增 `CollabRoomActive`（= `LoadStatus` 的 `HasRoom`），Editor 对"Occupied + 开关开 + 无房间"一律回退协作前的仅浏览（提示"当前有其他用户在编辑，无法保存更改"），不再误开房/接管保存权；等对方释放心跳后重新进入即可正常开房协作

**② 房主主动关房（CloseRoom）**

- 触发：房主离开编辑器路由（router 切走）或切换 saveId。SPA 内导航可可靠地先 `await CloseRoom(saveId)` 再离开；整页刷新/标签页关闭场景 `onBeforeUnmount` 不执行，只能靠 ③ 的宽限期兜底（房主在宽限期内重进则房间无缝恢复，超时则旧房被关）
- 服务器：`CloseRoom` 仅房主可调用（校验 `OwnerOf(room).UserId == userId`），回收房间（同空房回收：清 `_rooms` + 快照缓存）、广播 `RoomClosed`
- 客户端：所有成员（含房主自己）收到 `RoomClosed` → 清理本地会话（`cleanupLocal`，同现有 leave 语义）→ 弹窗**"所有者已关闭房间"**——区别于房主在面板里关协作开关（`collabEnabled=false` 经 op 广播）触发的**"所有者已关闭协作"**
- **两种弹窗均用 `Prompt` 组件且 `bgClickClose=false`（只能按钮关闭），弹窗关闭后立即 `router.push('/')` 跳转首页**（现有 `CollabPanel` 的关闭协作弹窗已满足 `bgClickClose=false`，需补跳转）。同一会话先收到"已关闭协作"又收到 `RoomClosed` 时，后者不再重复弹窗（以前者为准）
- 房主关闭协作开关（`disableCollab`）与房主关房在服务器侧殊途同归（房间最终都回收），差别只在成员收到的提示文案与路径

**③ 房主断网宽限期（区分"网络波动"与"主动关房"）**

- 判定依据：服务器**是否收到房主的主动关房信号**（`CloseRoom` 或房主连接上正常的 `LeaveRoom`）。收到 = 主动关房，立即广播 `RoomClosed`；未收到而连接断开 = 网络波动，进入宽限期
- 宽限期内：房间保留（不回收、不清房主成员的锁/前缀），向其他成员广播 `OwnerOffline`；客户端收到后显示**全屏蒙层**（复用 `CollabStatusOverlay` 样式，文案如"所有者已离线，暂时无法编辑"），`canEdit=false` 阻止继续操作。服务器不强制拒绝此期间的 `SubmitOp`（客户端蒙层已禁止编辑，服务端校验保持现状即可）
- 宽限期内房主重连：`withAutomaticReconnect` 恢复连接后按第 9 节重连流程重新 `JoinRoom`（幂等，同 userId 拿回房主身份，前缀租约不变）→ 服务器清离线标记、广播 `OwnerReconnected` → **其他成员全部重新走第 10 节快照流程**（`RequestSnapshot` → 轮询 → 整档重建），完成后解除蒙层。选快照重建而非增量补齐：房主断线期间状态相对其他成员可能大幅落后/分叉，整档重建最稳
- 宽限期超时（`CollabOptions.OwnerOfflineGraceSeconds`，建议默认 30 秒）：视同主动关房——回收房间、向仍在房的成员广播 `RoomClosed`（弹窗"所有者已关闭房间"→ 跳 `/`）
- 房主自己的断线蒙层沿用现有 `connState` 机制（与协作者一致），重连后按第 9 节恢复

**④ 前端开关进入协作的条件不变**

存档 `meta.collabEnabled === true` 仍是进入协作的前置条件（Editor 进房判定、SaveAvatar"可协作"徽章的进入行为均不改动）；本节只改"谁能开房"与"房主离开时房间的命运"。

## 8. 与现有体系的关系

### 权限

- `JoinRoom`：要求对存档有**编辑权限**（与编辑器打开存档同一标准：`AuthGrantCheckService.CheckFor(AuthGrantOn.Save, saveId, (byte)AuthGrantTypeOfSave.Edit, false)`）。Hub 内 `IHttpContextAccessor` 不可用，故该服务提供显式传入身份信息的重载，判定逻辑与 HTTP 场景共用同一份代码
- `SubmitOp`：要求 `UserType.Member` 及以上（对齐 `ChatHub.SendMessage` 的做法）。协作者是否必须是存档 owner / 心跳持有者——见第 13 节开放问题，v1 建议放宽为"任何可见且 Member 以上的用户"
- Hub 构造函数注入 `AarcContext` 与 `ILogger`，用户解析方式照抄 `ChatHub.TryGetCurrentUserInfo`

### JWT 配置改动（必须）

`JwtService.cs:35` 的 `OnMessageReceived` 目前只对 `/chat` 路径从查询字符串取 token，需要把 `/collab` 加进去：

```csharp
if (!string.IsNullOrEmpty(accessToken) &&
    (path.StartsWithSegments("/chat") || path.StartsWithSegments("/collab")))
```

### 注册改动

- `Program.cs`：`app.MapHub<CollabHub>("/collab");`（`AddSignalR()` 已有，无需重复）
- 新增 `builder.Services.AddCollabServices()` 扩展方法（放在 `AARC.WebApi/Services/Collab/` 内，对齐 `AddSavesServices` 等现有模式），注册 `CollabRoomManager` 为单例

### 与心跳/单编辑器锁的关系（保存责任人已定稿：房主制）

**已定稿（2025-12，不再是开放问题；2026-09 修订见 §7.1）**：保存责任人 = **房主** = **存档所有者**（仅其可开房；其他人进入不启动协作机制）。只有房主能保存；其他协作者的编辑通过 op 实时汇聚到房主本地存档，自己无法保存。

- 协作房间只负责实时同步，**不触碰心跳字段**；持久化仍走现有 `UpdateDataAndDiff` 全量保存 + 落库 diff
- **房主 = 心跳持有者**：房主打开存档时走现有 `SaveRepo.Heartbeat`（Initialization/Renewal）正常流程；协作者以协作身份加入时**不发心跳**
- **后端保存路径零改动**：`UpdateDataAndDiff` 现有的心跳校验天然拒绝非心跳持有者的保存——只要协作者不发心跳，"只有房主能保存"就由现有机制自动保证，无需在保存接口中查询房间状态
- **前端约束**：非房主禁用保存入口（保存按钮/Ctrl+S），UI 展示"由 XX 保存中"之类的提示；`JoinCollabRoomResult.OwnerUserId` 驱动该状态（`OwnerChanged` 继任路径保留但暂不使用，见 §7.1）
- **房主关房**：房主主动离开（路由切走/切换 saveId）时房间即关闭（`CloseRoom` + `RoomClosed` 广播，§7.1），不再由继任者接续保存权。已知取舍：房主若有未 ack 的本地编辑就关房/断网超时，这部分编辑随房间关闭而丢失（best-effort，与断线重连语义一致）；宽限期内的短暂断网不受影响（重连后房间恢复）

## 9. 断线重连语义

客户端为每个房间维护 `lastSeq`（最后应用的 op 序号）。重连流程：

1. 重新建立 SignalR 连接（`withAutomaticReconnect`，同 signalrStore 现有做法）
2. `JoinRoom(saveId)` 拿回 `LatestSeq` 与成员列表
3. 若 `lastSeq < LatestSeq`：调用 `SyncOps(saveId, lastSeq)` 增量补齐
   - `Gap = false`：按 Seq 顺序应用返回的 ops
   - `Gap = true`：队列已被修剪（断线太久或房间太活跃），走第 10 节快照流程重建（DB 底不可靠，不再走 HTTP `LoadData` 整档重载）——这是有界队列的必然代价，配置阈值（第 6 节）决定可容忍的断线时长
4. 断线期间未发送成功的本地 op：客户端维护**未 ack 待发队列**（`SubmitOp` 返回 Seq 才算成功），重连并增量补齐后按原序重新提交——重发的 op 作为全新提交由服务端分配新 Seq、按到达时序照常做锁仲裁，语义与在线时一致；同时断线期间前端显示蒙层禁止继续编辑（前端职责，后端无需配合）
5. 锁状态重建：断连期间服务器已清掉本连接的全部锁，客户端重连后须清空本地"我持有的锁"、重新评估激活/选中对象（可重新加锁）；他人锁以新的 `JoinRoom` 返回快照为准

**房主断连的特殊处理（2026-09 修订，见 §7.1）**：上述流程针对常规断线（普通成员、以及房主自己的连接恢复）。房主断连且未先发送 `CloseRoom`（即"网络波动"而非"主动关房"）时，服务器**不回收房间**，进入宽限期：广播 `OwnerOffline`，其他成员显示蒙层禁止编辑、等待房主；房主在宽限期内重连 → 重新 `JoinRoom` 幂等恢复房主身份（前缀租约不变），服务器广播 `OwnerReconnected`，**其他成员全部重新走第 10 节快照流程**（整档重建，而非增量补齐——房主离线期间房间状态相对其他成员可能分叉，整档重建最稳）；宽限期超时 → 视同主动关房，回收房间并广播 `RoomClosed`。

对比 ChatHub 的 `SyncHistory`（全量重发 + messageId 去重），本方案用序号做增量，语义更严格且流量更小。

## 10. 新成员初始化：房主快照直传

**问题**：新加入者无法用"DB 存档 + 房间队列"拼出最新状态——① 房主制下 DB 可能长期落后于房间实际状态（房主开房后未保存）；② 队列有界修剪，新客需要的从 Seq 1 起的历史可能已不存在；③ 房主开房前的单人编辑不在任何 op 里。差距只存在于房主内存中，因此**新客的底必须来自房主，而非 DB**。

**流程**（新客视角）：

1. `JoinRoom(saveId)`（HTTP `LoadData` 的 DB 版本仅作加载占位，也可直接显示加载中）
2. JoinRoom 成功后开始**缓冲**全部 `ReceiveOp`（此时已在 group 内，不会漏收）；同步完成前禁止本地编辑
3. 调用 `RequestSnapshot(saveId)`，服务器把 `SnapshotRequested` 转发给现任房主连接
4. 房主序列化本地存档（LZString 压缩，同 `SaveDiffService` 落库方案），记录自己已应用的最大 Seq 作为**水位**，POST `/collab/snapshot` 上传；服务器按房间缓存（TTL 约 60 秒，可被更新的快照覆盖）
5. 新客轮询 GET `/collab/snapshot?saveId=`（约 1s 间隔，15s 超时）拿到 `{ seq, payload }`
6. 以快照为底：应用快照 → `SyncOps(saveId, seq)` 补齐水位之后的 ops → 与缓冲的广播 ops 按 Seq 去重、升序应用 → 进入正常协作态

快照 DTO：

```csharp
/// 房主上传的存档快照（POST /collab/snapshot；Payload 为 LZString 压缩后的 base64）
public class CollabSnapshotUpload
{
    public int SaveId { get; set; }
    public long Seq { get; set; }       // 房主已应用的最大 op 序号（水位）
    public string Payload { get; set; }
}

/// GET /collab/snapshot?saveId= 返回（快照未就绪时 404，调用方轮询）
public class CollabSnapshotResult
{
    public long Seq { get; set; }
    public string Payload { get; set; }
    public string FromUserName { get; set; }
}
```

权限：上传仅现任房主（`CollabRoomManager` 校验），下载仅房间成员。

**同步期间发生编辑的安全性**（本方案的关键性质）：

- **房主/其他成员在快照生成与传输期间的编辑**：全部经 `SubmitOp` 获得比快照水位更大的 Seq，新客在第 6 步按序应用，不丢不重（Seq 去重）
- **水位必须由房主自报**（其已应用的最大 Seq），不能由服务器在收到上传时盖戳——序列化到上传之间到达的 op 不在快照内，服务器盖戳会错误吞掉它们
- **新客自己的编辑**：同步完成前一律禁止（loading 态），因为其 diff 基线尚未建立
- **快照请求在途时房主断连**：宽限期（§7.1）内房主连接恢复，`SnapshotRequested` 转发照常完成；宽限期超时房间已关，新客会随 `RoomClosed` 离开，不存在"房间在但无房主可传快照"的中间态（继任路径保留但暂不使用）。已知损失只有旧房主未 ack 的半截编辑（第 8 节已述）

**为什么不走 SignalR 传快照**：存档 JSON 可达 MB 级，而 ASP.NET Core SignalR 默认 `MaximumReceiveMessageSize = 32KB`；快照走 HTTP 上传/下载，SignalR 只传控制消息。注意 `SubmitOp` 计划的 256KB 上限也超过该默认值，需调 `MaximumReceiveMessageSize`（见第 11 节）。

**对断线重连语义的影响**：第 9 节中 `Gap=true` 的兜底从"HTTP LoadData 整档重载"改为"走本节快照流程"（DB 底同样不可靠）。

## 11. 限流与安全

现有 `RateLimitMiddleware`（`AARC.WebApi/Utils/RateLimitMiddleware.cs`）基于 HTTP endpoint 元数据，**不覆盖 SignalR 长连接上的方法调用**，需在 Hub 层自行实现：

- **提交频率**：每连接令牌桶（如 20 次/秒、突发 40），超限抛 `RqEx`；状态可挂在 `Context.Items` 或连接级字典（`SubmitOp` 与 `AcquireLock`/`ReleaseLock` 共用同一桶）
- **patch 大小**：单条 patch 上限（如 256 KB，按 `string.Length` 计），超限抛 `RqEx`
- **SignalR 消息上限**：默认 `MaximumReceiveMessageSize = 32KB` 放不下 256KB 的 patch，须在 `AddSignalR(o => ...)` 中调大（建议 512 KB，为 JSON 包装膨胀留余量）；快照走 HTTP 不受此限，但快照上传 endpoint 需自身的 body 大小上限（如 8 MB）与频率限制
- **房间规模**：每房间成员上限（如 10 人），超限拒绝加入
- **房主断网宽限期**（2026-09 修订，§7.1）：房主断连后房间保留的时长，超时视同主动关房。集中到 `CollabOptions.OwnerOfflineGraceSeconds`（建议默认 30 秒）；定时器可用 `Task.Delay` + 取消令牌或轮询 `LastActiveAt`，到点校验房主连接确未恢复再关房
- 所有限制值集中到 `CollabOptions`（可由 `appsettings.json` 覆盖，默认硬编码）

## 12. 实现步骤

| # | 动作 | 文件 |
|---|------|------|
| 1 | 新建 DTO（第 5 节）+ 快照 DTO（第 10 节） | `AARC.Collab/CollabDtos.cs` |
| 2 | 新建 `CollabRoomManager`：房间表、序号、入队、修剪、成员、空房回收、锁仲裁、前缀分发、快照缓存（第 6、10 节） | `AARC.Collab/CollabRoomManager.cs` |
| 3 | 新建 `CollabHub`：7 个方法 + 7 个事件 + 断连清理（含清锁广播、房主继任广播）+ 限流（第 7、11 节） | `AARC.WebApi/Services/Collab/CollabHub.cs` |
| 4 | 新建 `CollabController`：快照上传/下载 HTTP endpoint（第 10 节） | `AARC.WebApi/Controllers/CollabController.cs` |
| 5 | 新建 `AddCollabServices()` 扩展并注册单例 | `AARC.WebApi/Services/Collab/CollabServiceCollection.cs`，`Program.cs` |
| 6 | JWT `OnMessageReceived` 放行 `/collab` | `AARC.WebApi/Services/App/Authentication/JwtService.cs:35` |
| 7 | `app.MapHub<CollabHub>("/collab")` + 调大 `MaximumReceiveMessageSize`（第 11 节） | `AARC.WebApi/Program.cs` |
| 8 | `dotnet build` 验证（按根 AGENTS.md；若 dll 被锁则用 `-o temp-build` 方式）；新增 HTTP endpoint，需重新生成 TS 客户端（gen-ts-client） | — |

说明：本期不改 `Program.cs` 以外的任何现有行为，ChatHub、`SaveRepo`、心跳逻辑零改动；因新增快照 HTTP endpoint（第 10 节），**需要**重新生成 TS 客户端（`gen-ts-client` 只覆盖 HTTP API，Hub 方法不受影响）。

## 13. 开放问题（本期不解决）

- **冲突消解**：v1 服务器只做全序广播，两个用户同时改同一对象时是 last-writer-wins（按服务器 Seq），是否引入 OT/CRDT 由前端方案决定，后端已预留 `BaseSeq` 字段
- **多实例部署**：内存队列 + SignalR group 均为单机方案，横向扩展需 Redis backplane 与分布式序号发生器（现有 ChatHub 有同样前提）
- **与聊天房间的关系**：聊天与协作同一 saveId 是否共用房间/连接，v1 分开实现，后续视前端体验决定是否合并连接
- **锁保活**：当前锁随连接存活、断连即释放，长时间激活同一对象不需要续期；若未来引入"连接在但用户长时间无操作"的清场需求，再考虑锁 TTL
- **"仅 owner 可开房"的占位场景**（2026-09 修订的已知取舍，§7.1，已实施缓解）：`collabEnabled` 持久化开着但无房间时，非 owner 以普通编辑者身份进入并持有心跳；此后存档所有者再进入会被 `Occupied` 挡住——preflight 的 `CollabRoomActive` 为 false 时按仅浏览处理（不会误开房接管）。若未来放开"非 owner 开房"或引入"房主接管心跳"机制，需重新评估
