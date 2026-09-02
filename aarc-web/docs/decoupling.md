# aarc-core / aarc-web 拆分方案

本文分析把编辑器核心（`Cvs.vue` + `Menu.vue` 及其依赖闭包）拆分为独立包 `aarc-core`、剩余部分改名 `aarc-web`、共同置于 pnpm-workspace 下的实施步骤与主要阻碍。约束：**不改变任何运行时行为**；目标：未来新增 `aarc-tauri`，为 `aarc-core` 提供本地文件访问能力。

分析基于 `aarc-web/analyze-deps.mjs` 生成的依赖闭包 `temp.txt`，以及对闭包外文件的反向依赖扫描（2026-02 时点）。

注意：此处修改方案后，必须检查是否需要同步修改 `aarc-core/README.md`

---

## 1. 现状量化

### 1.1 依赖闭包

从 `src/components/Cvs.vue`、`src/components/Menu.vue` 出发递归解析全部 import（含 `@/` 别名、动态 `import()`），闭包共 **324 个文件**（初次分析时为 330，后经 §3.1/§3.4 的去耦改造收缩；2026-09 saveId/路由守卫/站点链接注入化后再减 1），无未解析的相对/别名 import——即闭包在静态 import 层面是自洽的，这是拆分的有利条件。

### 1.2 反向依赖（闭包外 → 闭包内）

闭包内共 **84 个文件被闭包外引用**（2026-02 重扫；初次分析为 85，`apiStore.ts`、`apiGenerated.ts`、`enteredCanvasFrom.ts` 已经改造退出闭包，见 §3.1/§3.4）。热点如下（括号内为外部引用方数量）：

| 闭包内文件 | 外部引用方数 | 性质 |
|---|---|---|
| `models/save.ts` | 32 | 存档数据模型（纯类型+常量） |
| `app/globalStores/uniqueComponents.ts` | 31 | 全局 Pop/Wait 回调总线 |
| `models/coord.ts` | 13 | 坐标工具（含 12 个测试文件） |
| `components/common/SideBar.vue` | 11 | 通用侧栏组件 |
| `components/common/Prompt.vue` | 10 | 通用弹窗组件 |
| `models/stores/saveStore.ts` | 10 | 核心 store（Editor.vue + 测试） |
| `pages/identities/routes/routesNames.ts` | 8 | 路由名常量 |
| `app/guideInfo.ts` | 8 | 指引文案配置 |
| `components/common/Notice.vue` | 7 | 通用提示组件 |
| `app/localConfig/common/keyPrefix.ts` | 6 | localStorage key 前缀 |

闭包外对核心 store（`envStore`/`saveStore`/`configStore`/`undoStore`/各 dispatcher）的直接读写**几乎全部集中在 `pages/editors/Editor.vue`**（507 行，是唯一的装配宿主），外加单元测试。`Cvs.vue`/`Menu.vue` 全项目仅被 `Editor.vue:2-3` 引用（模板在 `Editor.vue:464-465`）。

**结论**：装配面极窄（一个宿主组件），但共享面很宽——通用组件、数据模型被 web 侧大量反向引用（API 层曾是最大热点，已经 §3.4 的改造整体退出闭包）。拆分的关键不是"把核心搬走"，而是"裁定共享物的归属"。

---

## 2. 目标结构

```
AARC/                          # 仓库根（现有后端不动）
├── pnpm-workspace.yaml        # packages: ['aarc-web', 'aarc-core']（未来 + 'aarc-tauri'）
├── aarc-core/                 # 编辑器核心：Cvs/Menu + models + 渲染 + 交互
│   ├── package.json           # name: "aarc-core"
│   ├── README.md              # core 需要宿主提供的功能清单及 web 对照实现（见 §3.2）
│   └── src/...
├── aarc-web/                  # 现 aarc/ 目录的其余部分：pages、router、API、站点功能
│   ├── package.json           # name: "aarc-web", dependencies: { "aarc-core": "workspace:*" }
│   └── src/...
└── AARC.WebApi/ ...           # 后端，不受影响
```

