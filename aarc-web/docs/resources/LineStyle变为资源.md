# LineStyle 变为资源（上传为 UserFile 并作 dataSource 引入）实现路线分析

> 本文是**尚未实施**的改造方案。前端已拆分为 `aarc-core`（编辑器核心）与 `aarc-web`（站点），
> 本文已按新架构更新路径与机制描述：编辑器内的样式预览/导入导出/数据源逻辑都在 core，
> userFile 上传/收藏 UI 在 web，core 通过注入回调与窄投影 DTO 与宿主交互
> （见 `aarc-core/README.md` 与 `aarc-web/docs/decoupling.md`）。

## 目标

1. 在线路样式配置页一键把当前存档的 LineStyle 打包成 JSON 上传为 UserFile
   （`UserFileType.LineStyle`），同时上传由预览渲染逻辑生成的预览图作为缩略图。
2. 该 UserFile 的公开 URL 可被其他存档作为 `dataSources`（type: `lineStyles`）引入，
   实现跨存档/跨用户的样式共享。

## 现状盘点（可复用的零件）

### UserFile 上传/存储（后端零改动即可支持）

- `POST /api/UserFile/Upload` 已接受 `.json`（`UserFileRepo.cs:29-30` 的 `extAllowed`），
  且 `thumb` 参数对任意类型都有效：`UserFileService.Write` 把缩略图存为
  `<md5>_tb.webp`（`UserFileService.cs:18-19`），`GetUrl` 在缩略图缺失时回退原文件 URL。
  **后端无需任何修改**。
- `UserFileType.LineStyle = 1` 枚举已存在。
- 文件通过静态中间件 `/userfile/{md5前两位}/{md5}.json` **匿名可访问**——这是
  dataSource 机制能跨用户生效的关键前提（任何人打开存档都可能触发数据源拉取）。
- 文件名按内容 MD5 命名：URL 天然稳定且内容寻址，重复上传同一 JSON 不会产生新文件，
  适合做数据源的长期引用。

### 前端上传组件（`aarc-web/src/components/common/userFile/`）

拆分后上传 UI 整体留在 web 侧（core 不接触 API 层）：

- `UserFileUpload.vue`：按 `type` 分派到 `ImageUpload`（Icon，:16）或
  `GenericFileUpload`（其余类型，:24）。
- `GenericFileUpload.vue`：目前只接受 `application/json`（:131），上传时**不传缩略图**
  （:89 `userFileThumb` 传 `undefined`）。需要扩展：允许调用方附带一个预览图 Blob。

### 收藏与"取用"流程（UserFileFavorites）

拆分后这是一套**跨包的双向回调**机制（decoupling 第 20 步）：

- store 在 core：`aarc-core/src/models/stores/utils/userFileFavoriteStore.ts`。
  - `initOpenFavoritesSidebar(cb)`（:9）：由**宿主**注入"打开收藏夹侧栏"的实现；web 侧在
    `aarc-web/src/components/common/userFile/UserFileFavorites.vue:37` 注册。未注入被调用时
    `console.warn`（每次注册周期仅警告一次）。
  - `onFavoriteFileSelected`（:21）：仍是一个可赋值的 ref，由**消费方**注册。目前唯一消费方
    是图标：core 的 `iconStore.ts:167-168` 注册了它，把选中的 UserFile 转为 `textTagIcons`
    条目（displayName→name，urlOriginal→绝对 URL）。
  - 收藏夹 UI 在 web：`UserFileFavorites.vue:45-46` 用户点"取用"时调用
    `onFavoriteFileSelected.value(file)`。
  - 传给 core 的 `UserFileDto` 是**窄投影**（`aarc-core/models/types/apiShapes.ts`，仅
    `displayName`/`urlOriginal` 等少数字段），web 侧 `apiShapesAssert.ts` 做编译期形状断言。
- 入口：`aarc-core/src/components/sidebars/configs/TextTagIconConfig.vue:69` 的"添加资源"
  按钮调 `userFileFavoriteStore.openFavoritesSidebar()`（store action，不再直接操作 ref）。
- 收藏夹条目展示依赖 `urlThumb`（30×30 缩略图）——**这正是 LineStyle 上传时必须
  附带预览图的原因**：否则 JSON 文件在收藏夹里没有可视缩略图。
- 收藏入口在 `aarc-web/src/pages/components/UserFavoriteStar.vue`（文件列表页
  `aarc-web/src/pages/files/component/UserFiles.vue:101` 使用）。
- 注意：`onFavoriteFileSelected` 仍是**单一回调**，当前 iconStore 无条件注册。新增
  LineStyle 消费方时不能直接再注册一个（会互相覆盖），需要改造 store（见下文第 3 步）。

### 数据源机制（`aarc-core/src/models/save/dataSourceOps.ts`）

