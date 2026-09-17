# 多人协作 — 元素 ID 冲突问题分析

本文分析多人协作场景下「新元素 ID 通过 `getNewId()` 自增分配」的冲突问题，评估各解决方案的改动量与风险。是 `backend-plan.md` 的配套分析（前端侧前置问题）。

## 1. 问题机理

当前 ID 分配机制：

- `saveStore.getNewId()`（`aarc-core/src/models/stores/saveStore.ts:274`）返回 `save.idIncre++`，即**全存档共享一个自增计数器**，初始为 1（`save.ts:5`）
- 加载时 `ensureValidIdIncre`（`valid/idIncre.ts:3-25`）将 `idIncre` 修复为「全存档最大数值 id + 1」

多人场景下，两个客户端基于同一存档版本打开后，`idIncre` 相同：

1. 用户 A 新建一个点，本地取到 `id = N`
2. 用户 B 同时新建一个点，本地也取到 `id = N`
3. 两个 patch 先后到达服务器（按 `backend-plan.md` 的全序广播），所有客户端应用后出现**两个同 id 元素**

后果比"数据脏一点"更严重：

- keyed array diff（落库 diff 与协作 patch 同格式）以 id 配对 add/remove/replace，同 id 元素使后续 diff 语义错乱
- 前端大量 `Record<number, T>` 字典（`ptDict`、`lineDict` 等，saveStore.ts:20-260）直接互相覆盖
- 引用关系（`line.pts`、`pointLinks.pts`、`textTag.forId`、`selectionGroups`）指向错误的元素

**缓解因素（不改变结论）**：id 的唯一性实际上只需要在**同一实体类型（同一数组）内**成立——keyed diff 按数组路径独立配对，前端字典也按类型分开（`ptDict` 只装点、`lineDict` 只装线），跨类型引用各有明确的类型语义。A 建点、B 建线取到同 id 是无害的；只有**同类型并发创建**才冲突。这意味着"同类型创建"是低频事件，但一旦房间里有两个人同时画线/加点就必然踩中。

**附带问题：`idIncre` 本身是被 diff 的共享字段**。它随存档 JSON 一起序列化、一起被 diff（后端对它无任何特殊处理，走普通标量 diff）。即使解决了元素 id 冲突，只要多人各自执行 `idIncre++`，该字段就会在每个 patch 里反复横跳，产生持续的 diff 噪声和伪冲突。理想方案应让协作期间的新 id 分配**不触碰 `idIncre`**。

## 2. 现状盘点：ID 的消费方与硬约束

评估改动量前，先列出 id 的所有消费方（调查结论，均带出处）：

### 前端（aarc-core / aarc-web）

- **类型层**：`save.ts` 中全部实体 `id: number`，引用字段也都是 number（`Line.pts`、`ControlPointLink.pts`、`Line.parent/group/style`、`TextTag.forId/icon`、`SelectionGroup.ptIds/tagIds`、slice 系列等）；`getNewId: () => number` 签名被注入到 upgrade 脚本、`dataSourceOps`、`saveNormalize` 等约 10 处
- **字典/集合**：大量 `Record<number, …>`、`Map<number, …>`、`Set<number>`（saveStore、staClusterStore、iconStore、sliceResolverStore、lineStateStore、workers 等约 28 个文件）
- **字符串键回读 number**：`Object.entries` 后 `Number(id)`（saveStore.ts:82,84、freePtDirectionStore.ts:50）——id 变字符串会得到 `NaN`
- **全序依赖**：`staClusterStore.pure.ts:223,267` 用 `other.id <= pt.id` 做无序点对去重（只需全序，不需连续）
- **哨兵值**：`DataSourcesConfig.vue:27,55`、`TextTagIconConfig.vue:21,34` 用 `{id: 0}` 表示"创建中"占位
- **DOM 拼接**：`` `resultElId_${ptid}` ``、`data-line-id` 等（NameSearch.vue、Lines.vue 等）——字符串拼接，对负数/字符串 id 天然兼容
- **第三方库**：`@aurouscia/au-undo-redo` 的类型定义硬编码 `id: number`（其 `dist/patchStore.d.ts:5,13,16`）；运行时用 Map 键和 `===` 比较，对字符串兼容，但**类型层要 fork 或换库**
- 未发现对 id 的算术/位运算、按 id 排序业务列表、id 连续性假设

