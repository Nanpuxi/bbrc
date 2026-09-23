# aarc-core

AARC 编辑器核心包：`Cvs.vue` / `Menu.vue` 及其依赖闭包（models、渲染、交互、通用组件、单元测试）。

- 以**源码**经 `exports` 通配导出（`"./*": "./src/*"`），由宿主（当前为 `aarc-web`，未来 `aarc-tauri`）的 vite 统一打包，不是预构建产物。
- 内部 import 一律使用 `aarc-core/` 包名自引用，不依赖宿主包内任何文件（单向依赖：web → core 允许，core → web 禁止，由 `aarc-web/analyze-deps.mjs` 在构建时强制检查）。

## 开发命令

在根目录或本目录执行均可：

```sh
pnpm install                    # 根目录 workspace 安装
pnpm --filter aarc-core type-check   # vue-tsc 按本包 tsconfig 独立检查
pnpm --filter aarc-core test:run     # vitest 单元测试
```

## 需要宿主提供的功能

core 不直接持有以下能力，全部由宿主提供。下列"web 实现"均指 `aarc-web` 当前做法，是未来 `aarc-tauri` 等宿主的对照实现。

### 一、应用装配（必须）

| 功能 | core 侧约定 | web 实现 |
|---|---|---|
| Pinia 实例 + persist 插件 | core 的 store 依赖全局 pinia，其中 5 个 store 使用 `persist` 选项，要求 pinia 注册了 `pinia-plugin-persistedstate`；vue/pinia 必须单实例（源码导出 + 宿主统一打包保证） | `src/main.ts:11` `createPinia().use(piniaPluginPersistedstate)` |
| 编辑器宿主组件 | 挂载 `Cvs.vue` 与 `Menu.vue`；接线 `Menu` 的两个事件：`@save-data(mustBackup)`（保存存档）与 `@leave`（离开编辑器）；负责权限判定、心跳、压缩上传等宿主业务。存档数据进出 core 的时序走会话 API（`app/editorSession.ts`），宿主只传数据与选项、不直接操作 core store 的装配顺序：`loadSaveIntoEditor(raw, opts)`（normalize → 重建派生态 → 数据源自动更新 → 图标加载 → undo 基线；visitorMode 与三个资源栏目的屏蔽文案（opts 的 `iconAccessNotice`/`dataSourcesAccessNotice`/`uploadAccessNotice`，传入即屏蔽、文案原样显示给用户，状态存 `models/stores/utils/resourceAccessStore.ts`）经 opts 传入）、`prepareSavePayload()`（保存前：配置写回 + 站名坐标截断）、`disposeEditor()`（卸载清理） | `src/pages/editors/Editor.vue`（模板 440-441 行） |
| 当前存档 id | `setCurrentSaveIdRaw(id)`，宿主从路由参数同步，core 不读 route | `Editor.vue:52` `watch(() => props.saveId, ..., { immediate: true })` |

### 二、回调注入接口（`init*` 注册）

> 聚合入口：`initCoreHostServices(services: CoreHostServices)`（`app/hostServices.ts`）一次性注册下表中"应用启动期"的服务（弹窗/等待、云上传、拼音转换、存档信息、文件保存、站点链接、路由守卫），内部依次调用各 `init*`；新增宿主时实现 `CoreHostServices` 即得到完整装配 checklist。下表各低层入口保留，可单独调用。

