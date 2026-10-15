# 支线线路渐变色方案

> 状态：已实现（2026-10-07）；§6 决策点均已确认并落地
> 目标：允许支线（`parent` 非空的普通线路）把本体颜色从单色改为线性渐变——起点色为
> 主线（parent）颜色，终点色可手动指定或"自动"从其末端所连接的线路获取；渐变轴的
> 角度与作用范围可自动推导或手动指定。

## 0. 实现记录

- 渐变解析：`src/utils/lineUtils/lineGradient.ts`（纯函数，含单测
  `src/tests/unit/lineUtils/lineGradient.test.ts`）。
  - 连接检测 = 双方共享控制点 id；候选为除自身外的普通线路（地形线不接）；
    两端都接线时非 parent 优先，都为/都不是 parent 时取 `pts[last]` 端；环线不参与。
    一个控制点被多条线路共享时全部检出（`attachesOfEnd`）：指定线路模式的下拉列出全部，
    自动模式在同端多候选时优先非 parent。
  - 目标色三种模式（优先级）：**指定线路**（`targetLine` 线路 id，取该线路实际颜色）>
    **手动指定**（`targetColor`）> **自动**（接续检测，非 parent 优先，决策 C/G）。
    `targetLine` 指向的线路不存在时回退自动模式。UI 中"指定线路"的下拉候选 = 两端
    共享控制点的所有其他普通线路（**排除 parent**），标注接续端（首端/末端）。
  - 自动角度 = 两端点连线方向；手动角度以两端点中点为轴心，目标色一侧自动旋转到目标端方向
    （无连接信息时放在角度指向的一侧）。
  - 主色端/目标色端判定：目标色来自某条线路（指定线路或自动检测到）时，目标色端 =
    **与该线路的接续端**（与该线路颜色无缝衔接）；目标色为手动颜色时，主色端优先放在
    接在 parent 上的末端，其次放在未连接的一端；两端状态相同时主色端取 `pts[0]`。
  - 自动范围 = `[0.25, 0.75]`（`LINE_GRADIENT_AUTO_RANGE`）；起 > 止的非法手动范围回退自动值，
    起 = 止合法（表现为在该处瞬间换色）。
  - `buildLineGradient` 把渐变轴按逻辑坐标外延半个线宽，创建动作委托 `CvsContext.createLinearGradient`
    （内部 mapX/mapY 换算，Canvas 与 SVG 导出共用）。
- 渲染接入：`collectSpanRenderInfos` 按整线解析一次，所有 span 共用同一结果
  （决策 F，StyleSlice 截段时视觉连续），分组键新增 `gradientKey` 区分不同渐变；
  简化模式与选中点局部渲染（`doRender` 透传）同样支持渐变（决策 E）；
  填充地形与缩略图回退主色；pattern 层仍优先覆盖渐变，渐变仅作 tint 时回退其主色。
- 端点局部淡化与方向感知（§8 P1/P2/P3 及 §8.6，2026-10 落地）：span 被时间淡化时落笔回退纯色
  （`resolveSpanStrokeColor`，渐变轴无法表达沿路径的灰显边界）；渐变两端自动取色采样接点局部实际颜色
  （`lineStateStore.getJunctionPtColor` 注入 `resolveLineGradient` 的 `getPtColor`），交界点按支线
  接入方向选侧（垂直/无方向时非淡化优先兜底），选中 span 被导出过滤时取背景色；手动
  `targetColor` 仍为字面颜色。
- UI：LineOptions 支线区新增 渐变/目标颜色/渐变角度/渐变范围 控件；Lines.vue 子列表
  色块启用渐变时显示 CSS 渐变预览。
- `ensureChildrenOptionsSame` 排除项已加入 `'gradient'`（envStore.ts）。

## 1. 需求重述

- 仅支线（有 `parent` 的线）可设置渐变色。
- 渐变主颜色 = parent 的颜色（现状支线 `color` 已跟随主线同步，天然满足）。
- 目标颜色：
  - 手动：用户指定任意颜色；
  - 自动：当支线某一末端"接在"另一条线上时，从那条线取色。
- 渐变区域：角度（渐变轴方向）与范围（沿线作用区间）可自动也可手动。

## 2. 现状梳理

### 2.1 `Line.parent` 的作用