**不建议**引入第三个 `aarc-shared` 包放置共享物，理由：共享物（uniqueComponents、common 组件、save 模型）几乎全部被核心闭包引用，若放第三包则 core 必然依赖它，而未来 tauri 也要依赖它——三包结构与"core 自带共享物、web 依赖 core"等价，但多一层包管理开销。推荐 **core 包容纳共享物并统一 re-export，web 只 import `aarc-core`**。唯一例外见 §3.4（API 层的最终形态：已整体归属 web）。

---

## 3. 关键设计裁决

### 3.1 宿主服务接口（为 tauri 铺路的核心动作）

核心闭包对"环境"的依赖目前以隐性方式存在，拆包时必须显式化为 core 的**注入接口**（ports），由宿主（web/tauri）提供实现（adapters）：

| 环境依赖 | 现状 | 拆分后 |
|---|---|---|
| 全局弹窗/等待 | `uniqueComponents` store 存回调，App.vue 用 `initCallbacks` 注册（`App.vue:15-24`），闭包内 20+ 处调 `showPop/showWait` | **已是注入模式**，原样保留在 core，文档化为 core 的初始化契约 |
| 保存/上传 | `Menu.vue` 通过 `@save-data` 事件委托给 Editor.vue（良好）；~~`models/save/cloudSvgOps.ts` 直接调 `api.saveSvg.upload`~~ | ✅ 已改造（2026-02）：`cloudSvgOps.ts` 导出 `CloudSvgUploader` 类型与 `initCloudSvgUploader()` 注入入口，宿主 `App.vue` 在 `onMounted` 注册 HTTP 实现（`api.saveSvg.upload`）；tauri 届时注入本地 fs 实现 |
| 路由跳转 | ~~`Menu.vue:90` 经 `enteredCanvasFromStore.goBackToWhereWeEntered()` 直接跳路由~~（该 store import `vue-router` 和 `@/pages/homes/routes/routesNames`） | ✅ 已改造（2026-02）：`Menu.vue` 的"离开"按钮改为 emit `leave` 事件，宿主 `Editor.vue` 以 `@leave="goBackToWhereWeEntered"` 接线；`enteredCanvasFrom.ts` 经此改造后不再被闭包引用，**整个留在 web，不进 core** |
| 环境变量 | 闭包内 5 个文件用 `import.meta.env`（2026-02 重扫；原 `apiStore.ts:80` 的一处已随 api 层退出闭包）：`proxyUrl.ts:20`、`guideInfo.ts:2-4`（VITE_Guide\*）、`mainCvsDispatcher.ts:69`（VITE_LogMainCvsRendering）、`adsCvsWorker.ts:8-9`（VITE_AdsText\*）、`CloudSvgConfig.vue:48` | 短期：core 作为源码由宿主 vite 构建，env 注入天然有效；长期（tauri）改为 core 导出 `configure({...})` 配置入口 |
| localStorage 持久化 | 5 个 core store 依赖 `pinia-plugin-persistedstate`，插件由宿主 `main.ts:11` 全局注册；`editorLocalConfig.ts:28-35` 还有直接读写 localStorage 的 legacy 迁移 | core 文档声明"宿主必须注册 persist 插件"，或 core 导出 `createCorePinia()` 工厂；tauri 侧可换持久化适配层 |
| 后端 HTTP | ~~`apiStore.ts`（JWT/cookie/axios）在闭包内~~ 已退出闭包（见 §3.4） | api 层整体归属 web；core 只持有 `models/types/apiShapes.ts` 的 DTO 投影与三个注入 provider |
| 路由参数/守卫 | ~~闭包内 3 个文件 import `vue-router`~~（2026-02 重扫）：`CloudSvgConfig.vue`、`useImageExport.ts` 用 `useRoute` 取 saveId 路由参数；`preventLeavingUnsaved.ts` 用 `router.beforeEach` 注册"阻止未保存离开"守卫；`FaqAsConfig.vue` 模板用全局组件 `RouterLink` | ✅ 已全部改造（2026-09）：saveId 提取——新增 `models/save/currentSaveId.ts`（`setCurrentSaveIdRaw`/`getCurrentSaveIdRaw`/`getCurrentSaveIdNum`），宿主 `Editor.vue` 用 `watch(props.saveId, immediate)` 设置；路由守卫上移——`preventLeavingUnsaved.ts` 新增 `initRouteGuardRegistrar()` 注入入口，`Editor.vue` 以 `router.beforeEach` 实现注册，`window.onbeforeunload` 部分留 core；站点链接注入——`FaqAsConfig.vue` 的两处 `RouterLink` 改为 `<a :href>`，新增 `app/siteLinks.ts`（`initSiteLinks`/`getSiteLinks`），宿主 `App.vue` 用 `router.resolve({name}).href` 注册"关于页/私服案例"链接（不注入则链接隐藏，tauri 可不注入）。**至此 core 闭包对 vue-router 与 `@/pages` 的依赖（含运行时全局组件）彻底清零** |

