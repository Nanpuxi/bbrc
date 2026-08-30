# aarc-core / aarc-web 拆分方案

本文分析把编辑器核心（`Cvs.vue` + `Menu.vue` 及其依赖闭包）拆分为独立包 `aarc-core`、剩余部分改名 `aarc-web`、共同置于 pnpm-workspace 下的实施步骤与主要阻碍。约束：**不改变任何运行时行为**；目标：未来新增 `aarc-tauri`，为 `aarc-core` 提供本地文件访问能力。

分析基于 `aarc-web/analyze-deps.mjs` 生成的依赖闭包 `temp.txt`，以及对闭包外文件的反向依赖扫描（2026-02 时点）。

---

## 1. 现状量化

### 1.1 依赖闭包

从 `src/components/Cvs.vue`、`src/components/Menu.vue` 出发递归解析全部 import（含 `@/` 别名、动态 `import()`），闭包共 **330 个文件**，无未解析的相对/别名 import——即闭包在静态 import 层面是自洽的，这是拆分的有利条件。

### 1.2 反向依赖（闭包外 → 闭包内）

闭包内共 **85 个文件被闭包外引用**。热点如下（括号内为外部引用方数量）：

| 闭包内文件 | 外部引用方数 | 性质 |
|---|---|---|
| `app/com/apiStore.ts` | 39 | axios 实例 + 全部 API Client 封装 |
| `app/com/apiGenerated.ts` | 33 | NSwag 生成的 DTO/Client |
| `models/save.ts` | 32 | 存档数据模型（纯类型+常量） |
| `app/globalStores/uniqueComponents.ts` | 30 | 全局 Pop/Wait 回调总线 |
| `models/coord.ts` | 13 | 坐标工具（含 12 个测试文件） |
| `components/common/SideBar.vue` | 11 | 通用侧栏组件 |
| `components/common/Prompt.vue` | 10 | 通用弹窗组件 |
| `models/stores/saveStore.ts` | 10 | 核心 store（Editor.vue + 测试） |
| `pages/identities/routes/routesNames.ts` | 8 | 路由名常量 |
| `app/guideInfo.ts` | 8 | 指引文案配置 |
| `components/common/Notice.vue` | 7 | 通用提示组件 |
| `app/globalStores/enteredCanvasFrom.ts` | 6 | "从哪进入画布"记录（依赖 vue-router） |
| `app/localConfig/common/keyPrefix.ts` | 6 | localStorage key 前缀 |

闭包外对核心 store（`envStore`/`saveStore`/`configStore`/`undoStore`/各 dispatcher）的直接读写**几乎全部集中在 `pages/editors/Editor.vue`**（507 行，是唯一的装配宿主），外加单元测试。`Cvs.vue`/`Menu.vue` 全项目仅被 `Editor.vue:2-3` 引用（模板在 `Editor.vue:464-465`）。

**结论**：装配面极窄（一个宿主组件），但共享面很宽——API 层、通用组件、数据模型被 web 侧大量反向引用。拆分的关键不是"把核心搬走"，而是"裁定共享物的归属"。

---

## 2. 目标结构

```
AARC/                          # 仓库根（现有后端不动）
├── pnpm-workspace.yaml        # packages: ['aarc-web', 'aarc-core']（未来 + 'aarc-tauri'）
├── aarc-core/                 # 编辑器核心：Cvs/Menu + models + 渲染 + 交互
│   ├── package.json           # name: "aarc-core"
│   └── src/...
├── aarc-web/                  # 现 aarc/ 目录的其余部分：pages、router、API、站点功能
│   ├── package.json           # name: "aarc-web", dependencies: { "aarc-core": "workspace:*" }
│   └── src/...
└── AARC.WebApi/ ...           # 后端，不受影响
```

**不建议**引入第三个 `aarc-shared` 包放置共享物，理由：共享物（apiStore、uniqueComponents、common 组件、save 模型）几乎全部被核心闭包引用，若放第三包则 core 必然依赖它，而未来 tauri 也要依赖它——三包结构与"core 自带共享物、web 依赖 core"等价，但多一层包管理开销。推荐 **core 包容纳共享物并统一 re-export，web 只 import `aarc-core`**。唯一例外见 §4.4（API 层的最终形态）。

