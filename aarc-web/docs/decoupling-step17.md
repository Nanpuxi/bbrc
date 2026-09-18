# 第 17 步细化：CoreHostServices 收口与编辑器会话入口

本文是 `decoupling.md` 第 17 步（阶段 5：接口化与 tauri）的实施细化，基于 2026-09 对当前代码的逐点调查。约束与总方案一致：**每个子步完成后都应能构建、通过 `pnpm type-check` 和 `pnpm test:run`，不改变运行时行为**。

第 17 步原文提出三件事，本文对应三个工作包：

- **A. DTO 投影编译期断言**（web 侧 `apiGenerated.ts` ↔ core `apiShapes.ts`）——最小、独立，先做
- **B. `CoreHostServices` 聚合注入入口**——把散落的 `init*` 注册收口为一次性装配
- **C. 编辑器会话入口**（`loadSaveIntoEditor()` / `disposeEditor()` 等）——把 `Editor.vue` 对 core 内部时序的依赖收进 core

---

## 1. 现状盘点（调查结论）

### 1.1 已有注入接口（工作包 B 的收口对象）

| core 入口 | 定义位置 | 宿主注册点 |
|---|---|---|
| `uniqueComponents.initCallbacks({popCallback, waitCallback})` | `app/globalStores/uniqueComponents.ts:11` | `App.vue:26-33` |
| `initCloudSvgUploader(uploader)` | `models/save/cloudSvgOps.ts:8` | `App.vue:34-37` |
| `initPinyinConvertProvider(provider)` | `components/composables/usePinyinConvert.ts:11` | `App.vue:38` |
| `initSaveInfoProvider(provider)` | `components/sidebars/export/composables/useImageExport.ts:15` | `App.vue:39` |
| `initSiteLinks({about, forkAarc})` | `app/siteLinks.ts:9` | `App.vue:40-43` |
| `initRouteGuardRegistrar(registrar)` | `utils/eventUtils/preventLeavingUnsaved.ts:9` | `Editor.vue:60` |
| `setCurrentSaveIdRaw(id)` | `models/save/currentSaveId.ts:8` | `Editor.vue:57` |
| `mainCvsDispatcher.initAfterMainCvsRendered(cb?)` | `models/cvs/dispatchers/mainCvsDispatcher.ts:70` | `Editor.vue:321` 注册、`:451` 注销 |
| `userFileFavoriteStore.initOpenFavoritesSidebar(cb)` | `models/stores/utils/userFileFavoriteStore.ts:9` | `UserFileFavorites.vue:37` |

不在收口范围内的两类：

- **双向回调的另一方向** `onFavoriteFileSelected`（core 的 `iconStore.ts:168` 赋值、宿主调用）：方向是 core→host UI 事件，不属于"宿主服务"，不塞进 `CoreHostServices`。
- **pinia/persist 装配、全局样式、环境变量、静态资源**：属构建期/运行时环境契约（见 `aarc-core/README.md` 三、四节），不是函数注入，继续保持文档契约。

### 1.2 `Editor.vue` 装配面（工作包 C 的收口对象）

宿主目前直接 import 并操作 core 的 9 个 store/dispatcher：`saveStore`、`envStore`、`configStore`、`iconStore`、`undoStore`、`resetterStore`、`mainCvsDispatcher`、`miniatureCvsDispatcher`、`preventLeavingUnsavedStore`。其中**需要知晓 core 内部时序**的调用点：

**加载时序**（`Editor.vue:167-211`，数字存档与 demo 两条路径同构）：

```
saveStore.save = normalizeSave(obj)        // 直接写 store 字段
resetterStore.resetDerivedStores()         // 清空 12 个派生 store + envStore 编辑态
saveStore.ensureLinesOrdered()
await autoUpdateDataSources(saveStore.save, saveStore.getNewId, {...})
await iconStore.ensureAllLoaded()
loadComplete.value = true                  // 之后才挂载 Cvs/Menu
// 随后：
mainCvsDispatcher.visitorMode = viewOnly || notOwner
useIconStore().accessBlocked = true        // 仅浏览且非所有者时
undoStore.clear(); undoStore.push(saveStore.save)
```

**保存时序**（`Editor.vue:235-298`）：

```
configStore.writeConfigToSave()            // 配置写回存档
saveStore.save?.points.forEach(pt => pt.nameP && coordRound(pt.nameP))  // 站名坐标截断
compressObjectToGzip / JSON.stringify      // web 侧压缩与 HTTP 上传（留 web）
// 成功后：
miniatureCvsDispatcher.renderMiniatureCvs({sideLength:256, lineWidth:2}) → blob → api 上传
renderAndUploadCloudSvg(saveId)            // core 内已封装（渲染+注入的 uploader）
```