- `DataSource` 的 `type: 'lineStyles'` 已存在；`mergeDataSourceItems`（:58）把 fetch 到的
  JSON 数组合并进 `save.lineStyles`（按 name 去重、`overwriteSameName` 控制覆盖、
  上限 32 条、响应 64KB）。
- `fetchDataSource`（:16）对 URL 做 `convertToProxyUrlIfNeeded(url, 'json')`
  （`aarc-core/src/utils/urlUtils/proxyUrl.ts:10`）后 fetch。
  **注意点**：UserFile 的 `urlOriginal` 是相对路径 `/userfile/...`，作为数据源必须
  先拼成绝对 URL，否则其他部署/端口下拉不到。core 不读 `import.meta.env`，应使用
  `getCoreConfig().apiUrlBase` 或 `window.location.origin` 拼接（参考
  `iconStore.ts:40,174` 的做法）。
- 样式导入的格式兼容已解决：`aarc-core/src/components/sidebars/configs/LineStylesConfigReuse.vue`
  的导出格式就是 `LineStyle[]` JSON（`exportToFile` :66），导入侧有 `upgradeLineStyle`
  升级旧版格式——上传内容直接复用这套序列化即可。

### 预览渲染逻辑（已抽离为公共模块）

- 公共模块 `aarc-core/src/models/cvs/common/lineStylePreview.ts`（第 1 步已实施）：
  - `drawLineStylePreview(ctx, lineStyle, dynaColor)`：在 400×60 内容条带上白底 +
    居中水平线，复用 `strokeStyledLine`；画布尺寸由常量 `lineStylePreviewCvsWidth` /
    `lineStylePreviewCvsHeight` 导出。
  - `renderLineStylePreviewBlob(lineStyle): Promise<Blob|null>`：静态渲染一次，输出
    **正方形**（400×400）webp Blob 作资源缩略图——内容条带垂直居中，上下多出的部分
    白色填充；动态色固定为 `#3399FF`，保证同一样式产出相同 md5。
- 配置页组件 `LineStylesConfig.vue` 的 `renderPreviewCvsOf` 已改为调用
  `drawLineStylePreview`，动态色仍由时间戳 hue 计算（每 100ms 重绘产生流动效果）。

## 实现路线

### 第 1 步：抽出可复用的预览图生成函数（core）✅ 已完成

已新建 `aarc-core/src/models/cvs/common/lineStylePreview.ts`：

```ts
export function drawLineStylePreview(ctx, lineStyle, dynaColor): void
export function renderLineStylePreviewBlob(lineStyle: LineStyle): Promise<Blob | null>
```

- `renderLineStylePreviewBlob` 输出**正方形**（400×400）webp：内容条带（400×60）
  垂直居中，上下多出的部分白色填充；动态色固定 `#3399FF`，避免每次生成不同图
  导致 md5 抖动。
- `LineStylesConfig.vue` 的 `renderPreviewCvsOf` 已改为调用 `drawLineStylePreview`，
  两处绘制逻辑不会漂移。

### 第 2 步：添加快捷上传入口（core 发起，web 执行）

上传本身需要 API 客户端，而 API 层在 web——core 不能直接调 `api.userFile.upload`。
两种做法：

- **推荐**：仿照云上传/收藏夹的注入模式，在 core 定义 `initUserFileUploader` 注入口
  （参数：JSON Blob、缩略图 Blob、默认 displayName、UserFileType），web 侧用现有上传
  逻辑实现并注册。core 的 `LineStylesConfigReuse.vue`（已有选择多条样式的勾选 UI）加
  "上传为资源"按钮，选中 N 条后：
  1. `deepClone` 选中样式，`JSON.stringify`（与 `exportToFile` 同格式）。
  2. 逐条调用第 1 步函数生成预览图，合成一张（竖向拼接，或仅取第一条的预览）。
  3. 调注入的上传器，由 web 完成
     `api.userFile.upload({data: jsonBlob, fileName: 'xxx.json'},
     {data: thumbBlob, fileName: 'thumb.webp'}, displayName, intro, UserFileType.LineStyle)`。
  4. 成功后提示用户去"文件"页收藏（或上传成功后自动调收藏接口，
     `api.userFavorite` 相关方法，可省去手动收藏一步）。
- 或者：给 web 的 `GenericFileUpload.vue` 增加可选的 `thumb` prop/参数，由 web 页面提供
  "上传 LineStyle"入口，core 只负责产出预览图 Blob（经注入口传出）。前者更"快捷"，
  后者对 core 侵入更小。

### 第 3 步：改造收藏回调 store 以支持多消费方（core）

`userFileFavoriteStore.ts` 目前是单一 `onFavoriteFileSelected`。改为：

