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
- 带吸附候选时（free 点可能有平行线交点等候选位置），先做一次 bbox 快速拒绝（`bboxesCouldCling`），再对所有候选对做正式距离比较；任一候选对贴合即为 true

**关键不变量：所有快速拒绝/预筛都必须比正式判断宽松（至少带相同的 epsilon 余量），否则会把本该贴合的点对提前误杀。** 第 6 节的几次 fix 都是这一原则被破坏导致的。

## 3. 生成机制（buildNeighbors）

全量构建分两步：

1. **构建邻接表** `buildNeighbors`：只考虑 sta 点，用均匀网格索引避免 O(n²)
   - 网格边长 `cellSize = 2.5 * configClingingDist`
   - 先缓存各点吸附尺寸，预计算：
     - `pairSpan(aId, bId)`：点对的真实贴合阈值（含尺寸）
     - `maxPairSpan = configClingingDist * maxSize`：全局最大点对阈值
     - `epsMargin = epsilon * 10`：与正式比较一致的余量
   - 网格搜索半径 `cellRadius = ceil((maxPairSpan [+ 2*maxReach] + epsMargin) / cellSize)`，保证大尺寸点对跨格也能搜到
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

1. **单个 cluster 多边形缓存** `clusterPolyCache`：以 `id:pos:dir:size` 拼接为 key，cluster 内点未变时直接复用已算好的四角点（四角点计算见 `docs/formalize-free-cluster.md`）
2. **全量渲染数据缓存**（perf 提交 `8ebbdb92`）：
   - 把所有 cluster 点的 `id/pos/dir/size` 与所有 pointLink 写入可复用的签名缓冲区 `sigBuf`，与上一帧**逐位比较**（数值严格相等，无哈希碰撞风险）
   - 签名未变时直接复用 `polysCache`，不再重新遍历点和拼接缓存 key
   - 视角（视口）移动不改变签名，因此逐帧只做 O(cluster数) 的视口剔除：用每个 poly 预存的 `bbox` 加上由 `maxStaSize` 决定的线宽 padding，与 `cvsBlocksControlStore.blockTotalBoundary` 比较，视口外直接过滤

## 5. 增量修改

- **点移动/状态变化**：`envStore` 在点位编辑后调用 `staClusterStore.updateClustersBecauseOf(pt)` → `updateNeighborsForMovedPt`
  - 先摘除该点所有旧邻接，再对全部 sta 点重算该点的邻接关系
  - 带吸附候选时同样先做轴向粗筛（阈值 = 点对真实贴合阈值 + 双方 reach + epsilon 余量），再进 `ptClingingPure`
  - 点变为非 sta 时只清除邻接直接返回
- **点删除**：`saveStore.deletedPoint` 钩子指向 `cleanClustersFromDeletedPt` → `cleanNeighborsForDeletedPt`，从所有邻居的集合中移除该点并删除其条目
- 两条路径最后都重新执行 `makeClustersFromNeighbors()`

## 5.1 undo/redo 的缓存保留（patch 驱动）

undo/redo 的链路为 `undoStore.undo()/redo()` → `restoreState(state, patch)` → `resetterStore.resetDerivedStores(patch)`。撤销库 `@aurouscia/au-undo-redo` 的 `AurPatchStore` 内部已按 keyed 数组算好变更补丁（`{id, old?, new?}`，`old`/`new` 为 undefined 分别表示新增/删除），undo 应用的是 `history[pointer]`（应用前读取），redo 应用的是前移后 `history[pointer]`。

`staClusterStore.restoreWithPatch(patch)` 依据 `decideClusterRestoreStrategy`（纯函数）分三档处理：

| 条件 | 策略 | 代价 |
|------|------|------|
| patch 不含 `points`/`lines` | `preserve`：邻接表与 cluster 原样保留 | 零 |
| 只动少量 `points`（≤ `clusterRestoreIncrementalLimit` = 16） | `incremental`：逐变更点走 `updateNeighborsForMovedPt` / `cleanNeighborsForDeletedPt` | O(变更数 × n) |
| 无 patch 信息、动了 `lines`、变更点超阈值、或尚未构建过 | `rebuild`：`clearItems()` 后懒加载全量重建 | 与原行为一致 |

依据的不变量：patch 不含 points/lines 时，cluster 的全部输入（点位/状态/方向、吸附尺寸、free 点方向与 reach）都未变化。`lines` 之所以必须全量，是因为它决定吸附尺寸与 free 点方向/reach，无法按点增量。

非 undo/redo 的调用方（`Editor.vue`、`stashStore.ts`）不传 patch，`patch === undefined` 保守走全量重建，行为与改造前一致。

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
