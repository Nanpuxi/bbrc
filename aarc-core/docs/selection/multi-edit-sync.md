# 多选同属性同步编辑

> 状态：已实施（2026-11）
> 目标：多选（画笔临时选区或选区组）中编辑某元素的属性时，按配置决定是否把同一属性同步到其他同类选中元素。

## 1. 背景与现状

- 多选状态为 `selectionStore.selected: Set<ControlPoint|TextTag>`（`src/models/stores/selectionStore.ts`）；当前多选的唯一编辑能力是整体拖动（`draggingCommit`），`pos` 同步已由拖动路径覆盖。
- `matchedSelectionGroup`（selectionStore.ts:113）可判断"当前选区与某选区组完全一致"。
- 编辑 UI `ControlPointOptions.vue` / `TextTagOptions.vue` 的几十个输入框以裸 `v-model` 直接绑定 save 内对象（如 `editing.nameSize`、`editing.textOp.color`），逐一改包装 setter 不现实。
- 两个组件已有 deep watch 检测变更（`ControlPointOptions.vue:197`、`TextTagOptions.vue:70`）。

## 2. 配置设计（`editorLocalConfig.ts`）

仿照 `SelectionLockedBehavior`（editorLocalConfig.ts:11）新增两项，persist 插件自动持久化：

```ts
/** 多选时编辑某元素，是否同步更改其他同类选中元素的同属性：undefined（默认）=尚未选择，作用与 never 一致 */
export type MultiEditSyncScope = 'never' | 'notGroupOnly' | 'groupOnly' | 'always' | undefined
/** 同步时是否要求同伴该属性的当前值与编辑前旧值一致 */
export type MultiEditSyncValue = 'sameValueOnly' | 'always'
/** 文本标签字体（textOp/textSOp）的同步范围：all=全部同步；never=全部不同步；sameLine=仅同线路（forId 相等）；sameKind=仅同类（按 forId 是否存在分两类） */
export type MultiEditSyncFontScope = 'all' | 'never' | 'sameLine' | 'sameKind'
```

- `multiEditSyncScope`（默认 `undefined`，视同 `never`）：
  - `undefined`：**尚未选择**，作用与 `never` 一致（`scopeAllows` 中 `!scope` 即拒绝）。首次多选手势结束后由 `Cvs.vue` 的 Prompt 弹窗引导用户选择（见下文）；persist 不序列化 undefined，故在用户确认前一直保持未选择态。
  - `never`：不同步。
  - `notGroupOnly`：**非选区组**时同步——即当前选区不是（恰与）某个选区组时（画笔刷出的临时选区、或组展开后又加选/减选导致不再完全一致），允许同步；选区恰为某组时不同步（选区组的定位是整体移动，不做属性联动）。判据：`selectionStore.matchedSelectionGroup === undefined`。
  - `groupOnly`：**仅选区组**时同步——与 `notGroupOnly` 相反，只有选区恰为某组时才允许同步。判据：`selectionStore.matchedSelectionGroup !== undefined`。
  - `always`：任何多选都同步。
- `multiEditSyncValue`（默认 `'sameValueOnly'`）：
  - `sameValueOnly`：仅当同伴该属性与编辑前旧值**深相等**时写入（保持"值相同的一批"联动、不打扰值不同的）。
  - `always`：无条件写入。
- `multiEditSyncFontScope`（默认 `'sameKind'`）：仅作用于 TextTag 的字体键（`textOp`/`textSOp`）：
  - `all`：全部同步，不管 `forId`。
  - `never`：全部不同步——字体键完全不参与传播（其余属性不受影响）。
  - `sameLine`：仅同线路——`forId` 相等的同伴间同步（独立标签之间可互相同步）。
  - `sameKind`：仅同类——按 `forId` 是否存在分两类，线路标签（forId 存在，跨线路也算同类）与独立标签（forId 为 undefined）各自内部同步，跨类不同步。
