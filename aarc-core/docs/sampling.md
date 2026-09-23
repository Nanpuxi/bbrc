# 线路“采样”功能设计分析

目标：给定一条线路，以固定间隔沿线路实际绘制出的轨迹生成一系列点，使采样点尽量贴合屏幕上看到的线。

本方案的一个硬约束：**本项目后续可能新增线条渲染类型（如贝塞尔、圆弧等）**，采样设计必须随之可扩展——新增一种渲染几何，不应要求重写采样行走逻辑，也尽量不影响现有绘制代码。

## 1. 线的实际走向是如何形成的

“线画在哪里”由两级处理决定，渲染样式（颜色、宽度、carpet、span 拆分）**不影响几何**，可全部忽略。

### 1.1 控制点 → formal 点：`formalize()`

源码：`aarc-core/src/utils/lineUtils/formalize.ts`

- 原始数据是 `ControlPoint[]`（每个点有 `pos`、`dir`（vertical / incline）、`free` 标志）。
- `formalize()` 在相邻控制点之间按 8 方向（水平/垂直/45° 斜线）的位置关系插入中间点（`itp`），得到 `FormalPt[]`。
- 插入中间点后，**任意相邻两个 formal 点之间的连线都是一条直线段**：
  - 非自由点之间：严格沿 8 方向之一的直线（水平、垂直或斜率 ±1）；
  - 自由点（`free`）相邻区间：直接连接，方向任意（`direct: true`）。
- 病态段（`illPosedSegJustify`，如"×-×"形）会被邻近段矫正，插入一个交点作为中间点，结果仍是直线段序列。
- 环线（`isRing`）会在头部/尾部各追加一段 margin 段做矫正，之后丢弃，最终 formal 点序列首末点重合。
- 每个 formal 点带 `afterIdxEqv`，可回溯到原控制点序号（供 span 拆分、点击判定使用，采样不需要）。

> 演进提示：`formalize` 的插值策略（`coordFill`）本质上是"相邻控制点之间的**段生成器**"。未来若出现贝塞尔段、圆弧段等新段类型，变化点在这一层，会产生新的 formal 点序列（或新的段标记）。采样层不应对 formal 点做"8 方向直线"的假设。

### 1.2 formal 点 → canvas 路径：`linkPts()`

源码：`aarc-core/src/models/cvs/workers/lineCvsWorker.ts:68`（`linkPts`）

这是当前采样必须复刻的核心逻辑。对 formal 点序列的每个**内部顶点**（转角）：

1. 计算理论圆角半径 `turnRadius = getTurnRadiusOf(lineInfo, relOrTheta)`（`configStore.ts:197`）：
   - 8 方向分支：`rel` 为两段射线的方向关系（`parallel` / `90` / `45` / `135`），90° 用基准半径，45° 除以、135° 乘以 `turn45Ratio`；
   - 自由点分支：传入实际内角 `theta`，半径保持与 90° 相同（接近 45°/135° 时按比例折算）。
2. 计算两个**切点**（sok）——直线段只画到切点，顶点被圆角取代：
   - 8 方向分支：`d = min(turnRadius, prevDist/2, nextDist/2)`，沿两个 8 方向单位向量从顶点各退/进 `d`；
   - 自由点分支：`theta = atan2(|cross|, -dot)`（内角，∈ [0, π]），
     `d = min(turnRadius / tan(theta/2), len1/2, len2/2)`，沿实际单位向量退/进 `d`。
   - 退化情况（任一段长为 0、两段平行或反向）：两个切点都取顶点本身，弧退化为直线。
3. 路径结构为：
   - 非环线：`moveTo(pts[0])` → 逐转角 `lineTo(prevSok)` + 弧 → 收尾 `lineTo(pts[n-1])`；
   - 环线：`moveTo(头部切点)` → 逐转角 `lineTo(prevSok)` + 弧 → 收尾 `lineTo(头部切点)` 平滑闭合。
4. 弧的画法：`drawArcByThreePoints(ctx, prevSok, nowPt, nextSok, mode)`（`aarc-core/src/utils/drawUtils/drawArc.ts`）：
   - formal 模式：将两条切线射线各旋转 90°，交点为圆心 `center`，半径 `r = dist(prevSok, center)`，`ccw` 由两段方向的叉积符号决定；
   - free 模式：用浮点向量解 `a.source + s·na = b.source + t·nb` 得圆心，角度取 atan2 并把 delta 归一化到 (-π, π] 决定方向；
   - 无法求圆心或近乎平行时退化为 `lineTo(nextSok)`。

**结论：线的实际走向 = 「直线段 + 圆角弧」交替的单一一维路径**。这给采样提供了精确贴合的可能：只要按相同几何走一遍，采样点可以与渲染像素级一致。

