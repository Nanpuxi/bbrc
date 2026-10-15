# 站名局部缩放支持

## 目标

让 `ControlPoint` 的主站名、副站名可以分别做横向/纵向的非等比缩放（绕站名锚点，在文字自身坐标系内生效），同时保证：

- 缩放后的包围盒（`rectFull` / `rectMain`，`QuadCoord`）与绘制结果严格一致，点击判定、远距离糊弄渲染、命中高亮不受影响。
- 与站名旋转（`nameAngle`）正确叠加：先缩放、后旋转。
- 与站名位置“记忆”互不干扰：写入/应用记忆时不记录、不覆盖缩放值。
- 四个值均未设置时行为与旧版完全一致（无任何画布变换），旧存档无需迁移。

## 数据模型

`aarc-core/src/models/save.ts` 的 `ControlPoint` 新增四个可选字段：

- `nameScaleX?: number` — 主站名横向缩放倍率
- `nameScaleY?: number` — 主站名纵向缩放倍率
- `nameSScaleX?: number` — 副站名横向缩放倍率；未设置时**跟随 `nameScaleX`**，再未设置按 1
- `nameSScaleY?: number` — 副站名纵向缩放倍率；未设置时跟随 `nameScaleY`，再未设置按 1

回退链由 worker 解析（`staNameCvsWorker.ts`）：

```ts
const nameSx  = resolveTextScale(pt.nameScaleX)          // 本点值 → 1
const nameSy  = resolveTextScale(pt.nameScaleY)
const nameSSx = resolveTextScale(pt.nameSScaleX, nameSx) // 本点副值 → 本点主值 → 1
const nameSSy = resolveTextScale(pt.nameSScaleY, nameSy)
```

`resolveTextScale`（`drawText.ts`）只接受正的有限数值，其余（`undefined`、0、负数、`NaN`、`Infinity`、空串等）按 fallback 处理。不接受负倍率的原因：负倍率会镜像矩形、翻转四边形顶点的环绕方向，破坏 `quadInside` 的命中检测。

## 渲染实现

### drawText 签名

`aarc-core/src/utils/drawUtils/drawText.ts` 末尾追加四个可选参数：

```ts
export function drawText(
    ctx: CvsContext, pos: Coord, align: SgnCoord, textAlignOverride: SgnNumber | undefined,
    main: DrawTextBodyOption, sub: DrawTextBodyOption, stroke?: DrawTextStrokeOption | false,
    task: 'draw' | 'measure' | 'both' = 'both', width?: number, angle?: number,
    scaleX?: number, scaleY?: number, subScaleX?: number, subScaleY?: number
): { rectFull: QuadCoord, rectMain: QuadCoord } | undefined
```

函数内部再次用 `resolveTextScale` 兜底（副倍率未传时跟随主倍率），与 worker 的回退链叠加是幂等的。

### 变换语义（绘制与测量共用同一映射，两条路径必须严格一致）

- **副倍率与主一致**（含副未设置、跟随主值的常见情况）：主副共用一个变换块，整块绕 `pos` 做 `ctx.scaleAround(pos, sx, sy)`，与旋转共用 `save`/`restore`。
- **副倍率独立**：主、副各套一个变换块（carpet 描边随各自的块）。由 `getSubScaleTransform`（`drawText.ts`）计算副块参数：
  - **横向**：主、副行带沿锚点同侧对齐，副行带的锚点侧边缘恰落在 `pos` 上，主倍率绕 `pos` 缩放不移动它，因此副横向只绕 `pos` 缩放。若绕副行带自身中心缩放，副文字会整体横移、脱离锚点侧，与主文字表现不一致。
  - **纵向**：主、副行带是上下相接的两段。跟随主倍率的是**整块**（主+副）的锚点侧边缘（`ySgn=1` 块顶边、`ySgn=-1` 块底边、`ySgn=0` 块中心线）。副倍率只改变块高，主副之间始终无缝相接：块整体平移 `blockTranslateY`，不能只把副顶边钉在“主倍率位置”而让块底边被推离锚点。`ySgn=1` 时块顶即主行带上边缘、本已被主倍率钉住，位移为 0；副倍率等于主倍率时位移也为 0，因此“副跟随主”的整体缩放路径不受影响。
- **倍率为 1 时缩放退化为平移**（锚点公式 0/0），故 `scaleCenter` 与 `translate` 分别给出；`ssy === 1` 时纵向用平移、`ssy !== 1` 时给出真正的缩放中心。
- **变换顺序**：先（绕 `pos`）旋转 → 平移 →（绕各自中心）缩放。缩放发生在文字自身坐标系内，即“先缩放后旋转”。画布矩阵是各调用的左乘累积，因此 `translate` 先于 `scale` 发出时，作用在“缩放之后”的输出空间里。