| 功能 | core 入口 | web 实现 |
|---|---|---|
| 全局弹窗 / 等待遮罩 | `uniqueComponents.initCallbacks({ popCallback, waitCallback })`（`app/globalStores/uniqueComponents.ts:11`） | `App.vue:23-40` 聚合注册（pop/wait 字段），用 web 自有的 `Pop.vue` / `Wait.vue` 实现 UI |
| 存档缩略 SVG 云上传 | `initCloudSvgUploader(uploader)`（`models/save/cloudSvgOps.ts:8`）；未注入则"云端SVG"配置区整体隐藏 | `App.vue:23-40` 聚合注册（cloudSvgUploader 字段），`api.saveSvg.upload` |
| 拼音转换 | `initPinyinConvertProvider(provider)`（`components/composables/usePinyinConvert.ts:11`）；未注入则站名/文本标签编辑器内的转换按钮及"站名拼音转换"配置区隐藏 | `App.vue:23-40` 聚合注册（pinyinConvert 字段），`api.saveUtils.pinyinConvert` |
| 存档信息读取（导出图片用） | `initSaveInfoProvider(provider)`（`components/sidebars/export/composables/useImageExport.ts:15`）；未注入则导出文件名退化为存档 id，不阻断导出 | `App.vue:23-40` 聚合注册（saveInfo 字段），`api.save.loadInfo` |
| 文件保存（导出落盘） | `initFileSaver(saver)`（`components/sidebars/export/composables/useImageExport.ts`）；未注入则 `triggerDownload` 使用浏览器 `<a download>` 下载兜底（webview 下载不可靠的宿主如 tauri 应注入原生实现） | web 不注入，走 core 默认浏览器下载；tauri：`src/fileSaver.ts`（dialog `save` + fs `writeFile`） |
| 站点内链接（关于页 / 私服案例） | `initSiteLinks({ about, forkAarc })`（`app/siteLinks.ts:9`）；不注入则对应链接隐藏 | `App.vue:23-40` 聚合注册（siteLinks 字段），`router.resolve({ name }).href` |
| "未保存离开"路由守卫 | `initRouteGuardRegistrar(registrar)`（`utils/eventUtils/preventLeavingUnsaved.ts:9`）；`window.onbeforeunload` 部分由 core 自理 | `Editor.vue:60`，`router.beforeEach` |
| 主画布渲染完成回调 | `mainCvsDispatcher.initAfterMainCvsRendered(cb)`（`models/cvs/dispatchers/mainCvsDispatcher.ts:69`），宿主用它做"阻止离开 + 心跳"（undo 入栈由 core 在 `notifyMainCvsRendered` 内自理，先于宿主回调执行）；未注入被调用时 `console.warn`（每次注册周期仅警告一次） | `Editor.vue:294` 注册，`:422` 离开编辑器时经 `disposeEditor()` 注销 |
| 图标收藏夹（**双向回调**） | `userFileFavoriteStore`（`models/stores/utils/userFileFavoriteStore.ts`）：宿主调 `initOpenFavoritesSidebar(cb)` 注册"打开侧栏"实现（未注入则相关入口隐藏，被调用时仅 `console.warn`）；消费方可用 `openFavoritesSidebar(intent)` 传入一次性 `onSelected` 回调与 `fileType` 过滤；宿主在用户选中文件时调 `notifyFileSelected(file, contentUrl)`（`contentUrl` 为宿主拼好的按 uniqueName 的绝对固定链接，core 不感知拼法；存量资源无 uniqueName 时为 undefined）——优先消费一次性回调，否则回退到全局 `onFavoriteFileSelected`（由 core 的 `iconStore.ts:168` 赋值） | `components/common/userFile/UserFileFavorites.vue`（`open`/`select`） |
| 多人协作传输 | `initCollabTransport(t)`（`models/collab/collabTransport.ts`）：实现 `CollabTransport`（房间/op/锁/快照请求 + 事件回调），快照 payload 压缩是传输层内部细节；不在 `initCoreHostServices` 聚合内，需单独注入；未注入则 `collabSessionStore.join` 报错 | `app/com/collabSignalrStore.ts`（SignalR `/collab` + HTTP 快照直传，LZString 压缩），`App.vue` `initWebCollabTransport()` 注入 |

**弹窗 / 等待遮罩的行为约定**（任何宿主的 pop/wait 实现都必须遵循）：

