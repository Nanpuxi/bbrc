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
| 编辑器宿主组件 | 挂载 `Cvs.vue` 与 `Menu.vue`；接线 `Menu` 的两个事件：`@save-data(mustBackup)`（保存存档）与 `@leave`（离开编辑器）；负责存档加载/保存/权限判定，只读场景通过 `mainCvsDispatcher.visitorMode` 告知 core | `src/pages/editors/Editor.vue`（模板 469-470 行） |
| 当前存档 id | `setCurrentSaveIdRaw(id)`，宿主从路由参数同步，core 不读 route | `Editor.vue:57` `watch(() => props.saveId, ..., { immediate: true })` |

### 二、回调注入接口（`init*` 注册）

| 功能 | core 入口 | web 实现 |
|---|---|---|
| 全局弹窗 / 等待遮罩 | `uniqueComponents.initCallbacks({ popCallback, waitCallback })`（`app/globalStores/uniqueComponents.ts:11`） | `App.vue:26-33`，用 web 自有的 `Pop.vue` / `Wait.vue` 实现 UI |
| 存档缩略 SVG 云上传 | `initCloudSvgUploader(uploader)`（`models/save/cloudSvgOps.ts:8`）；未注入时调用仅报错不崩溃 | `App.vue:34-37`，`api.saveSvg.upload` |
| 拼音转换 | `initPinyinConvertProvider(provider)`（`components/composables/usePinyinConvert.ts:11`） | `App.vue:38`，`api.saveUtils.pinyinConvert` |
| 存档信息读取（导出图片用） | `initSaveInfoProvider(provider)`（`components/sidebars/export/composables/useImageExport.ts:15`） | `App.vue:39`，`api.save.loadInfo` |
| 站点内链接（关于页 / 私服案例） | `initSiteLinks({ about, forkAarc })`（`app/siteLinks.ts:9`）；不注入则对应链接隐藏 | `App.vue:40-43`，`router.resolve({ name }).href` |
| "未保存离开"路由守卫 | `initRouteGuardRegistrar(registrar)`（`utils/eventUtils/preventLeavingUnsaved.ts:9`）；`window.onbeforeunload` 部分由 core 自理 | `Editor.vue:60`，`router.beforeEach` |
| 主画布渲染完成回调 | `mainCvsDispatcher.afterMainCvsRendered`（`models/cvs/dispatchers/mainCvsDispatcher.ts:67`），宿主用它做"阻止离开 + 心跳 + undo 入栈" | `Editor.vue:321` 赋值，`:451` 离开编辑器时置回 `undefined` |
| 图标收藏夹（**双向回调**） | `userFileFavoriteStore`（`models/stores/utils/userFileFavoriteStore.ts`）：宿主给 `openFavoritesSidebar` 赋值"打开侧栏"实现；`onFavoriteFileSelected` 由 core 的 `iconStore.ts:168` 赋值，宿主在用户选中文件时调用它 | `components/common/userFile/UserFileFavorites.vue:36` / `:45` |

### 三、构建期环境（宿主 vite）

- **环境变量**：core 内 5 个文件使用 `import.meta.env`，由宿主 vite 在 dev/构建时注入（源码导出方案下天然有效）：
  - `VITE_ApiUrlBase` — `utils/urlUtils/proxyUrl.ts:20`、`components/sidebars/configs/CloudSvgConfig.vue:37`
  - `VITE_GuideResetPassword` / `VITE_GuideFindHelp` / `VITE_GuideExtra` — `app/guideInfo.ts:2-4`
  - `VITE_LogMainCvsRendering` — `models/cvs/dispatchers/mainCvsDispatcher.ts:69`
  - `VITE_AdsTextLess` / `VITE_AdsTextMore` — `models/cvs/workers/adsCvsWorker.ts:8-9`
- **全局样式**：core 组件模板依赖全局 class（`.sqrBtn` / `.withShadow` / `.statusDisplay` 等）以及 sidebars shared 样式（`configSection` / `options` / `arrangableList`），由宿主全局加载。web：`src/styles/styles.scss`（`main.ts:5` 引入，内部 `@use` 三份 shared scss）
- **第三方组件全局 CSS**：core 组件使用 `@aurouscia/au-color-picker` 但不引入其样式表，由宿主加载。web：`main.ts:6` `import '@aurouscia/au-color-picker/style.css'`
- **静态资源打包**：core 内以模块形式 import `aarc-core/assets/ui/*.svg`，需宿主打包器支持静态资源 import（vite 默认支持）。

### 四、浏览器运行时

- **localStorage**：persist 插件的持久化存储，以及 `app/localConfig/editorLocalConfig.ts` 的 legacy 配置迁移直接读写 localStorage。宿主须运行在具备 localStorage 的环境（浏览器 / tauri webview 均可）。