### 3.2 回调注入式隐性接口清单

> 📄 core 对宿主的全部依赖（含本清单的注入接口、pinia/persist 装配、构建期环境变量、全局样式等）已汇总在 **`aarc-core/README.md`** 的"需要宿主提供的功能"一节，并以 aarc-web 当前实现为对照；新增/变更注入接口时应同步更新该 README。

拆包前这些接口必须梳理成 core 的显式 API，否则会退化成"web 深层 import core 内部文件"：

- `uniqueComponents.initCallbacks`（Pop/Wait，App.vue 注册）
- `initCloudSvgUploader`（svg 云上传，App.vue 注册，见 §3.1"保存/上传"行）✅ 新增
- `initPinyinConvertProvider`（拼音转换，App.vue 注册，见 §3.4）✅ 新增
- `initSaveInfoProvider`（存档信息，App.vue 注册，见 §3.4）✅ 新增
- `setCurrentSaveIdRaw`（当前存档 id，Editor.vue 用 `watch(props.saveId)` 设置，见 §3.1"路由参数/守卫"行）✅ 新增
- `initRouteGuardRegistrar`（"阻止未保存离开"的路由守卫注册，Editor.vue 以 `router.beforeEach` 实现，见 §3.1"路由参数/守卫"行）✅ 新增
- `initSiteLinks`（站点内链接，App.vue 用 `router.resolve({name}).href` 注册，见 §3.1"路由参数/守卫"行）✅ 新增
- ~~`mainCvsDispatcher.afterMainCvsRendered`~~ ✅ 已改为 `initAfterMainCvsRendered(cb?)` 注册函数（2026-09，见第 20 步；`mainCvsDispatcher.ts:69`，Editor.vue 用它做"阻止未保存离开 + 心跳"；undo 入栈已收进 core 的 `notifyMainCvsRendered`，见第 17 步工作包 C2）
- `userFileFavoriteStore.openFavoritesSidebar / onFavoriteFileSelected`（core 的 `iconStore.ts:168` 设回调，web 的 `UserFileFavorites.vue:36,45` 实现 UI——**双向回调**；其中 `openFavoritesSidebar` ✅ 已改为 `initOpenFavoritesSidebar(cb)` 注册函数，见第 20 步）
- `envStore.rerender / rescaled / getActivePtOpsAvoidance / lineFocus`（dispatchers 与 store 互相给函数 ref 赋值接线）

### 3.3 需下移/裁决归属的模块

- ~~`pages/*/routes/routesNames.ts`~~ ✅ 已解决（2026-09）：闭包内最后一处引用（`FaqAsConfig.vue`）已随站点链接注入改造消除，**routesNames 整体留 web，无需移动**。
- `app/guideInfo.ts`、`app/globalStores/browserInfo.ts`：app 级模块但被 core 侧边栏（`EtcConfig.vue:24`、`ExportImage.vue:34`、`FaqAsConfig.vue`）直接使用，随 core 走并由 core re-export。
- 单元测试 `src/tests/`：大量引用闭包内 store 与 `models/coord.ts`，**随 core 迁移**，vitest 配置一并搬。
- `src/assets/ui/**.svg`（闭包内 9 个组件 import）随 core；`defaultAvatar.svg`/`defaultMini.svg` 留 web。
- `data/dev/devSave.ts`（Editor demo 模式，引用 public/demoDataSource）留 web。

### 3.4 API 层的两阶段处理

`apiStore.ts` + `apiGenerated.ts` 是最大的共享热点（web 侧合计 60+ 处引用）。~~两阶段处理~~ **已一次性解决（2026-02）**：

