# 协作面板：成员列表与事件日志（设计，已实施）

本文档规划协作状态组件（`aarc-web/src/pages/editors/components/CollabPanel.vue`）的增强：
展示**房间内玩家名称列表**与**事件日志**（"某人进入/离开了"、"某人进行了 xx 操作"），
其中他人进入/离开房间同时使用 `showPop` 气泡提示。

协议与传输层零改动——所需数据（成员列表、进/出房事件、op 的 userName 与 patch）
在当前协议里已经全部具备，本期是纯前端（core + web）工作。

## 1. 现状盘点

已具备的条件：

| 条件 | 位置 |
|------|------|
| 成员列表 `members: CollabMemberInfo[]`（`{userId, userName}`） | `collabSessionStore.ts:118`，随 join/rejoin 赋值、`onUserJoined`/`onUserLeft` 增量维护 |
| 房主身份 `ownerUserId` / `isOwner` | `collabSessionStore.ts:117,122` |
| 进/出房事件处理器（目前**只更新数组，无任何 UI 反馈**） | `collabSessionStore.ts:428-440` |
| op 消息携带 `userId`/`userName`/`patch`（SaveDiff JSON 字符串） | `collabTransport.ts:15-23`（`CollabOpMsg`） |
| core 内调 `showPop` 的先例（`onSaved` 弹"房主已保存"、同步失败弹窗） | `collabSessionStore.ts:589,425`；`showPop` 定义于 `app/globalStores/uniqueComponents.ts:19`，签名 `(msg, type: "success"\|"failed"\|"warning"\|"info")`，时长固定约 2.5s |
| 日志列表 UI 参照：ChatRoom 的 `.messages` 容器（滚动跟随、system 样式变体） | `aarc-web/src/pages/chat/ChatRoom.vue:349-362` |
| CollabPanel 的 SideBar 用 `shrink-way='v-show'`，面板 DOM 常驻挂载（日志可持续追加） | `CollabPanel.vue:100` |

缺口：

- `members` 的消费方只有面板里的一行计数（`CollabPanel.vue:48`）和 Editor 查房主名，没有成员列表 UI
- 进/出房无任何提示
- op 流没有任何"人话"概括代码（全仓库不存在 diff → 文本的转换），日志存储也不存在

## 2. 总体设计

新增一个 core 侧日志 store 作为唯一数据源，会话层挂钩写入，web 面板只负责渲染：

```
服务器事件 ──▶ collabSessionStore（onUserJoined/onUserLeft/onOp）
                    │ 挂钩（3 处）
                    ▼
            collabLogStore（core，环形日志，响应式 entries）
                    │                      │
              web CollabPanel        showPop（仅进/出房）
              （成员列表 + 日志列表）
```

职责划分：

- **core**：日志的产生、概括、存储、气泡。会话层已经集中处理所有协作事件且有 showPop 先例，
  挂钩放这里最内聚、可单测（mock 传输接口的现有测试基建直接复用）；web 侧只加一个展示组件，不引入"watch members 前后数组比差"这类脆弱逻辑
- **web**：`CollabPanel.vue` 增加两个展示区块，纯渲染

## 3. core 改动

### 3.1 新增 `src/models/collab/opSummary.ts`：SaveDiff → 人话概括

纯函数（node 单测友好，不依赖 store）：

```ts
/** 把一条协作 op 的 diff 概括为一句中文，如 "新增了车站「新宿」、删除了 2 条线路"。
 *  save = 应用该 diff 之前的存档（用于查 $rm/$upd 目标的名称）；可能为 null */
export function summarizeSaveDiff(diff: SaveDiff, save: Save | null): string
```

概括规则（"大致描述即可"，按顶层 key 逐个生成片段、`、` 连接；无法识别则兜底 `"进行了编辑"`）：