**编辑回调**（`Editor.vue:321-329`）：`afterMainCvsRendered` 回调体内做"首次编辑警告 + `preventLeaving()` + 编辑心跳 + `undoStore.push(saveStore.save)`"——前三项是 web 业务（留宿主），`undoStore.push` 属 core 时序（候选收进 core）。

**快捷键**（`Editor.vue:396-419`）：Delete 调 `envStore.delActivePt(true,true)` / `delActiveTextTag(true)`，Ctrl+Z / Ctrl+Shift+Z 调 `undoStore.undo()/redo()`——原子 action 调用，无时序问题，可原样留宿主。

**卸载**（`Editor.vue:443-459`）：core 相关仅 `initAfterMainCvsRendered(undefined)` 一处，其余（心跳释放、快捷键 dispose、topbar）是 web 职责。

**注意**：`resetterStore.ts:17-22` 注释自述"加载前重置已废弃、改用 `location.reload` 保证状态全新"（见 `loadedSave.ts` 与 `Editor.vue:430-433`）——但加载路径仍在 `save` 赋值后调用 `resetDerivedStores()`，语义是"新数据填充后重建派生态"，session 化时必须保留该调用，不要误删。

### 1.3 apiGenerated ↔ apiShapes 投影接点（工作包 A 的断言对象）

core 的 `models/types/apiShapes.ts` 是 web 侧 `apiGenerated.ts`（NSwag 生成）的字段子集投影，兼容性目前**只靠注入点赋值隐式验证**。三个接点：

| 接点 | 方向 | 涉及类型 |
|---|---|---|
| `App.vue:39` `initSaveInfoProvider(saveId => api.save.loadInfo(saveId))` | 生成 → core | `SaveDto`（core 只用 `name`） |
| `UserFileFavorites.vue:45` `onFavoriteFileSelected(file)` | 生成 → core | `UserFileDto`（core 只用 `displayName`/`urlOriginal`） |
| `App.vue:38` `initPinyinConvertProvider(req => api.saveUtils.pinyinConvert(req))` | core → 生成 | `PinyinConvertRequest`（core 构造的请求必须能传给生成的 client）+ `PinyinConvertOptions`/`PinyinCaseType`/`PinyinVariantType` |

风险：后端 DTO 删改 core **未使用**的字段时零告警（正确，正是投影的意义）；但若 core 使用的字段被删改，目前依赖注入点恰好走到才报错——`onFavoriteFileSelected` 的赋值经 ref 间接传递，报错位置不直观。显式断言可把全部漂移集中到一处、在 type-check 时即暴露。

---

## 2. 目标形态设计

### 2.1 工作包 A：DTO 投影断言 ✅ 已完成（2026-09，步骤 1）

web 侧新增 `src/app/com/apiShapesAssert.ts`（纯类型文件，无运行时代码）。⚠️ 实际实现与原设想的 `const` 赋值式不同——web 的 tsconfig 开了 `noUnusedLocals`，未使用的 const 会报错，故改用**导出的类型别名 + 泛型约束**：

```ts
type AssertAssignableTo<Target, Source extends Target> = Source

export type SaveDtoAssert = AssertAssignableTo<CoreSaveDto, GenSaveDto>              // 生成 ⊇ core 投影
export type UserFileDtoAssert = AssertAssignableTo<CoreUserFileDto, GenUserFileDto>
export type PinyinConvertRequestAssert = AssertAssignableTo<GenPinyinConvertRequest, CorePinyinConvertRequest>  // core 投影 ⊆ 生成
```

- 不被任何模块 import 也可被 vue-tsc 检查到（include 整个 src）；实际已按设想由 `apiStore.ts:6` `import "./apiShapesAssert"` 显式引入。
- 数值 enum 的双向兼容（`PinyinCaseType` 等）靠 TS number 互赋规则，无需断言；若未来改成 string enum 会在上述约束处报错，符合预期。
- 已做负向验证：故意声明错误形状（`name?: number`）可在 type-check 报 TS2344、错误定位在断言处。注意反方向"窄投影赋给宽生成类型"不构成有效断言——两侧字段全可选时互相天然可赋。

### 2.2 工作包 B：CoreHostServices 聚合入口

core 新建 `src/app/hostServices.ts`：

```ts
export interface CoreHostServices {
    pop: PopCallback                  // 复用 uniqueComponents 既有类型
    wait: WaitCallback
    cloudSvgUploader?: CloudSvgUploader  // 可选（2026-09 改）：不注入则"云端SVG"配置区隐藏
    pinyinConvert?: PinyinConvertProvider  // 可选（2026-09 改）：不注入则转换按钮与配置区隐藏
    saveInfo?: SaveInfoProvider         // 可选（2026-09 改）：不注入则导出文件名退化为存档id
    siteLinks?: SiteLinks             // 可选：不注入则链接隐藏（现状语义）
    routeGuardRegistrar?: RouteGuardRegistrar  // 可选：无路由的宿主（tauri 初期）不注入
}
export function initCoreHostServices(services: CoreHostServices): void
```