`parent`（`src/models/save.ts:106`）纯粹是**元数据**，对几何没有任何约束：

- **分组/排序**：支线跟在主线之后渲染与列表展示（`saveStore.ensureLinesOrdered`，
  `saveStore.ts:534-569`）；侧栏主列表只显示 `!x.parent` 的线，子列表按
  `x.parent === showingChildrenOf` 过滤（`useSideListShared.ts:41-58`）。
- **属性同步**：主线属性变动时 `ensureChildrenOptionsSame`（`envStore.ts:940-952`）
  把主线几乎所有字段复制给支线，排除项仅 `['id','name','nameSub','parent','pts','style','time']`。
  因此支线 `color` 永远等于主线 `color`（"支线颜色跟随主线"就是这么实现的，
  渲染时支线直接用自身 `line.color`，见 `lineStateStore.getLineActualColor`）。
- **样式跟随**：支线 `style === -1` 表示跟随主线样式（`lineCvsWorker.ts:493-497`、
  `lineSpanStore.ts:191-195`）。
- **淡化联动**：强调/时间淡化时支线随 parent 豁免或连带（`lineStateStore.ts:64-65,91-92,153-161`）。
- **删除/拆分**：主线被删不级联删支线，而是 `child.parent = undefined`（`envStore.ts:912-915`）；
  支线可在侧栏"拆分"按钮脱离 parent（`useSideListShared.ts:162-168`）。
- **不参与几何**：创建支线只是新建两个独立控制点（`lineCreation.ts:82-114`），
  端点是否与主线相接、接到哪，代码完全不感知。`isLineFamily.ts` 仅按 `parent || id` 分组。

### 2.2 渲染管线（渐变将接入的位置）

- 主线画布为**事件驱动全量重绘**：每次 `rerender` 全量 `renderAllLines`
  （`mainCvsDispatcher.ts:98-166`）。本体按 span 拆分渲染：
  `collectSpanRenderInfos` → `renderAllSpansBase` → `renderAllSpansStyle`
  （`lineCvsWorker.ts:239-249`）。span 已支持颜色覆盖（`SpanRenderInfo.color`）。
- 真正落笔在 `strokeStyledLine`（`src/models/cvs/common/strokeStyledLine.ts`）：
  本体层 `:34` `ctx.strokeStyle = dynaColor`；样式层 `:67` 由 `colorMode` 决定，
  `colorMode==='line'` 的层同样使用 `dynaColor`；pattern 分支（`:86-90`）会**覆盖**
  strokeStyle（现有优先级：pattern > 颜色）。
- `dynaColor` 目前是字符串，源自 `lineStateStore.getLineActualColor`（已含强调/时间淡化）。
  样式层固定色走 `fixedColorConverter` → `colorProcDownplay.convert`（字符串进字符串出）。
- **坐标系**：`CvsContext`（`cvsContext.ts`）手写坐标映射（`CvsBlock.mapX/mapY`），
  底层 ctx 基本无变换。Canvas 原生渐变和 svgcanvas 渐变都以**创建时传入坐标**为准，
  因此渐变端点必须换算成 device 坐标（`x * scale - offset` 方向，以 `mapX/mapY` 为准）。
  SVG 导出时 `scale=1, offset=0`（`mainCvsDispatcher.ts:167-195`），同一套换算两边通用。
- **SVG 导出零障碍**：项目自维护的 `@aurouscia/svgcanvas` fork 已完整支持
  `createLinearGradient`/`addColorStop`，`strokeStyle = gradient` 会生成
  `<linearGradient gradientUnits="userSpaceOnUse">` + `stroke="url(#id)"`
  （svgcanvas.esm.js:280-291, 469-540, 998-1010）。svgcanvas 的 `stroke()` 会改当前
  `<path>` 而非新建，多层样式靠 `pathBuilder` 重建路径（`lineCvsWorker.ts:1-22`），
  渐变按层赋 strokeStyle 时同样受此机制保护。
- **命中检测纯几何**（`coordOnLine.ts`，基于 formalPts + 容差），不读颜色——
  只改 strokeStyle 不影响点击检测。
- **简化模式**（`ignoreStyleAndSpan || lineShouldSimplify()`，`lineCvsWorker.ts:211-223`）
  无视样式层与 span，整线走 `doRender` 只画本体 `dynaColor`——渐变挂在**本体色**上
  则简化模式天然可用。