- 闭包内三处实际发 HTTP 的调用均已注入化（均由宿主 `App.vue` 注册实现）：`cloudSvgOps.ts`（svg 上传，`initCloudSvgUploader`，见 §3.1"保存/上传"行）、`usePinyinConvert.ts`（拼音转换，`initPinyinConvertProvider`）、`useImageExport.ts`（存档信息，`initSaveInfoProvider`）。
- 闭包对 `apiGenerated.ts` 的 5 处 DTO/枚举 import（`iconStore`、`userFileFavoriteStore`、`PinyinConvertConfig`、`usePinyinConvert`、`useImageExport`）已改为从 core 自有的 `models/types/apiShapes.ts` 导入——该文件声明 `SaveDto`/`UserFileDto` 的**字段子集投影**（仅 core 实际读写的字段：`SaveDto` 只留 `name`，`UserFileDto` 只留 `displayName`/`urlOriginal`）与形状一致的 `PinyinConvertRequest`/`PinyinConvertOptions`/`PinyinCaseType`/`PinyinVariantType`（拼音转换的字段全部被用到，无法精简）。兼容性由 TS 结构化类型在注入/接线点静态验证（生成类型字段更多可赋给窄投影；数值 enum 借 number 互赋规则兼容）。
- **至此 api 层（apiStore + apiGenerated）整体退出闭包、归属 web**，无需再拆分 DTO 与 Client。后端 DTO 变更时若形状漂移，`App.vue` 注入点会编译报错。tauri 阶段只需实现三个 provider 接口（svg 上传/拼音转换/存档信息）。

---

## 4. 实施步骤

每一步完成后都应能构建、通过 `pnpm type-check` 和 `pnpm test:run`，保证"不改变行为"可验证。

### 阶段 0：准备（已完成）

1. ✅ `analyze-deps.mjs` 已改造为 prebuild 检查（位于 `aarc-web/`，接入 `package.json` 的 `build`/`build-here`）：入口闭包内存在未解析 import 时以非零码退出阻止构建；`--out <file>` 参数控制是否写出闭包清单（默认不写）。~~拆分后需扩展为：分别扫描两个入口包，任何 core 文件 import 到 web 文件即为违规（单向依赖：web → core 允许，core → web 禁止）。~~ ✅ 扩展已完成（2026-09）：入口改为 `aarc-core/src` 的 Cvs/Menu + 全部测试文件，解析 `aarc-core/` 自引用；任何 core 文件 import 逃逸出 `aarc-core/src`（含 `@/` 别名、`aarc-web` 引用、越界相对路径）均以非零码退出。
2. ✅ 已清理残留：删除 `vite.config.ts` 中无人使用的 `~` 别名。

### 阶段 1：workspace 化（不改代码归属，先改布局）（已完成）

3. ✅ 根目录已建 `pnpm-workspace.yaml`：`packages: ['aarc-web']`（aarc-core 将在阶段 2 加入；原 aarc/pnpm-workspace.yaml 的 `allowBuilds`/`minimumReleaseAgeExclude` 配置已并入根配置），并新建根 `package.json`；`pnpm-lock.yaml`、`.npmrc` 已上移到根目录。
4. ✅ `aarc` 已改名 `aarc-web`（包名同步改为 `aarc-web`），修正的引用：
   - `Dockerfile` 前端构建阶段（workspace 布局复制 + `pnpm --filter aarc-web build-here`，产物路径 `/web/aarc-web/dist`）
   - `gen-ts-client.ps1` / `gen-ts-client.sh` 注释
   - `AARC.WebApi/Services/App/OpenApi/NSwagTsGenService.cs:11` 的 `defaultOutputPath`（硬编码的 ts 客户端输出路径）
   - 根 `AGENTS.md`、`README.md`、`aarc-web/AGENTS.md`
   - `.dockerignore` 无 aarc 路径引用，无需改动
   - 注意：`vite.config.ts` 的 `outDir: "../AARC.WebApi/wwwroot"` **无需改动**——`aarc` → `aarc-web` 为同级改名，目录深度不变（本文档早先版本对此判断有误）