裁决：**`initCoreHostServices` 内部依次调用既有各 `init*`，旧入口全部保留**。理由：

- 各 `init*` 已被 README 文档化、被 `UserFileFavorites.vue`/`Editor.vue` 分散调用，全部替换收益小、diff 大
- 聚合入口的价值在于"新增宿主（tauri）时有一个完整的 checklist 类型"，而不是消灭旧入口
- `setCurrentSaveIdRaw`、`initAfterMainCvsRendered`、`initOpenFavoritesSidebar` 是**编辑器会话期**接线而非应用启动期服务，不进 `CoreHostServices`，随工作包 C 处置

web 侧 `App.vue` 的 5 处 `init*` 改为一次 `initCoreHostServices({...})`；`Editor.vue` 的 `initRouteGuardRegistrar` 视裁决也可并入（但它依赖 `router` 且在 Editor 作用域，建议留 Editor.vue 或传入聚合——取前者，保持现状）。

### 2.3 工作包 C：编辑器会话入口

core 新建 `src/app/editorSession.ts`，把 §1.2 的时序收进 core：

```ts
export interface LoadSaveOptions {
    visitorMode: boolean        // 由宿主据 preflight/所有权判定
    blockIconAccess?: boolean   // 浏览模式且非所有者（现 iconStore.accessBlocked）
    onDataSourceEvent?: {...}   // autoUpdateDataSources 的 onLoad/onDone/onError 日志回调
}
/** 把存档数据装入编辑器：normalize → 写入 store → 重建派生态 → 数据源更新 → 图标加载 → undo 初始化 */
export async function loadSaveIntoEditor(raw: unknown, opts: LoadSaveOptions): Promise<void>
/** 保存前的 core 侧处理：配置写回 + 站名坐标截断，返回可序列化的 Save */
export function prepareSavePayload(): Save | undefined
/** 卸载：注销渲染回调等 core 侧清理 */
export function disposeEditor(): void
```

- `loadSaveIntoEditor` 内部严格按 §1.2 加载时序执行；`undoStore.clear()` + `push` 并入其中（消掉 `Editor.vue:208-211`）。
- `afterMainCvsRendered` 回调体内的 `undoStore.push`（`Editor.vue:327-328`）是否收进 core：**收进**——core 在 `notifyMainCvsRendered` 里先 push undo 再调宿主回调，宿主回调只剩"警告 + preventLeaving + 心跳"纯 web 业务。⚠️ 这会改变"undo 入栈"与"宿主回调"的相对顺序（现 push 在回调内最后），需确认 `preventLeaving` 等不依赖该顺序——调查结论：回调内四项互相独立，顺序无关。
- **留在宿主不进 core**的：preflight/权限判定、心跳全套（`renewHeartbeat`/`startHeartbeat`/`endHeartbeat`）、SignalR/聊天、`compressObjectToGzip` 与 HTTP 上传、缩略图上传（core 只负责渲染出 blob，已满足）、demo 模式的数据来源（web 的 `devSave`，宿主把解析后的 raw 传给 `loadSaveIntoEditor` 即可，两条加载路径合一）。
- `mainCvsDispatcher.visitorMode` 由 `LoadSaveOptions` 传入，宿主不再直写 dispatcher 字段。
- 完成后 `Editor.vue` 对 core store 的直接操作应收缩到：`preventLeavingUnsavedStore`（弹窗接线）、`undoStore.undo/redo`（快捷键）、`envStore.delActivePt/delActiveTextTag`（快捷键）——均为原子 action，无时序耦合。

---

## 3. 实施步骤

每步独立提交，完成后跑：`pnpm --filter aarc-core type-check && pnpm --filter aarc-web type-check && pnpm --filter aarc-core test:run && pnpm --filter aarc-web build-here`。