### 后端（AARC.WebApi / AARC.Diff）

- **存档 Data 本体对后端完全不透明**：存的是 string / LZString 字节，无 C# 强类型对应，除 diff 外无任何代码解析存档内部字段
- **唯一的硬约束在 `AARC.Diff`**：
  - `DiffGeneratorArray.cs:60,69` 用 `GetProperty("id").GetInt32()` 提取主键，`Dictionary<int,…>`、`HashSet<int>`、sequence 为 `List<int>`
  - `DiffGeneratorObject.cs:49` `DiffKeyedObjReplace(…, int key)`
  - `SaveDiffService.cs:96-114` 的 `PtLinkEqMark` 用 `pts[i].GetDecimal()`（pointLinks 引用点 id）
  - **`GetInt32()` 对字符串 id 或超出 int32 的数字直接抛异常**，异常在 `SaveRepo.UpdateDataAndDiff` 被吞成"保存失败"——即 id 不合规时非所有者保存整体失败
  - `AARC.Diff/README.md:10-11` 明文契约：「id 是兼容 int 的**正整数**，以后不会升级」
- 结论：**int32 是硬边界，"正整数"目前只是文档契约**（代码本身支持负数，但改契约要更新 README 并验证无正值假设）

### 存量存档

- 所有现存存档的 id 都是小的正整数（`idIncre` 从 1 自增；devSave 硬编码 `idIncre: 10000000`）
- 任何新方案必须与存量正整数 id **共存**（迁移全部存量存档不现实）

## 3. 候选方案

### 方案 A：随机字符串 ID（nanoid / uuid）

`id: string`，创建时生成随机串，彻底摆脱协调问题。

- 优点：零协调、碰撞概率可忽略、对将来 OT/CRDT 最友好、天然支持离线创建
- 缺点（改动量确实大）：
  1. 前端类型层约 28+ 文件：`id: number` → `string`，`Record/Map/Set<number>` → `string` 键，`getNewId: ()=>number` 的十余个注入点
  2. `Number(id)` 回读点失效（NaN），`staClusterStore` 的 `<=` 比较要改字典序（语义仍成立但需逐处确认）
  3. 第三方 `au-undo-redo` 类型硬编码 `id: number`，需 fork 或换库
  4. `AARC.Diff` 要改：`GetInt32()` → `GetString()`、`Dictionary<int>` → `Dictionary<string>`、sequence 元素类型、README 契约重写、测试矩阵整体换键类型
  5. 存量存档数字 id 与新字符串 id **混用**：`id: number|string` 联合类型会让上述所有比较点都要处理两种类型；`==` 宽松相等点（saveStore.ts:413,440,470 等）在类型混杂时行为微妙
  6. `{id: 0}` 哨兵要换成空串或专用标记
- **评估**：长期最干净，但作为多人协作 v1 的前置改造，成本（前端 + Diff 库 + 第三方库 fork + 混用期风险）远超协作功能本身。不建议作为 v1 方案。

### 方案 B：纯随机整数 ID

`getNewId()` 改为返回安全范围内的随机整数。

- 致命约束：`AARC.Diff` 的 `GetInt32()` 把可用空间压到 **int32（约 2.1×10⁹ 个正值）**
- 生日悖论下碰撞概率 ≈ n²/(2×2³¹)：单个存档累计创建 1 万元素即约 **2.3%** 碰撞率，10 万元素必然碰撞。对"会被长期多人编辑的存档"不可接受
- **评估**：否决。除非 Diff 库放宽到 int64（`GetInt64()`，改动很小），空间扩到 2⁶³ 后碰撞率才可忽略（1 万元素约 3×10⁻¹²）。这是方案 A 的一个低改动量变种，但仍有 `idIncre` 噪声问题，且随机数不可诊断，不如下面的分区方案

### 方案 C：会话分区整数 ID（推荐）

保持 `number` 类型与 int32 兼容，把 id 空间按**会话**分区：高位 = 会话前缀，低位 = 会话内本地计数。

```
id = -(prefix × 2^20 + counter)     prefix ∈ [1, 2047]（11 位），counter ∈ [0, 2^20-1]（20 位）
```