- **wait**：等待期间以蒙层阻止页面上的**一切**操作；当等待持续超过约 4 秒（与 `aarc-web` 的 `apiCancelableMs` 对齐）仍未结束时，必须出现**取消按钮**，允许用户放弃本次操作（取消的语义由宿主决定：web 为中止全部进行中 API 请求，无 API 层的宿主可直接强制结束等待）。
- **pop**：必须支持**多条消息同时弹出**，相互不遮挡（如按序堆叠）；每条消息到达时限（web 为约 2 秒）后**自动消失**。

### 三、运行配置与构建期环境（宿主）

- **运行配置**：core 不读 `import.meta.env`，所需配置由宿主在启动早期调用 `configureCore(config: CoreConfig)`（`app/coreConfig.ts`）注入，core 内经 `getCoreConfig()` 读取：`apiUrlBase`（代理转换/云端SVG分享链接）、`guideResetPassword`/`guideFindHelp`/`guideExtra`（指引文案）、`logMainCvsRendering`（渲染耗时日志）、`adsTextLess`/`adsTextMore`（导出图片水印文案）。未注入的项按 undefined/false 处理。web：`src/main.ts` 顶层以 `import.meta.env.VITE_*` 注入
- **全局样式**：core 自带 `src/styles/global.scss`（base 元素样式 + `.sqrBtn` / `.withShadow` / `.statusDisplay` 等全局 class + `configSection` / `options` / `arrangableList` / `bangPanel` 四份 partial），**宿主必须全局引入一次**，否则 core 组件会静默变形。web：`src/styles/styles.scss` 顶部 `@use 'aarc-core/styles/global.scss'`（经包 `exports` 通配解析，由宿主 vite 编译）
- **第三方组件全局 CSS**：core 组件使用 `@aurouscia/au-color-picker` 但不引入其样式表，由宿主加载。web：`main.ts:6` `import '@aurouscia/au-color-picker/style.css'`
- **静态资源打包**：core 内以模块形式 import `aarc-core/assets/ui/*.svg`，需宿主打包器支持静态资源 import（vite 默认支持）。

### 四、浏览器运行时

- **localStorage**：persist 插件的持久化存储，以及 `app/localConfig/editorLocalConfig.ts` 的 legacy 配置迁移直接读写 localStorage。宿主须运行在具备 localStorage 的环境（浏览器 / tauri webview 均可）。
- **core 会直接发网络请求**：`utils/urlUtils/checkUrl.ts:3`（`fetch` HEAD 探测 URL 可用性）、`models/save/dataSourceOps.ts:19`（`fetch` 拉取数据源）——core 并非零出站请求，宿主环境须允许这些请求发出（未来计划随注入模式 provider 化，见 `aarc-web/docs/decoupling.md` 第 19 步）。
- **同源假设**：`utils/urlUtils/proxyUrl.ts:15`、`models/stores/iconStore.ts:40,174`、`components/sidebars/configs/CloudSvgConfig.vue:38` 用 `window.location.origin` 拼接 API/图标 URL，隐式要求后端与静态资源同源于页面；不同源时必须正确配置 `VITE_ApiUrlBase`。
- **硬编码静态路径**：`models/save/upgrade/textTagIcons.ts:9-10` 的默认文本标签图标引用 `/icons/a/airport.svg`、`/icons/a/train.svg`，依赖宿主 `public/icons/` 目录提供。web：`aarc-web/public/icons/`。
- **构建信息 `/gitInfo.json`**：`components/sidebars/configs/EtcConfig.vue` 底部显示分支/提交/构建时间（`utils/gitInfo/gitInfoGet.ts` 懒加载 fetch，失败则该行隐藏）。宿主应在 dev/build 前把 `gitInfo.json` 生成到自身 `public/` 下。web：`build.ts` 内调用 `src/utils/gitInfo/gitInfoGen.ts`；tauri：`scripts/gen-git-info.mjs`（已挂进 `dev`/`build` 脚本前置）。