---

## 3. 关键设计裁决

### 3.1 宿主服务接口（为 tauri 铺路的核心动作）

核心闭包对"环境"的依赖目前以隐性方式存在，拆包时必须显式化为 core 的**注入接口**（ports），由宿主（web/tauri）提供实现（adapters）：

| 环境依赖 | 现状 | 拆分后 |
|---|---|---|
| 全局弹窗/等待 | `uniqueComponents` store 存回调，App.vue 用 `initCallbacks` 注册（`App.vue:15-24`），闭包内 20+ 处调 `showPop/showWait` | **已是注入模式**，原样保留在 core，文档化为 core 的初始化契约 |
| 保存/上传 | `Menu.vue:91-102` 通过 `@save-data` 事件委托给 Editor.vue（良好）；但 `models/save/cloudSvgOps.ts:1,13` 直接调 `api.saveSvg.upload` | 上传动作改为注入函数，web 用 HTTP 实现，tauri 用本地 fs 实现 |
| 路由跳转 | `Menu.vue:90` 经 `enteredCanvasFromStore.goBackToWhereWeEntered()` 直接跳路由；该 store（`enteredCanvasFrom.ts:1,10`）import `vue-router` 和 `@/pages/homes/routes/routesNames` | "返回来源页"改为注入回调；路由名常量下移（见 §3.3） |
| 环境变量 | 闭包内 6 个文件用 `import.meta.env`：`apiStore.ts:80`（VITE_ApiUrlBase）、`proxyUrl.ts:20`、`guideInfo.ts:2-4`（VITE_Guide\*）、`mainCvsDispatcher.ts:69`（VITE_LogMainCvsRendering）、`adsCvsWorker.ts:8-9`（VITE_AdsText\*）、`CloudSvgConfig.vue:48` | 短期：core 作为源码由宿主 vite 构建，env 注入天然有效；长期（tauri）改为 core 导出 `configure({...})` 配置入口 |
| localStorage 持久化 | 5 个 core store 依赖 `pinia-plugin-persistedstate`，插件由宿主 `main.ts:11` 全局注册；`editorLocalConfig.ts:28-35` 还有直接读写 localStorage 的 legacy 迁移 | core 文档声明"宿主必须注册 persist 插件"，或 core 导出 `createCorePinia()` 工厂；tauri 侧可换持久化适配层 |
| 后端 HTTP | `apiStore.ts`（JWT/cookie/axios）在闭包内 | 见 §3.4 |

### 3.2 回调注入式隐性接口清单

拆包前这些接口必须梳理成 core 的显式 API，否则会退化成"web 深层 import core 内部文件"：

- `uniqueComponents.initCallbacks`（Pop/Wait，App.vue 注册）
- `mainCvsDispatcher.afterMainCvsRendered`（`mainCvsDispatcher.ts:67,134`，Editor.vue:316-324 用它做"阻止未保存离开 + 心跳 + undo 入栈"）
- `userFileFavoriteStore.openFavoritesSidebar / onFavoriteFileSelected`（core 的 `iconStore.ts:168` 设回调，web 的 `UserFileFavorites.vue:36,45` 实现 UI——**双向回调**）
- `envStore.rerender / rescaled / getActivePtOpsAvoidance / lineFocus`（dispatchers 与 store 互相给函数 ref 赋值接线）

### 3.3 需下移/裁决归属的模块

- `pages/*/routes/routesNames.ts`（4 个文件被闭包 import：`enteredCanvasFrom.ts:1`、`useImageExport.ts:7`、`CloudSvgConfig.vue:8`、`FaqAsConfig.vue:2,5`）：纯常量，移到 core 或 web 的 `app/router/` 中立位置。注意 `pages/identities/routes/routesNames.ts` 同时被 8 个 web 文件用，移动后两边都要改 import。
- `app/guideInfo.ts`、`app/globalStores/browserInfo.ts`：app 级模块但被 core 侧边栏（`EtcConfig.vue:24`、`ExportImage.vue:34`、`FaqAsConfig.vue`）直接使用，随 core 走并由 core re-export。
- 单元测试 `src/tests/`：大量引用闭包内 store 与 `models/coord.ts`，**随 core 迁移**，vitest 配置一并搬。
- `src/assets/ui/**.svg`（闭包内 9 个组件 import）随 core；`defaultAvatar.svg`/`defaultMini.svg` 留 web。
- `data/dev/devSave.ts`（Editor demo 模式，引用 public/demoDataSource）留 web。

