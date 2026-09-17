# 多人协作实施步骤总览

本文档是协作功能的实施路线图，汇总各分析文档的结论并跟踪进度。

相关文档：
- `backend-plan.md`：后端方案（透传 patch、不做解析）
- `id-allocation.md`：ID 分配方案（方案C：负数分区，已实施）
- `object-locking.md`：对象锁与三步操作流程分析

## 已完成

- [x] ID 前缀分区（`collabStore`，负数 id = `-(prefix×2²⁰+counter)`）+ 测试
- [x] 协作用 diff 生成/应用（`src/models/save/saveDiff.ts`，自定义应用导向格式）+ 测试

## 步骤一：undo 栈防污染（进行中）

**问题**：远程 op 应用到 `saveStore.save` 后，下一次本地 `undoStore.push()` 会把他人变更算进本地 diff，导致 undo 撤销别人的操作。

**方案**：au-undo-redo 包由本项目作者控制（源码 `d:\npm项目\au-npm-pkgs\packages\au-undo-redo`），直接为其新增 API：

- `AurPatchStore.syncBaseline(state)`：将内部基线 `currentState` 静默替换为给定状态（深拷贝），**不记录历史、不动 pointer、不触发回调**。远程变更应用后调用一次，后续 `push()` 即以新基线计算 diff，远程变更不会进入 undo 栈。

**已知语义限制**（有意为之，文档化即可）：
- 已存在的 undo/redo 记录仍以各自 patch 为准。若远程变更与历史 patch 涉及同一属性，undo/redo 结果是 patch 覆盖语义（last-patch-wins），不会"合并"。
- pointer ≠ 0（用户正处于 undo 中途）时收到远程变更，redo 语义同样是 best-effort。

**依赖状态**：`syncBaseline` 已随 `@aurouscia/au-undo-redo@1.1.0` 发布到 npm，aarc-core 正常使用版本号引用。

## 步骤二：拆"纯数据刷新"路径

`resetterStore.resetDerivedStores(patch)` 目前吃 au-undo-redo 形状的 patch 且会 `cancelActive`。需要一条给远程 op 用的路径：

- 输入改为 `saveDiff.ts` 的 `SaveDiff`（或整个新 save）
- 只刷新派生 store（cvs 渲染、staCluster 等），不碰 undo、不取消本地正在进行的拖动
- 例外：若被远程删除/修改的正是本地激活对象，需按步骤三处理

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
