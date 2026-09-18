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

细化结论（对账三份配套文档后）：

- **协议缺口**：`backend-plan.md` §7 原定协议只有 op 透传，缺 lock/unlock 消息与锁仲裁；`JoinRoom` 返回值缺 id 前缀与锁表快照（后进房者必须知道存量锁，否则红叉与激活拦截对存量锁失效）。传输层动工前先修订 `backend-plan.md`（4.1）
- **断连对锁是双向的**：服务器断连清锁 ⇒ 客户端重连后 `myLocks` 也已失效，重连流程须清空 `myLocks` 并重新评估本地激活/选中对象
- **core/web 解耦**：SignalR 连接实现属宿主职责（aarc-web，参照 `signalrStore.ts`）；aarc-core 只定义传输接口并消费事件，不直接依赖 `@microsoft/signalr`

子步骤：

- [x] 4.1 **协议定稿**：修订 `backend-plan.md` §5/§6/§7——新增 `AcquireLock`/`ReleaseLock`（房间锁内 first-write-wins 仲裁）、`LockAcquired`/`LockReleased` 事件、`JoinCollabRoomResult` 加 `IdPrefix` + 锁表快照、断连清锁并广播
- [x] 4.2 **后端实现**：按 `backend-plan.md` §12 实现步骤 + 锁扩展（房间锁表与仲裁、单调前缀计数器、`OnDisconnectedAsync` 清锁广播）+ 快照上传/下载 HTTP endpoint（§10 新成员初始化）。`dotnet build` 验证；新增 HTTP endpoint 后需跑 gen-ts-client 重新生成 TS 客户端
- [x] 4.3 **前缀复用兜底**：id-allocation.md §7.1——服务器前缀改**租约制**（进房分最小空闲前缀、离房/断连回收；耗尽条件变为"2047 个成员同时在房"，成员上限 10 人，实际不可达）；客户端进房扫存档设 counter 种子：`collabStore.scanCollabIdSeed`（前缀区间内已用最大值 + 1）+ `setIdPrefix` 种子参数 + 单测。注意：种子扫描须在 4.5 进房流程的"快照同步完成"闸门后调用
- [x] 4.4 **服务端并发语义测试**：协作核心已拆分为独立零依赖类库 `AARC.Collab`（Hub/Controller 胶水层留在 WebApi），测试项目 `AARC.Collab.Test`（xUnit，已加入 `AARC.slnx`）直接 new `CollabRoomManager` 实例获得隔离，33 个用例钉住：并发抢锁恰好一个胜者、并发进房前缀不双发、离房/断连回收前缀可复用、多连接用户最后连接离开才回收、断连清该连接全部锁、并发提交 Seq 恰好 1..N、队列顺序即 Seq 顺序、修剪 Gap 判定、房主继任、空房回收、快照仅房主可传/TTL 过期/覆盖
- [ ] 4.5 **前端传输层**：core 定义传输接口（join/leave/submitOp/acquireLock/releaseLock/requestSnapshot + 事件回调注册），aarc-web 侧新建 `collabSignalrStore` 实现并注入（连 `/collab`，自动重连模式参照 `signalrStore.ts`）。接线：进房 → `setIdPrefix`（含种子）+ 应用锁表快照 + 记录房主（`OwnerUserId`）；`ReceiveOp` → `applyRemoteSaveDiff`（同步期先缓冲）；`LockAcquired` → `applyRemoteCollabLock`（含败方降级）；`LockReleased` → `applyRemoteUnlock`；`UserLeft` → `clearLocksOfHolder`；`OwnerChanged` → 更新房主状态（我是新房主时启用保存入口并补发心跳）；`SnapshotRequested`（我是房主时）→ 序列化存档 + 记录已应用 Seq 水位 → POST `/collab/snapshot` 上传；设置 `lockRequestHandler`/`lockReleaseHandler` 两个挂钩；连接状态（在线/重连中/已断开）暴露给 UI 驱动断线蒙层（见 4.6）。**新客初始化**（backend-plan.md §10）：进房后缓冲 ReceiveOp → requestSnapshot → 轮询 GET 快照 → 以快照为底 + SyncOps(水位) + 缓冲按 Seq 去重重放；**同步完成前禁止本地编辑**（diff 基线未建立）
- [ ] 4.6 **本地 op 提交管线 + 保存权限**：捕获本地变更生成 SaveDiff → `SubmitOp`（返回值即 ack，携带 baseSeq）；维护 `lastSeq`，重连后 `JoinRoom` + `SyncOps` 增量补齐，`Gap=true` 走快照流程（§10，DB 底不可靠，不再是 HTTP 整档重载）；**断线处理**：本地维护未 ack op 待发队列——捕获本地变更生成 SaveDiff 后即入队，`SubmitOp` 拿到 Seq 才出队；断线期间提交失败的 op 留在队列，重连并补齐后按原序重新提交（视作全新提交、获得新 Seq，服务端按到达时序照常做锁仲裁），最大程度避免漏 patch；断线期间前端显示**断线蒙层**阻止继续操作（补齐后 diff 基线变动、本地锁已被服务器释放，继续编辑意义不大；SignalR 检测断连有延迟，蒙层出现前产生的编辑会自然落入待发队列，不会丢失）；重连后清 `myLocks` 并重设前缀种子；离房/关档走 `LeaveRoom` + `clearIdPrefix` + `clearAllLocks`。**保存责任人 = 房主**（backend-plan.md §8 已定稿）：协作者不发心跳、禁用保存入口（按钮/Ctrl+S），`UpdateDataAndDiff` 的心跳校验天然拒绝非房主保存，后端保存路径零改动
- [ ] 4.7 **验证**：`pnpm --filter aarc-core type-check`、`pnpm --filter aarc-web type-check`、core 单测（mock 传输接口）、`dotnet test AARC.Collab.Test`

已定稿（原"待明确"）：**持久化责任人 = 房主制**——第一个打开/加入存档的人才能保存，协作者只能把编辑实时传递给房主；房主离开由最早加入者继任（`OwnerChanged`）。详见 `backend-plan.md` §8。

待明确（不阻塞 4.1~4.4）：锁是否需心跳保活（当前设计锁随连接存活、断连即释放，大概率够用）

执行顺序：4.1 → 4.2 →（4.3、4.4 与 4.5/4.6 可并行）→ 4.7

## 步骤五：收尾验证

- 负 id 在 `AARC.Diff` 侧的兼容性测试（若后端确认不透传不解析可降级）
- E2E：两个浏览器实例同开一份存档，互相拖动/增删，验证收敛与 undo 正确性