- **keyed 数组**（`$add`/`$rm`/`$upd`）：按"新增 N 个 / 删除了 / 修改了" + 类型名组织：
  - 类型名映射：`points` → 按元素 `sta === 1` 细分"车站"/"控制点"；`lines` → 线路；`textTags` → 文本标签（无 name，用 `text` 字段截断展示）；`lineStyles`/`lineGroups`/`styleSlices`/`timeSlices`/`textTagIcons`/`patterns`/`dataSources`/`selectionGroups` → 各自的类型名
  - 单个元素且查得到名称时引用名称："删除了线路「山手线」"；多个或无名称时用数量："修改了 3 个车站"
  - **`$rm`/`$upd` 的名称必须在应用 diff 之前查**（应用后目标已删除/改名）；`$add` 的名称在 diff 元素本体里
  - `$seq`（纯重排）概括为"调整了 xx 的顺序"
- **`$set` 整组替换**：`pointLinks`（元素无 id 只能整组 `$set`）→ "修改了点间连线"；`cvsSize` → "调整了画布尺寸"
- **递归对象**：`config` → "修改了全局配置"；`meta` → "修改了存档设置"（`collabEnabled=false` 有专门弹窗，日志照记不冲突）
- **必须忽略 `idIncre`**：任何元素创建都会带动自增计数器变化，它是每个 diff 的固定噪音，不参与概括
- 一条 diff 涉及多个顶层 key 时拼接全部片段；全部片段都被忽略（理论上只剩 idIncre）时兜底 "进行了编辑"

### 3.2 新增 `src/models/collab/collabLogStore.ts`：日志 store

```ts
export interface CollabLogEntry {
    id: number            // 自增
    time: number          // Date.now()，面板里 toLocaleTimeString()
    kind: 'join' | 'leave' | 'op'
    userName: string
    text: string          // join/leave 为 "加入了协作" 等；op 为概括文本
}
```

- 响应式 `entries: CollabLogEntry[]`，**环形上限 100 条**（超出从头丢弃；协作会话级别的日志无持久化需求）
- `add(entry)` / `clear()`
- 纯数据 store，无任何副作用（showPop 由会话层发，见下），单测直接断言数组

### 3.3 `collabSessionStore.ts` 挂钩（3 处）

1. **`onUserJoined`（:428）**：数组更新后追加——
   `logStore.add({kind:'join', ...})` + `showPop(\`${m.userName} 加入了协作\`, 'info')`。
   自己进房不会收到自己的 `UserJoined`（初始成员列表由 join 返回直接赋值，不逐条触发事件），天然不弹
2. **`onUserLeft`（:435）**：同理，`kind:'leave'` + `showPop(\`${m.userName} 离开了协作\`, 'info')`
3. **`applyOpNow`（:174）**：`JSON.parse` 之后、**`applyRemoteSaveDiff` 之前**调
   `summarizeSaveDiff(diff, saveStore.save)`（应用前才能查到待删/待改对象的名称），
   成功后 `logStore.add({kind:'op', userName: op.userName, text})`。
   解析失败走快照兜底的路径不记日志
4. **`cleanupLocal`（:695）**：`logStore.clear()`——日志随会话消亡，重进房间是全新日志

只记录**他人**的 op：上述路径本就是远程 op 的入口（本地 op 走 `captureLocalOp`，不经 `onOp`），天然满足；本人操作不记日志（自己知道自己干了什么，避免刷屏）。

### 3.4 已知取舍（v1 接受，文档化）

- **断线抖动**：A 短暂断连会广播 `UserLeft`、重连再 `UserJoined`，其他成员看到一对"离开/加入"气泡。
  v1 接受（与锁释放语义一致——断连时 A 的锁本就真实释放了）；若后续嫌吵，可做 3s 内同名 left+join 相互抵消的合并，属 UI 层优化，不动协议
- **追赶期日志**：稳态跳号 → `catchUp` 补齐、快照重建后缓冲重放时，每条历史 op 也会经过 `applyOpNow`
  而逐条记日志。v1 接受（这些本就是真实发生的他人编辑，漏收的补记反而合理）；
  快照整档重建（`reloadSaveFromSnapshot` 路径）重放的存量 op 量可能很大，届时可改为合并成一条
  "同步了 N 条历史操作"，列入后续优化
- `showPop` 时长固定 ~2.5s、无标题参数（`Pop.vue` 硬编码），进/出房提示用这个规格足够，不改 Pop

## 4. web 改动：`CollabPanel.vue`

在现有"功能开关 / 会话状态 / 提示文案"之后追加两个区块：