- **缩略图** `lineSimplifiedCvsWorker.ts:60-79` 直接 `strokeStyle = color` 字符串，
  需单独决定回退策略。
- **序列化**：Line 新增可选字段即可，旧存档零迁移；字段默认值靠代码 `??` 兜底
  （先例：`carpetWidth`，`lineCvsWorker.ts:482`）。协作 op / `saveDiff` 走对象 diff，
  新字段自动同步，无需额外注册。若 `AARC.WebApi` 的 Save DTO 包含 Line 字段，
  后端 DTO 需同步并跑 `gen-ts-client.sh`。

## 3. 数据结构设计（save.ts）

```ts
export interface Line {
    // ...现有字段...
    /** 支线渐变色设置；仅对 parent 非空的普通线路有意义 */
    gradient?: LineGradient
}

export interface LineGradient {
    /** 目标颜色；undefined/null = 自动（从末端所接线路获取） */
    targetColor?: string | null
    /**
     * 渐变轴角度（弧度，逆时针为正，与 canvas rotate 一致）；
     * undefined = 自动（沿线路走向，从连接端指向另一端）
     */
    angle?: number
    /** 渐变作用范围：沿线路长度方向的比例 [起, 止]，0..1；undefined = 自动 */
    range?: [number, number]
}
```

设计要点：

- 主颜色**不另设字段**：支线 `color` 已被主线同步，即 parent 的颜色。
- 全字段可选，旧存档/旧客户端零迁移成本。
- 不设 `enabled` 开关：`gradient` 字段存在即启用，删除即关闭（与 `carpet` 等字段的
  心智模型一致；UI 上提供"清除渐变"按钮）。
- **`ensureChildrenOptionsSame` 排除项必须加入 `'gradient'`**（`envStore.ts:940-952`），
  否则主线的空值会把支线的渐变配置冲掉。

## 4. 核心机制设计

### 4.1 末端连接检测（自动目标色）

支线是否有"末端接在另一条线上"是**几何事实**，当前代码无任何现成数据，需新增检测。
在渲染解析渐变时执行（见 4.2），按以下顺序判定支线两端点：

1. **端点与控制点重合**（v1 必做）：支线 `pts[0]` / `pts[last]` 的坐标与另一线路
   的某个控制点坐标相同（`pos` 严格相等，或小于 1 逻辑单位容差）。
2. **端点吸附到线段中途**（可选/v2）：端点到另一线路 formalized 折线的投影距离小于
   阈值（可复用 `config.clickLineThrs` 量级）。注意需要对方线路的 formalPts，
   主画布整帧渲染时缓存有效，局部渲染（active 画布）可能缺缓存，需降级为只判 1。

候选线路范围：**排除自身**；是否限同 family（主线及其支线）还是允许任何线路
（含地形线）是需要决策的点（见 §6-B）。检测到的连接信息（哪一端、接到哪条线）
同时可用于自动角度/范围的推导。

### 4.2 渐变参数解析与构建

新增一个纯函数（建议放 `src/utils/lineUtils/`，如 `resolveLineGradient.ts`）：

```
resolveLineGradient(line, formalPts, attachInfo, deps) → ResolvedGradient | undefined
ResolvedGradient = { gradient: CanvasGradient, fallbackColor: string }
```

输入与解析规则（以 §0 实现记录为准）：

- **主色**：`lineStateStore.getLineActualColor(line)`（支线色 = parent 色，已淡化）。
- **目标色**：`targetColor` 非空 → 手动色；否则 → 连接线路的
  `getLineActualColor(对方)`（取对方整线主色，决策 G）。未连接且无手动色 → 返回 undefined（不启用渐变）。
- **角度**：`angle` 手动 → 以两端点中点为轴心，目标色一侧旋转到目标端方向；
  自动 → 两端点连线方向（决策 D）。
- **范围**：`range` 手动 → 沿渐变轴比例 [起, 止]；自动 → 固定 0.25~0.75（决策 D）；
  非法值回退自动。
- **主色端判定**：主色优先放在接在 parent 上的末端（与主线颜色无缝衔接）；
  没有 parent 端时放在未连接的一端（连接端留给目标色，与所接线路颜色衔接）。
