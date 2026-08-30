# 文本旋转支持改造计划

## 目标

让 `TextTag`（文本标签）和 `ControlPoint`（站点）的站名可以绕锚点旋转任意角度，同时保证：

- 旋转后的点击判定（hover / select / detect）准确。
- 旋转后的“远距离糊弄渲染”仍能正确占位。
- 不旋转时（`angle = 0`）行为与当前完全一致。
- 旧存档无需迁移，未定义角度时默认为 0。

## 当前限制

当前代码中所有文本相关的包围盒都使用 `RectCoord`：

```ts
export type RectCoord = [Coord, Coord]
```

即“轴对齐矩形的对角两点”。这种结构天然只能描述正着的矩形，无法表达倾斜后的文本。

涉及的两个派生状态缓存文件：

- `aarc/src/models/stores/saveDerived/textTagRectStore.ts` —— 缓存每个 `TextTag` 的包围盒。
- `aarc/src/models/stores/saveDerived/staNameRectStore.ts` —— 缓存每个站点的完整站名包围盒（`rectFull`）和主站名包围盒（`rectMain`）。

## 总体方案

把“矩形”从两个点升级为**四个顶点**的凸四边形，并用新的几何工具处理旋转、命中检测、绘制和扩展。

### 1. 数据模型新增角度字段

`aarc/src/models/save.ts`：

- `TextTag` 增加 `angle?: number`，单位：弧度，逆时针为正（与 canvas `rotate` 一致）。
- `ControlPoint` 增加 `nameAngle?: number`，同样使用弧度。
- 旧存档未定义时按 `0` 处理，无需迁移。

> 注意：`TextTag` 中已有一个被注释掉的 `FormalRotation` 枚举字段（`//rot?:FormalRotation`），它只支持几个离散方向。本次改造应使用任意弧度，而不是复用该枚举。

### 2. 新增几何类型

`aarc/src/models/coord.ts` 中增加：

```ts
/** 四边形坐标，按顺序的四个顶点，通常为凸四边形 */
export type QuadCoord = [Coord, Coord, Coord, Coord]
```

保留 `RectCoord` 给非旋转场景使用（如 `gridCvsWorker.ts` 的视图裁剪、网格扩展）。

两个 RectStore 的存储类型从 `RectCoord` 改为 `QuadCoord`：

- `textTagRectStore.ts`： `useKvStoreCore<QuadCoord>`。
- `staNameRectStore.ts`： `useStaNameRectStore` 和 `useStaNameMainRectStore` 都改为 `useKvStoreCore<QuadCoord>`。
- 删除联动逻辑保留：当 `setStaNameRect(id, undefined)` 时仍同步删除 `useStaNameMainRectStore` 中的记录。

### 3. 几何工具函数改造

`aarc/src/utils/coordUtils/coordRect.ts` 中新增或改造：

- `pointInQuad(quad: QuadCoord, pos: Coord): boolean`
  - 使用叉积法判断点是否在凸四边形内（统一按逆时针/顺时针顺序）。
- `quadCoordDistSqLessThan(quad: QuadCoord, pos: Coord, cmpSq: number): boolean`
  - 点在四边形内则距离为 0。
  - 否则计算点到四边形四条边的最近距离。
- `enlargeQuad(quad: QuadCoord, delta: number): QuadCoord`
  - 按各边法向向外平移，用于类似 `enlargeRect` 的扩展（如 TextTag 的 padding 扩展）。
- `drawQuad(ctx: CvsContext, quad: QuadCoord, strokeColor?: string, lineWidth?: number)`
  - 替代 `drawRect` 的 `strokeRect`，改为 `ctx.beginPath / moveTo / lineTo / stroke`。
- `quadBoundingRect(quad: QuadCoord): RectCoord`
  - 取四边形各顶点的 min/max，用于需要轴对齐包围盒的临时计算。
- `rectToQuad(rect: RectCoord): QuadCoord`
  - 兼容性工具，把旧的轴对齐矩形转成四边形（按顺序的四个角）。

### 4. 文本渲染函数改造

`aarc/src/utils/drawUtils/drawText.ts`：