5. ✅ 已验证：根目录 `pnpm install`（lockfile importers 迁移为 `aarc-web`）、`pnpm --filter aarc-web type-check`、`pnpm --filter aarc-web build`（产物正确输出到 `AARC.WebApi/wwwroot`）、`dotnet build`、完整 `docker build`。

### 阶段 2：core 包骨架与文件迁移（已完成，2026-09）

6. ✅ 已建 `aarc-core/`：package.json（`name: "aarc-core"`、`type: module`，按第 8 步建议预置 `"exports": {"./*": "./src/*"}` 源码导出）、tsconfig（与 aarc-web 对齐）、空的 `src/`；根 `pnpm-workspace.yaml` 的 `packages` 已加入 `'aarc-core'`，`pnpm install` 通过（lockfile 新增 `aarc-core` importer）。~~dependencies 留待第 12 步按实际 import 分配~~（已随迁移一并分配，见第 12 步）。
7. ✅ 已用 `git mv` 整体迁移闭包文件（保持相对目录结构，文件间相对 import 全部未改）。最终迁移集 **371 个文件**：基础闭包 324 + 测试迁入带入的增量 47（39 个测试文件 + 8 个仅被测试/宿主引用的模型模块：`saveNormalize`、`defaultDataSources`、`upgrade/config|patterns|textTagIcons|textTags`、`valid/dataSources|idIncre`）。迁移前已对增量模块做耦合审查（无 vue-router/@/pages/api 层引用）。`apiStore`/`apiGenerated`、`data/dev/devSave.ts`、`gitInfoGen.ts`/`colorSetsGen.ts` 等按裁定留 web。
8. ✅ `@/` 别名处理：实际做法与原设想不同——**core 内部 import 全部改写为 `aarc-core/` 自引用**（208 个文件），不再使用 `@/`。原因：vite alias 无法按 importer 位置区分同名 `@`，TS `paths` 也是 program 级生效，双包共存时 `@` 只能指向一处；包名自引用经 workspace symlink + `exports` 通配解析，在 vite/vitest/vue-tsc 下均验证可用。~~保险起见 web 的 vite.config 与 core 的 vitest.config 仍各加了 `aarc-core` 显式 alias~~（2026-09 更新：两处显式 alias 已随第 22 步全部删除），两边 tsconfig 也加了 `aarc-core/*` paths。~~例外：core 组件 `<style>` 中的 `@use '@/styles/...'`（仅 `CvsBlocks.vue:50-51`）仍经 web vite alias 指向 web 侧样式，留待第 10 步处理。~~ ✅ 已解决（2026-09）：`CvsBlocks.vue` 对 `_globalMixins.scss`/`_globalValues.scss` 的两处引用已内联为字面量（内容仅数行、引用点唯一），`_globalMixins.scss` 随之删除，core 的 `<style>` 不再依赖 web 侧任何 scss。
9. ✅ web 侧反向 import 已全部改为包名导入：91 处 `@/` 别名形式 + 21 处相对路径形式（后者为首轮扫描漏网，由 type-check 暴露后补扫改写），复核扫描 0 残留。web 侧剩余 `@/` 仅指向 web 自有 src。

### 阶段 3：构建与样式拆分