### 3.4 API 层的两阶段处理

`apiStore.ts` + `apiGenerated.ts` 是最大的共享热点（web 侧合计 60+ 处引用），而 core 闭包内真正发 HTTP 的只有 `cloudSvgOps.ts`（svg 上传），`iconStore.ts:8`、`userFileFavoriteStore.ts:1` 等仅 import 其 DTO 类型。

- **阶段一（求稳）**：api 层整体留在 core 包内，web 从 `aarc-core` import。行为零变化，但 core 名义上含 web 专属 API（评论、用户、聊天等），语义被稀释。
- **阶段二（为 tauri 瘦身）**：把 `apiGenerated.ts` 的 DTO 类型与 Client 拆分——DTO 类型留在 core（或独立 `types` 文件），HTTP Client 移到 web；core 内 `cloudSvgOps` 等改为依赖注入的上传接口。tauri 实现同一接口写本地文件。

推荐阶段一先合、阶段二再分，避免一次改动过大。

---

## 4. 实施步骤

每一步完成后都应能构建、通过 `pnpm type-check` 和 `pnpm test:run`，保证"不改变行为"可验证。

### 阶段 0：准备（已完成）

1. ✅ `analyze-deps.mjs` 已改造为 prebuild 检查（位于 `aarc-web/`，接入 `package.json` 的 `build`/`build-here`）：入口闭包内存在未解析 import 时以非零码退出阻止构建；`--out <file>` 参数控制是否写出闭包清单（默认不写）。拆分后需扩展为：分别扫描两个入口包，任何 core 文件 import 到 web 文件即为违规（单向依赖：web → core 允许，core → web 禁止）。
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

### 阶段 2：core 包骨架与文件迁移

6. 建 `aarc-core/`：package.json（`name: "aarc-core"`、`type: module`）、tsconfig、`src/`。
7. 按 `temp.txt` 用 `git mv` 整体迁移 330 个闭包文件（保持相对目录结构，则**文件间的相对 import 全部不用改**）；同时迁移 §3.3 裁定的共享物（apiStore/apiGenerated/common 组件/guideInfo/browserInfo/tests/assets/ui 等）——迁移后闭包会扩大，重新运行 `analyze-deps.mjs` 直至 core 闭包再次自洽。
8. `@/` 别名处理：core 的 tsconfig 与 web 的 vite alias 分别把 `@` 指向各自 src；web 侧对 core 内容的 import 统一改为包名 `aarc-core`（在 core 的 package.json 用 `exports` 暴露 `./src/**` 或建立 barrel 文件）。**建议短期直接 exports 源码**（`"exports": {"./*": "./src/*"}`），由宿主 vite 编译，避免 core 独立构建产物带来的双重 vue 实例、env 注入失效等问题。
9. web 侧 85 处反向 import 改为从 `aarc-core` 导入（编辑器 WebStorm/VSCode 的 move-symbol 或全局替换可批量处理）。

### 阶段 3：构建与样式拆分

