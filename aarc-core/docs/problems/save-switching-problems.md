# 存档切换的状态清理问题与去 reload 方案

> 2026-09 调查。回答一个问题：**能否去掉 `Editor.vue` 两处 `location.reload` 兜底，改为运行时切换存档？**
> 结论：目前**不能**——状态清理不完整，但问题已全部定位，修复集有限且明确。本文档记录完整问题清单与解决方案。

## 0. 背景

编辑器历史上靠刷新页面保证存档切换时状态全新：

- `aarc-web/src/pages/editors/Editor.vue:362-365`：`watch(props)`——saveId 变化（同一路由记录复用组件实例）即 `window.location.reload()`
- `aarc-web/src/pages/editors/Editor.vue:398-404`：`onBeforeMount` 检查 `useLoadedSave().loadedSave`（`aarc-web/src/models/stores/utils/loadedSave.ts`），已加载过别的存档即 reload
- `aarc-core/src/models/stores/utils/resetterStore.ts:17-22` 注释自述"加载前重置已废弃、改用 location.reload"

加载路径现状：`loadSaveIntoEditor()`（`aarc-core/src/app/editorSession.ts:39-61`）依次做：写 `saveStore.save` → `resetDerivedStores()`（清 12 个派生 store + staClusterStore 全量重建 + envStore 部分编辑态）→ `ensureLinesOrdered()` → 数据源自动更新 → `iconStore.ensureAllLoaded()` → undo 基线（`clear()+push()`）。**注意 `resetDerivedStores` 本身不是废弃逻辑，load/undo/stash 三条路径都在用，不能误删。**

切换存档有两条候选路径，问题面不同：

- **A. 组件重挂**：销毁并重新挂载 Cvs/Menu（web 由路由重建实例触发，或用 `:key` 强制）
- **B. 组件不重挂**：同一组件实例上直接换数据（tauri `aarc-tauri/docs/fs-save-manager.md` §3.4 的设想）——渲染管线的重启全部需要补做，问题最多

## 1. 已验证安全的部分（无需改动）

- `resetDerivedStores` 的 12 个 `clearItems`：formalizedLine、staNameRect、staNameMainRect、textTagRect、lineExtend、cvsBlocksControl、pointLink、iconStore.data、discardArea、nameEdit、textTagEdit、namePosMemory——清理正确
- `staClusterStore.restoreWithPatch(undefined)`：无 patch 时恒走 rebuild，`clearItems` 清 `staClusters`+`neighbors`（`staClusterStore.ts:159-162`），懒重建，无残留
- `undoStore.clear()+push()`（`editorSession.ts:58-59`）：正确重建 undo 基线
- `saveStore.save` 本体及全部 computed 字典：覆盖 + 惰性重算
- 纯 computed 派生 store（freePtDirection、lineState、lineTime、lineSpan、sliceResolver、bgRefImg）：无独立可变状态，天然安全（bgRefImg 的正确性依赖 config 被重读，见 §2.4）
- dispatcher 体系（mainCvs/baseCvs/activeCvs/miniatureCvsDispatcher）：canvas 引用每次渲染时按 DOM id 现取（`cvs.ts:17`），不缓存旧画布；回调在 setup 闭包只注册一次。组件重挂安全
- localStorage 持久化的用户级偏好（`aarc-core/src/app/localConfig/*`）、全局身份类 store（userInfo、uniqueComponents、kickedFromCanvas、enteredCanvasFrom、chatMsgsRead）：跨存档保留是设计意图
- `mainCvsDispatcher.visitorMode`：load 每次覆盖（`editorSession.ts:46`）

## 2. core 侧问题清单

### 2.1 画布空白且不自愈（阻断级，路径 B 必炸）

`resetDerivedStores()` 清空 `cvsBlocksControlStore.blocksControl`（`aarc-core/src/models/cvs/common/cvs.ts:158-160`）后，canvas DOM 被移除；但 `relaunchDerivedStores()`（refreshBlocks + ensureAllLoaded）只在 stash.thaw 和 undo.restoreState 路径调用，**load 路径不调**。`renderMainCvs`/`initContSizeStyle`/`readConfigFromSave` 全部只在 `Cvs.vue:41-61` 的 `onMounted` 里跑，没有任何 watch 在 save 变化时触发重渲染。