1. ✅ 已完成（2026-09）**A：投影断言**。新增 `aarc-web/src/app/com/apiShapesAssert.ts`，`apiStore.ts` 引入。纯类型，零行为变化。（实现采用导出类型别名而非 const 赋值，原因与负向验证结论见 §2.1。）
2. ✅ 已完成（2026-09）**B1：聚合入口**。core 新增 `app/hostServices.ts`（聚合调用既有 `init*`）；`aarc-core/README.md` "回调注入接口"一节顶部补一行指向聚合入口。（实现与 §2.2 设计一致，`siteLinks`/`routeGuardRegistrar` 为可选注入。）
3. ✅ 已完成（2026-09）**B2：web 切换**。`App.vue:23-40` 改为一次 `initCoreHostServices`（路由守卫仍留 `Editor.vue:60` 单独注册）；`aarc-core/README.md` 表格 web 实现列已同步。手动回归项（弹窗/等待、svg 云上传、导出图片、拼音转换、站点链接）待部署环境核对；已完成验证：两包 type-check、core 测试 701 通过、`build-here`、dev 服务器下 `App.vue` 与 `hostServices.ts` 正常转换加载。
4. ✅ 已完成（2026-09）**C1：`loadSaveIntoEditor`**。core 新增 `app/editorSession.ts`（visitorMode → normalize → 写 store → `resetDerivedStores` → `ensureLinesOrdered` → 数据源自动更新 → 图标加载 → accessBlocked → undo 基线，顺序按 §1.2 两条路径的并集，渲染均在 `loadComplete` 后发生故等价）；`Editor.vue` 两条加载路径改为传 raw + opts，undo 初始化并入 core，宿主不再直写 `mainCvsDispatcher.visitorMode`/`iconStore.accessBlocked`。原 `runAutoUpdateDataSources` 的 count 起始日志随封装移除（逐条 onLoad/onDone/onError 日志保留，作为宿主传入的 `onDataSourceEvent` 回调）。手动回归项（编辑器打开：数字存档 + demo、浏览模式：visitorMode/图标栏目隐藏、undo 从初始状态可用）待部署环境核对；已完成验证：两包 type-check、core 测试 701 通过、`build-here`。
5. ✅ 已完成（2026-09）**C2：undo push 内移 + `disposeEditor`**。`mainCvsDispatcher.notifyMainCvsRendered` 内先 `undoStore.push(saveStore.save)` 再调宿主回调；`Editor.vue` 的 `afterMainCvsRendered` 回调删去 push（只剩"首次编辑警告 + preventLeaving + 编辑心跳"纯 web 业务）。core 的 `app/editorSession.ts` 新增 `disposeEditor()`（注销渲染回调），`Editor.vue` 卸载处改为调用它。顺序变化复核：回调内各项与 undo 入栈互相独立，且注册（onBeforeMount）早于任何渲染、卸载后不再渲染，undo push 改为"无论回调是否注册都执行"在实践中等价。手动回归项（编辑→阻止离开→保存→解除；undo/redo）待部署环境核对；已完成验证：两包 type-check、core 测试 701 通过、`build-here`。
6. ✅ 已完成（2026-09）**C3：`prepareSavePayload`**。core 的 `app/editorSession.ts` 新增 `prepareSavePayload(): Save | undefined`（`configStore.writeConfigToSave()` + 站名坐标 `coordRound` 截断，返回可序列化的 Save）；`Editor.vue` 保存流程改为调用它，压缩/明文两条上传路径与 DEV 日志均改用返回的 payload，`configStore`/`coordRound` 的直接 import 移除。顺序微调：站名截断从 staCount/lineCount 统计之后提前到之前（两者是数量统计，不受坐标截断影响，等价）；`writeConfigToSave` 位置不变（仍在"demo 不可保存"判断之前）。手动回归项（保存：含压缩与明文两条路径、自动站名位置保存后小数截断）待部署环境核对；已完成验证：两包 type-check、core 测试 701 通过、`build-here`。
7. ✅ 已完成（2026-09）**收尾文档**。`aarc-core/README.md` "编辑器宿主组件"行已改为会话 API 契约（`loadSaveIntoEditor`/`prepareSavePayload`/`disposeEditor`），"主画布渲染完成回调"行同步（undo 入栈收进 core、注销经 `disposeEditor`），相关行号引用已更新；`decoupling.md` 第 17 步标记完成并补落地结果、§3.2 清单同步。根 `AGENTS.md` 装配命令无变化，未改动。

## 4. 风险与注意

- **别把 web 业务搬进 core**：心跳、权限、SignalR、HTTP 压缩上传是宿主职责，session API 只收"数据进/出 core"的时序。判断标准：tauri 宿主仍需自己实现的，留宿主。
- **`resetDerivedStores` 不是废弃逻辑**（§1.2 注释警告），session 化必须原样保留调用位置。
- **undo 时序**：`undoStore.push` 首次调用即 `initUndo`（`undoStore.ts:25-31`），`clear()` 后必须紧跟 `push` 重建基线，别把两步拆到不同生命周期。
- **顺序变化审查**（步骤 C2）：undo 入栈从"宿主回调内"移到"回调前"，需确认 `preventLeaving`、心跳、`savingDisabledWarningStore` 均不依赖原顺序。
- 本工作包全部完成后，`Editor.vue` 仍是宿主（心跳/聊天/快捷键/弹窗装配仍在），只是不再知晓 core 内部时序——不追求"Editor.vue 零 core import"。
