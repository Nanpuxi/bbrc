# aarc-tauri

AARC 编辑器的**最小 Tauri 宿主**（实现中：第 1 步"纯浏览器 dev"已完成，尚未接入编辑器组件与 tauri）。

目标：以最小装配跑通 `aarc-core` 编辑器（Cvs/Menu 及其闭包），验证"core + 非 web 宿主"的拆分成果，后续演进为具备本地文件读写能力的完整 `aarc-tauri`。

## 定位与边界

- **只跑编辑器**：不复制 `aarc-web` 的站点功能（pages、路由、账号、API 层、Demo 模式等）。
- 复用 `aarc-core`：经 workspace 源码导出依赖（`"aarc-core": "workspace:*"`），由本包的 vite 统一打包，与 aarc-web 相同的方式保证 vue/pinia 单实例。
- 参考文档（实现前必读）：
  - `aarc-core/README.md` —— core 需要宿主提供的全部功能清单及 web 对照实现
  - `aarc-web/docs/decoupling.md` —— §3.1 宿主服务接口、§5 第 18 步（tauri 注意事项）

## minimal 需要满足的功能

对照 `aarc-core/README.md` 的"需要宿主提供的功能"，按 minimal 的取舍分三档。

### 一、必须实现（缺则编辑器无法工作）

| 功能 | core 侧约定 | minimal 实现要点 |
|---|---|---|
| Pinia + persist 插件 | core 的 5 个 store 依赖 `pinia-plugin-persistedstate`；vue/pinia 必须单实例 | `main.ts` 中 `createPinia().use(piniaPluginPersistedstate)`，与 web 相同 |
| 全局样式 | core 不自引样式，宿主必须全局引入一次，否则组件静默变形 | `@use 'aarc-core/styles/global.scss'` + `import '@aurouscia/au-color-picker/style.css'` |
| 编辑器宿主组件 | 挂载 `Cvs.vue`/`Menu.vue`；接线 `@save-data(mustBackup)` 与 `@leave`；存档进出走会话 API `loadSaveIntoEditor` / `prepareSavePayload` / `disposeEditor`（`aarc-core/app/editorSession.ts`），不直接操作 core store 的装配时序 | 对应 web 的 `Editor.vue` 的极简版：无权限判定、无心跳、无压缩上传 |
| 当前存档 id | `setCurrentSaveIdRaw(id)`，core 不读 route | minimal 无路由，用本地存档标识（或固定值）设置 |
| 运行配置注入 | `configureCore(config)`（`aarc-core/app/coreConfig.ts`），core 不读 `import.meta.env` | minimal 阶段可只注入 `apiUrlBase`，其余留 undefined |
| 弹窗 / 等待（pop/wait） | `initCoreHostServices` 的 pop/wait 字段（或 `uniqueComponents.initCallbacks`），core 内 20+ 处依赖 | Pop.vue/Wait.vue 是 web 自有组件，**minimal 需自实现极简版** |
| 主画布渲染完成回调 | `mainCvsDispatcher.initAfterMainCvsRendered(cb)` | 至少用于"未保存离开"拦截置位；undo 入栈由 core 自理 |

### 二、可省略（不注入即降级，不崩溃）

- `siteLinks`：不注入则"关于页/私服案例"链接隐藏（tauri 本就不需要）。
- `routeGuardRegistrar`：tauri 无前端路由，可不注入；`window.onbeforeunload` 部分 core 自理。
- `pinyinConvert` / `saveInfo`：不注入则站名拼音转换、导出图片读存档信息不可用。
- `cloudSvgUploader`：minimal 阶段可注入 noop/本地保存占位；tauri 阶段换 fs 实现。
- `initOpenFavoritesSidebar`：不注入则图标收藏夹入口仅 `console.warn`。

### 三、运行时环境约束（tauri webview 需处理）

- **localStorage**：tauri webview 具备，persist 可直接用；后续可换 fs 持久化适配层。
- **core 会直接发 fetch**（`checkUrl.ts`、`dataSourceOps.ts`）：tauri 需在 CSP/能力配置中放行出站请求。
- **同源假设**：core 多处用 `window.location.origin` 拼 API/图标 URL；tauri 下页面源是 `tauri://localhost`，**必须注入 `apiUrlBase`** 指向实际后端，或走完全离线策略。
- **硬编码静态路径** `/icons/a/*.svg`：需把 `aarc-web/public/icons/` 打进本包静态资源。
- **原生行为抽象**（tauri 阶段）：core 内十余处 `window.confirm/alert` 与 `contextMenu.ts` 对 `document.oncontextmenu` 的全局改写，如需原生对话框/右键菜单，须统一抽象为宿主 UI 服务（见 decoupling.md 第 18 步）。

## 推荐实现步骤

每步完成后应能 `pnpm --filter aarc-tauri type-check` 通过，并在浏览器 dev 模式下目检。

1. **纯浏览器 dev 先行**（先不接 tauri）：补 `vite.config.ts`、`index.html`、`src/main.ts`——创建 App、注册 pinia + persist、`configureCore`、引入全局样式。本包 `package.json` 随之补依赖（vue、pinia、pinia-plugin-persistedstate、vite、vue-tsc 等，版本与 aarc-core/aarc-web 对齐）与 `dev`/`build`/`type-check` 脚本。
2. **最小 App.vue**：自实现极简 Pop/Wait 组件，`initCoreHostServices` 注册 pop/wait（其余 provider 暂不注入）。
3. **Editor 宿主组件**：挂载 Cvs/Menu，接 `@save-data`/`@leave`，经 `loadSaveIntoEditor` 从 localStorage（或内置空存档）加载，保存时 `prepareSavePayload` 写回 localStorage；`setCurrentSaveIdRaw` 设固定值；注册 `initAfterMainCvsRendered` 做离开拦截。
4. **浏览器内回归**：打开编辑器、编辑、保存、刷新后恢复、离开拦截、弹窗/等待、导出图片（降级项确认不崩溃）。
5. **接入 tauri**：`tauri init` 生成 `src-tauri`，配置 CSP/网络放行，注入 `apiUrlBase`；icons 静态资源随包打包。
6. **fs 化**：保存与 svg 缩略上传改本地文件读写（`@tauri-apps/plugin-fs` 或自定义 command）；persist 存储评估是否换 fs 适配。
7. **收尾**：原生对话框/右键抽象（如需要）；确认 web 侧 `analyze-deps.mjs` 的 core 闭包检查仍通过（本包不改 core，理论上无影响）；更新根 `AGENTS.md` 与 decoupling.md 第 18 步状态。