- `drawText` 签名增加可选角度参数，并返回 `QuadCoord`：

  ```ts
  export function drawText(
      ctx: CvsContext, pos: Coord, align: SgnCoord, textAlignOverride: SgnNumber | undefined,
      main: DrawTextBodyOption, sub: DrawTextBodyOption, stroke?: DrawTextStrokeOption | false,
      task: 'draw' | 'measure' | 'both' = 'both', width?: number,
      angle?: number
  ): { rectFull: QuadCoord, rectMain: QuadCoord } | undefined
  ```

- 先按现有逻辑计算无旋转时的轴对齐矩形（`left`, `right`, `top`, `bottom`）。
- 以 `pos` 为旋转中心，把四个角旋转 `angle` 弧度，得到 `rectFull: QuadCoord`。
- `rectMain` 同样由主文本范围旋转后得到。
- 当 `angle === 0` 时，四边形顶点与当前矩形四角完全一致，保持行为等价。
- 绘制时，如果 `angle !== 0`：
  - `ctx.save()`
  - `ctx.translate(pos[0], pos[1])`
  - `ctx.rotate(angle)`
  - `ctx.translate(-pos[0], -pos[1])`
  - 按原有逻辑绘制文字（此时文字是“正着”绘制的，但画布已旋转）。
  - `ctx.restore()`

- 注意：测量阶段也需要在相同变换下进行，否则文本测量结果与绘制结果不一致。

`drawTextForLineName` 同样增加 `angle?: number` 参数并返回 `QuadCoord`。

### 5. Canvas Worker 改造

#### `aarc/src/models/cvs/workers/textTagCvsWorker.ts`

- `renderForCommonLine`、`renderForTerrainLine`、`renderPlain` 都需要把 `TextTag.angle` 传给 `drawText` / `drawTextForLineName`。
- 存储到 `textTagRectStore` 的矩形改为 `QuadCoord`。
- 当需要绘制外框（`strokeRect`）时，使用 `drawQuad` 替代 `drawRect`。
- 图标处理：图标与文字组合后的整体矩形也需要旋转。当前逻辑先得到文字的 `rectFull`，再把图标纳入扩展；改造后应继续沿用这一流程，但扩展函数改为 `enlargeQuad` / 图标边界也参与旋转。

#### `aarc/src/models/cvs/workers/staNameCvsWorker.ts`

- `renderPtName` 把 `pt.nameAngle` 传给 `drawText`。
- 返回的 `rectFull` 和 `rectMain` 都是 `QuadCoord`，分别写入 `useStaNameRectStore` 和 `useStaNameMainRectStore`。
- 远距离糊弄渲染：
  - 当前逻辑用 `staNameMainRectStore.getStaNameMainRect(pt.id)` 获取矩形，并直接用 `ctx.fillRect(...)` 画一个灰色半透明白底。
  - 改造后：获取的是 `QuadCoord`，使用 `ctx.beginPath / moveTo / lineTo / fill` 填充该四边形。
- 命中高亮（`markRoot`）的 `drawRect(ctx, rects.rectFull)` 改为 `drawQuad`。

### 6. 命中检测改造

`aarc/src/models/stores/saveDerived/saveDerivedDerived/onDetectStore.ts`：

- `onStaName(c)`：把 `rectInside(rect, c)` 替换为 `pointInQuad(quad, c)`。
- `onTextTag(c)`：同样替换为 `pointInQuad(quad, c)`。

`aarc/src/models/stores/selectionStore.ts`：

- `brush` 选择 TextTag 时，把 `rectCoordDistSqLessThan(rect, coord, radiusSq)` 替换为 `quadCoordDistSqLessThan(quad, coord, radiusSq)`。

### 7. 属性面板 UI 改造

#### `aarc/src/components/sidebars/options/TextTagOptions.vue`

在“横向锚点/纵向锚点/文字对齐”附近增加“旋转角度”输入：

```html
<tr>
    <td>旋转</td>
    <td>
        <input type="number" v-model.number="editing.angle" :step="5" />
        <span class="smallNote">度</span>
    </td>
</tr>
```