- **device 坐标换算**：渐变轴两个端点 = 两端点 formalPt（向两端各外延半个线宽避免
  端部截断），由 `CvsContext.createLinearGradient`（内部 mapX/mapY 换算）创建。
  Canvas 与 svgcanvas 两端共用；`strokeStyle` setter 类型已放宽为
  `string | CanvasPattern | CanvasGradient`。
- **淡化**：整线淡化状态在 `lineActualColors` 预计算（`getLineActualColor` 已含），
  主色/目标色直接取淡化后的值。

### 4.3 渲染接入点

- **span 路径（主路径）**：在 `collectSpanRenderInfos`（`formalizedLineStore.ts:106`）
  中解析渐变，结果挂到 `SpanRenderInfo` 新字段（如 `gradient?: CanvasGradient`）。
  选这里的原因：formalPts 在手、主线画布与 SVG 导出共用此入口，天然一致。
  `renderAllSpansBase` 分组键无需变——渐变只影响 strokeStyle，不影响分组依据；
  `doRenderSpan` 中 `dynaColor` 形参类型放宽为 `string | CanvasGradient` 并透传。
- **strokeStyledLine**：`dynaColor` 类型放宽；本体层 `:34` 与样式层
  `colorMode==='line'`（`:54-55`）直接赋值。样式层固定色/`fixedColorConverter`
  链路不动（只接受字符串）。**与 pattern 的优先级维持现状：pattern 覆盖渐变**。
- **简化模式**：`renderLine` 的 `ignoreStyleAndSpan` 分支（`lineCvsWorker.ts:211-223`）
  中同样调用解析函数，把渐变传给 `doRender`（该处 formalPts 在手，注意 doRender
  需要新增透参；若嫌改动大，v1 可让简化模式回退单色，列入决策点 §6-E）。
- **选中点局部渲染** `renderSegsAroundActivePt`（`lineCvsWorker.ts:252-331`）：
  只画线段局部，渐变端点超出局部范围——按该线整线的 formalPts 解析渐变后，
  对局部 path 赋同一 gradient（CanvasGradient 是设备坐标系对象，局部 path 同样适用）。
- **缩略图** `lineSimplifiedCvsWorker.ts`：v1 直接回退主色；如需呈现渐变，把
  `ResolvedGradient.fallbackColor` 换成按范围取中点色，复杂度可控。
- **UI 取色点**：`getLineActualColor` 返回字符串，被 NameSearch、侧栏列表等当
  CSS 颜色用——渐变线路在这些处回退主色（fallbackColor），无需改签名。

### 4.4 parent 关系变动时

- **主线删除**：支线 `parent = undefined` 后不再是支线，渐变自动失效（解析时
  `line.parent` 为空直接跳过）。`gradient` 字段**保留**，重新归为支线后继续生效
  （不静默丢配置）。
- **支线"拆分"脱离 parent**：同上，配置保留、渲染停用。
- **支线改挂别的主线**：主色随新的 parent 色同步，目标色连接检测不变。

## 5. UI 设计

- **LineOptions.vue 支线区**（`haveParent` 模板，`:479-515`）新增一组控件：
  - 目标颜色：`AuColorPicker` + "自动"单选（自动时禁用取色器，显示检测到的来源线名；
    未检测到连接时提示"末端未连接任何线路"）。
  - 角度：自动/手动切换 + 手动时角度输入。
  - 范围：自动/手动切换 + 手动时起止百分比输入。
  - "清除渐变"按钮（置 `gradient = undefined`）。
- **侧栏 Lines.vue 支线色块**（`:188-190` 现为固定色块 + "跟随主线"提示）：
  启用渐变时改为 CSS `linear-gradient` 小预览块。
- 主线本身不显示渐变控件（`!haveParent` 模板内不加）。

## 6. 需要进一步决策的点

**A. 主色可定制程度**
需求说"主颜色即 parent 的颜色"。现状支线色强制跟随主线，若用户想微调渐变起点色
（比如略浅于主线色），要不要放开？放开意味着把支线 `color` 移出同步排除项，
会牵动现有"支线颜色跟随主线"的交互（侧栏提示、同步逻辑）。建议 v1 不放开。

- 不放开

**B. "接在另一条线上"的判定范围**
候选线是否限同 family？是否包含地形线（湖泊等）？"重合"用严格相等还是容差？
v1 建议：任意普通线路 + 严格相等（或极小容差），地形线不接。