1. **成员列表**：渲染 `collabSession.members`——每行 userName + 徽章：
   `userId === collabSession.ownerUserId` 显示"房主"，`userId === collabSession.myUserId` 显示"我"（可叠加）。
   替代现有 `sessionStatus` 里的"N 人在线"计数（保留会话状态文案本身：未连接/同步中/离线等）
2. **事件日志**：渲染 `collabLogStore.entries`，参照 ChatRoom 的消息列表（`ChatRoom.vue:349-362`）：
   - 容器 `flex:1 + overflow-y:auto`，条目为"时间 + userName + text"一行（日志比聊天消息轻，单行即可；
     join/leave 条目用弱化样式——对应 ChatRoom 的 `system` 变体：居中、灰/浅色、斜体）
   - 新条目到达且滚动在底部时自动滚底（照搬 `atBottom` + `nextTick` 模式）；用户上翻时不打断
   - SideBar 已是 `v-show` 常驻挂载，日志在面板折叠期间也持续累积，展开即见

`CollabStatusOverlay.vue` 不动（蒙层语义与日志无关）。

## 5. 改动清单

| # | 动作 | 文件 |
|---|------|------|
| 1 | 新增 SaveDiff 概括纯函数 | `aarc-core/src/models/collab/opSummary.ts`（新增） |
| 2 | 概括函数单测（各顶层 key、增/删/改/重排、idIncre 忽略、无名元素兜底、多片段拼接） | `aarc-core/src/tests/unit/collab/opSummary.test.ts`（新增） |
| 3 | 新增日志 store（环形 100 条） | `aarc-core/src/models/collab/collabLogStore.ts`（新增） |
| 4 | 会话层 4 处挂钩（join/leave/op/cleanup） | `aarc-core/src/models/collab/collabSessionStore.ts` |
| 5 | 会话层单测：进/出房产生日志与 showPop（mock `uniqueComponents` 或断言 popCallback）、远程 op 产生概括日志、leave 清空日志 | `aarc-core/src/tests/unit/collab/collabSession.test.ts`（追加用例） |
| 6 | 面板加成员列表 + 日志列表 | `aarc-web/src/pages/editors/components/CollabPanel.vue` |
| 7 | 验证：`pnpm --filter aarc-core type-check` + core 单测、`pnpm --filter aarc-web type-check` | — |

注意（根 AGENTS.md 前端测试约定）：日志 store 单测若触发会话层路径，沿用现有 `collabSession.test.ts`
的基建（mock 传输、`createTestPinia`、`flush()` 等收尾），新增 mock 失败必须有限次。

## 6. 不做的事（本期）

- 不改后端协议/传输层（数据已齐备）
- 不持久化日志（会话级，离房即弃）
- 不做 op 撤销/定位跳转等日志交互（纯展示）
- 不做断线抖动合并与追赶期日志合并（§3.4，视体验再迭代）

## 7. 实施落地情况（本期已按上述设计完成）

代码与本文的出入（都是措辞/细节层面的取舍，不影响设计）：

- 类型名沿用站内既有叫法：`lineGroups` → 线路分组、`patterns` → 纹理、
  `textTagIcons` → 图标、`styleSlices` → 样式片段、`timeSlices` → 时间片段
- 数量形态统一用「N 个 xx」（不给每类配量词，"2 条线路"与"2 个线路"里只有后者是通用的），
  名称超过 12 字截断加 `…`
- 同一条 diff 里识别不了的结构会多个顶层 key 同时命中兜底，片段拼接前先去重，
  避免出现"进行了编辑、进行了编辑"
- `$seq` 只在该节点没有 `$add`/`$rm`/`$upd` 时单独成句（与增删改同时出现时属重排噪音）
- `summarizeSaveDiff` 的 save 参数接受 `null | undefined`（会话层 `saveStore.save` 本身可能 undefined），
  且函数对任意畸形 diff 都不抛异常——它挂在远程 op 的数据应用路径上，抛错会误触发快照重建兜底
- 面板布局：`.collabPanel` 撑满 SideBar body 高度（`height:100%` + flex 列），日志区块 `flex:1`，
  成员区块保持自然高度（成员数很少，不需要滚动）