- **使用负数空间**：存量存档与 `idIncre` 自增序列全部是正整数，负数空间与其**零交集、零迁移**；`id` 恒 ≤ -2²⁰，不会碰到 `0` 哨兵
- **前缀分配**：加入协作房间时由服务器分配（`JoinRoom` 返回值加一个字段即可；房间成员上限 10 人，11 位前缀空间绰绰有余，服务器自增分发永不会重复）。也可客户端随机取 + 服务器查重拒绝，但服务器分发更简单
- **本地计数**：每会话可创建约 100 万元素，耗尽后向服务器申请新前缀或断开重进
- 单人 / 未加入房间时：回退到现有 `idIncre++` 正数逻辑，存量行为完全不变

满足全部硬约束：

| 约束 | 兼容性 |
|------|--------|
| `AARC.Diff` `GetInt32()` | 负数在 int32 范围内，代码直接兼容；但 README 的"正整数"契约要修订 |
| `ensureValidIdIncre` 取 max + 1 | 负数永远不成为 max，**无需改动**，且协作中 `idIncre` 不再被触碰 → 顺带消除 §1 的 diff 噪声 |
| `staClusterStore` `<=` 全序 | 负数仍是全序，成立 |
| `Number(id)` 回读、Map/Set 键、`===` 比较 | number 类型不变，全部兼容 |
| `au-undo-redo` 类型 `id: number` | 兼容 |
| `{id: 0}` 哨兵、DOM 拼接 | 兼容 |

- 改动面（估算）：
  1. `saveStore.getNewId()` 改为「有会话前缀走分区、无则 `idIncre++`」（单点）
  2. `saveNormalize.ts:57` 及 upgrade 注入点：规范化期间分配的都是配置类元素（非协作场景），保持 `idIncre++` 即可，或同样走分区——建议保持现状
  3. 协作会话层：JoinRoom 后设置前缀、断开/耗尽时清理（新代码）
  4. 服务器 `JoinRoom` 增加前缀分发（`CollabRoomManager` 房间锁内自增，几行代码）
  5. `AARC.Diff/README.md` 契约修订 + 负数 id 测试用例
- 缺点：依赖服务器在线分配（离线编辑新元素需用临时负数前缀 + 重连后换前缀，或干脆离线只读）；id 不再紧凑可读（调试时看到 -7340032 之类的值）
- **评估**：以最小的改动量消除了同类型并发创建冲突，且不动 Diff 库代码、不动类型系统、不迁移存量数据。**建议 v1 采用**。

### 方案 D：服务器 ID 段分配

客户端通过 Hub 预领 id 段（如每次 1000 个），用完再领。

- 优点：确定性、零碰撞、id 保持正数紧凑
- 缺点：需要分配水位持久化或「房间存活期内单调发段 + 保存时回写 `idIncre`」的约定；**断线期间无法分配**，离线编辑要么禁止要么引入临时 id + 重映射（重映射要穿透 `line.pts`、`pointLinks`、slice 等所有引用，复杂且易错）；比方案 C 多出预取/ refill / 断线处理一整套状态机
- **评估**：不优于方案 C，除非强烈要求 id 保持正数。

### 方案 E：服务器仲裁 + 乐观重试

客户端照常用 `idIncre++`，`SubmitOp` 时服务器检查 patch 中 add 的 id 是否已被占用，冲突则拒绝，客户端换 id 重新 diff 再提交。

- 优点：零前端改造
- 缺点：两个同版本客户端的**首次并发创建必然冲突**（不是小概率），每个创建路径都要加重试与失败 UI；服务器从"不透明中继"变成要解析 patch 内容，违背 `backend-plan.md` 第 3 节的定位；`idIncre` 噪声问题原样保留
- **评估**：不推荐单独采用；可作为方案 C 的兜底（防御性拒绝重复 id 的 add）。

## 4. 方案对比