- 地形线不接
- “接在”指的是双方共享一个 point，仅视觉上重合的情况不判定

**C. 两端都接上线时**
取哪一端？可选：(1) 固定取 `pts[0]` 端；(2) 取连接线路"更强"的一端（如非 parent
优先，制造"主线→别的线"过渡）；(3) v1 不支持、视为未连接回退手动色。
另外是否要做**两端各自独立渐变**（v2 方向）？

- 非 parent 线优先
- 两端各自渐变暂不做

**D. 自动范围与自动角度的精确定义**
自动范围 = 整条支线（0→100%）还是只渐变靠近连接端的一段（如固定比例/固定像素长度）？
自动角度 = 沿线路首段方向，但自由曲线段方向不稳定，是否改为"两端点连线方向"或
"连接端指向另一端"？

- 使用两端点连线方向
- 自动范围暂时固定 0.25-0.75

**E. 简化模式与选中点局部渲染的取舍**
简化模式下是支持渐变（需给 `doRender` 加透参）还是回退单色？影响代码改动量与
"缩小地图时渐变突然消失"的体验落差。

- 支持渐变

**F. 渐变与 span（StyleSlice 换色）的叠加**
`SpanRenderInfo.color` 可覆盖 span 颜色。渐变线路被 StyleSlice 截段时：渐变仍按
整线解析（各 span 共用同一渐变对象，视觉连续），还是渐变按 span 各自解析（各段
从头渐变，接缝处断裂）？建议前者（视觉连续），需在文档/代码注释中固定该语义。

- 使用前者

**G. 目标线为渐变线时的取色**
支线末端接在**另一条也开了渐变**的线上时，目标色取对方主色，还是按对方渐变在
接点的颜色采样（更平滑但实现复杂）？v1 建议取对方 `getLineActualColor` 主色。

- 取主色

**H. `AARC.WebApi` DTO 同步范围**
后端 Save DTO 是否包含 Line 全字段？包含则需同步加字段并跑 `gen-ts-client.sh`，
并确认反序列化对新字段宽容。

- 与后端无关，后端是直接透传整个 save 的，不知道其结构

## 7. 影响面清单

| 位置 | 改动 |
|---|---|
| `src/models/save.ts` | 新增 `LineGradient`、`Line.gradient` |
| `src/models/stores/envStore.ts:940-952` | `ensureChildrenOptionsSame` 排除项加 `'gradient'` |
| `src/models/cvs/common/cvsContext.ts` | 新增 `createLinearGradient` 代理；放宽 `strokeStyle` 类型 |
| `src/models/cvs/common/strokeStyledLine.ts` | `dynaColor` 类型放宽为 `string \| CanvasGradient` |
| `src/utils/lineUtils/resolveLineGradient.ts` | 新增：连接检测 + 渐变解析（纯函数，便于单测） |
| `src/models/stores/saveDerived/formalizedLineStore.ts` | `SpanRenderInfo` 加 `gradient` 字段；`collectSpanRenderInfos` 解析 |
| `src/models/cvs/workers/lineCvsWorker.ts` | 简化模式/局部渲染接入；`SpanRenderOptions`/`doRenderSpan` 透传 |
| `src/models/cvs/workers/lineSimplifiedCvsWorker.ts` | 缩略图回退主色 |
| `src/components/sidebars/options/LineOptions.vue` | 支线渐变控件组 |
| `src/components/sidebars/sideList/Lines.vue` | 支线渐变预览色块 |
| `aarc-core/src/tests/unit/cvs/` | 新增渐变解析单测；注意 ghost line 等既有测试的渲染断言 |
| `AARC.WebApi`（若 DTO 含 Line） | DTO 加字段 + `gen-ts-client.sh` |

无需改动：命中检测（`coordOnLine.ts`）、`saveNormalize`（Line 级字段靠 `??` 兜底）、
协作 diff（对象 diff 自动携带新字段）。

---

## 8. 与按 span 淡化（downplay）机制的交叉分析