- `openFavoritesSidebar` 接受参数：`open(intent: 'icon' | 'lineStyle' | 'dataSource-lineStyles')`，
  或
- 把 `onFavoriteFileSelected` 改为"打开时由调用方传入回调"：store 增加
  `pendingCallback`，`openFavoritesSidebar(cb?)` 时记录。

最小侵入做法：store 增加 `pendingCallback`，web 的 `UserFileFavorites.vue` 选中文件时
优先调 `pendingCallback`，无则回退现有 `onFavoriteFileSelected`（保持图标流程不变）。
注意 store 在 core、收藏夹 UI 在 web，两者经 store 共享状态，不涉及新的跨包依赖。

### 第 4 步：从收藏引入为数据源（core）

在 `aarc-core/src/components/sidebars/configs/DataSourcesConfig.vue` 的"添加数据源"区加
"从收藏选择"按钮：

1. 用第 3 步的机制打开收藏夹，回调中拿到 `UserFileDto`（窄投影，含
   `displayName`/`urlOriginal`）。
2. 拼绝对 URL：`getCoreConfig().apiUrlBase + file.urlOriginal`（或
   `window.location.origin + urlOriginal`，与 iconStore 一致）。
3. 自动填入创建表单（type 固定 `lineStyles`，name 取 displayName），走现有
   `addDataSource` 流程（URL 查重、id 分配不变）。
4. 可选优化：`UserFileFavorites`（web）按 `UserFileType` 过滤列表（需要后端
   `GetUserFiles` 支持 type 参数——目前不支持，属于可选的后端小改；不改则靠前端的
   预览图/名称辨认）。

引入后的拉取、合并、自动更新全部由现有 `dataSourceOps.ts` 与 core 会话 API
（`editorSession.ts` 的 `loadSaveIntoEditor` 内部调 `autoUpdateDataSources`）接管，
无需改动。样式变化后 `lineStyles` 的 watch 会自动触发 `envStore.rerender()` 重绘
（DataSourcesConfig 的 `loadDataSource` 已处理）。

## 风险与注意点

- **数据源 URL 必须绝对化**：相对路径在非编辑器域名下会拉取失败；且 dev 环境前端
  与 API 不同源。core 内拼 URL 只能用 `getCoreConfig().apiUrlBase` /
  `window.location.origin`，不能读 `import.meta.env`。
- **内容寻址 = 不可变**：同一 URL 内容永远相同（改样式重新上传会得到新 md5 URL），
  数据源的 `autoUpdate` 对 userFile 类 URL 实际无意义（内容不会变），但机制上无害。
- **预览图颜色固定**：必须用固定 dynaColor 渲染预览，否则同一样式每次上传缩略图
  md5 不同、产生垃圾文件；服务端目前不清理失去引用的文件（`UserFileRepo.cs` 内有
  TODO）。
- **收藏回调全局唯一**：第 3 步不做的话，LineStyle 的取用回调会覆盖 iconStore 注册
  的回调，导致图标"取用"功能串线。
- **跨包边界**：上传调 API 必须经注入口由 web 执行，core 不能 import web 的 apiStore
  （core → web 依赖被 `aarc-web/analyze-deps.mjs` 在构建时禁止）。
- **后端校验**：JSON ≤ 3MB 限制对样式足够；缩略图走 `_tb.webp` 约定，前端必须传
  webp。
- 后端 `Search`（匿名可见）需要 View 授权，但 `/userfile/**` 静态文件本身无鉴权，
  数据源拉取不受授权影响——分享 URL 即分享文件。

## 改动清单预估

| 文件 | 改动 |
|---|---|
| `aarc-core/src/models/cvs/common/lineStylePreview.ts` ✅ | 已新建：`drawLineStylePreview` + `renderLineStylePreviewBlob`（正方形 webp） |
| `aarc-core/src/components/sidebars/configs/LineStylesConfig.vue` | ✅ 已改为复用 `drawLineStylePreview`；待做：可选单条上传按钮 |
| `aarc-core/src/components/sidebars/configs/LineStylesConfigReuse.vue` | "上传为资源"按钮，调注入的上传器 |
| `aarc-core/src/models/stores/utils/userFileFavoriteStore.ts` | 支持按调用方传入回调（pendingCallback） |
| `aarc-web/src/components/common/userFile/UserFileFavorites.vue` | 优先消费传入回调；（可选）类型过滤 |
| `aarc-core/src/components/sidebars/configs/DataSourcesConfig.vue` | "从收藏选择"入口 |
| core 新增上传器注入口 + web 侧实现 | core 定义 `initUserFileUploader`，web 用 `api.userFile.upload` 实现 |
| （可选）`aarc-web/.../GenericFileUpload.vue` | 支持携带缩略图上传 |
| 后端 | 无必需改动（可选：GetUserFiles 加 type 过滤） |
