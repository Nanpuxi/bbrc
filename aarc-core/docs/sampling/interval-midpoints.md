# 线路区间中点：可复用能力与缓存设计

本文是 `sampling.md` 的姊妹篇。采样几何层（`buildLinePathGeometry` / `PathPrimitive` / `intervalArcRange` / `pointAtArcLength`，见 `sampling.md` §2）落地后，“区间中点”成为多个功能都可能用到的基础能力（协作锁渲染、站点/标注定位、按区间布点、路径动画等）。本文定义它的**可复用 API** 与**可靠的缓存机制**。锁渲染只是第一个消费者，用法见 §4。

## 1. 能力定义与分层

### 1.1 纯几何层（无 store 依赖，可独立测试）

新文件 `aarc-core/src/utils/lineUtils/intervalMidpoints.ts`：

```ts
/** 单个区间的中点（精确解：弧长范围取半后 pointAtArcLength） */
export function intervalMidpoint(prims: PathPrimitive[], idx: number): Coord | undefined

/** 所有区间的中点，按路径走向排序 */
export function intervalMidpoints(prims: PathPrimitive[]): Coord[]
```

实现即 `sampling.md` §2.8 的公式：`range = intervalArcRange(prims, idx)`，中点 = `pointAtArcLength(prims, (range[0] + range[1]) / 2)`。`intervalMidpoints` 遍历 `spanIdxRange[0]` 的 distinct 值（保持图元顺序即路径顺序），跳过 `intervalArcRange` 返回 undefined 的索引。

纯层不感知 `Line`/formal 点/半径来源——任何能构造出 `PathPrimitive[]` 的调用方（包括未来新增的段类型）都能直接用。

### 1.2 业务层（store 入口，带缓存）

在 `formalizedLineStore` 中新增两个缓存入口（与 `sampleLineCoords` 并列）：

```ts
/** 线路的路径几何（带缓存）。几何 = formal 点 + 半径来源，二者任一变化自动重建 */
function getLinePathGeometry(line: Line): PathPrimitive[]

/** 线路所有控制点区间的中点（带缓存，派生自 getLinePathGeometry） */
function getLineIntervalMidpoints(line: Line): Coord[]
```

调用方只需一行：`useFormalizedLineStore().getLineIntervalMidpoints(line)`。后续新消费者（标注、动画……）直接复用，不再各自 formalize/构造几何。

## 2. 缓存机制

### 2.1 缓存什么

按线路 id 缓存一个条目：

```ts
interface LinePathCacheEntry {
    formalPts: FormalPt[]      // 计算时所用的 formal 点（引用，用于失效校验）
    radiusKey: string          // 半径相关输入的快照（见 2.2）
    prims: PathPrimitive[]     // 几何图元
    midpoints: Coord[]         // 区间中点（由 prims 派生）
}
```

几何与中点同条目缓存：中点由几何纯函数派生，几何在则中点零成本；几何重建则中点一起重建。

### 2.2 失效校验：不信任钩子，只认输入

中点/几何的输入有三类，任何一类变化都必须重建：

| 输入 | 变化场景 | 校验方式 |
|---|---|---|
| formal 点 | 拖动控制点、增删点、远程 op、undo/redo、环线矫正 | **引用比对**：`entry.formalPts === getItem(line.id)`。渲染循环每次刷新可见线路的 formal 点（新数组），引用必变 |
| 半径配置 | `lineTurnAreaRadius`、`lineWidth`、`turn45Ratio` 被用户修改 | **快照比对**：`radiusKey` 记录这三个值的字符串拼接，读取时与当前配置比对 |
| 线路字段 | `line.width`（common 类型参与半径）、`line.type` | 纳入 `radiusKey`：`${cfg.lineTurnAreaRadius}|${cfg.lineWidth}|${cfg.turn45Ratio}|${line.width}|${line.type}` |

读取时三项全过 → 直接返回缓存；任一不符 → 重新 formalize（若缓存已被清）+ 重建几何与中点，写回条目。**不依赖任何外部 clearItems 时机的正确性**——钩子失效只是提前清内存，校验才是正确性保障。

### 2.3 与现有失效体系的关系（清内存，不保正确性）