> 2026-10 追加。对照 `per-span-rendering-plan.md`（其 Step 1/2 已落地）分析渐变与
> span 级淡化的交互。结论：**渐变文档 §4.2 的"淡化"假设的是整线级淡化，与已落地的
> span 级时间淡化存在一处真实渲染 bug（P1）与两处语义缺口（P2/P3）**。
> **更新：P1/P2/P3 均已修复——span 落笔回退纯色（P1/P3）；渐变两端自动取色改采
> 接点局部实际颜色（P2），并进一步升级为方向感知（§8.6）：交界点按支线接入方向
> 选侧，垂直时非淡化优先兜底，选中 span 被导出过滤时取背景色。**

### 8.1 两套机制的现状

- **淡化**：`lineStateStore` 提供两个粒度——整线级 `getLineActualColor`（含强调淡化、
  整线时间淡化），以及 span 级 `getSpanActualColor` / `isSpanDownplayed`
  （`lineStateStore.ts:203-235`）。span 级时间淡化随 TimeSlice 生效：**同一条线可以
  只有部分 span 被淡化**（未开通区间淡化、已开通区间正常，per-span 文档 Q3 答复）。
- **渐变**：`collectSpanRenderInfos` 按**整线**解析一次（`formalizedLineStore.ts:123`），
  端点色取自整线级 `getLineActualColor`，所有 span 共用同一 `LineGradientResolution`
  （决策 F）；落笔处颜色优先级为
  `gradient ?? span color ?? getLineActualColor`（`lineCvsWorker.ts:369`）。

### 8.2 P1（bug）：span 级时间淡化对渐变线路失效

当渐变支线带 TimeSlice、只有部分 span 未开通时：

- 非渐变线路：未开通 span 走 `getSpanActualColor` 返回淡化色，正常灰显；
- 渐变线路：`lineColor = gradient ?? color`，span 淡化色被**整体绕过**，
  未开通 span 仍按完整渐变彩色渲染。

且该问题**无法靠"把淡化烘进渐变"解决**：渐变轴是两端 formalPt 间的**直线**，而淡化
状态沿**线路路径长度**变化，单条线性渐变只有在轴与走向一致时才能恰好表达"前段灰、
后段彩"。因此必须显式定规则（见 8.5）。

注意强调淡化不受影响：它是整线级的，解析渐变时 `getLineActualColor` 已含，两端点
同为灰度，整线灰渐变正确。

### 8.3 P2（已修复）：渐变目标色取对方**整线**色，与接点处的 span 级实际色脱节

目标色 = `getLineActualColor(对方)`（决策 G，取整线主色）。若对方线路在接续点所在的
span 恰被 TimeSlice 淡化（接点处实际渲染为灰），渐变目标端仍取正常彩色 → 接续处
出现色差。反向亦然：支线自身部分 span 淡化时，主色端取的是整线正常色。决策 G 只讨
论了"目标线是渐变线"的情形，未覆盖"目标线被 span 级淡化"的情形。

**修复**：渐变两端颜色自动判定时改采**端点局部实际颜色**——`lineStateStore.getJunctionPtColor(lineId, ptId, approach?, selfLineId?)`（定位控制点的相邻
span，返回 `getSpanActualColor`），`resolveLineGradient` 增加 `getPtColor` 注入参数：
- 主色端 = 主色端点所在 span 的局部颜色；
- 目标色端（指定线路/自动模式）= 接续共享点在对方线路上所在 span 的局部颜色；
- 手动指定的 `targetColor` 是字面颜色，不做淡化（用户显式选择）；
- 取不到局部颜色（点不在线路上等）时回退整线颜色。
- **交界点的选侧规则后来从“固定到达侧”升级为方向感知（§8.6）**，此处为演进记录。

### 8.4 P3（连带点）：接缝补圆与样式层

- 接缝补圆（`lineCvsWorker.ts:520-526`）同样用 `info.gradient ?? info.color`，
  P1 修复时必须同步改这里，否则断笔处冒出彩色圆点。
- 样式层 `colorMode==='line'` 的层与本体共用 `dynaColor`，P1 修复（淡化 span 回退
  纯色）后这些层自动跟随，无需单独处理；`fixedColorConverter` 链路本就走
  `downplayed` 分支，不受影响。
- 分组键已含 `downplayed` 与 `gradientKey`（`gradientKey` 内含两端色，淡化切换会
  令其变化），分组机制本身无需改动。

### 8.5 修复方向建议（已实施）