- **逐键开关** `multiEditSyncKeys: Record<string, boolean>`（键格式 `pt:${属性名}` / `tag:${属性名}`，带类型前缀避免点/标签同名属性冲突）：用户对 `multiEditSyncKeyDefaults` 表中属性的显式选择；未设置的键回退到默认值表，表外属性一律默认允许同步。默认关闭、需用户勾选开启的键：
  - `pt:dir` / `pt:sta` / `pt:free`——右键/Ctrl 点击切换，面板外入口，极易误触发广播
  - `pt:name` / `pt:nameS`、`tag:text` / `tag:textS`——文字内容同步=批量覆盖，危险操作 opt-in
  - `tag:icon`——归属性强
  - 纯样式属性（尺寸、锚点、角度、白边、不透明度、zIndex 等）与 `pinyinConvertPreset` 默认联动，不逐个开关
- **属性组**（UI 从属关系，同步判定落到成员逐键开关上）：`multiEditSyncGroupDefaults` 定义组成员（与 `namePosMemory` 的"站名位置记忆"同一划分）；组成员在默认值表中默认关闭、可单独勾选。ToolBox 中组 checkbox 为派生状态——成员全选=选中、部分选=indeterminate，点击组则全选/全不选：
  - `pt:namePos`：`nameP`/`anchorX`/`anchorY`/`noLeader`/`nameAngle`——站名位置五元组，一同决定站名视觉效果
  - `nameP` 走**绝对值同步**（与组内其他键一致）：拖动站名时每帧的 nameP 直接广播给选区同伴（含原本无 nameP 的点，最终全部一致）；`pos` 仍为硬排除。历史上曾实现 delta 语义（`syncNamePDragDelta`），按用户要求改为绝对收敛后已移除

设置 UI 挂在 `ToolBox.vue` 的"批量选择功能设置" `ConfigSection`（`MultiEditSyncConfig.vue`）：scope/value 两个 `<select>` + scope 非 `never`/`undefined` 时显示默认关闭键的 checkbox 列表，底部为文本标签字体同步范围 select（scope 为 `never`/未选择时禁用）。scope 下拉底部有"未选择"选项（`:value="undefined"`，仅当当前值为 undefined 时渲染），选中即回到未选择态。

**首次引导弹窗**（`MultiEditSyncPrompt.vue`，由 `Cvs.vue` 引用）：`multiEditSyncScope === undefined` 时，监听 `selectionStore.brushStatus` 由 `down` 转 `up`（鼠标/手指松开、多选涂抹手势结束）且 `selected.size >= 2`，弹出 `Prompt`（无 bg-click-close、无 close-btn，只能点确认关闭）。弹窗内两个下拉框不含 undefined 选项，默认 `notGroupOnly` + `always`；确认后写入两项配置。

## 3. 实现方案：快照 diff + 传播（锚点 = 激活对象）

组合式函数 `src/models/stores/utils/selectionPropSync.ts`，由 envStore 在 setup 期接入一次：

1. **锚点**：`computed(() => activePt ?? activeTextTag)`（envStore 的激活对象）。覆盖 Options 面板编辑与面板外编辑（右键切换 sta/dir、站名/标签文字编辑等全部激活期修改）。
2. **快照**：锚点引用变化时同步重取基线快照；`flush: 'sync'` 保证"同一手势内先激活后修改"（点击站点的同时切换 sta）也能被 diff 到——激活瞬间取基线，随后的修改触发传播。
3. **挂起**：`suspendSelectionPropSync()` 供 `ControlPointOptions/TextTagOptions.startEditing` 补默认值期间挂起同步（挂起期的变更只更新快照、不传播）。
4. **侦听**：deep watch 锚点，对比快照找出变化的顶层 key；注册表 `nestedObjectSyncKeys` 内的嵌套对象键（`textOp`/`textSOp`/`nameCarpet`）再深入到**内部字段**逐字段 diff。
5. **前置条件**：锚点对象在 `selected` 内；变化 key 不在排除列表、且通过逐键开关（用户选择 → `multiEditSyncKeyDefaults` → 默认允许）。
6. **传播判定**：
   - 配置一：`never` 跳过；`notGroupOnly` 要求 `matchedSelectionGroup === undefined`；`groupOnly` 要求 `matchedSelectionGroup !== undefined`；`always` 要求 `selected.size > 1`。
   - 嵌套对象键：逐字段应用配置二（同伴某变化字段的当前值与编辑前旧字段等价才写入该字段），写入是**合并**——`{...同伴现值, 仅变化字段}`，未变化字段不动同伴（只调字号不改同伴颜色）。
   - 其余键对选区内**同类型**其他成员应用配置二：深相等比较复用 `saveDiff.ts` 导出的 `deepEqual`；写入值 rfdc 深拷贝（不能共享引用）。
