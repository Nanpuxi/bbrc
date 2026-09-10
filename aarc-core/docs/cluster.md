# 车站团（cluster）机制说明

本文描述 cluster 的生成、缓存、增量修改机制，以及 2026-08 几次 fix 修复的问题重点。

## 1. 什么是 cluster

地理位置足够接近的若干个站点（`sta === ControlPointSta.sta` 的控制点）会被划入同一个 cluster，渲染时涂成一个整体的"车站团"（换乘站样式），并共享站名解析、尺寸计算等逻辑。

核心文件：

| 文件 | 职责 |
|------|------|
| `src/models/stores/saveDerived/staClusterStore.pure.ts` | 全部纯函数：贴合判断、邻接表构建/增量更新、cluster 生成 |
| `src/models/stores/saveDerived/staClusterStore.ts` | pinia store：持有邻接表与 cluster 结果，对接 saveStore/configStore |
| `src/models/cvs/workers/clusterCvsWorker.ts` | 渲染侧：把 cluster 转成多边形并绘制，含渲染缓存 |

## 2. 贴合判断（ptClingingPure）

两个点是否应划入同一 cluster，由 `ptClingingPure` 判定：

- 点对阈值：`clingingDist = configClingingDist * (sizeA + sizeB) / 2`
  - `configClingingDist` 来自配置项 `snapOctaClingPtPtDist`
  - `size` 来自 `saveStore.getLinesDecidedPtSnapSize(id)`，即该点在各线路中决定的吸附尺寸
  - 因此**大站点的贴合阈值更大**，不是固定值
- 正式比较带 epsilon 余量：`distSq < (clingingDist + epsilon * 10)²`，其中 `epsilon = numberCmpEpsilon = 1e-4`（余量即 0.001），用于容忍长 cluster 中坐标累加产生的浮点漂移
- 带吸附候选时（free 点可能有平行线交点等候选位置），先做一次 bbox 快速拒绝（`bboxesCouldCling`），再做正式距离比较。正式比较与 `snapCore.snapInterPt` 的语义一致，分两层：
  - **位置对位置**：`a.pos vs b.pos`，阈值 `clingingDist + epsMargin`，与非 free 点的基准语义一致（候选列表本身包含 `pos`，但 pos 对的阈值不被吸附阈值收紧）
  - **位置对偏移候选**：`a.pos vs bSnap.candidates`、`b.pos vs aSnap.candidates`，阈值改用**实际吸附阈值** `snapThrs = snapOctaClingPtPtThrs × getSnapThrsRatio(id)`（`+ epsMargin`），与实际吸附完全对齐——只有"拖动某点时会真的吸附到对方候选上"才贴合，避免仅仅接近的点意外成 cluster（见 7.3）

**free 点 cluster 生成模式**（配置项 `freePtClusterMode`，见 `FreeSegmentConfig.vue`）：

- `loose`（默认）：即上述当前行为，点的实际位置落在对方吸附点位的吸附阈值内即算入 cluster
- `strict`：位置对偏移候选的比较阈值收紧为仅 epsilon 余量（`ptClingingPure` 的 `freeClusterMode` 参数），点的实际位置必须几乎精确落在对方吸附点位上才贴合；位置对位置的基准判断不受影响
- `off`：free 点完全不参与 cluster 生成——`ptClingingPure` 对任何含 free 点的点对直接返回不贴合（全量/增量/补丁恢复所有路径都经过该函数）；store 层此时也不再传入吸附候选，避免 free 点候选的无效计算

模式变化通过 `staClusterStore` 的配置 watch 使邻接表/cluster 缓存整体失效后懒加载重建（同 7.1）。strict/off 都只让正式判断更严格，所有预筛（bbox、轴向粗筛、网格半径）仍按 loose 口径计算，保持"只会更宽松"的不变量，无需改动。

**关键不变量：所有快速拒绝/预筛都必须比正式判断宽松（至少带相同的 epsilon 余量），否则会把本该贴合的点对提前误杀。** 第 6 节的几次 fix 都是这一原则被破坏导致的。

## 3. 生成机制（buildNeighbors）

全量构建分两步：

