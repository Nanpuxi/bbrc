# 多人协作实施步骤总览

本文档是协作功能的实施路线图，汇总各分析文档的结论并跟踪进度。

相关文档：
- `backend-plan.md`：后端方案（透传 patch、不做解析）
- `id-allocation.md`：ID 分配方案（方案C：负数分区，已实施）
- `object-locking.md`：对象锁与三步操作流程分析

## 已完成

- [x] ID 前缀分区（`collabStore`，负数 id = `-(prefix×2²⁰+counter)`）+ 测试
- [x] 协作用 diff 生成/应用（`src/models/save/saveDiff.ts`，自定义应用导向格式）+ 测试
- [x] 步骤一：undo 栈防污染（au-undo-redo@1.1.0 `syncBaseline`）
- [x] 步骤二：纯数据刷新路径 + 远程 op 应用管线（`remoteOpApplier.applyRemoteSaveDiff`）

## 步骤一：undo 栈防污染（已完成）

**问题**：远程 op 应用到 `saveStore.save` 后，下一次本地 `undoStore.push()` 会把他人变更算进本地 diff，导致 undo 撤销别人的操作。

**方案**：au-undo-redo 包由本项目作者控制（源码 `d:\npm项目\au-npm-pkgs\packages\au-undo-redo`），直接为其新增 API：

- `AurPatchStore.syncBaseline(state)`：将内部基线 `currentState` 静默替换为给定状态（深拷贝），**不记录历史、不动 pointer、不触发回调**。远程变更应用后调用一次，后续 `push()` 即以新基线计算 diff，远程变更不会进入 undo 栈。

**已知语义限制**（有意为之，文档化即可）：
- 已存在的 undo/redo 记录仍以各自 patch 为准。若远程变更与历史 patch 涉及同一属性，undo/redo 结果是 patch 覆盖语义（last-patch-wins），不会"合并"。
- pointer ≠ 0（用户正处于 undo 中途）时收到远程变更，redo 语义同样是 best-effort。

**依赖状态**：`syncBaseline` 已随 `@aurouscia/au-undo-redo@1.1.0` 发布到 npm，aarc-core 正常使用版本号引用。

## 步骤二：拆"纯数据刷新"路径（已完成）

已实现（含测试 `src/tests/unit/collab/remoteOpApplier.test.ts`）：

- `resetterStore.refreshDerivedStoresForRemote(diff?)`：远程 op 专用刷新路径。只失效"由存档数据派生的缓存"（formalizedLine/staNameRect/textTagRect/lineExtend/cvsBlocksControl/icon），**不触碰**编辑与交互态（nameEdit/textTagEdit/pointLink/discardArea/namePosMemory/envStore 的激活对象），远程变更不打断本地进行中的输入、连线创建或拖动
- `staClusterStore.pure.ts` 新增 `saveDiffToSavePatch(diff)`：把协作 SaveDiff 转换为 cluster 恢复所需的 SavePatch 视图（`$set`/`$del` → undefined 保守重建；`$seq` 跳过——cluster 与顺序无关；restoreWithPatch 只读 id 和 new 的 undefined 性，内容用占位对象）
- `src/models/collab/remoteOpApplier.ts` 的 `applyRemoteSaveDiff(diff)`：远程 op 应用管线——① `applySaveDiff` 原地应用（保留引用，本地激活/选中对象存活）→ ② `undoStore.syncBaseline` → ③ `refreshDerivedStoresForRemote` + `relaunchDerivedStores`。独立成模块以避免与 saveStore→collabStore 的循环依赖
- 顺带重构：`resetDerivedStores` 内的 envStore 改为函数内懒取，远程路径不再实例化 envStore

待后续步骤处理：激活对象被远程 patch 删除/修改时的防御（步骤三）、渲染触发依赖 refreshBlocks 的 blocksReformHandler（undo 路径同款机制，已够用）。

## 步骤三：激活对象防御 + 对象锁落地

按 `object-locking.md` 结论实现：

- 第一步（点击选中）后广播 lock；第三步（点击他处/操作完成，即 `mainCvsDispatcher.ts` 中 undo push 的提交边界）广播 unlock + 新状态
- 锁覆盖位置、dir、sta 变化与删除
- 试图操作被他人锁定的对象时，自动解除选中
- 本地三步流程期间，激活对象被远程 patch 删除/修改时的防御（解锁 + 解除选中 + 刷新）

## 步骤四：传输层

- 定义 WS 消息协议：hello（分配 id 前缀）、lock/unlock、op（SaveDiff 透传）等
- `collabStore` 已有前缀字段，接入服务器分发
- 后端按 `backend-plan.md` 做透传，不解析不保存

## 步骤五：收尾验证

- 负 id 在 `AARC.Diff` 侧的兼容性测试（若后端确认不透传不解析可降级）
- E2E：两个浏览器实例同开一份存档，互相拖动/增删，验证收敛与 undo 正确性