7. **无循环风险**：传播修改的是同伴而非锚点，不触发自身 watch。

### 排除与特例（已决策）

- **`pos` 一律不做属性级同步**（已决策 4）——拖动位移已由 `draggingCommit` 对全选区统一施加，再同步会双重叠加；`nameP` 不在此列，它由属性组 `pt:namePos` 的逐键开关控制（默认关闭），且拖动期间由 envStore 挂起同步。
- **嵌套对象逐字段同步**（已决策 7）：`textOp`/`textSOp`（TextOptions）、`nameCarpet`（StaNameCarpetConfig）等值为扁平纯对象的键登记在 `nestedObjectSyncKeys`，逐字段 diff/比较/合并写入；新增嵌套对象属性时在注册表加一行即可纳入。整体移除（新值为 undefined）时回退整键写入。
- **TextTag 的 `textOp` / `textSOp` 同步范围可配置**（已决策 1，原为"仅 forId 一致的同伴"硬编码）：由 `multiEditSyncFontScope` 控制，默认 `sameKind`（按 forId 是否存在分两类各自同步，避免字体体系互相污染）；`sameLine` 退化为原硬编码行为；`all` 不做 forId 过滤；`never` 字体键全部不同步。
- 线路名标签的文字颜色实际存于 line 上（`TextTagOptions.vue:179` 改的是 `editingForLine.tagTextColor`），不在 tag 自身，同步逻辑不涉及（已决策 2：跳过）。

- `ControlPointOptions` 中 `anchorX/anchorY/noLeader`（undefined 参与的三态值）按顶层 key 处理；`pinyinConvertPreset` 纳入同步（已决策）。
- 快照与写入的深拷贝用 rfdc（`structuredClone` 无法克隆 Vue 响应式代理，会抛 DataCloneError）。
- `sameValueOnly` 的等价规范化：`nameSize`/`nameSSize`/`padding`/`width`/`zIndex` 这些"0 与 undefined 均表示使用默认"的键，比较时 `undefined` 视为 `0`（否则打开面板补默认值 0 的点与同伴 undefined 永不相等、无法同步）；嵌套对象键逐字段比较时，同伴从未设置该对象（undefined=整体跟随默认）且旧字段为 0/undefined 视为等价。`anchorX`/`noLeader`/`dropCap` 等 undefined 与 0/false 语义不同的键不做规范化。
- 锚点改为激活对象后，右键切换 `dir`/`sta`/`free` 等面板外编辑走同一条同步路径，由逐键开关（默认关闭）把关——即默认安全、勾选后联动，属预期行为而非边界。

## 4. 与多人协作的交叉点分析

对照 `../multiplayer/object-locking.md` 与 `../multiplayer/steps.md`，逐点确认：