### 测量语义

- 先算未变换的轴对齐矩形：`rectFull`（`getRect`）、`rectMain`（`getMainRectByFullRect`）、`rectSub`（`getSubRectByFullRect`，新增：主行带在上方，副行带从其下缘开始）。
- 副跟随主：整体矩形绕 `pos` 缩放（`scaleRect`）即可。
- 副独立：主、副行带各自按各自倍率缩放（`mapMainRect` / `mapSubRect`，含整块平移），再取并集 `unionRect`（`coordRect.ts` 新增）。**两侧都只用自己的行带矩形**（宽度 = 该行最大行宽）：`rectFull` 的宽度来自主副最大行宽，若用它乘副倍率，会把源自主文本的宽度也缩放，主缩副不缩时矩形比文字宽、两侧留白。
- 只有一方有文本时另一方倍率无从生效；无主文本时 `rectMain` 退回已按副倍率缩放的 `rectFull`，避免退化成含 `±Infinity` 的矩形。
- **`width` 参数是盒子与任何倍率无关的固定下限**：文字先各自缩放，缩放后实际宽度不足 `width` 时向锚点对侧拉长到 `width`，超出则保持撑大后的宽度（`enlargeRectToWidth` 在缩放之后调用）。

### 画布上下文辅助

`aarc-core/src/models/cvs/common/cvsContext.ts` 新增：

- `translateBy(dx, dy)` — 以逻辑单位平移（`ctx2d` 处于设备坐标系，位移需乘 `scale`）。
- `scaleAround(x, y, sx, sy)` — 以逻辑坐标 `(x, y)` 为中心非等比缩放，配合 `save`/`restore` 使用。

## 未设置值时的开销

四个值均未设置（且未旋转）时：

- **绘制路径零画布状态变化**：`withTransform` 的快速路径直接执行 `body()`，不产生 `save`/`restore`/`translate`/`scale` 调用（有测试断言），fillText/strokeText 次数与旧版一致。
- **每站每帧仅新增常数级纯计算**：worker 侧 4 次 `resolveTextScale`；`drawText` 侧 `resolveTextScale`×4、`getSubRectByFullRect`、`getSubScaleTransform`（少量算术 + 2 个闭包分配，其中 `mapSubRect` 在跟随路径下不被调用）。`measureText` 次数不变。
- **测量路径**多一次 `scaleRect(=1)` 的矩形拷贝（此前原地复用 `rectFull`），可忽略。

## UI

- `aarc-core/src/components/sidebars/shared/ScaleInput.vue`（新增）：数字输入 + 滑条。输入留空或非法一律写回 `undefined`（由渲染层按默认倍率处理）；setter 统一 clamp 到 `[0.05, 10]`；滑条只覆盖常用区间 `[0.3, 2]`（步进 0.1），超出区间的值显示在端点。
- `aarc-core/src/components/sidebars/options/ControlPointOptions.vue` 新增“站名局部缩放”一节：四值均未设置时收起为“自定义”按钮，点击仅展开表格、不写入数据（仿站名白边交互）；副站名 placeholder 提示“跟随主值”；提供“清除本点缩放设置”一键置空四个值。本节设置不属于站名位置“记忆”。

## 测试与开发存档

- `aarc-core/src/tests/unit/utils/drawText.test.ts`：新增约 20 个缩放用例——缺省无变换、横/纵独立缩放、副独立时的锚点侧行为、对齐方向（左/中/右、上/中/下）、与旋转叠加、非法倍率兜底、`width` 下限交互、空主文本退化等；变换公式在测试内独立实现，不引用被测代码。
- `aarc-core/src/tests/unit/utils/coordRect.test.ts`：新增 `scaleRect`、`unionRect` 用例。
- `aarc-web/src/data/dev/devSave.ts`：开发存档的若干站点带上四个缩放字段，覆盖跟随/独立组合。

## 兼容性与风险

- **旧存档**：四个字段未定义按 1 处理，无需迁移；序列化时 `undefined` 字段不进 JSON。
- **负倍率**：UI 与 `resolveTextScale` 双重拦截，不会进入渲染。
- **协作同步**：字段在 `ControlPoint` 上，随 save 同步，无特殊处理。
- **已知取舍**：副独立缩放时绘制拆成两个变换块，canvas 状态切换次数略增，仅在设置了独立副倍率的站点上发生。
