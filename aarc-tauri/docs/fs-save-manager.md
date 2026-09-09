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
    groupId?: string    // 所属分组 id；缺省或指向已删除分组时按"未分组"处理
    createdAt: number
    updatedAt: number   // 每次保存时更新，列表按它倒序
}
interface SaveGroup {
    id: string
    name: string
    order: number       // 组间显示顺序，归一化为 0..n-1
}
interface SaveIndex { saves: SaveIndexEntry[]; groups: SaveGroup[] }
```

- **分组**（2026-09-09 新增）：存储依然扁平（存档文件布局不变），分组只是 index.json 里的元数据——`groups` 数组维护组定义（含用户可调的 `order`），存档经 `groupId` 引用。旧 index.json 无 `groups` 字段，读取时按空数组处理，零迁移成本。删除分组不删存档，成员回到未分组。

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
    listGroups(): Promise<SaveGroup[]>                 // 按 order 升序
    createGroup(name: string): Promise<SaveGroup>
    renameGroup(id: string, name: string): Promise<void>
    removeGroup(id: string): Promise<void>             // 成员回未分组，不删存档
    moveGroup(id: string, delta: number): Promise<void>  // 组间排序（上移/下移）
    setSaveGroup(saveId: string, groupId?: string): Promise<void>  // 缺省 = 未分组
}
```

分组相关操作只碰清单，其变更逻辑抽成 `idx*` 纯函数（`idxCreateGroup`/`idxMoveGroup` 等），两个实现各自 read → 变更 → write。

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
  - **删除**：先弹确认 Modal（标题"确认删除「名字」？"，描述"本操作不可撤销"；删除非空分组时追加一行"x个存档将变为未分组状态"，覆盖在最上层，存档与分组删除共用），确认后删文件并移出清单；禁止删除当前正在编辑的存档（按钮禁用或先切走）。
  - **搜索**：顶部搜索框按名称过滤（不区分大小写），搜索时忽略分组扁平展示。
  - **分组**（2026-09-09 新增）：列表按组分节，组头显示组名 + 存档数，点击折叠（折叠状态存 localStorage 键 `aarc-tauri-save-groups-collapsed`，纯 UI 态）；组头提供 ↑/↓ 调序、重命名、删除（成员回未分组）；存档项的"分组"按钮打开独立 Modal（覆盖在管理器上层，标题"为「存档名」设置分组"）：现有分组 + 未分组 + 新建分组。"未分组"固定排在所有分组之后且仅在有内容时显示；脏 `groupId`（指向已删分组）渲染时兜底进未分组。
- 样式参考本包 `Pop.vue` 的简洁风格，遮罩 + 居中卡片即可；`Esc`/点遮罩关闭。

### 3.4 Editor.vue 接线改造

- `localSaveId` 常量变 **`ref<string>` 当前存档 id**，启动时从 localStorage 键 `aarc-tauri-current-save` 恢复；无记录或指向已删存档时取清单中 `updatedAt` 最新者，清单为空则现场新建一个空白存档。每次切换/保存后回写该键。
- `load()` 改为按当前 id 走 `saveStorage.load(id)`（不再直接碰 localStorage）。
- `saveData()` 写 `saveStorage.store(id, name, payload)`；写失败要 `showPop('保存失败', 'failed')` 且**不** `releasePreventLeaving()`（保持脏态拦截）。
- `leave()` 改为打开 `SaveManagerModal`。
- **切换存档流程**（Modal 回调）：~~运行时切换（dispose + loadSaveIntoEditor 重载）~~ **仿照 web 的彻底 reload**：把目标存档 id 写入 `aarc-tauri-current-save` 后 `window.location.reload()`，启动流程自然加载目标存档。原因见"修订记录"。
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

## 五、修订记录

- **2026-09-09 存档分组**（§3.1/§3.2/§3.3）：存储保持扁平，分组信息全部在 index.json（`groups` 数组 + 存档的 `groupId`），支持自定义组间顺序（`order` 字段 + `moveGroup`）；组头折叠/重命名/删除，存档经"分组"菜单移动或新建组。搜索时忽略分组扁平过滤。
- **2026-09-07 切换存档改为整页 reload**（§3.4）。初版实现按原计划做运行时切换（`disposeEditor` + `loadSaveIntoEditor` 重载 + 调 `Cvs` 暴露的 `init()` 重渲染），但运行时切换存在一组状态清理缺陷——画布空白不自愈、Scaler 尺寸缓存不重置、`config` 跨存档串台（切换后保存会把旧存档的整套 config 写进新存档）等，完整清单与修复方案见 `aarc-web/docs/save-switching-problems.md`。这些问题修复前，本包与 web 保持一致：切换存档 = 写入目标 id 到 `aarc-tauri-current-save` + `window.location.reload()`。该文档 §4 的修复集落地后，可再回到运行时切换方案（届时需一并处理 §2.1/§2.2/§2.4 等阻断级问题）。