1. **构建邻接表** `buildNeighbors`：只考虑 sta 点，用均匀网格索引避免 O(n²)
   - 网格边长 `cellSize = 2.5 * configClingingDist`
   - 先缓存各点吸附尺寸，预计算：
     - `pairSpan(aId, bId)`：点对的真实贴合阈值（含尺寸）
     - `maxPairSpan = configClingingDist * maxSize`：全局最大点对阈值
     - `epsMargin = epsilon * 10`：与正式比较一致的余量
   - 网格搜索半径 `cellRadius = max(1, ceil((maxPairSpan [+ 2*maxReach] + epsMargin) / cellSize))`，保证大尺寸点对跨格也能搜到
   - 对搜索到的每个点对，先做轴向粗筛（`|dx|`、`|dy|` 不超过 `pairSpan + reachA + reachB + epsMargin`），通过后才调用 `ptClingingPure` 正式判断
   - 分两条路径：不传 `getSnapCandidates` 时为标准位置判断；传入时把 free 点的吸附候选与 `reach`（候选相对点位的最大轴向偏移）也纳入
2. **由邻接表生成 cluster** `makeClustersFromNeighborsPure`：对邻接表做洪水填充（`expandSetInNeighbors`），每个连通分量即一个 cluster

store 层（`staClusterStore.ts`）懒初始化：`staClusters` 为 `undefined` 时先 `initNeighbors()` 再 `makeClustersFromNeighbors()`；`staBelongToCluster` 是基于结果的 computed 反查表（点 id → 所属 cluster）。

## 4. 缓存机制

### 4.1 数据层缓存（staClusterStore）

- `neighbors` 邻接表是持久的模块级状态，点移动/删除时做**增量更新**而不是全量重建（见第 5 节）
- `staClusters` 由邻接表派生，每次邻接表变化后重新做洪水填充（开销很小）
- `clearItems()` 在存档切换时清空两者

### 4.2 渲染层缓存（clusterCvsWorker）

两级缓存：

1. **单个 cluster 多边形缓存** `clusterPolyCache`：以 `id:pos:dir:size` 拼接为 key，cluster 内点未变时直接复用已算好的四角点（四角点计算见 `../../aarc-web/docs/formalize-free-cluster.md`）
2. **全量渲染数据缓存**（perf 提交 `8ebbdb92`）：
   - 把所有 cluster 点的 `id/pos/dir/size`、所有 pointLink 的内容、以及**非 dot 链接端点的 `pos/dir/size/sta`** 写入可复用的签名缓冲区 `sigBuf`，与上一帧**逐位比较**（数值严格相等，无哈希碰撞风险）。端点数据必须入签名：伪集群与 cluster 型链接的多边形由端点坐标决定，而端点未必属于真实 cluster，否则移动端点时缓存不失效、伪集群留在原地
   - 签名未变时直接复用 `polysCache`，不再重新遍历点和拼接缓存 key
   - 视角（视口）移动不改变签名，因此逐帧只做 O(cluster数) 的视口剔除：用每个 poly 预存的 `bbox` 加上由 `maxStaSize` 决定的线宽 padding，与 `cvsBlocksControlStore.blockTotalBoundary` 比较，视口外直接过滤

## 5. 增量修改

- **点移动/状态变化**：`envStore` 在点位编辑后调用 `staClusterStore.updateClustersBecauseOf(pt)` → `updateNeighborsForMovedPt`
  - 先摘除该点所有旧邻接，再对全部 sta 点重算该点的邻接关系
  - 带吸附候选时同样先做轴向粗筛（阈值 = 点对真实贴合阈值 + 双方 reach + epsilon 余量），再进 `ptClingingPure`
  - 点变为非 sta 时只清除邻接直接返回
- **点删除**：`saveStore.deletedPoint` 钩子指向 `cleanClustersFromDeletedPt` → `cleanNeighborsForDeletedPt`，从所有邻居的集合中移除该点并删除其条目
- 两条路径最后都重新执行 `makeClustersFromNeighbors()`
- 两条增量路径都以缓存已构建为前提：`staClusters` 为 `undefined`（尚未懒加载构建）时**直接跳过**——存档数据本身已是最新，之后的 `getStaClusters` 会全量构建，在空邻接表上做增量更新会摧毁既有 cluster（见 7.4）

