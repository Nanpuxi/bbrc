# 多选结果持久化（选区组 Selection Groups）方案

> 状态：草案 / 待评审
> 目标：把一次多选的结果存入存档，之后点击其中任一成员即整组选中，效果等同于重新做了一次同样的画笔多选。

## 1. 现状梳理

多选由 `src/models/stores/selectionStore.ts`（pinia，id 为 `selection`）实现：

- 核心状态 `selected: Ref<Set<ControlPoint | TextTag>>` —— **直接持有对象引用**，不含 id，因此无法直接序列化。
- 填充方式：画笔（`brush()`）。Shift+拖动为加选、Ctrl+Shift+拖动为减选；触屏经 `enableForTouchScreen()` 开启。Esc 清空（`clearIfEsc`）。
- **功能范围（重要）**：目前多选的唯一实际功能是**整体拖动平移**（`draggingStart/Drag/Commit`，由 `envStore.ts` 在点/文本标签拖动流程中调用）。其余消费方均为辅助性质：
  - 高亮渲染：`selectionCvsWorker.ts:37-45`，经 `activeCvsDispatcher.ts` 的 `renderSelection()`；
  - UI 提示：`Cvs.vue:110-117` 的多选状态条；
  - 状态判断：`envStore.viewMoveLocked`、`activeCvsDispatcher.noNeedActiveCvs` 等。
  - 没有批量删除、批量改属性、对齐等操作。因此选区组恢复后能做的事也就是整体拖动，本方案不涉及扩展多选的功能面。
- 关键点：**所有消费方只认 `selected` 这个 Set**。只要能把"整组成员"灌进 `selected`，后续移动、高亮等行为与手动画笔多选完全一致，无需改动任何消费代码。

## 2. 数据结构设计（save.ts）

持久化只存 id，不存引用。在 `Save` 中新增可选字段：

```ts
export interface Save {
    // ...
    selectionGroups?: SelectionGroup[]
}

export interface SelectionGroup {
    id: number          // 从 idIncre 取，与全项目元素 id 规则一致
    name?: string       // 可选，便于在侧栏列表中辨认
    ptIds: number[]     // ControlPoint.id
    tagIds: number[]    // TextTag.id
}
```

设计要点：

- 点和文本标签分两个数组，因为二者 id 空间共用但类型不同，解析时分别走 `saveStore.getPtById` / `getTextTagById`。
- 字段可选（`?`），旧存档零迁移成本；规范化逻辑兜底（见 §5）。
- 允许一组同时含点和标签，与画笔多选的语义一致。

## 3. 运行时行为设计

### 3.1 建组 / 解散组

入口放在多选状态条中，即 `Cvs.vue:102-118` 的 `<div class="statusDisplay selectionWorkingStatus">`（内联模板，非独立组件）。该状态条分两分支：画笔涂抹中显示"添选/减选模式、选择完成"；`selected.size > 0` 时显示"当前选中 N 个元素"及加选/减选/退出按钮。**建组/解散组按钮加在第二个分支**：

- **建组**："存为选区组"按钮（`selected.size >= 2` 时可用）。点击后：
  1. 遍历 `selectionStore.selected`，按 `'dir' in s` 区分点/标签，收集 id；
  2. 调 `saveStore` 新方法 `createSelectionGroup(ptIds, tagIds)`，内部用 `getNewId()` 分配 id 并 push 进 `save.selectionGroups`；
  3. （可选）弹出命名输入。
- **解散组**：当前 `selected` 的 id 集合与某个组**完全一致**时，显示"解散选区组"按钮，点击调 `removeSelectionGroup(id)` 删除该组（不影响元素本身，也不清空当前多选）。
- 组列表的管理（重命名/删除/查看）如需独立界面，后续再议，初版只做上面两个按钮。

### 3.2 触发"点一中全"（已决策：总是触发）

挂载点在 `envStore.ts` 的点击流程：`pureClickHandler` 确定 `activePt` / `activeTextTag` 之后、且本次点击**未处于多选画笔状态**（`selectionStore.enabled === false`）时：

