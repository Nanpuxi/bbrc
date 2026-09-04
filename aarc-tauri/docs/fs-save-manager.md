# aarc-tauri 存档 fs 化与存档管理器

> 计划文档（2026-09-05）。目标：把存档从单个 localStorage 迁移到文件系统，并把 core 的"离开"按钮接成存档管理器 Modal。
> 对应 README「推荐实现步骤」第 6 步（fs 化）的主体部分。

## 一、现状

- **存档读写**：`src/components/Editor.vue` 使用固定标识 `local`，整个存档 JSON 序列化后存在单个 localStorage 键 `aarc-tauri-save-local` 下；只能有一个存档。
  - 加载：`localStorage.getItem` → `JSON.parse` → `loadSaveIntoEditor(raw, ...)`（`aarc-core/app/editorSession.ts`，normalize → 写 store → 数据源自动更新 → 图标加载 → undo 基线）。
  - 保存：core Menu 组件 `@save-data` → `prepareSavePayload()` → `JSON.stringify` 写回 localStorage；带 1 秒防抖，`releasePreventLeaving()`。
- **保存/离开按钮**：core 的 `Menu.vue` 是同一个按钮——脏（`preventLeaving` 置位）时显示"保存"并 emit `saveData`，干净时显示"离开"并 emit `leave`。**因此 `leave` 触发时数据必定已保存**，切存档无需再提示保存。
- **当前 `leave()`**：仅弹个提示，无实际功能。
- **存档 id**：`setCurrentSaveIdRaw('local')` 固定值（`aarc-core/models/save/currentSaveId.ts`）。core 导出图片时用 `getCurrentSaveIdNum()` 取数值 id，经宿主注入的 `saveInfo` provider 查存档名命名导出文件；非数值 id 则退化为原样字符串。
- **存档元数据**：core 的 `Save` 模型内**没有**存档名字段（web 侧名字存在服务端）。tauri 需要自己维护"id ↔ 名字/时间"的元数据。`saveStaCount`/`saveLineCount`（`aarc-core/models/save.ts`）可从存档内容算站点/线路数用于列表展示。
- **fs 能力**：已有 `@tauri-apps/plugin-fs` + `@tauri-apps/plugin-dialog` 依赖，`src/fileSaver.ts` 用 `save` 对话框 + `writeFile` 实现导出落盘。但 `src-tauri/capabilities/default.json` 目前只放行 `fs:allow-write-file`/`fs:allow-write-text-file`（且 scope 来自对话框运行时授权），**没有**读目录/读文件/建目录/删文件能力，也没有 `$APPLOCALDATA` 的静态 scope。
- **浏览器 dev 兼容**：README 要求浏览器 dev 模式（`pnpm dev`）与 tauri dev 都能跑编辑器，`isTauri()`（`@tauri-apps/api/core`）已是现有环境判断手段。

## 二、目标

1. 存档持久化到文件系统（tauri 环境），支持**多个**本地存档。
2. 点击 core 的"离开"按钮 → 打开本包自实现的**存档管理器 Modal**：列出全部存档，点击加载对应存档；提供新建/重命名/删除。
3. 浏览器 dev 模式保持可用（降级为 localStorage 多存档实现）。
4. 不动 core 的任何代码。

## 三、设计

### 3.1 存储布局（tauri 环境）

目录：`BaseDirectory.AppLocalData` 下的 `saves/`（即 `$APPLOCALDATA/saves/`）。

```
saves/
├── index.json          # 存档清单（元数据）
├── 1757xxxxxx01.json   # 存档数据，文件名即存档 id
└── ...
```

- **存档 id**：用数值字符串（时间戳 + 两位随机数，如 `String(Date.now()) + pad(random)`）。数值 id 的好处：`getCurrentSaveIdNum()` 能解析，可顺势注入 core 的 `saveInfo` provider，让导出图片文件名使用存档名而非 id。
- **`index.json`（manifest）**：列表页只读它，避免为列表面解析每个大存档文件。

```ts
interface SaveIndexEntry {
    id: string          // 数值字符串，与文件名一致
    name: string        // 显示名，重命名时更新
    createdAt: number
    updatedAt: number   // 每次保存时更新，列表按它倒序
}
interface SaveIndex { saves: SaveIndexEntry[] }
```

- **存档文件内容**：`prepareSavePayload()` 返回的 `Save` 直接 `JSON.stringify`，不加包装层（与 web 服务端存档数据同构，未来互通/导入更容易）。站点数/线路数在列表项展开或加载时经 `saveStaCount`/`saveLineCount` 现算，不进 manifest（避免两处维护）。

### 3.2 存储适配层（浏览器 dev 降级）

新建 `src/saves/` 目录，对外只暴露统一接口：

```ts
// src/saves/saveStorage.ts
export interface SaveStorage {
    list(): Promise<SaveIndexEntry[]>                  // 按 updatedAt 倒序
    load(id: string): Promise<unknown>                 // 返回未 normalize 的原始 JSON 对象
    store(id: string, name: string, data: unknown): Promise<void>  // 新建或覆盖，更新 manifest
    rename(id: string, name: string): Promise<void>
    remove(id: string): Promise<void>
}
```

两个实现，模块内按 `isTauri()` 选择导出：