| 交叉点 | 结论 |
|---|---|
| op 提交（`captureLocalOp`，主画布渲染边界 diff） | **安全**。传播与 `draggingCommit` 同模式——同一渲染边界内的全部变更 diff 成**同一个 op**，撤销也整批回滚，不会出现"改了自己、同伴变更漏发/单独成 op"。 |
| 对象锁（brush/applyGroups 过滤他人锁、入选区即乐观加锁） | **安全**。传播只写 `selected` 内成员，选区内全是我方持有的锁；不存在写入他人锁定对象的路径。 |
| 远程删除选中成员（`dropStaleLocalHolds`） | **安全**。传播遍历的是"当前活的 `selected`"，死对象已被移出，不会写悬空引用。 |
| 败方快照恢复（`lockApplier` 把失去锁的对象写回加锁快照） | **安全**。只恢复失去锁的那一个对象；传播造成的同伴改动在我方仍持有的锁上，是合法本地编辑，正常随 op 发出。 |
| undo 基线（`syncBaseline`） | **安全**。传播发生在 Vue watch 内（同步、早于下一次渲染/undo push），不会跨 push 边界。 |
| **远程 op 原地修改我正在编辑的对象**（`applyRemoteSaveDiff` 保留引用） | **存在放大竞态，需文档化**。deep watch 无法区分变更来源：他人绕过我的锁改了我编辑中的对象时，watch 会把这个远程值**再传播**给我的整个选区，把定点编辑放大成广播。缓解：这是建议性软锁语义下"他人绕过锁"的稀有场景（选区全员被我锁定），一致性由服务器全序 + LWW 兜底，与 object-locking.md §3 坑 3"保留本地编辑"同类；接受该语义并在本文档记录。若日后反馈不佳，可改为 Proxy 拦截 set（本地输入才传播，远程写绕过 trap），代价是深代理复杂度。 |
| `sameValueOnly` 与远程并发 | 深相等比较以**本地快照旧值**为准；若同伴值在快照后被远程改动，比较结果可能与视觉预期不符，属 LWW 固有取舍，可接受。 |

另：访客/只读模式下 Options 面板本就无法编辑，无需额外处理。

## 5. 改动清单

| 文件 | 改动 |
|---|---|
| `src/app/localConfig/editorLocalConfig.ts` | 新增 `MultiEditSyncScope`/`MultiEditSyncValue`/`MultiEditSyncFontScope` 类型与对应 ref、`multiEditSyncKeys` 逐键开关 ref 与 `multiEditSyncKeyDefaults` 默认值表，导出 |
| `src/components/sidebars/ToolBox.vue` | "批量选择功能设置"里挂 `MultiEditSyncConfig` 组件 |
| `src/components/sidebars/configs/MultiEditSyncConfig.vue` | 多选属性同步设置（scope/value 两个 select + 逐键 checkbox + 派生状态的属性组树 + 底部字体同步范围 select），自 ToolBox 拆出 |
| `src/components/MultiEditSyncPrompt.vue` | 首次多选后的同步策略引导弹窗（watch brushStatus 触发，自 Cvs 拆出） |
| `src/models/stores/utils/selectionPropSync.ts` | 组合式函数：快照 + deep watch diff + 按配置/逐键开关传播；锚点由调用方指定，flush=sync；含 `suspendSelectionPropSync`（供 startEditing 补默认值挂起） |
| `src/models/stores/envStore.ts` | setup 期接入一次：`useSelectionPropSync(computed(() => activePt ?? activeTextTag))` |
| `src/components/sidebars/options/ControlPointOptions.vue` | startEditing 补默认值用 suspendSelectionPropSync 包裹 |
| `src/components/sidebars/options/TextTagOptions.vue` | 同上 |
| `src/models/save/saveDiff.ts` | 导出 `deepEqual` |
| `src/tests/unit/store/selectionPropSync.test.ts` | 单测（见 §6） |

验证：`pnpm --filter aarc-core type-check`、`pnpm --filter aarc-core test:run`。

## 6. 测试要点（vitest，aarc-core）