后果（组件不重挂时）：画布消失且不自愈；首次重绘走 `useCvs` 的 fallback 分支（`cvs.ts:26-27`）用错误的 block/画布尺寸；命中检测缓存清空后无人重建，点击全部落空。

**方案**：把渲染管线重启收口进 core——扩展 `relaunchDerivedStores()`（refreshBlocks + 首帧 `renderMainCvs` + `initContSizeStyle` + 重置 Scaler 缓存），并在 `loadSaveIntoEditor` 末尾调用。

### 2.2 Scaler 尺寸缓存不重置（阻断级，路径 B 必炸）

`arenaHWCache`（`aarc-core/src/models/cvs/common/scaler.ts:277-285`）与 cvsCont 尺寸样式（`cvsFrameStore.ts:135-144` 的 `initContSizeStyle`，内含 `disposeArenaHWCache`）只在 Cvs onMounted 执行。新存档画布尺寸不同时，cvsCont style 宽高保持旧值，缩放/平移/`getArenaHW` 全按旧宽高比算，坐标变换整体错误。

**方案**：并入 §2.1 的重启流程。

### 2.3 事件处理重复注册（路径 A 的坑）

- `cvsFrameStore.initScaler`（`cvsFrameStore.ts:17-31`）：每次调用都**无去重地** push `viewScaleHandlers`/`viewMoveHandlers` 并 new 一个 Scaler，旧的从不 dispose（`blocksControlInit` 有 once 守卫，`initScaler` 没有）
- `envStore.init()`（`envStore.ts:84-97`）：每次调用重复 `listenPureClick` + 4 个 `addEventListener`，无幂等守卫

后果：走"重挂兜底"路线时，每挂一次多一份监听器，缩放/点击随切换次数线性叠加（有 50ms 节流兜底，低害但确定泄漏）。

**方案**：给 `initScaler`/`envStore.init` 加幂等守卫或 dispose 对称逻辑。

### 2.4 configStore 不重读档（数据级串台，两条路径都中招）

`config` 存在 `save.config` 里，但 `readConfigFromSave` 的唯一调用点是 `Cvs.vue:52` onMounted，**不在 `loadSaveIntoEditor` 里**。切换后：

1. B 以 A 的 bgColor/线宽映射/吸附参数/拼音表渲染
2. **更严重**：切换后第一次保存 B 时，`prepareSavePayload → writeConfigToSave`（`configStore.ts:113-118`，由 `editorSession.ts:75` 调用）把 **A 的整套 config 覆盖写进 B 的存档数据**——数据损坏，不是显示问题

**方案**：`loadSaveIntoEditor` 内、`saveStore.save` 赋值后立即调 `configStore.readConfigFromSave()`。

### 2.5 selectionStore.selected 残留旧对象引用

`Set<ControlPoint|TextTag>`（`selectionStore.ts:15`）持有 A 的对象引用，reset 路径不清（`endEveryEditing → disableForTouchScreen` 不涉及）。后果：

- 选中徽标残留（`Cvs.vue:110-117`），`insnif` 被错误置真（`Cvs.vue:89`）
- `activeCvsDispatcher.noNeedActiveCvs`（`activeCvsDispatcher.ts:51-54`）因 `selected.size>0` 持续渲染，`renderSelection` 把**旧存档的点画到新画布**
- 后续 brush 把 B 的元素加进混有 A 对象的 Set；拖动提交还会 mutate 旧对象

**方案**：`resetDerivedStores` 增加 `selectionStore.selected.clear()`（连带复位 mode/showControl 等）。

### 2.6 渲染/缓存灰区（闭包非响应式状态，不在任何 clearItems 范围）