- `tauriFsSaveStorage`：`@tauri-apps/plugin-fs` 的 `mkdir`/`exists`/`readTextFile`/`writeTextFile`/`remove`，全部以 `{ baseDir: BaseDirectory.AppLocalData }` 作用在 `saves/` 下。首次使用确保目录存在；`index.json` 缺失/损坏时按空清单重建（可选：扫描目录内 `*.json` 兜底重建清单）。
- `browserSaveStorage`：localStorage 实现——清单存键 `aarc-tauri-saves-index`，每个存档存 `aarc-tauri-save-<id>`。保持浏览器 dev 可完整验证存档管理器交互。

**旧数据迁移**：模块初始化（首次 `list()`）时检查旧键 `aarc-tauri-save-local`：存在则作为名为"本地存档"的存档导入（id 新生成、写文件/新键、入清单），随后删除旧键。两个实现各自的存储介质内都可能存在旧键（tauri webview 也有 localStorage），迁移逻辑放在适配层公共入口统一做一次。

### 3.3 存档管理器 Modal

新建 `src/components/SaveManagerModal.vue`（本包自实现，不改 core）：

- 打开时机：`Editor.vue` 的 `leave()` 中打开（此刻数据必定已保存干净，见"现状"）。
- 内容：存档列表（当前存档高亮），每项显示 **名字、最后保存时间**；操作：
  - **点击列表项** → 加载该存档并关闭 Modal（点当前项则仅关闭）。
  - **新建存档**：以默认名（"新存档"）创建空白存档并立即切入（走加载流程，core `normalizeSave({})` 会按全新存档初始化）。
  - **重命名**：行内输入或 `prompt` 式小输入框，仅改 manifest。
  - **删除**：确认后删文件并移出清单；禁止删除当前正在编辑的存档（按钮禁用或先切走）。
- 样式参考本包 `Pop.vue` 的简洁风格，遮罩 + 居中卡片即可；`Esc`/点遮罩关闭。

### 3.4 Editor.vue 接线改造

- `localSaveId` 常量变 **`ref<string>` 当前存档 id**，启动时从 localStorage 键 `aarc-tauri-current-save` 恢复；无记录或指向已删存档时取清单中 `updatedAt` 最新者，清单为空则现场新建一个空白存档。每次切换/保存后回写该键。
- `load()` 改为按当前 id 走 `saveStorage.load(id)`（不再直接碰 localStorage）。
- `saveData()` 写 `saveStorage.store(id, name, payload)`；写失败要 `showPop('保存失败', 'failed')` 且**不** `releasePreventLeaving()`（保持脏态拦截）。
- `leave()` 改为打开 `SaveManagerModal`。
- **切换存档流程**（Modal 回调）：
  1. `disposeEditor()`（注销主画布渲染回调）
  2. `setCurrentSaveIdRaw(newId)` + 更新 ref + 回写 localStorage
  3. `loadSaveIntoEditor(raw, ...)` 加载新存档（undo 基线由 core 重建）
  4. 重新注册 `mainCvsDispatcher.initAfterMainCvsRendered(preventLeaving)`（与 `onBeforeMount` 中相同的回调）
  5. Cvs/Menu 已挂载则不重挂载——存档数据走 store 驱动重渲染；若实测有派生态残留，再用 `loadComplete` 先 `false` 后 `true` 强制重挂载兜底。
- 顺带注入 `saveInfo` provider（`initCoreHostServices` 或 `initSaveInfoProvider`）：按 `getCurrentSaveIdNum()` 从 manifest 查名字，让导出图片文件名使用存档名（id 设计为数值字符串正是为此）。

### 3.5 tauri 权限与配置

`src-tauri/capabilities/default.json` 增加：

```json
"fs:allow-read-text-file",
"fs:allow-mkdir",
"fs:allow-exists",
"fs:allow-remove",
{ "identifier": "fs:scope", "allow": [{ "path": "$APPLOCALDATA/saves/**" }] }
```

（现有两条 write 权限保留给导出对话框的运行时 scope。）无需新增 Rust command，纯 JS 侧 plugin-fs 即可。无需新增 npm 依赖（`@tauri-apps/plugin-fs` 的 `path`/`BaseDirectory` 由 `@tauri-apps/api` 提供）。

### 3.6 范围外（本次不做）

- pinia `persistedstate` 的 5 个 core store 仍走 localStorage（存的是 UI 态，不是存档本体）；是否换 fs 适配另行评估（README 第 6 步原话）。
- "云端 SVG 缩略上传"的 fs 化（`cloudSvgUploader`）另行处理。
- 存档导入/导出（`.aarc` 文件互传）、自动备份，后续再加。

## 四、实施步骤

1. `src/saves/saveStorage.ts`：接口 + 双实现 + 旧键迁移。
2. `src-tauri/capabilities/default.json` 加 fs 权限与 `$APPLOCALDATA/saves/**` scope；`pnpm tauri:dev` 验证 `saves/` 目录可建、可读写删。
3. `src/components/SaveManagerModal.vue`：列表 + 新建/重命名/删除 + 点击加载。
4. `Editor.vue` 改造：当前存档 id 状态化、`saveData`/`leave`/切换流程接线、`saveInfo` provider 注入。
5. 回归验证：
   - `pnpm --filter aarc-tauri type-check` 通过；
   - 浏览器 dev：新建/编辑/保存/刷新恢复/重命名/删除/切换存档全链路；
   - `pnpm --filter aarc-tauri tauri:dev`：同上，并确认文件落在 `$APPLOCALDATA/saves/`（macOS: `~/Library/Application Support/com.aarc.app/saves/`），旧 localStorage 存档被自动迁移；
   - 导出图片文件名使用存档名。
6. 收尾：更新本包 README（第 6 步状态、存档位置说明）与根 `AGENTS.md` 中 aarc-tauri 的描述。