`formalizedLineStore.clearItems` 已注册在 `resetterStore` 的 `needClearItemsStoreUses`（undo/stash/加载）与 `remoteDataCacheStoreUses`（远程 op）两个列表中，存档级变更会自动清掉全部条目——包括本缓存（放在同一 store 内即自动纳入）。此外 `lineCvsWorker` 对视野外线路调 `setLinesFormalPts(id, undefined)` 逐条驱逐。这些都只是内存管理；即使某条路径漏了 clear，`2.2` 的引用/快照校验也会兜住正确性。

注意一个既有特性带来的边界：视野外线路的 formal 点缓存被驱逐后，若控制点已变而未重渲染，`getItem` 返回 undefined——此时入口按 `sampleLineCoords` 的同款逻辑即时 `formalize(saveStore.getPtsByIds(line.pts))` 重建（不写入 formal 点缓存，避免污染渲染节奏），校验自然通过。

### 2.4 为什么不缓存进模块级单例

几何缓存是“由存档派生的数据”，必须与 pinia 生命周期对齐（测试每用例重建 pinia）。放在 `formalizedLineStore`（setup store 闭包内）随 store 实例生灭，测试与热重载天然安全；模块级 Map 会跨用例泄漏。

## 3. 与采样功能的关系

`sampleLineCoords(line, interval)` 目前每次调用都现构几何。接入本缓存后可改为消费 `getLinePathGeometry(line)`（simplify 模式仍现构，或缓存键中区分 simplify——建议不缓存 simplify 结果，它是临时视图态）。这样采样与中点共享一份几何，同一帧内多处调用只构造一次。

## 4. 第一个消费者：协作锁渲染

`lockCvsWorker.collectLockCrosses` 的线路分支（原质心逻辑，`lockCvsWorker.ts:83-86`）改为：

```ts
const line = saveStore.getLineById(parsed.id)
if (!line)
    continue
const mids = formalizedLineStore.getLineIntervalMidpoints(line)
if (mids.length === 0) {
    // 退化线路（如只剩 1 个控制点，无区间）：退化为在控制点处画叉，保持可见性
    const pt = line.pts.map(id => saveStore.getPtById(id)).find(p => !!p)
    if (pt)
        marks.push({ center: [...pt.pos], arm: baseArm * 2.5, width: baseWidth * 2 })
    continue
}
for (const m of mids)
    marks.push({ center: m, arm: baseArm * 2.5, width: baseWidth * 2 })
```

注意点：

- **区间数量**：非环线 m 个控制点 → m−1 个叉；环线 m 个区间（含闭合段），起点/终点交界附近的两个中点可能较近，先接受、不去重。
- **simplify**：锁叉与缩放无关，业务层入口固定用非简化几何（与 `sampleLineCoords` 默认一致）。
- **性能**：`collectLockCrosses` 在 active 图层约每 50ms 重跑一次。被锁线路数 = 其他成员的锁数量（个位数），缓存命中时开销为几次引用/字符串比对；即使重建，O(n) 几何构造也可忽略。
- **视觉效果**：叉随控制点数量排成一列，标出被锁范围，符合需求本意。

## 5. 测试要点

- 纯层（`intervalMidpoints.ts`）：单区间直线中点；多区间折线中点个数与顺序；90° 转角区间中点落在弧上（到圆心距离 = r）；环线区间数 = 控制点数。
- 缓存层（`formalizedLineStore`）：
  - 重复调用命中缓存：几何返回同一数组引用；中点返回外层浅拷贝（内容相等，修改返回数组不影响缓存与其他消费者）；
  - `setLinesFormalPts` 换新 formal 点后结果更新（引用校验生效）；
  - 修改 `config.lineTurnAreaRadius` 后结果更新（快照校验生效，**不经过任何 clearItems**）；
  - `clearItems()` 后再次调用结果正确重建；
  - 视野外驱逐场景（`setLinesFormalPts(id, undefined)` + 控制点已变）结果与即时 formalize 一致。
- 锁渲染（`lockCvsWorker.test.ts`）：锁定 3 控制点折线出 2 个叉，位置与纯几何层中点逐一比对（而非质心）；单点线路退化路径；锁悬空线路保持原有行为。