## 5.1 undo/redo 的缓存保留（patch 驱动）

undo/redo 的链路为 `undoStore.undo()/redo()` → `restoreState(state, patch)` → `resetterStore.resetDerivedStores(patch)`。撤销库 `@aurouscia/au-undo-redo` 的 `AurPatchStore` 内部已按 keyed 数组算好变更补丁（`{id, old?, new?}`，`old`/`new` 为 undefined 分别表示新增/删除），undo 应用的是 `history[pointer]`（应用前读取），redo 应用的是前移后 `history[pointer]`。

`staClusterStore.restoreWithPatch(patch)` 依据 `decideClusterRestoreStrategy`（纯函数）分三档处理：

| 条件 | 策略 | 代价 |
|------|------|------|
| patch 不含 `points`/`lines` | `preserve`：邻接表与 cluster 原样保留 | 零 |
| 只动少量 `points`（≤ `clusterRestoreIncrementalLimit` = 16） | `incremental`：逐变更点走 `updateNeighborsForMovedPt` / `cleanNeighborsForDeletedPt` | O(变更数 × n) |
| 无 patch 信息、动了 `lines`、变更点超阈值、或尚未构建过 | `rebuild`：`clearItems()` 后懒加载全量重建 | 与原行为一致 |

依据的不变量：patch 不含 points/lines 时，cluster 的全部输入（点位/状态/方向、吸附尺寸、free 点方向与 reach）都未变化。`lines` 之所以必须全量，是因为它决定吸附尺寸与 free 点方向/reach，无法按点增量。

非 undo/redo 的调用方（`app/editorSession.ts` 的 `loadSaveIntoEditor`、`stashStore.ts`）不传 patch，`patch === undefined` 保守走全量重建，行为与改造前一致。

## 6. 历次 fix 的问题重点

三次 fix 都是同一 bug 模式：**预筛条件比正式判断更严格，把本应贴合的点对提前误杀，导致长 cluster 断链**。

### 6.1 `4ec20c40` — bbox 快速拒绝缺少 epsilon 余量

`ptClingingPure` 带吸附候选时，bbox 快速拒绝只传了 `clingingDist`，而正式比较用 `clingingDist + epsilon * 10`。浮点漂移使边界距离略微超阈值（如 25.00001 vs 25）时，正式判断本可放行，却被 bbox 检查提前返回 false，cluster 在任意位置断开。

**修复**：bbox 拒绝阈值加上同样的 `epsilon * 10` 余量。

### 6.2 `4c3348aa` — 预筛阈值未考虑站点尺寸

`buildNeighbors` 的粗筛阈值是固定的 `2.5 * configClingingDist`，但点对真实阈值是 `configClingingDist * (sizeA + sizeB) / 2`。平均尺寸大于 2.5 的点对（如尺寸 3 的换乘站，阈值 75 > 62.5）在进入正式判断前就被丢弃；固定 3×3 的网格搜索半径也会漏掉相隔多格的大尺寸点对。

**修复**：缓存各点尺寸，粗筛阈值改为按点对实际尺寸计算（`pairSpan`），网格搜索半径按全局最大尺寸计算（`cellRadius`）；`updateNeighborsForMovedPt` 的粗筛同步修正。

### 6.3 `b77b1d4d` — 预筛缺少 epsilon 余量（初始 + 增量）

上一个 fix 修正了阈值中的尺寸系数，但初始（`buildNeighbors` 两条路径）与增量（`updateNeighborsForMovedPt`）的轴向粗筛仍是严格 `>` 比较、没有 epsilon 余量：距离 `25.000000001` vs 阈值 25 时，`|dx| > 25` 成立，点对被跳过，走不到带余量的正式判断；距离恰好 25 则正常。这正是"手动改成 25 就能形成 cluster"的原因。

**修复**：提取统一的 `epsMargin = epsilon * 10`，三条路径的轴向粗筛阈值与网格搜索半径全部加上该余量，与 `ptClingingPure` 的正式比较对齐。

### 6.4 教训