- `formalizedLineStore.localFormalSegs`（`formalizedLineStore.ts:28`）：闭包变量，`clearItems` 只清 kv Map。切换前若有 active 点渲染过（`lineCvsWorker.ts:451` 写入），新存档同 lineId 时 `findAdjacentFormalPts`（被 `terrainSmoothCvsWorker.ts:117` 使用）命中**旧存档坐标**
- `clusterCvsWorker.clusterPolyCache`（`clusterCvsWorker.ts:31`）：跨存档永不清理；缓存 key（`:322-325`）只含 id/pos/dir/size，**不含 free 拓扑信息**——两存档几何相同但拓扑不同的 free cluster 直接返回旧多边形。Map 无上限，长期缓慢涨内存
- `saveStore.prevLinePtsSnapshots`（`saveStore.ts:665-694`）：跨存档闭包 Map，切换后拿 A 的快照对比 B 的线路产生伪 `changedLineIds` → 伪触发 `removeInvalidSlices`（`sliceResolverStore.ts:18-21`）。正常数据下不会误删，但应显式清空

**方案**：三者纳入 `resetDerivedStores` 清理名单（localFormalSegs 置 null、clusterPolyCache clear、prevLinePtsSnapshots clear）。

### 2.7 其余 store 级残留

| 状态 | 位置 | 后果 | 方案 |
|---|---|---|---|
| `stashStore.s`（A 的完整存档深拷贝） | `stashStore.ts:14` | 切到 B 后 `thaw()` 把 A 的暂存盖到 B 头上 | 切换时清空或按存档隔离 |
| ~~`iconStore.accessBlocked`~~ | 已修复（2026-09）：屏蔽状态迁到 `models/stores/utils/resourceAccessStore.ts`，三个资源栏目各一 ref（值为宿主传入的提示文案，有值即屏蔽），`loadSaveIntoEditor` 每次装载无条件赋值 | 原问题"从浏览模式存档切到自有存档，图标栏仍隐藏"已消除 | 无需再处理 |
| `renderOptionsStore.accentuationLineIds / timeMoment / timeMomentStr` | `renderOptionsStore.ts:10-15` | 按 A 的 lineId/时间轴作用于 B 的同 id 线路（`lineStateStore.ts:42-98` 直接作用于主画布渲染） | reset 存档相关字段 |
| `snapStore.snapLines / snapInterPtTargets` | `snapStore.ts:28,51` | activeCvs 的 50ms 渲染定时器跨切换仍在跑（`Cvs.vue:56-58`），把 A 的吸附辅助线画到 B 上，直到下次交互 | reset |
| nameEdit/textTagEdit 编辑中暂存 | `resetterStore.ts:44-51` | 当前靠"clearItems 先跑、targetPtId 先被清掉"的**隐式顺序**才安全——若顺序变动，`applyName` 会按旧 targetPtId 在 B 里查点覆写名字（`nameEditStore.ts:64-76`）。且切换时 A 未完成的命名被静默丢弃 | 显式化顺序依赖（reset 前先 endEveryEditing）；文档化 |

低害残留（可不处理）：opsStore.atAvoidWays、envStore 零散字段（activePtType/cursorDir 等）、iconStore.prefixSelected（有 `ensurePrefixSelectedValid` 兜底）、onDetectStore.lastClickedLocked\*、preventLeavingUnsaved 脏标记（见 §3.3）、`pureClick` 模块级瞬时输入态、colorProc 纯函数缓存、各 worker 的每帧重算缓存、Menu 组件 pending 计时器（同 id 碰撞时才可能打错目标，低害）。

## 3. web 侧问题清单（Editor.vue 及宿主 store）

### 3.1 路由与组件复用事实

- 编辑器只有一条路由记录 `/Editor/:saveId`，`props: true`，无 `:key`（`aarc-web/src/pages/editors/routes/routesInit.ts:12-17`）；`App.vue:48` 的 `<RouterView>` 也无 key
- **复用场景**（实例不销毁，`watch(props)` 触发 reload）：地址栏手改 saveId、历史前进/后退；demo↔数字 id 互跳也走同一记录。tauri 存档管理器的"点击加载"将 100% 走复用路径
- **重建场景**（`onBeforeMount` 触发 reload）：编辑器 → 其他页 → 再进编辑器。实例销毁重建但 pinia store 全部存活
- **便宜的备选**：给 `<RouterView :key="$route.fullPath">` 加 key，把复用场景退化成重建场景，只需处理重建场景的清理，工作量减半

### 3.2 实例复用时必须手工复位的状态

复用时 `onBeforeUnmount`（`Editor.vue:414-430`）整段不执行。逐项：