- 保存时把角度转换为弧度（或者 UI 直接存弧度但显示为度）。
- 与 `drawText` 的参数单位保持一致。

#### `aarc/src/components/sidebars/options/ControlPointOptions.vue`

在“站名位置”或“站名尺寸”附近增加“站名旋转角度”输入，绑定到 `editing.nameAngle`。

### 8. 其他需要同步调整的地方

- `aarc/src/utils/drawUtils/drawRect.ts`：
  - 保留 `drawRect` 用于轴对齐矩形（如网格高亮）。
  - 新增 `drawQuad` 函数，或者把 `drawRect` 改名为 `drawQuad` 并统一使用四边形（视具体调用而定）。
- `aarc/src/models/stores/utils/resetterStore.ts`：无需改动，`clearItems()` 仍然有效。
- `aarc/src/components/sidebars/SizeEdit.vue`：无需改动，清空 `staNameMainRectStore` 仍然有效。
- `aarc/src/models/cvs/workers/gridCvsWorker.ts`：仍使用 `RectCoord`，不受影响，保留原类型。

## 实施顺序建议

按以下顺序进行，每步都可以独立验证：

1. **几何基础设施**
   - 在 `coord.ts` 增加 `QuadCoord`。
   - 在 `coordRect.ts` 增加 `pointInQuad`、`quadCoordDistSqLessThan`、`enlargeQuad`、`drawQuad`、`quadBoundingRect`、`rectToQuad`。
   - 增加单元测试（如果有测试框架），确保 `pointInQuad` 和 `quadCoordDistSqLessThan` 在 angle=0 时与旧函数结果一致。

2. **drawText 改造**
   - 让 `drawText` 支持 `angle` 参数并返回 `QuadCoord`。
   - 保持 `angle=0` 时的输出与旧 `RectCoord` 完全等价（可通过 `rectToQuad` 验证）。
   - 同步改造 `drawTextForLineName`。

3. **TextTag 渲染与检测**
   - 在 `TextTag` 增加 `angle?: number`。
   - 在 `textTagCvsWorker.ts` 传入角度并存储 `QuadCoord`。
   - 在 `textTagRectStore.ts` 改为 `QuadCoord`。
   - 在 `onDetectStore.ts` 和 `selectionStore.ts` 使用新的四边形检测。
   - 在 `TextTagOptions.vue` 增加角度输入。

4. **站名渲染与检测**
   - 在 `ControlPoint` 增加 `nameAngle?: number`。
   - 在 `staNameCvsWorker.ts` 传入角度并存储 `QuadCoord`。
   - 在 `staNameRectStore.ts` 改为 `QuadCoord`（保留删除联动）。
   - 在 `onDetectStore.ts` 使用新的四边形检测。
   - 在 `ControlPointOptions.vue` 增加角度输入。

5. **回归测试**
   - 把大量现有文本角度设为 0，确认渲染、点击、选择、导出与之前一致。
   - 再测试非 0 角度，确认旋转和点击判定正确。

## 兼容性与风险

- **旧存档**：`angle` 和 `nameAngle` 未定义时按 `0` 处理，无需迁移。
- **SVG 导出**：`svgcanvas` 提供的上下文通常兼容 `ctx.rotate`，但需验证；如果导出异常，可能需要给 SVG 导出单独处理变换矩阵。
- **性能**：命中检测从轴对齐矩形比较改为四边形运算，计算量略有增加。对于大地图，仍可接受（每个候选对象只需一次 `pointInQuad`）。
- **图标+文本组合**：图标纳入旋转后的整体矩形需要小心，避免图标和文字在旋转后发生错位。
- **“糊弄渲染”**：使用 `fillQuad` 填充半透明白底，视觉上仍应覆盖主站名区域，不能因为旋转而出现留白或越界。

## 命名约定

- 角度统一用 **弧度（radian）** 存储和传给 canvas API，UI 层可显示为度（degree）。
- 新类型命名为 `QuadCoord`，避免与 `RectCoord` 混淆。
- 函数前缀使用 `quad`：
  - `pointInQuad`
  - `quadCoordDistSqLessThan`
  - `enlargeQuad`
  - `drawQuad`
  - `quadBoundingRect`
