# aarc-tauri

AARC 编辑器的**最小 Tauri 宿主**（实现中：第 1~5 步已完成，浏览器 dev 与 tauri dev 均可运行编辑器；尚未做 fs 化与收尾）。

## 运行

```sh
pnpm --filter aarc-tauri dev          # 纯浏览器 dev（http://127.0.0.1:5174）
pnpm --filter aarc-tauri tauri:dev    # tauri dev（自动拉起上面的 vite，再编译启动原生窗口）
pnpm --filter aarc-tauri type-check
pnpm --filter aarc-tauri build
```

安卓（详见 `docs/android-init.md`）：

```sh
pnpm --filter aarc-tauri android:init            # 首次：生成 gen/android 工程（之后需重跑 gen:icons 同步图标；gen/ 有手工定制，非必要勿重跑 init，见 docs/android-init.md 七）
pnpm --filter aarc-tauri android:dev             # 连接设备/模拟器的 dev 模式
pnpm --filter aarc-tauri android:build           # debug APK（universal，全 ABI）
pnpm --filter aarc-tauri android:build:release   # release APK（按 ABI 分包；需先配签名）
```

注意：tauri webview 下页面源是 `tauri://localhost`，API/数据源等出站请求依赖 `.env.development` 注入的 `VITE_ApiUrlBase`（默认 `http://localhost:5250`，对应 WebApi 的 "http" profile）与 `src-tauri/tauri.conf.json` 中的 CSP `connect-src *` 放行。

## 构建信息生成

`dev`/`build` 前会自动运行 `scripts/gen-git-info.mjs`（也可手动 `pnpm gen:git-info`），把分支/提交/构建时间写入 `public/gitInfo.json`（生成产物，已 gitignore），供 core 的"杂项"配置区底部展示；无 git 环境时写入 unknown 兜底。

## 图标生成

```sh
pnpm --filter aarc-tauri gen:icons
```

整个 `src-tauri/icons/` 目录都是生成产物，已加入 `.gitignore`；克隆仓库或改动 logo 后需先跑一次本命令再 `tauri:dev`/`tauri:build`。

`scripts/gen-icons.mjs` 以 `aarc-web/public/aarc-logo-background.svg`（渐变背景层）与 `aarc-web/public/aarc-logo-foreground.svg`（透明底白色 Λ 前景层）为源，经 `sharp`（SVG 栅格化，跨平台保留 alpha）与 `png2icons`（纯 JS 打包 icns/ico）生成：

- **macOS**：`icon.icns`（全尺寸）与桌面通用 png（squircle：824/1024 居中、圆角约 22.37%），Dock 圆角由此烘焙进资源，macOS 不会自动裁圆角
- **Windows**：`icon.ico`（同一 squircle 源）与 Store 磁贴 `Square*Logo.png` / `StoreLogo.png`（满幅版）
- **Android**：`android/mipmap-*/` 下 adaptive icon 前景/背景层（Λ 缩至 85% 居中，落在 66dp 安全区内；厂商遮罩形状由系统套用，无需按厂商区分）与 legacy 方/圆图标；`mipmap-anydpi-v26/ic_launcher.xml` 固定引用渐变 mipmap 背景。生成后**自动同步**到 `gen/android/app/src/main/res/`（`tauri android init` 只会生成默认 logo，不会使用这里的定制图标；未 init 则跳过并提示，init 后重跑本脚本即可）；同步进 `res/` 的 `mipmap-*` 同样是生成产物，已加入 `.gitignore` 不入库
- **iOS**：`ios/AppIcon-*.png` 全套（满幅版，经 `removeAlpha` 去除 alpha——App Store 不允许图标带透明通道）

改动 logo 后重跑一次即可；不要用 `tauri icon` 覆盖（它会把 Android 前景塞成满幅、背景改回纯色）。

目标：以最小装配跑通 `aarc-core` 编辑器（Cvs/Menu 及其闭包），验证"core + 非 web 宿主"的拆分成果，后续演进为具备本地文件读写能力的完整 `aarc-tauri`。

## 定位与边界

- **只跑编辑器**：不复制 `aarc-web` 的站点功能（pages、路由、账号、API 层、Demo 模式等）。
- 复用 `aarc-core`：经 workspace 源码导出依赖（`"aarc-core": "workspace:*"`），由本包的 vite 统一打包，与 aarc-web 相同的方式保证 vue/pinia 单实例。
- 参考文档（实现前必读）：
  - `aarc-core/README.md` —— core 需要宿主提供的全部功能清单及 web 对照实现
  - `aarc-web/docs/decoupling/decoupling.md` —— §3.1 宿主服务接口、§5 第 18 步（tauri 注意事项）

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
- `saveInfo`：不注入则导出文件名退化为存档 id，不阻断导出。（拼音转换已于 2026-09 改为 core 本地实现，无需注入、自动可用。）
- `cloudSvgUploader`：不注入则"云端SVG"配置区整体隐藏；minimal 阶段也可注入 noop/本地保存占位，tauri 阶段换 fs 实现。
- `initOpenFavoritesSidebar`：不注入则"添加资源"按钮隐藏（被调用时仅 `console.warn`）。
- `fileSaver`：core 默认用浏览器 `<a download>` 下载兜底，tauri webview 下不可靠，**本包已注入原生实现**：`src/fileSaver.ts`（`main.ts` 经 `isTauri()` 判断仅在 tauri 环境注入，浏览器 dev 仍走默认下载）。实现按平台分流：
  - **安卓**：图片（png/jpeg/webp/gif，gif/apng 导出的文件名也在此列）经 `tauri-plugin-android-fs` 的 MediaStore API 写入系统相册 `Pictures/AARC/`（子目录名即相册名）；不支持进相册的格式（svg、txt 等）用 Pop 报错，不落盘。权限：`android-fs:allow-create-new-public-image-file` + `android-fs:allow-write-file`（见 `src-tauri/capabilities/default.json`）；插件 feature `legacy_storage_permission` 仅为 Android 9 及以下补 `WRITE_EXTERNAL_STORAGE`
  - **桌面（Win/Mac）**：plugin-dialog `save` 弹"另存为" + plugin-fs `writeFile` 写盘，对话框选中的路径自动进入 fs 运行时 scope。导出名先经 `src/fsFileName.ts` 的 `safeFileNamePart` 清洗（非法字符→`_`、去结尾点/空格、限长、避开 Windows 保留名），并传 `filters` 让系统补全扩展名——存档名是用户输入，含 `\ / : * ? " < > |` 等字符时 Windows 的 `IFileDialog::SetFileName` 会失败，而 rfd 把对话框构建失败与用户取消折叠成同一个 `null`（JS 侧不可区分），表现为"点了没反应也不报错"，故 `!path` 分支留 `console.warn` 线索。安卓同用清洗后的名字，避免名字里的 `/` 改变相册子目录。

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
6. **fs 化**：保存与 svg 缩略上传改本地文件读写（`@tauri-apps/plugin-fs` 或自定义 command）；persist 存储评估是否换 fs 适配。（已部分完成：导出落盘经 core 的 `fileSaver` 注入——桌面走 dialog+fs，安卓走 MediaStore 相册，见"二、可省略"末节）
7. **收尾**：原生对话框/右键抽象（如需要）；确认 web 侧 `analyze-deps.mjs` 的 core 闭包检查仍通过（本包不改 core，理论上无影响）；更新根 `AGENTS.md` 与 decoupling.md 第 18 步状态。