| 方案 | 碰撞风险 | 前端改动 | 后端/Diff 改动 | 存量迁移 | 离线创建 | v1 适配度 |
|------|---------|---------|---------------|---------|---------|----------|
| A 随机字符串 | 可忽略 | 大（28+ 文件 + 第三方库 fork） | 大（Diff 库键类型） | 需混用策略 | 支持 | 差（成本超主线） |
| B 随机整数(int32) | 不可接受 | 极小 | 无 | 无 | 支持 | 否决 |
| B′ 随机整数(int64) | 可忽略 | 极小 | 小（GetInt64） | 无 | 支持 | 备选 |
| **C 会话分区负整数** | 零（前缀唯一即唯一） | 小（getNewId 单点 + 会话层） | 小（JoinRoom 分发 + README） | 无 | 受限 | **推荐** |
| D 服务器发段 | 零 | 中（领取状态机） | 中 | 需约定回写 | 不支持 | 一般 |
| E 乐观重试 | 冲突可修复但必然发生 | 中（全创建路径重试） | 中（服务器解析 patch） | 无 | 支持 | 差 |

## 5. 建议

1. **v1 采用方案 C（会话分区负整数）**：改动集中在 `getNewId` 单点与协作会话层，不动类型系统、不动 Diff 库代码、不迁移存量存档，且顺带消除 `idIncre` 的多人 diff 噪声
2. **同步做两件事**：
   - 修订 `AARC.Diff/README.md:10-11` 的"正整数"契约为"兼容 int32 的整数（协作场景使用负数分区空间）"，并在 `AARC.Diff.Test` 补负数 id 用例
   - 服务器侧无论最终选哪个方案，`SubmitOp` 都应防御性检测「add 的 id 与同房间已广播过的 add 重复」并拒绝（方案 E 的检测逻辑作为兜底，防止客户端 bug 造成全房间数据损坏）
3. **长期演进**：若未来需要离线编辑、跨设备草稿或 CRDT 级冲突消解，再评估方案 A（字符串 id）的整体迁移；方案 C 不阻塞该演进（负数空间可整体保留为合法 id）

## 6. 方案 C 实施清单（供后续任务拆分）

| # | 动作 | 位置 | 状态 |
|---|------|------|------|
| 1 | `getNewId()` 支持会话前缀：`-(prefix×2²⁰ + counter)`，无前缀回退 `idIncre++` | `aarc-core/src/models/stores/saveStore.ts:274` | ✅ 已实现 |
| 2 | 协作会话状态（前缀持有、计数器、耗尽处理） | `aarc-core/src/models/stores/collabStore.ts` | ✅ 已实现 |
| 3 | `JoinRoom` 返回分配的前缀；房间锁内自增分发 | `CollabRoomManager` / `CollabDtos.cs`（见 backend-plan.md §5/§7） | 待后端协作功能实施 |
| 4 | 规范化与 upgrade 路径保持 `idIncre++` 不变（非协作场景） | `saveNormalize.ts:57`（无需改动，确认即可） | ✅ 已确认 |
| 5 | Diff 库负数 id 测试 + README 契约修订 | `AARC.Diff.Test/DiffGeneratorKeyedArrayTests.cs`、`AARC.Diff/README.md` | 待实施 |
| 6 | 排查负 id 的隐含正值假设（重点是新增代码路径） | 全局，重点 `valid/` 目录 | ✅ 已排查（`valid/` 全部基于 Map/Set 查找与 `typeof number` 判断，对负数安全；全库无 `id>0`/`Math.abs(id)` 之类假设） |
| 7 | （兜底）`SubmitOp` 重复 id 检测 | `CollabHub` / `CollabRoomManager` | 待后端协作功能实施 |

实施细节说明（#1、#2）：

- 位分配：低 20 位会话内计数器（每前缀 2²⁰ ≈ 105 万个 id），高 11 位前缀（1..2047），常量导出为 `collabIdCounterBits` / `collabIdCounterCap` / `collabIdPrefixMax`；最大前缀 + 最大计数恰好落在 int32 负数范围内（≥ -(2³¹-1)）
- 计数器从 0 开始、设置/更换/清除前缀时重置；**耗尽时 `nextCollabId` 抛错**（未来协作层捕获后重新加入房间换新前缀）
- `collabStore.setIdPrefix(prefix)` / `clearIdPrefix()` 是会话的唯二入口，供将来的 JoinRoom/LeaveRoom 流程调用；未设置前缀时 `getNewId` 行为与原来完全一致
- 测试：`aarc-core/src/tests/unit/store/collabStore.test.ts`（回退、分区、区间不重叠、int32 边界、重置、非法前缀、耗尽）
