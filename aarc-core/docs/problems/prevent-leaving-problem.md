# 点击选中站名误触发 preventLeaving 问题分析

> 状态：**已定位机制，未修复**（2026-09-29）
> 相关改动：拼音转换预设功能（未提交的工作区改动）

## 现象

进行过某些操作（疑似与拼音预设相关）后，点击选中站名会在控制台打出一次"限制离开"（即 `preventLeaving()` 发生了 false→true 转换）。每次"残留"只触发一次，之后同样点击不再出现。

## preventLeaving 的含义

`preventLeaving()`（`src/utils/eventUtils/preventLeavingUnsaved.ts:25`）= 标记"当前有未保存改动"：挂 `beforeunload`、注册路由守卫。**只在 false→true 转换时打印"限制离开"**，已是 true 时重复调用为静默 no-op。唯一让它回到 false 的是保存成功后的 `releasePreventLeaving()`（aarc-web `Editor.vue:257`）。

它有两个调用来源：

1. 配置面板各处的显式调用（含 `PinyinConvertConfig.vue:39-41` 的 watch 与预设增删改）；
2. **宿主注入的"主画布渲染完成"回调**（aarc-web `Editor.vue:302-308`）——设计上把每次主画布重渲染视为"可能有改动"，渲染即调用 `preventLeaving()`。

## 点击站名 → preventLeaving 的唯一通路

点击站名本身不改 config（已用 store 级仿真验证：`startEditing`/`applyName`/`endEveryEditing` 全链都不触发 PinyinConvertConfig 的 watch）。它要触发 preventLeaving，只有一条路：

```
点击站名
  → pureClickHandler 发现 nameEditStore.edited === true（envStore.ts:185）
  → rerender.value(...)               （envStore.ts:216）
  → renderMainCvs()                   （mainCvsDispatcher.ts:189，未 suppress）
  → notifyMainCvsRendered()           （mainCvsDispatcher.ts:156）
  → undo push + 宿主回调 preventLeaving()（mainCvsDispatcher.ts:76-88 / Editor.vue:306）
```

同一次点击的 `endEveryEditing` 会把 `edited` 复位（`envStore.ts:141`）——这解释了为什么**恰好触发一次**。

推论：问题不在"点击"本身，而在于**点击之前 `edited` 被静默置成了 true**。

## 核心机制：`edited=true` 误报链

关键环节在 `NameEdit.vue:120`：

```vue
<ControlPointOptions @changed="edited=true">
```

`ControlPointOptions.vue:197-211` 对 `editing.value`（点对象本身）挂了 deep watch，任何深层变更都 `emit('changed')`。两个放大器：

1. **`editing.value` 从不复位**——整个组件只有 `editing.value = pt`（`:41`）一处赋值。面板收起后 deep watch 仍永久架在最后一个打开过的点上；`TextTagOptions.vue:70-73` + `:28` 完全相同（`@changed="edited=true"` 在 `TextTagEdit.vue:99`）。
2. **Vue 3.5 深 watch 对"新增键"也触发**（已写最小语义测试确认：`pt.pinyinConvertPreset = '粤语'` 会触发 watch；等值写回不触发）。

于是：任何在"watch 仍架着的点/标签"上的后台写入，都会静默置 `edited=true`——**此时并不调用 preventLeaving**，用户毫无感知。

## 本次改动引入的新触发面

- `renamePinyinPresetRefs` / `clearPinyinPresetRefs`（`src/models/pinyinPreset.ts:55-71`）：预设改名/删除时级联写所有引用点/标签的 `pinyinConvertPreset`（可能是新键赋值）。
- `PinyinConvertConfig.vue` 一键转换写 nameS/textS（HEAD 已存在，同样波及）。

注意：级联写本身已正确调用 `preventLeaving()`（`PinyinConvertConfig.vue:92/111`），语义没丢；问题是**冗余的 `edited=true` 残留**会在"保存之后"的下一次无辜点击上再次触发标记 + 一次多余的主画布重渲染 + 一次 undo push。

## 典型复现序列

1. 之前打开过某站的选项面板（deep watch 架在该点上，之后不撤）；
2. 在"设置-站名拼音转换"里给该站指定预设，或改名/删除预设触发级联 → 该点 `pinyinConvertPreset` 被写 → `changed` → `edited=true`（静默）；
3. Ctrl+S 保存 → `releasePreventLeaving`（false）；
4. 点击选中任意站名 → 走上述唯一通路 → "限制离开"，恰好一次。

## 历史上已存在的同类触发面（非本次引入）

- `ControlPointOptions.startEditing` 给没设置过 nameSize 的点补 `nameSize=0`/`nameSSize=0`/`nameP`（`:38-43`）→ 触发 changed → `edited=true`；
- 一键转换写 nameS（HEAD 的 `34f270e2` 引入）；
- 拖动等真实编辑（符合设计）。

本次改动让触发面明显变大，所以表现为"疑似与本次更改有关"。

## 次要发现（独立小问题）

`PinyinConvertConfig.vue:26-37` 的 `onMounted` 在 `config.pinyinConvert` 为空（老存档/未配置）时填充默认值，会触发自己的 watch（`:39-41`）→ 编辑器一打开即处于"未保存"态。因为 `writeConfigToSave` 的 `removeKeyIfSame` 会把等于默认值的 `{}` 从存档中剔除，所以未碰过拼音设置的新存档每次加载都会踩到。

## 候选修复方向（未实施）

1. **解除误报根源**：选项面板收起/关闭时复位 `editing.value`（或 SideBar fold 时撤架 deep watch）。最治本，需确认面板收起时机与重新展开的行为。
2. **级联写抑制**：`renamePinyinPresetRefs`/`clearPinyinPresetRefs`/批量转换期间置模块级抑制标志，选项面板 watch 收到变更时若标志置位则不 emit（级联本身已调 preventLeaving，语义不丢）。
3. 两者都做：1 治本、2 兜底。

另可考虑：顺手处理次要发现（`onMounted` 填充默认值不应走 watch 触发 preventLeaving，可改为直接写 config 后重置 watch 或给 watch 加 enabled 条件）。
