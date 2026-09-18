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
- [x] 步骤三：对象锁（`collabLockStore` + envStore/selectionStore 挂钩 + 败方降级 + 红叉渲染）

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

## 步骤三：激活对象防御 + 对象锁落地（已完成）

已实现（测试：`src/tests/unit/store/collabLockStore.test.ts`、`src/tests/unit/collab/lockApplier.test.ts`、`src/tests/unit/collab/remoteOpApplier.test.ts` 防御用例、`src/tests/unit/cvs/lockCvsWorker.test.ts`）：

- `src/models/stores/collabLockStore.ts`：锁表。锁键带类型前缀（`pt:5`/`line:3`/`tag:7`）；乐观加锁（`acquireMine` 立即视为持有，被他人持有时失败）；`releaseMineExcept(keep)` 统一释放咽喉；传输层挂钩 `lockRequestHandler`/`lockReleaseHandler`（步骤四接线，未设置时纯本地行为）
- 激活拦截（envStore `pureClickHandler` 四个命中分支）：命中他人锁定的对象视同点中空白（抽出的 `blankClickHandler` 闭包）；激活成功即乐观加锁；站名拖动的车站团转移时锁跟随转移
- 释放挂钩：`cancelActive`、删除路径（`delActivePt`/`delActiveTextTag`/丢弃区）、选区清空都汇入 `releaseStaleMyLocks`（保留集 = 激活 ∪ 选中）
- 多选（selectionStore）：brush/applyGroups 过滤被他人锁定的对象，进入选区即加锁、离开即释放
- 败方降级（`models/collab/lockApplier.ts` 的 `applyRemoteCollabLock`）：他人获得我激活/选中对象的锁时，**先把对象恢复为加锁时登记的快照**（`acquireMine(key, obj)` 深拷贝存于 collabLockStore，正常释放时随锁丢弃），再取消激活 + 移出选区。恢复后 save 与 undo 基线一致、下一次 diff 为空，半截改动零网络痕迹；对象已被删除时跳过恢复；无快照（兼容路径）时退回保留改动 + LWW 兜底
- 防御（`remoteOpApplier.dropStaleLocalHolds`）：远程 patch 删除本地激活对象 → 结束编辑+取消激活；删除选中对象 → 移出选区；指向已删除对象的他人锁 → 清理。激活对象被远程修改（未删除）时保留本地编辑（v1 策略）
- 红叉渲染（`cvs/workers/lockCvsWorker.ts`）：被他人锁定的对象在 active 图层画红色 ×（白边垫底；点按 ptSize 缩放，文本标签优先用渲染登记的包围盒、否则锚点固定大小，线取点质心）。画在 active 图层是因 Cvs.vue 的 50ms 重绘循环使锁变化无需触发主画布渲染；`noNeedActiveCvs` 已加入 `hasOtherLocks` 条件

## 步骤四：传输层

- 定义 WS 消息协议：hello（分配 id 前缀）、lock/unlock、op（SaveDiff 透传）等
- `collabStore` 已有前缀字段，接入服务器分发
- 后端按 `backend-plan.md` 做透传，不解析不保存
- **（阻塞上线）前缀复用问题**：同一前缀被重复分配且其旧负 id 仍在存档中时会撞号，须实现 id-allocation.md §7.1 的修复（服务器单调分配 + 客户端扫存档设 counter 种子兜底），**解决前不能上线**
- **服务端并发语义测试（必要，方案定为"纯逻辑类 + xUnit"）**：一致性根基在服务端新代码（锁仲裁 first-write-wins、前缀单调分配、断连清锁、房间内有全序），前端单测全部建立在"服务器说话算数"的假设上，必须钉住。实施方式：
  - 房间状态（锁表、前缀计数、成员表）放进**实例化**的 `CollabRoomManager`（DI 单例，测试每次 new 新实例获得隔离），Hub 只做鉴权+转发——避免重蹈 `ChatHub` 静态 `ConcurrentDictionary` 无法隔离的坑
  - 新建 `AARC.WebApi.Test` 项目（xUnit），用 `Task.WhenAll` 并发压测断言：锁竞争恰好一个胜者、前缀跨进出单调不复用（§7.1）、断连后其锁全部释放、op 按到达顺序出队
  - SignalR 全链路集成测试（TestServer+测试鉴权+EF InMemory）**降级为可选**：Hub 层是纯透传，逻辑薄，正确性由步骤五双浏览器 E2E 顺带验证

## 步骤五：收尾验证

- 负 id 在 `AARC.Diff` 侧的兼容性测试（若后端确认不透传不解析可降级）
- E2E：两个浏览器实例同开一份存档，互相拖动/增删，验证收敛与 undo 正确性