10. ✅ 已完成（2026-09）~~样式：`src/styles/styles.scss`（仅 `main.ts:5` 引入一次）劈成两半~~——实际做法：core 新建 `aarc-core/src/styles/global.scss`（含 base 元素样式、core 依赖的全部全局 class、以及 `@use` 的四份 partial），四份 partial 已 `git mv` 至 `aarc-core/src/styles/`——`configSection.scss`、`options.scss`、`arrangableList.scss`（原位于 web 的 `components/sidebars/*/shared/`，目录结构镜像 core 组件树）与 `bangPanel.scss`（原 `styles/`，实际仅 core 的 NameEdit/NameSearch/TextTagEdit 使用）。web 的 `styles.scss` 改为顶部 `@use 'aarc-core/styles/global.scss'`（包路径经 vite sass 解析正常），仅保留 web 私有规则（`h1WithBtns`/`table.index`/`dangerZone`/`wideTableContainer` 等）。core 样式自此 self-contained，宿主契约变为"全局引入 core 样式表一次"。验证：迁移前后 `pnpm build-here` 产物 CSS 规则集合 diff 为零（1290 条规则逐条一致）。~~`styles/_globalValues.scss`、`_globalMixins.scss` 被两包共用（`CvsBlocks.vue:50-51`、`App.vue:40` 等），放 core 导出~~（2026-09 更新：`_globalMixins.scss` 实际仅 core 的 `CvsBlocks.vue` 使用，已内联进该组件并删除文件；`_globalValues.scss` 仅 web 自用，留 web，两包不再共用 scss partial）。
11. ✅ 构建脚本：`build.ts` 的 `gitInfoGen`、`apiGenerated.ts` 拷贝到 public（`build.ts:21-23`）属于 web 职责，留在 aarc-web（未改动）；~~`vite.config.ts` 的 `fullReload` 监听列表要改为包含 core 路径~~ ✅ 已完成（2026-09）：监听列表已加入 `../aarc-core/src/**`。Dockerfile 前端阶段已补 `aarc-core` 的 package.json 与源码 COPY，✅ 完整 `docker build` 已重跑通过（2026-09，产物 chunk 哈希与本地构建一致）。
12. 依赖拆分：✅ 已完成（2026-09）——core 侧按迁移集实际 import 分配：vue/pinia/pinia-plugin-persistedstate、@aurouscia/*（au-color-picker/au-undo-redo/keyboard-shortcut/svgcanvas）、bowser/color/color-convert/copy-to-clipboard/omggif/rfdc/svgo/upng-js 及对应 @types；vitest 随测试迁至 core（含 vitest.config.ts 与 test 脚本，web 的 `test`/`test:run` 改为 `pnpm --filter aarc-core` 透传）。`vue-router`/`@microsoft/signalr`/`axios` 等留 web（闭包内 vue-router 引用已在 §3.1 改造中清零，原注意事项失效）。~~web 侧 dependencies 暂未瘦身（仍声明全部包，含 core 也用的那些），可后续清理——已查明可删清单，见第 21 步。~~ ✅ web 侧瘦身已完成（2026-09，见第 21 步）。pinia、vue 单实例由源码导出 + web vite 统一打包保证。
13. 环境变量：env 目录随 web（宿主），core 内 `import.meta.env` 用法阶段一保持不变（宿主 vite 构建时注入）。

### 阶段 4：验证与收尾

14. `pnpm type-check`、`pnpm test:run`（vitest 配置随测试迁至 core，注意 `proxyUrl.ts:12` 等有 `typeof window === 'undefined'` 的测试守卫）、`pnpm build`，产物仍输出到 `AARC.WebApi/wwwroot`。（2026-09 迁移后已验证：`pnpm install`、analyze-deps（371 文件、无逃逸）、type-check、test:run（701 通过）、build 全部通过。）
15. 手动回归清单：编辑器打开/保存/离开拦截、缩略图上传、svg 云上传、图标收藏夹（双向回调）、导出图片、Pop/Wait 弹窗、路由返回来源页、demo 模式。
16. 更新两级 `AGENTS.md`（启动命令、type-check 命令的作用范围）与根 README。

### 阶段 4.5：耦合收尾（2026-09 调查新增，均为小改动，建议按序执行）

本阶段源于一次 core↔web 耦合复查（结论：单向依赖约束执行良好，无 core→web 逃逸；以下为遗留的隐式契约类问题）。执行顺序按"先文档、再接线、后清理"排列；第 10 步（样式）与第 17 步（装配收口）不在本阶段，随各自阶段排期。

19. ✅ 已完成（2026-09）~~**补登 core 的隐式环境依赖到 `aarc-core/README.md`**（纯文档）~~：core 并非零出站请求——`utils/urlUtils/checkUrl.ts:3`、`models/save/dataSourceOps.ts:19` 直接 `fetch()`；`proxyUrl.ts:15`、`iconStore.ts:40,174`、`CloudSvgConfig.vue:38` 用 `window.location.origin` 拼 URL（隐式要求静态资源与页面同源，或正确配置 `VITE_ApiUrlBase`）；`models/save/upgrade/textTagIcons.ts:9-10` 硬编码 `/icons/a/*.svg` 默认图标路径（依赖宿主 `public/icons/`）。以上三条已补入 README"四、浏览器运行时"一节。tauri 阶段这些 fetch 应随 §3.1 模式 provider 化。
20. ✅ 已完成（2026-09）~~**裸 ref 接线改为 `init*` 注册函数**~~：`mainCvsDispatcher` 新增 `initAfterMainCvsRendered(cb?)`（`mainCvsDispatcher.ts:69`，内部 ref 不再外露，渲染完成后经 `notifyMainCvsRendered` 调用；宿主 `Editor.vue:321` 注册、`:451` 传 `undefined` 注销）；`userFileFavoriteStore` 新增 `initOpenFavoritesSidebar(cb)`（宿主 `UserFileFavorites.vue:36` 注册；`openFavoritesSidebar` 变为 store action，`TextTagIconConfig.vue:69` 改为直接调 action）。两处未注册被调用时均 `console.warn`——但渲染回调每次渲染都会触发，为避免刷屏，两处都按"每次注册周期仅警告一次"节流（重新注册后重置）。`aarc-core/README.md` 对应两行已同步。
21. ✅ 已完成（2026-09）~~**web 侧 dependencies 瘦身**（承接第 12 步）~~：已从 `aarc-web/package.json` 删除 web 侧零 import 的 8 个包——`omggif`、`upng-js`、`svgo`、`color`、`color-convert`、`bowser`、`@aurouscia/svgcanvas`、`@aurouscia/au-undo-redo`，连带删除 devDependencies 中对应的 `@types/color`、`@types/color-convert`、`@types/omggif`、`@types/upng-js`（core 侧均已自带）。`vite.config.ts:65-66` manualChunks 的 `'svgo'` 分包配置保留不动（分的是 core 的依赖，构建产物中 svgo chunk 仍正常生成）。验证：`pnpm install` + `pnpm build-here` 通过。
22. ✅ 已完成（2026-09）~~**删除冗余解析通道**~~：已删除 `aarc-web/vite.config.ts` 中 `aarc-core` 的显式 alias（原 :77）与 `aarc-core/vitest.config.ts` 的同名 alias，保留 workspace `exports` 通配（运行时解析）与两边 tsconfig `paths`（编辑器跳转/type-check）。验证：`pnpm type-check`（两包）、`pnpm build-here`、`aarc-core` 的 vitest（701 用例）、dev 服务器下 `aarc-core` import 经 exports 解析为 `/@fs/.../aarc-core/src/...` 均正常。

### 阶段 5（未来）：接口化与 tauri

17. ✅ 已完成（2026-09）在三个已注入 provider（§3.4）的基础上收口：core 定义 `CoreHostServices` 接口（文件读写、弹窗、导航、配置），web 提供 HTTP 实现。**同期建议收敛 `Editor.vue` 的装配面**（2026-09 调查）：目前宿主直接操作 core 的 `mainCvsDispatcher`/`miniatureCvsDispatcher`/`resetterStore`/`undoStore`/`iconStore`/`saveStore` 且需知晓内部调用时序（如 `Editor.vue:169-173` 依次 `saveStore.save = normalizeSave(...)`——直接写 store 字段、`resetDerivedStores()`、`ensureAllLoaded()`）；宜由 core 提供"编辑器会话"入口（如 `loadSaveIntoEditor()` / `disposeEditor()`）把时序收进 core 内部，宿主只传数据与回调。另可在 web 侧为 `apiGenerated.ts` ↔ core `apiShapes.ts` 的字段投影加编译期断言（`satisfies`/类型互赋测试），防止后端 DTO 改了 core 未用字段时零告警。📄 **实施细化（2026-09 调查编写）：见 [`docs/decoupling-step17.md`](./decoupling-step17.md)**——三个工作包（投影断言 / CoreHostServices 聚合 / 编辑器会话入口），含现状逐点盘点与 7 个可独立提交的子步骤。**落地结果**：7 个子步骤全部完成——web 侧新增 `app/com/apiShapesAssert.ts` 编译期断言；core 新增 `app/hostServices.ts`（`initCoreHostServices` 聚合入口）与 `app/editorSession.ts`（`loadSaveIntoEditor`/`prepareSavePayload`/`disposeEditor` 会话 API），undo 入栈收进 `notifyMainCvsRendered`；`Editor.vue` 不再直写 core store 的装配时序（剩余 core 触点：`preventLeavingUnsavedStore` 弹窗接线、`undoStore.undo/redo` 与 `envStore.delActivePt/delActiveTextTag` 快捷键等原子 action）。
18. 新增 `aarc-tauri` 包：复用 `aarc-core`，实现 fs 版 HostServices，替换 persist 存储与上传逻辑。注意 core 内还有十余处 `window.confirm/alert`（`Lines.vue:64`、`stashStore.ts:22,35`、`ControlPointOptions.vue:96,108,115` 等）与 `contextMenu.ts:4` 对 `document.oncontextmenu` 的全局改写——浏览器宿主下可接受，tauri 阶段若要替换原生对话框/右键行为，需统一抽象为宿主 UI 服务。

---

## 5. 主要阻碍清单（按风险排序）

1. **共享物归属裁定（§1.2 的 84 个文件）**：最大工作量来源。处理不当会退化成双向依赖或 core 臃肿。（最大的两个热点 apiStore/apiGenerated 已退出闭包，剩余为通用组件与数据模型。）
2. **回调注入式隐性接口（§3.2）**：编译期不可见的接线方式，搬迁后极易漏接，表现为运行时空函数/不弹窗。迁移后必须逐个核对。（~~2026-09 调查：`afterMainCvsRendered`、`openFavoritesSidebar` 两处仍是裸 ref 赋值、漏接时静默 noop~~ ✅ 已整改，见第 20 步：两处均改为 `init*` 注册函数，未注册被调用时 `console.warn`。）
3. ~~**apiStore/apiGenerated 在闭包内且被 web 重度引用**~~ ✅ 已解决（2026-02）：三处 HTTP 调用注入化 + core 自有 `models/types/apiShapes.ts` 承载所需 DTO 投影/枚举，api 层整体退出闭包、归属 web（见 §3.4）。
4. ~~**`enteredCanvasFrom` 耦合 vue-router 与 pages 目录**~~ ✅ 已解决（见 §3.1"路由跳转"行）：Menu 改用 `leave` 事件，该 store 整体留 web，core 不再涉及。
5. **persist 插件由宿主注册**：core 内 5 个 store 的持久化依赖它；`editorLocalConfig.ts:28-35` 的 legacy localStorage 迁移也要随宿主环境测试。
6. ~~**全局 scss 隐式依赖（§4 第 10 步）**：样式缺失不会报错，只会静默变形——迁移后需目检全部 core 组件。~~ ✅ 已解决（2026-09，第 10 步）：core 样式已 self-contained（`aarc-core/src/styles/global.scss`），宿主契约简化为"全局引入一次"；迁移正确性由构建产物 CSS 规则集合 diff 为零验证。
7. **`import.meta.env` 散落 core 闭包 5 个文件**（原 6 个，`apiStore.ts` 已退出闭包）：tauri 阶段必须改配置注入，阶段一可暂不处理但要在文档中登记（清单见 §3.1"环境变量"行）。
8. **构建耦合点**：outDir 指向后端 wwwroot、fullReload 监听列表、build.ts 的两个拷贝动作、Dockerfile/gen-ts-client 的路径——workspace 化后全部要跟着改。
9. **vue/pinia 单实例约束**：若未来 core 改为预构建产物（而非源码导出），必须用 `peerDependencies` + vite `dedupe`，否则会出现双 pinia 实例导致 store 错位。源码导出方案下无此问题。

## 6. 有利条件

- 闭包静态自洽（325 文件，无未解析 import），有 `analyze-deps.mjs` 可持续验证。
- 宿主仅 `Editor.vue` 一处，装配改动面小。
- 闭包内无对 `public/` 运行时路径的依赖（`/icons/`、`/demoDataSource/` 均不在闭包内）。
- `uniqueComponents` 已是注入模式，证明该项目代码风格可容纳"宿主注入"，扩展此模式阻力小。
- 纯 DOM/浏览器 API 依赖（47 个文件访问 window/document）无抽象层——这对 tauri webview 不是阻碍（同样是 web 环境），但意味着 SSR 不在本方案考虑范围内。