- 四种 scope × 两种 value 的组合矩阵：改一个属性，断言同伴是否被写、写了几人。
- 逐键开关：默认关闭的键（dir/name/text 等）不传播，显式开启后传播；表外属性默认传播。
- `notGroupOnly`：选区恰为选区组时不同步；组展开后 Shift 加选一人（不再匹配组）则同步。
- `groupOnly`：与 `notGroupOnly` 相反，仅选区恰为选区组时同步。
- `sameValueOnly`：同伴值相同被写、不同不被写；嵌套对象键（textOp/nameCarpet）逐字段比较、合并写入不共享引用，只调字号不改同伴颜色。
- `pos` 变更不传播；`nameP` 由属性组 `pt:namePos` 控制（组默认关闭，且拖动期间挂起）。
- TextTag：字体同步范围四档均生效——`never` 全部不同步；`sameLine` 仅 forId 一致；`sameKind`（默认）按 forId 是否存在分两类各自同步、跨类不同步；`all` 全部同步。
- 属性组 `pt:namePos`：默认关闭不同步，开启后整组联动；拖动挂起期的 nameP 不同步、手输同步。
- `startEditing` 初始化（补默认值）不触发传播。
- 协作相关：传播产生的同伴变更与编辑者变更在同一个 capture 边界内（mock 渲染钩子断言一次 op）。
- 测试环境注意 AGENTS.md 所述坑：`ensureDomStub()`、`meta: { textTagIconsVersion: 1 }` 构造 Save、`void promise` 接 `.catch`。

## 7. 已决策记录

1. TextTag 字体类属性（textOp/textSOp）同步范围可配置（`multiEditSyncFontScope`，2026-12 由"仅 forId 一致的同伴间同步"的硬编码改为配置项）：`all`=全部同步、`never`=全部不同步、`sameLine`=仅同线路（forId 相等，原硬编码行为）、`sameKind`=仅同类（按 forId 是否存在分两类），默认 `sameKind`。
2. 线路级 `tagTextColor`（存在 line 上）不涉及本次同步。
3. 配置一最初中间档为 `notGroupOnly`（非选区组时同步），判据为 `matchedSelectionGroup === undefined`；后追加其反向档 `groupOnly`（仅选区组时同步），四档并存。
4. `pos` 作为特例排除，不做属性级同步（拖动已有选区级位移）。
5. 逐键开关（2026-11 追加）：`dir`/`sta`/`free`、站名/副站名、标签文字/副文字、`tag:icon` 默认关闭、checkbox 显式开启（见 §2）；`pinyinConvertPreset` 维持默认联动（"纳入"决策不变）。
6. 属性组（2026-11 追加，用户决策）：`pt:namePos`（站名位置五元组 `nameP`/`anchorX`/`anchorY`/`noLeader`/`nameAngle`，与 namePosMemory 同划分）。组 checkbox 为派生状态（全选/部分选 indeterminate），成员可单独设置，同步判定落到成员逐键开关上、成员默认关闭；`nameP` 含拖动在内的所有修改均**绝对值同步**（早期实现过 delta 语义，用户要求"最终全部一样"后改为绝对收敛并移除 `syncNamePDragDelta`）。
7. 嵌套对象逐字段同步（2026-11 追加，用户决策）：`textOp`/`textSOp`/`nameCarpet` 等扁平对象键在 `nestedObjectSyncKeys` 注册表登记，逐字段 diff、逐字段 sameValueOnly 比较、合并写入（未变化字段不动同伴）；注册表即扩展点，未来新增嵌套对象属性时加一行即可。
8. 未选择态（2026-11 追加，用户决策）：`multiEditSyncScope` 默认 `undefined`（视同 never，persist 不序列化故保持未选择态），设置下拉里以置底的"未选择"选项表示且仅在值为 undefined 时出现；值为 undefined 时首次多选手势结束（brushStatus down→up 且选区 ≥2）由 `Cvs.vue` 弹 Prompt 引导选择（默认 notGroupOnly + always，仅确认按钮可关闭）。