> 演进提示：圆角（转角处理）也是一种可替换的策略。未来"转角画贝塞尔""整段就是大圆弧"等新渲染类型，本质上是给路径增加新的图元种类（贝塞尔段、圆角贝塞尔等），或替换转角处理器。采样方案必须对"图元种类增加"封闭。

### 1.3 简化模式

视图缩得很远时 `lineShouldSimplify()` 为真，`linkPts` 退化为直接 `moveTo/lineTo` 连接所有 formal 点（不画圆角）。采样功能通常应始终按非简化几何采样（与缩放级别无关）；如需与屏幕所见严格一致，可传入同一判定结果。

## 2. 采样方案

### 2.1 总体思路

不要把采样做成"沿 formal 折线等距取点"——那样转角处会切掉圆角、贴着折线内侧走，与屏幕所见偏差可达一个 `turnRadius`。正确做法是**复刻 `linkPts` 的几何**，先把线路转成几何图元序列，再沿图元等距行走：

```
控制点 → formalize() → FormalPt[]
       → 几何构造（与 linkPts 同源）→ 图元序列: PathPrimitive[]
       → 沿图元累计弧长，每 interval 放一个采样点
```

### 2.2 核心抽象：`PathPrimitive` 接口（可扩展的关键）

采样与绘制都不直接认识"线"，只认识一维路径图元。定义统一接口：

```ts
// aarc-core/src/models/cvs/common/linePathPrimitives.ts（或 utils/lineUtils/ 下）
interface PathPrimitive {
    /** 图元的长度（世界坐标单位）。实现须缓存或 O(1) 计算。 */
    length(): number
    /** 距图元起点的弧长 s ∈ [0, length()] 处的点 */
    pointAt(s: number): Coord
    /** 追加到 canvas 路径（linkPts 用；svgcanvas 的 pathBuilder 亦复用） */
    appendTo(ctx: CvsContext): void
}

interface LinePrimitive extends PathPrimitive { kind: 'line', p0: Coord, p1: Coord }
interface ArcPrimitive  extends PathPrimitive { kind: 'arc', center: Coord, r: number, startAngle: number, endAngle: number, ccw: boolean }
// 未来新增：BezierPrimitive（解析弧长可用数值积分/查表，pointAt 用 de Casteljau 或预计算多项式系数）
```

设计要点：

- **`length()` + `pointAt(s)` 是采样行走所需的全部能力**。行走循环只调这两个方法，完全不 switch 图元种类——新增贝塞尔、样条、椭圆弧等图元时，**采样行走代码零改动**，只需新写一个图元类。
- `appendTo(ctx)` 让绘制也消费同一批图元：`linkPts` 的绘制循环退化为 `for (p of prims) p.appendTo(ctx)`，几何来源唯一，不存在"绘制一份逻辑、采样一份逻辑"的漂移。
- 每种图元封装自己的退化处理（如平行转角退化为直线、零长图元 length 为 0），行走循环天然跳过。
- 图元为纯数据 + 纯函数，不依赖 store，可独立单元测试（验证 `length` 与 `pointAt` 的自洽性、与 canvas arc 行为一致等）。

### 2.3 几何构造：`buildLinePathGeometry()` 与转角处理器注册表

把 `linkPts` 的转角循环抽成纯几何构造函数：

```ts
// aarc-core/src/utils/lineUtils/buildLinePathGeometry.ts
function buildLinePathGeometry(
    formalPts: FormalPt[],
    lineInfo: Line,
    getTurnRadiusOf: GetTurnRadiusOf,
    options?: { simplify?: boolean },
): PathPrimitive[]
```

转角处理（formal / free 两种圆角，未来更多）通过**注册表**分派，而不是 if-else 硬编码：

```ts
// 转角处理器：输入前一图元终点方向、顶点、下一图元起点方向及线路信息，
// 输出 (切入长度, 切出长度, 转角图元或 null)
interface CornerHandler {
    match(prevFormal: FormalPt, nowFormal: FormalPt, nextFormal: FormalPt): boolean
    buildCorner(prevPt: Coord, nowPt: Coord, nextPt: Coord, lineInfo: Line,
                getTurnRadiusOf: GetTurnRadiusOf): CornerResult
}
// CornerResult = { trimPrev: number, trimNext: number, primitive: PathPrimitive | null }

const cornerHandlers: CornerHandler[] = [formalCornerHandler, freeCornerHandler]
// 未来：bezierCornerHandler 等，注册即可生效于绘制与采样两端
```

同时把 `drawArc.ts` 中 formal/free 两种圆心计算抽成纯函数，供转角处理器与（过渡期的）绘制共用。