| 状态 | 位置 | 后果 | 严重度 |
|---|---|---|---|
| `heartbeatTimer` + `heartbeatOnEdit` | :303, :339, :346 | load()→startHeartbeat 再开 interval **覆盖** timer 引用，旧 interval 永久泄漏；且 `renewHeartbeat` 用 `saveIdNum`（:310），B 为 viewOnly 时旧 interval 持续给 B 发心跳，服务端视角是"幽灵编辑者"；`heartbeatOnEdit` 的 `??=` 只赋值一次 | **严重** |
| 心跳释放用的 saveId | :418 | A 的心跳从不释放（且此处读的是当前 prop，补做时必须用 watch 回调的 oldValue） | **严重** |
| SignalR / ChatRoom | :69, :183 | ChatRoom 无 `:key` 被复用，其 onUnmounted（`ChatRoom.vue:291-307`：leaveRoom+stopConnection+clearMessages）不跑 → 不退 A 房间就加入 B 房间，服务端房间成员与 joinedRooms 同时残留 | **严重**（给 `<ChatRoom :key="saveIdNum">` 一行可解） |
| `viewOnly` | :76, :134 | 只置 true 不置 false，A 是 viewOnly 则 B 永远 visitorMode、屏蔽资源栏目（图标/数据源/上传，现已随 load 无条件赋值故不受影响）、不启动心跳 | **严重** |
| `loadError` / `loadComplete` | :77, :72 | 残留则全屏错误页挡住 B / Cvs 在 B 加载完成前挂着 A 的数据 | **严重** |
| `savingDisabledWarningStore` | `savingDisabledWarningStore.ts:22-28` | `clearWarning()` 已存在但**全项目无人调用**；B 加载失败提前 return 时永久显示 A 的警告文案 | 中 |
| `preventLeavingDisabled` | :171, :192, :280 | 只置 true，**全项目无任何复位点**；viewOnly/demo/未登录会话之后，可编辑存档静默失去未保存离开保护。**两个场景都中招且无 UI 表现，最易漏** | 中 |
| `notLogin`、`saveStatus`、`showHiddenLongWarn`、`showHeartbeatFailWarn`、`heartbeatStolenWarn`、`ownerUserInfo` | :272, :81, :393, :305-306, :78 | 残留旧提示/旧弹窗/旧值 | 轻 |
| `heartbeatStatusStore.lastSuccessAt` | `app/globalStores/heartbeatStatus.ts` | 无清方法；startHeartbeat 会 markSuccess 覆盖，B 为 viewOnly 时残留无影响 | 轻（可新增 reset 方法） |
| `lastSavedTime` | :212 | 可能误报一次"保存过于频繁" | 极轻 |

安全无需处理：ShortcutListener×4（回调读 live store/computed）、cachePreventer、hiddenLongWatcher、visibilitychange 监听（同函数引用去重）、`setLeavingPreventing` 注册的回调（mainCvsDispatcher 是单个 shallowRef 槽，重复注册即覆盖）、`watch(()=>props.saveId, setCurrentSaveIdRaw)`（带 immediate 自动同步）、topbarShow。

### 3.3 web 侧 store 处置一览

必须 reset：`savingDisabledWarningStore`（clearWarning）、`preventLeavingDisabled`（复位 false）、SignalR（leaveRoom/stopConnection+clearMessages，或用 `:key` 借 onUnmounted 自动完成）。
不需要 reset：`useKickedFromCanvasStore`、`useEnteredCanvasFromStore`、`useUserInfoStore`、`useUniqueComponentsStore`、`useApiStore`、`useChatMsgsReadStore`（均按 saveId 索引或全局语义）。
可删除：`useLoadedSave`（去掉 reload 后失去存在意义，仅 Editor.vue:71,118,401 三处引用）。

### 3.4 一个意外的利好

`preventLeavingUnsaved` 的路由守卫（`preventLeavingUnsaved.ts:31-34`）会拦截 A→B 的 param 导航，迫使先保存/放弃——**切换入口天然经过 unsaved 检查**，去掉 reload 后这个保护依然有效。

## 4. 解决方案汇总（去 reload 实施清单）

### 第一步：core 侧（aarc-core）