10. 样式：`src/styles/styles.scss`（仅 `main.ts:5` 引入一次）劈成两半——它 `@use` 了 3 个位于 core 组件目录的 scss（`styles.scss:5-7`），且 core 组件模板依赖其中的全局类名（`.sqrBtn`/`.withShadow`/`.statusDisplay` 等）。core 自带一份基础样式并由 barrel 导出；`styles/_globalValues.scss`、`_globalMixins.scss` 被两包共用（`CvsBlocks.vue:50-51`、`App.vue:40` 等），放 core 导出。
11. 构建脚本：`build.ts` 的 `gitInfoGen`、`apiGenerated.ts` 拷贝到 public（`build.ts:21-23`）属于 web 职责，留在 aarc-web；`vite.config.ts` 的 `fullReload` 监听列表（`vite.config.ts:17-19`，监听 `src/app|models|utils`）要改为包含 core 路径，否则 core 改动不触发整页刷新。
12. 依赖拆分：两个 package.json 按实际 import 分配 dependencies（vue/pinia 为 core 的 dependencies，web 经 core 传递或自行声明；`@microsoft/signalr`、`axios` 阶段一随 api 层在 core，`vue-router` 留 web）。注意 pinia、vue 必须保证单实例——core 用源码导出 + web 的 vite 统一打包可天然保证。
13. 环境变量：env 目录随 web（宿主），core 内 `import.meta.env` 用法阶段一保持不变（宿主 vite 构建时注入）。

### 阶段 4：验证与收尾

14. `pnpm type-check`、`pnpm test:run`（vitest 配置随测试迁至 core，注意 `proxyUrl.ts:12` 等有 `typeof window === 'undefined'` 的测试守卫）、`pnpm build`，产物仍输出到 `AARC.WebApi/wwwroot`。
15. 手动回归清单：编辑器打开/保存/离开拦截、缩略图上传、svg 云上传、图标收藏夹（双向回调）、导出图片、Pop/Wait 弹窗、路由返回来源页、demo 模式。
16. 更新两级 `AGENTS.md`（启动命令、type-check 命令的作用范围）与根 README。

### 阶段 5（未来）：接口化与 tauri

17. 执行 §3.4 阶段二：core 定义 `CoreHostServices` 接口（文件读写、弹窗、导航、配置），web 提供 HTTP 实现。
18. 新增 `aarc-tauri` 包：复用 `aarc-core`，实现 fs 版 HostServices，替换 persist 存储与上传逻辑。

---

## 5. 主要阻碍清单（按风险排序)

1. **共享物归属裁定（§1.2 的 85 个文件）**：最大工作量来源。处理不当会退化成双向依赖或 core 臃肿。
2. **回调注入式隐性接口（§3.2）**：编译期不可见的接线方式，搬迁后极易漏接，表现为运行时空函数/不弹窗。迁移后必须逐个核对。
3. **apiStore/apiGenerated 在闭包内且被 web 重度引用**：两阶段处理（§3.4），切勿一步到位。
4. **`enteredCanvasFrom` 耦合 vue-router 与 pages 目录**：core 不能依赖 vue-router（tauri 可能不用 hash 路由），返回导航必须注入化。
5. **persist 插件由宿主注册**：core 内 5 个 store 的持久化依赖它；`editorLocalConfig.ts:28-35` 的 legacy localStorage 迁移也要随宿主环境测试。
6. **全局 scss 隐式依赖（§3.10）**：样式缺失不会报错，只会静默变形——迁移后需目检全部 core 组件。
7. **`import.meta.env` 散落 core 闭包 6 个文件**：tauri 阶段必须改配置注入，阶段一可暂不处理但要在文档中登记。
8. **构建耦合点**：outDir 指向后端 wwwroot、fullReload 监听列表、build.ts 的两个拷贝动作、Dockerfile/gen-ts-client 的路径——workspace 化后全部要跟着改。
9. **vue/pinia 单实例约束**：若未来 core 改为预构建产物（而非源码导出），必须用 `peerDependencies` + vite `dedupe`，否则会出现双 pinia 实例导致 store 错位。源码导出方案下无此问题。

## 6. 有利条件

- 闭包静态自洽（330 文件，无未解析 import），有 `analyze-deps.mjs` 可持续验证。
- 宿主仅 `Editor.vue` 一处，装配改动面小。
- 闭包内无对 `public/` 运行时路径的依赖（`/icons/`、`/demoDataSource/` 均不在闭包内）。
- `uniqueComponents` 已是注入模式，证明该项目代码风格可容纳"宿主注入"，扩展此模式阻力小。
- 纯 DOM/浏览器 API 依赖（47 个文件访问 window/document）无抽象层——这对 tauri webview 不是阻碍（同样是 web 环境），但意味着 SSR 不在本方案考虑范围内。