构造算法（与 `linkPts` 同构）：

1. 依 formal 点序列生成初始直线图元序列（simplify 模式下到此为止）；
2. 逐顶点查注册表得处理器，算出切入/切出长度，截断相邻直线图元，插入转角图元；
3. 按非环线/环线规则处理首尾（环线追加"最后直线 → 头部切点"的闭合图元）；
4. 过滤零长图元。

`linkPts` 随后简化为 `buildLinePathGeometry(...).forEach(p => p.appendTo(ctx))`，行为不变。

> 若未来新渲染类型不是"转角"而是"整段替换"（如某类线路整段渲染为大圆弧），则变化点在步骤 1 的段生成——届时把"初始图元序列生成"也做成可注入的段生成器即可（与 1.1 的演进提示呼应）。本方案的行走循环与接口层依然不受影响。

### 2.4 沿图元等距采样

```ts
// aarc-core/src/utils/lineUtils/sampleLinePath.ts
function sampleLinePath(
    prims: PathPrimitive[],
    interval: number,          // 世界坐标单位下的间隔
    includeEnds = true,        // 是否包含起点/终点
): Coord[]
```

行走算法（与图元种类无关）：

- 维护 `remain = interval`（到下一个采样点的剩余距离）。
- 逐个图元：令 `L = p.length()`；当 `remain <= L` 时输出 `p.pointAt(remain)` 并 `remain += interval`，直到 `remain > L`；然后 `remain -= L` 进入下一图元。
- 终点处理：若 `includeEnds`，收尾时若末采样点距路径终点超过 epsilon（如 `interval * 1e-6`），补一个终点采样点；环线首尾切点重合，行走自然闭合，不要重复输出首点。

### 2.5 必须注意的边界与一致性

| 事项 | 说明 |
|---|---|
| 转角半径 | 必须与渲染一致地调用 `getTurnRadiusOf`（含 `line.type === common` 时乘 `lineWidthRatio`、`turn45Ratio` 折算）；几何构造应把该函数作为参数注入，便于测试与将来半径策略变化。**落地时签名建议直接传上下文对象**（见 §2.7），避免将来半径来源需要更多输入时改签名 |
| 半径缓存 | formal 点缓存（`formalizedLineStore`）不含半径，无失效问题；若未来把几何图元也缓存，半径相关几何不得进长效缓存，或把半径参数纳入缓存键 |
| 切点上限 | `min(..., prevDist/2, nextDist/2)` 防止短段上弧越界，转角处理器内不可省略 |
| 退化转角 | 零长段、平行/反向段弧退化为直线，由各图元/处理器自行退化，行走循环无需特判 |
| 自由点 | free 分支的 `theta`、`tan(theta/2)` 公式与 formal 分支不同，分属不同处理器 |
| 环线 | 首末 formal 点重合，构造需输出回到头部切点的闭合图元；采样点序列不重复首点 |
| 简化模式 | 传入 `simplify` 时几何构造直接输出 formal 折线（全 `line` 图元），行走逻辑不变 |
| filled 地形线 | 填充也走同一路径（`fill()`），采样逻辑不变 |
| span/样式 | `collectSpanRenderInfos` 只是对同一几何按 span 切片渲染，不改变形状，采样整线无需关心 |
| 缓存 | `formalizedLineStore.getLinesFormalPts(lineId)` 已有缓存可复用，避免重复 `formalize`；但注意被省略（视野外）时会清缓存返回 undefined，采样前应判空 |

### 2.6 升级路径小结

| 未来新增 | 需要做的事 | 不需要动的 |
|---|---|---|
| 新转角样式（贝塞尔圆角等） | 新 `CornerHandler` 注册；新图元类实现 `length/pointAt/appendTo` | `sampleLinePath` 行走循环、`linkPts` 绘制循环 |
| 新整段几何（圆弧段、样条段） | 新段生成器（formalize 层）；新图元类 | 同上 |
| 新图元近似弧长（贝塞尔无解析弧长） | 在该图元类内部用数值积分/自适应采样预计算，`length()`/`pointAt()` 对外接口不变 | 行走循环、调用方 |
| 采样参数变化（按数量均匀、限定区间采样等） | 新增 walking 包装函数，复用 `PathPrimitive` 接口 | 几何构造、图元实现 |
| 任意弧长定位（区间中点、按距离布点等） | 新增 `pointAtArcLength` 行走包装；几何输出标注控制点区间索引 | 行走循环、图元实现 |
| 转角半径来源变化（改为线路配置、按角度函数、随样式/缩放变化等） | 半径本就经 `getTurnRadiusOf` 注入；若为新增输入改传 `TurnRadiusContext`（§2.7），仅处理器内部实现变化 | 行走循环、`PathPrimitive` 接口、绘制循环；注意几何缓存的失效（§2.5） |