1. `loadSaveIntoEditor`（`editorSession.ts`）：
   - `saveStore.save` 赋值后立即 `configStore.readConfigFromSave()`
   - ✅ 已做（2026-09）：屏蔽状态迁至 `resourceAccessStore` 并在 `loadSaveIntoEditor` 开头无条件赋值（三个栏目分别对应 opts 的 `iconAccessNotice`/`dataSourcesAccessNotice`/`uploadAccessNotice`，值即给用户看的文案）
   - 末尾调用扩展后的 `relaunchDerivedStores()`
2. `resetDerivedStores`（`resetterStore.ts`）清理名单增加：
   - `selectionStore.selected.clear()`（连带 mode/showControl）
   - `formalizedLineStore.localFormalSegs = null`（需暴露清理方法）
   - `clusterCvsWorker.clusterPolyCache.clear()`（需暴露清理方法）
   - `saveStore.prevLinePtsSnapshots.clear()`
   - `stashStore` 清空（或按存档隔离）
   - `renderOptionsStore` 的 accentuationLineIds/timeMoment/timeMomentStr
   - `snapStore` 的 snapLines/snapInterPtTargets
   - 顺序显式化：先 `envStore.endEveryEditing()` 再 clearItems，避免 §2.7 的隐式顺序依赖
3. 扩展 `relaunchDerivedStores()`：refreshBlocks + 首帧 renderMainCvs + `initContSizeStyle`（含 `disposeArenaHWCache`）
4. `cvsFrameStore.initScaler` 与 `envStore.init` 加幂等守卫（重挂路径必需）
5. 更新 `resetterStore.ts:17-22` 的过时注释

### 第二步：web 侧（aarc-web）

1. 收敛成统一路径：新写一个 `teardownEditorSession()`（~30 行）做"停心跳 → 用旧 saveId 释放心跳 → SignalR 退房 → 复位实例 ref 和 store"，`watch(() => props.saveId)` 里走 "teardown → load"，`onBeforeMount` 保持只负责首次启动
2. 复位清单见 §3.2 表格（重点：`viewOnly`/`loadError`/`loadComplete`/`heartbeatOnEdit=undefined`/`savingDisabledWarningStore.clearWarning()`/`preventLeavingDisabled=false`）
3. 给 `<ChatRoom :key="saveIdNum">` 加 key（借其 onUnmounted 自动完成 SignalR 清理）；或更进一步给 `<RouterView :key="$route.fullPath">` 加 key，把复用场景退化为重建场景
4. 删除两处 reload 与 `useLoadedSave` store（loadedSave.ts + Editor.vue:71,118,401 三处引用）
5. `heartbeatStatusStore` 可新增 lastSuccessAt 归零方法（轻，可选）

### 第三步：验证

- 两包 type-check + core 测试
- 手动回归矩阵：数字存档→数字存档、数字→demo、demo→数字、viewOnly→可编辑、可编辑→viewOnly（重点核对心跳释放/资源栏目屏蔽/未保存保护）、未保存改动时切换被路由守卫拦截、切换后保存 B 检查 config 未被 A 污染、tauri 存档管理器点击加载

## 5. 工作量评估

- core 侧：约半天（问题已全部定位，无排查成本）
- web 侧：半小时到一天（取决于是否用 `:key` 方案）
- 过渡方案：可以先只修 core 侧，web 保留 reload 兜底；但注意 **config 串台（§2.4）在保留 reload 的 web 端不会触发，而 tauri 端没有 reload 兜底**——tauri 做存档切换前 §2 全部必须修完

## 6. tauri 侧现状（2026-09-07 追加）

`aarc-tauri` 的存档管理器（`aarc-tauri/docs/fs-save-manager.md`）曾按路径 B 实现运行时切换（`disposeEditor` + `loadSaveIntoEditor` 重载 + 调 `Cvs` 暴露的 `init()` 重渲染），实测画布空白，且 `init()` 无法覆盖 §2.4/§2.5/§2.6 等数据级缺陷。现**已改回与 web 一致的彻底 reload**：切换存档 = 写目标 id 到 localStorage 键 `aarc-tauri-current-save` + `window.location.reload()`（`aarc-tauri/src/components/Editor.vue` 的 `switchSave`）。§4 修复集落地后，tauri 可同步去掉 reload。