- 预筛存在的唯一目的是提速，它**只能更宽松、不能更严格**；任何"正式判断能过但预筛过不去"的情形都是 bug
- 正式判断的判定边界（尺寸系数、epsilon 余量、reach 偏移）发生变化时，必须同步检查所有预筛：bbox 快速拒绝、轴向粗筛、网格搜索半径、增量更新路径
- 回归测试应覆盖"恰好等于阈值"和"阈值 + 极微小增量"两类边界输入

## 7. 2026-08 调查发现的问题（均已修复）

调查起因：用户报告 free 点之间的 cluster 生成"似乎没有考虑 config 中的 LineWidthMappedConfig"，部分情况下产生远距离 cluster。调查确认尺寸链路本身**是**走映射的（`getLinesDecidedPtSnapSize` → `saveStore.ptSnapSizes`，优先级含 `config.lineWidthMapped[width].staSnapSize`），但发现以下两个真实问题。

### 7.1 配置变更不会使 cluster 缓存失效（已修复）

- ~~`staClusterStore.ts` 中 `configClingingDist = cs.config.snapOctaClingPtPtDist` 在 store 创建时**一次性捕获**~~，会话内修改该配置不会反映到 cluster 生成。
- 修改 `lineWidthMapped` 后，没有任何 watcher 使 `neighbors`/`staClusters` 失效（`resetterStore` 只在存档加载/undo/redo 时重置；`configStore` 内无相关监听）。
- 更隐蔽的是：改完配置后再移动某个点，`updateNeighborsForMovedPt` 会用**新尺寸**增量更新该点的邻接边，而邻接表中其他边仍是**旧尺寸**的计算结果——新旧混杂，旧的大尺寸远距离 cluster 会一直残留到页面刷新。

**修复**：`configClingingDist` 改为 `getConfigClingingDist()` 使用时读取；新增对 `snapOctaClingPtPtDist` 与 `lineWidthMapped` 的 watch，变化时 `clearItems()` 触发懒加载全量重建（后续 `snapOctaClingPtPtThrs`、`freePtClusterMode` 也加入同一 watch）。注意该 watch 现为**值键 watch**（四项值拼接为字符串比较），不再是 deep watch：`readConfigFromSave` 会整体替换 config 对象，deep watch 在值未实际变化时也会误触发清缓存（见 7.4）。回归测试见 `staClusterStore.test.ts` 的"贴合配置变更后缓存失效"一组用例（含 `lineWidthMapped` 深层就地修改、以及 `freePtClusterMode` 切换到 strict/off 时的失效）。

### 7.2 free 点"候选对候选"比较过度合并（已修复）

`ptClingingPure` 带吸附候选时曾比较**双方全部候选的两两组合**，任一候选对贴近即贴合。但实际吸附（`snapCore.snapInterPt`）的语义是"**一个点的实际位置**落在**另一个点的候选**上"，候选只描述"对方可以吸附到哪里"。

两个偏移候选之间的贴近不对应任何真实吸附结果，导致过度合并。实测（base=25、尺寸=1、两个 90° 拐角 free 点沿对角线拉开）：

| dist(A,B) | cluster 判定 | 实际吸附是否发生 |
|-----------|-------------|------------------|
| 35~40 | 贴合 | 是（拐角交点候选 ≈ 1.41×base） |
| 45~95 | **贴合（误并）** | 否 |
| ≥100 | 不贴合 | 否 |

即 cluster 最远可在约 **3.8 倍阈值**的距离上形成（双方偏移候选各伸出 ~1.41×snapDist，再加 clingingDist）。典型例：A(0,0)、B(50,50) 两个拐角朝向相对的 free 点，各自候选都含中点 (25,25)，距离 70.7 也被并入。`lineWidthMapped` 把 staSnapSize 调大时该效应同比放大。

**修复**：候选比较已改为"点的实际位置 vs 对方候选"（`a.pos vs bSnap.candidates`、`b.pos vs aSnap.candidates`；候选列表本身包含 `pos`，因此也覆盖位置对位置的比较），修复时阈值仍用 `clingingDist + epsMargin`（后由 7.3 进一步收紧，偏移候选改用实际吸附阈值）。bbox 快速拒绝与全部预筛带 reach 余量，依然是"只会更宽松"，无需改动；第 2 节的描述已同步更新。回归测试见 `staClusterStore.pure.test.ts` 的"候选比较应为'点的实际位置 vs 对方候选'"用例。