### 2.7 转角半径的注入与签名设计

转角半径在方案中只有**一个消费点**：转角处理器计算切点距离 `d = min(radius, …)`，进而决定弧的圆心与半径。因此半径来源的任何变化（改为读线路自身配置、按任意角度函数折算、随 span 样式或视图缩放变化等）都被隔离在 `getTurnRadiusOf` 的实现内部——行走循环、`PathPrimitive` 接口、绘制循环均不受影响。

唯一需要预防的是**签名演进**：当前实现签名为 `(line: Line, relOrTheta: WayRel | number)`，若未来半径来源需要更多上下文（相邻段长、span 样式、缩放系数等），位置参数就得改、所有处理器与调用点跟着动。落地时建议直接传上下文对象：

```ts
interface TurnRadiusContext {
    line: Line
    relOrTheta: WayRel | number   // 8 方向关系（formal 分支）或自由点内角 theta（free 分支）
    prevPt: Coord; nowPt: Coord; nextPt: Coord
    prevDist: number; nextDist: number
    // 未来新增来源所需字段在此扩展，既有调用方不受影响
}
type GetTurnRadiusOf = (ctx: TurnRadiusContext) => number
```

注意 `configStore.getTurnRadiusOf` 是渲染期每帧调用的热路径函数，改签名时需同步更新 `linkPts` 的调用点（过渡期可做一层适配）；采样/几何构造侧因是新代码，直接按新签名设计即可。

### 2.8 与“区间中点”类需求的关系

已有计划中的“固定间隔采样”**不能直接、稳定地**满足“找到区间中点”（大致近似即可）这类需求，但同一几何层稍加补充即可低成本覆盖。分析如下：

**为什么采样点数组不够用**：`sampleLinePath` 发出的是全局弧长 `k * interval` 处的点，与“区间边界”（如第 i 个控制点区间、某个 span）无关。用采样点逼近区间中点，最近采样点沿路径的偏差最大可达 `interval/2`，只能靠缩小 interval 换精度，低效且不可靠。**不要把这类需求建立在采样点数组之上。**

**中点其实是“按弧长取点”的特例**：有了 `PathPrimitive.length()` + `pointAt(s)`，区间中点 = 该区间弧长范围的中点处的点，是**精确解**而非近似：

```
s_mid = s_start(区间) + L(区间) / 2
point = pointAtArcLength(prims, s_mid)
```

`pointAtArcLength(prims, s)` 就是采样行走循环去掉“周期发点”、改为“取单个 s”的版本，应与 `sampleLinePath` 并列为一等 API。区间中点、距起点某距离处布点、站点/标注定位等需求都收敛到这一个函数。

**唯一缺的是“区间 → 弧长”的映射**：当前 `buildLinePathGeometry` 吃掉 `FormalPt[]` 后图元不再携带 `afterIdxEqv`，无法回答“第 i 个控制点区间从哪里开始”。补法很轻——构造时为每个图元标注它覆盖的控制点区间索引：

```ts
interface PathPrimitive {
    // ...length / pointAt / appendTo
    /** 该图元覆盖的原控制点区间索引（afterIdxEqv 语义）；转角弧跨两个区间，
        近似类需求下约定归属任一侧即可 */
    spanIdxRange: [number, number]
}
```

之后“第 i 段的中点”= 覆盖该区间的图元弧长范围取半，代入 `pointAtArcLength`。若未来 span 的语义细化（样式分段与几何区间解耦），此标注也是现成的挂载点。

### 2.9 放置位置与依赖

- 纯几何部分（图元接口与实现、`buildLinePathGeometry`、转角处理器、`sampleLinePath`、`pointAtArcLength`）不依赖 store，放 `aarc-core/src/utils/lineUtils/`（或 `models/cvs/common/`），用 vitest 做单元测试（该目录已有测试先例）。
- 入口函数（面向业务）封装为：入参 `line: Line` + `interval`，内部 `formalize(saveStore.getPtsByIds(line.pts))` → 几何 → 采样，返回 `Coord[]`。避免把 store 依赖带进纯几何层，便于测试。
- 测试要点：各图元的 `length/pointAt` 自洽（数值微分验证切向、抽样验证在几何上）；直线线路（间隔整除/不整除）；单转角（采样点落在圆弧上：到圆心距离 = r）；45°/135° 半径折算；自由点任意角度；环线闭合；退化段；短段 `len/2` 截断；`simplify` 模式；区间索引 → 弧长范围 → `pointAtArcLength` 的往返一致性。