实际实现收敛为一个纯函数 `resolveSpanStrokeColor`
（`src/utils/lineUtils/lineGradient.ts`），`doRenderSpan` 与 base 接缝补圆
（`lineCvsWorker.ts`）两处取色共用：

1. **淡化 span 回退纯色**：span 因时间被淡化时（`downplayed && downplayedBy !==
   'accentuation'`，span 级时间淡化在 `lineActualColors` 无条目、`downplayedBy`
   为 undefined，同样命中）用 `getSpanActualColor` 的淡化色（字符串），仅未淡化
   span 使用渐变。代价是淡化 span 与其他 span 之间渐变不连续，但这正是淡化语义
   想要的"该段灰显"，与非渐变线路行为对齐。整线级时间淡化也因此从"灰→彩半渐变"
   修正为整段灰显。强调淡化仍走渐变（端点已灰，视觉等价）。
2. **接缝补圆**同步采用同一优先级（同一函数，天然一致）。
3. **目标色采样（P2）**：✅ 已实现——端点局部取色，见 §8.3。
4. 简化模式与选中点局部渲染（`lineCvsWorker.ts` 的 `doRender` 路径）无视 span，
   天然不受 P1 影响，保持现状。

### 8.6 接点方向感知取色（2026-10 决策，已实施）

**背景**：P2 修复（§8.3）后，`getPtActualColor` 在交界点固定取"到达侧"（`findIndex`
首个命中）。评估发现固定选侧有两个问题：

1. 支线从交界点的什么方向接入是用户画图的偶然结果，与两侧淡化分布无关——
   固定取到达侧意味着支线恰好朝未淡化一侧延伸时，渐变末端灰得莫名其妙；
2. 更严重的：导出时未开通 span 被 `filterNotOpened` 整体过滤，"到达侧"可能
   根本没被渲染——渐变末端灰着接到一条正常色的线头（或空白），预览/导出不一致。
   且 B 自己在交界点盖的是**出发侧** span 的接缝补圆（`lineCvsWorker.ts:508-526`），
   固定到达侧连"B 画在该点的颜色"都没对上。

**决策（方案 A：方向感知，垂直兜底）**：

- `resolveLineGradient` 从支线 formalPts 计算端点伸出方向 `approach`，随 `getPtColor`
  回调传入；
- 交界点（前后两个 span 均相邻）时，对每侧计算"接点指向该 span 另一侧"的方向
  射线，与支线 **approach** 方向点积，取得分最高的一侧。**两端 approach 统一为
  支线驶向接点的方向**（本体 → 接点并延伸）：支线"开往"哪一侧，就取哪一侧的
  颜色（朝着淡化侧 → 一起淡化；朝着未淡化侧 → 维持该侧颜色）；
  - 初版两端统一用"接点 → 本体"方向，人工测试发现与实际相反，故两端先后修正为
    驶入方向（目标端先修，主色端随后，2026-10 修正）。
- 方向与两侧夹角都超过 60°（dot < 0.5，含垂直）或方向信息缺失 → 兜底**非淡化
  优先**（任一相邻 span 未淡化取基础色，全部淡化取淡化色）——与车站圆圈
  `getStaColorFromSpan`（`pointCvsWorker.ts:59-70`）同一策略；
- 非交界点（线路端点或 span 内部）只有一个相邻 span，直接取该 span，无需方向；
- **导出过滤**：选中 span 未开通（导出时被过滤、不渲染）→ 渐变端色取**背景色**
  （`config.bgColor`），渐变末端"溶入背景"而非指向不存在的线头；预览模式不受影响
  （淡化 span 仍渲染，取淡化色）；
- 主色端采样 **parent**（而非支线自身）在接点处的方向感知局部颜色（注意：演进初期曾错误地采样支线自身端 span，导致
  parent 侧局部淡化被忽略；2026-10 修正）；但支线自身端 span 已被淡化时优先跟随自身
  （该 span 落笔已按 §8.5 回退纯色，渐变起点与之衔接）；
- 手动 `targetColor` 仍为字面颜色，不参与上述规则。

实现：`lineStateStore.getJunctionPtColor(lineId, ptId, approach?, selfLineId?)`（取代初版
`getPtActualColor`）；`resolveLineGradient` 的 `getPtColor` 注入签名追加
`approach` 参数。