1. 查 `save.selectionGroups`，找出包含该元素 id 的组；
2. 若找到，调 `selectionStore.applyGroups(groups)`（新增方法）：把各组 id 解析回对象引用，灌入 `selected`；
3. 渲染与拖动自动生效，无需其他改动。

`applyGroups` 需忽略已删除元素的死 id（解析结果为 undefined 直接跳过）。

### 3.3 重叠组（已决策：取并集）

一个元素属于多个组时，点中后把所有匹配组取**并集**灌入 `selected`。实现最简单，语义上也接近"这些都和它关联"。

### 3.4 选中之后不再特殊

组选中后，`selected` 就是普通的引用 Set：用户可以继续 Shift 加选/减选、Esc 清空、整体拖动，与手动画笔多选毫无区别。**不要**在 selectionStore 里维护"当前激活组"之类的状态，避免双向同步的复杂度。

### 3.5 组的可视化（已决策：暂不做）

不给同组元素常显弱高亮，保持与手动画笔多选表现一致。后续如需要再单独立项。

## 4. 组的生命周期维护

- **元素删除时清理引用**：`saveStore.removePt()`（约 saveStore.ts:425）与 `removeTextTag()`（约 saveStore.ts:593）中，仿照 `removePointLinkByPt` 的做法，把被删 id 从所有组的 `ptIds`/`tagIds` 中剔除；成员为空的组整个删除。
- **规范化兜底**：`saveNormalize.ts` 新增 `ensureValidSelectionGroups(obj)`（放在 `src/models/save/valid/` 下，与 `slices.ts` 等并列）：
  - `selectionGroups` 不是数组则丢弃；
  - 过滤不存在的 id、组内去重；
  - 删除空组、缺合法 `id` 的组。
- **撤销/重做**：`undoStore` 以整个 `Save` 为快照单位，组数据天然被覆盖。注意 `restoreState` 会整体替换 `save` 对象，此时 `selected` 里的引用全部失效 —— 建议顺带在恢复流程中清空 `selected`（这对现有画笔多选同样是必要的健壮性修复）。

## 5. 改动清单

| 文件 | 改动 |
|---|---|
| `src/models/save.ts` | 新增 `SelectionGroup` 接口与 `Save.selectionGroups?` |
| `src/models/save/valid/selectionGroups.ts` | 新建：`ensureValidSelectionGroups` |
| `src/models/save/saveNormalize.ts` | 调用上面的规范化函数 |
| `src/models/stores/saveStore.ts` | 新增 `createSelectionGroup / removeSelectionGroup / renameSelectionGroup`；`removePt`、`removeTextTag` 中清理组内引用 |
| `src/models/stores/selectionStore.ts` | 新增 `applyGroups(groups)`（id → 引用，灌入 `selected`） |
| `src/models/stores/envStore.ts` | `pureClickHandler` 激活点/标签后触发组展开（并集）；undo/redo 恢复后清空 `selected` |
| `src/components/Cvs.vue` | 多选状态条第二分支新增"存为选区组"/"解散选区组"按钮 |
| `src/tests/unit/save/saveNormalize.test.ts` | 补充 `ensureValidSelectionGroups` 用例 |

验证方式：改动后运行 `pnpm --filter aarc-core type-check` 与 `pnpm --filter aarc-web test:run`。

## 6. 已决策事项与遗留问题

已决策：

1. **重叠组**：取并集（见 §3.3）。
2. **触发方式**：暂定总是触发，不加开关；若试用反馈干扰单元素微调，再考虑 Alt+点击触发或全局开关（见 §3.2）。
3. **建组/解散组入口**：放 `Cvs.vue` 多选状态条（见 §3.1）。
4. **组可视化**：暂不做（见 §3.5）。

遗留问题：

- 组的**列表管理界面**（重命名、删除任意组、手动应用某组）是否要做、放哪里，初版之后再定。
- 解散组时是否要求"完全一致"，还是"当前选区是某组的超集"即可解散？初版按完全一致实现，超集场景用户可先减选到一致。