### 7.3 free 点候选比较的阈值与实际吸附不对齐（已修复）

7.2 修正了比较的**对象**（位置 vs 候选），但偏移候选的判定**阈值**仍是 `clingingDist`（默认 25），而实际吸附（`snapCore.snapInterPt`）用的是 `snapThrs = snapOctaClingPtPtThrs × getSnapThrsRatio(id)`（默认 10）。于是两个 free 点在"接近但远未吸附"的距离上也会成 cluster（直线上最远 ~50，拐角更远），实际使用中出现意外的合并。

**修复**：`ptClingingPure` 新增可选参数 `getSnapThrs`（由 `staClusterStore` 注入，`snapOctaClingPtPtThrs × saveStore.getSnapThrsRatio(id)`）。带候选的比较分两层：

- 位置对位置（`a.pos vs b.pos`）仍用 `clingingDist + epsMargin`，保持与非 free 点一致的基准语义；
- 位置对**偏移候选**改用 `snapThrs + epsMargin`，方向性也与吸附一致（"a 吸附到 b 的候选"模拟拖动 a，阈值取 a 的比率）。

`getSnapThrsRatio` 从 `snapStore` 移到 `saveStore` 供两处共用（`snapStore` 依赖 `staClusterStore`，反向引用会成环）。配置 watch 补充 `snapOctaClingPtPtThrs`。所有预筛（bbox、轴向粗筛、网格半径）仍按 `clingingDist + reach + epsMargin` 计算，比正式判断宽松，无需改动。回归测试见 `staClusterStore.pure.test.ts` 的"点的实际位置落在对方候选的吸附阈值内应贴合（与实际吸附对齐）"。

注意一个已知的近似：候选的**生成**仍用各点自身尺寸（`snapDist = size(pt) × base`），而实际吸附的候选偏移距离按点对交叉尺寸 `(sizeA+sizeB)/2 × base` 计算；两者在双方尺寸相同时一致，尺寸不同时候选位置略有差异，暂不影响主要使用场景。

### 7.4 缓存未构建时的增量更新摧毁既有 cluster（已修复）

**现象**：进入存档后，若第一个操作就是移动点（哪怕与 cluster 毫不相干），既有 cluster 全部消失，只有手动移动 cluster 内的点才能重新产生；先移动 textTag 再移动点则不出现。

**根因**：两个问题叠加——

1. `Cvs.vue` 初始化时 `readConfigFromSave()` 整体替换 `config` 对象。即使各项值未变，7.1 引入的配置 deep watch 也会被触发（flush:'pre'，异步执行），在首次渲染**之后**把刚建好的邻接表/cluster 清空——画面仍是旧像素（cluster 看似还在），内部缓存已空。
2. 增量路径 `updateClustersBecauseOf` / `cleanClustersFromDeletedPt` 没有"缓存未构建则跳过"的防护：在空邻接表上做增量更新，新邻接表只含被移动点的边，且 `makeClustersFromNeighbors()` 把 `staClusters` 置为"已构建"，懒加载无法自愈，既有 cluster 全部丢失。先移动 textTag 会触发主画布渲染 → `getStaClusters()` 懒加载正确全量重建，之后移动点走正常增量路径，所以不触发本 bug。

**修复**：

- 增量路径（`updateClustersBecauseOf`、`cleanClustersFromDeletedPt`）在 `staClusters` 未构建时直接跳过：存档数据本身已是最新，等懒加载全量构建即可（`restoreWithPatch` 原本就由 `decideClusterRestoreStrategy` 的 `alreadyBuilt` 覆盖了此情形）。
- 配置 watch 由 deep watch 改为值键 watch（`snapOctaClingPtPtDist | snapOctaClingPtPtThrs | freePtClusterMode | JSON.stringify(lineWidthMapped)` 拼接比较）：值未实际变化的整体替换（如 `readConfigFromSave`）不再误清缓存。

回归测试见 `staClusterStore.test.ts` 的"未构建缓存时的增量调用（进入存档首个操作回归）"三个用例。
