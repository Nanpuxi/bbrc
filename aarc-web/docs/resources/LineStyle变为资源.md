# LineStyle 变为资源（上传为 UserFile 并作 dataSource 引入）实现路线分析

> 本文所述改造已**全部实施**（下文各步骤均标注 ✅ 并记录实际做法），保留作实现路线与
> 现状机制的记录。前端已拆分为 `aarc-core`（编辑器核心）与 `aarc-web`（站点）：
> 编辑器内的样式预览/导入导出/数据源逻辑都在 core，userFile 上传/收藏 UI 在 web，
> core 通过注入回调与窄投影 DTO 与宿主交互
> （见 `aarc-core/README.md` 与 `aarc-web/docs/decoupling.md`）。

## 目标

1. 在线路样式配置页一键把当前存档的 LineStyle 打包成 JSON 上传为 UserFile
   （`UserFileType.LineStyle`），同时上传由预览渲染逻辑生成的预览图作为缩略图。
2. 该 UserFile 的公开 URL 可被其他存档作为 `dataSources`（type: `lineStyles`）引入，
   实现跨存档/跨用户的样式共享。

## 现状盘点（可复用的零件）

### UserFile 上传/存储（最初评估后端零改动即可支持；后续为同名覆盖与按 id 固定链接增加了端点，见第 2.5/4 步）

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
- `GenericFileUpload.vue`：只接受 `application/json`。曾计划扩展"携带预览图 Blob 上传"，
  最终未采用该路线（LineStyle 上传改走 core 注入口，见第 2 步）；现已接入同名覆盖
  预检（`uploadUserFileGuarded`，见第 2.5 步）。

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
- 注意：`onFavoriteFileSelected` 曾是**单一回调**（iconStore 无条件注册），直接新增
  LineStyle 消费方会互相覆盖——已按第 3 步改造为一次性取用意图，图标流程不受影响。

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
  的导出格式就是 `LineStyle[]` JSON（`exportToFile`），导入侧有 `upgradeLineStyle`
  升级旧版格式——上传内容直接复用这套序列化。
- **pattern 跨存档问题**：`LineStyle.layers[].pattern` 只存本存档的 pattern id，跨存档
  导入后无意义甚至撞 id。上传路径已在打包前把各层引用的完整 pattern 深拷贝嵌入
  `layers[].patternEmbedded`（`LineStylesConfigReuse.vue` 的 `embedReferencedPatterns`，
  仅上传时做，导出到剪切板/文件不嵌入）。渲染（`strokeStyledLine`）优先使用嵌入
  pattern（经 `patternStore.getRenderedOf` 直接渲染 Pattern 对象），配置 UI 在图层
  带嵌入 pattern 时显示"已使用嵌入pattern"，并提供"移除嵌入"按钮（移除时连同
  源存档的 pattern id 一并清除，回到普通 id 选择）。

### 预览渲染逻辑（已抽离为公共模块）

- 公共模块 `aarc-core/src/models/cvs/common/lineStylePreview.ts`（第 1 步已实施）：
  - `drawLineStylePreview(ctx, lineStyle, dynaColor, bgColor?)`：在 400×60 内容条带上
    背景填充 + 居中水平线，复用 `strokeStyledLine`；画布尺寸由常量
    `lineStylePreviewCvsWidth` / `lineStylePreviewCvsHeight` 导出。`bgColor` 同时用作
    背景填充与 `colorMode==='bg'`（跟随背景色）层的颜色来源，缺省白色。
  - `renderLineStylePreviewBlob(lineStyle): Promise<Blob|null>`：静态渲染一次，输出
    **正方形**（400×400）webp Blob 作资源缩略图——内容条带垂直居中，上下多出的部分
    白色填充；动态色固定 `#3399FF`、背景**固定白色**（不传 bgColor），保证同一样式
    产出相同 md5。
- 配置页组件 `LineStylesConfig.vue` 的 `renderPreviewCvsOf` 调用 `drawLineStylePreview`
  并传入实际 `configStore.config.bgColor` 作背景（"跟随背景色"的层在预览中可见），
  动态色仍由时间戳 hue 计算（每 100ms 重绘产生流动效果）。

## 实现路线

### 第 1 步：抽出可复用的预览图生成函数（core）✅ 已完成

已新建 `aarc-core/src/models/cvs/common/lineStylePreview.ts`：

```ts
export function drawLineStylePreview(ctx, lineStyle, dynaColor, bgColor?): void
export function renderLineStylePreviewBlob(lineStyle: LineStyle): Promise<Blob | null>
```

- `renderLineStylePreviewBlob` 输出**正方形**（400×400）webp：内容条带（400×60）
  垂直居中，上下多出的部分白色填充；动态色固定 `#3399FF`、背景固定白色，
  避免每次生成不同图导致 md5 抖动。
- `LineStylesConfig.vue` 的 `renderPreviewCvsOf` 调用 `drawLineStylePreview`（配置页
  预览传实际背景色），两处绘制逻辑不会漂移。

### 第 2 步：添加快捷上传入口（core 发起，web 执行）✅ 已完成

上传本身需要 API 客户端，而 API 层在 web——core 不能直接调 `api.userFile.upload`。
已按注入模式实现：

- core 新增注入口 `aarc-core/src/models/save/lineStyleResourceOps.ts`：
  - `initUserFileUploader(uploader)`（:20）由宿主注入；经
    `CoreHostServices.userFileResourceUploader` 可选注入（`app/hostServices.ts`），
    未注入被调用时 `console.warn`。
  - `uploadLineStylesAsResource(lineStyles)`（:34）：**逐条**上传——每条样式单独打包
    JSON（单元素数组，与 `exportToFile` 同格式，`JSON.stringify([style], null, 2)`），
    用第 1 步的 `renderLineStylePreviewBlob` 取**各自**样式的正方形预览作缩略图，
    displayName 取各自样式名（未命名则为"未命名线路样式"），逐条调注入的上传器；
    因此每条选中的样式各自成为一个 UserFile，同名覆盖的 preflight 与确认也逐条
    各自进行（web 侧 `uploadUserFileGuarded` 每次调用处理一条）。任一条取消/失败
    即中止后续上传。
- core 的 `LineStylesConfigReuse.vue` 导出按钮组下方新增"上传为资源"按钮
  （仅 `hasUserFileUploader()` 为真时显示）；成功后提示用户前往"文件"页收藏。
  上传前对深拷贝出的样式执行 `embedReferencedPatterns`，把各层引用的 pattern 嵌入
  `patternEmbedded`（因此上传的 JSON 可能比导出到剪切板/文件的多出该字段，
  保证样式在任意存档中纹理不丢失）。
- web 侧在 `App.vue` 的 `initCoreHostServices` 聚合注册中实现
  `userFileResourceUploader`：`api.userFile.upload`，type 固定 `UserFileType.LineStyle`，
  缩略图以 `thumb.webp` 上传。

未做的可选项：上传成功后自动收藏（`upload` 接口只返回 boolean，拿不到新文件 id，
故保留"手动去文件页收藏"的提示）；`GenericFileUpload.vue` 的 thumb 扩展（未采用该路线）。

### 第 2.5 步：同名资源覆盖（preflight + 覆盖确认弹窗）✅ 已完成

行为：同一用户下同类型的资源，同名上传不再新建实体，而是**覆盖**——UserFile 实体
不增删，仅写新文件并更新 `StoreName` 等字段。上传前先 preflight，发现同名则弹窗
展示名称+预览图，用户确认后才实际覆盖。

- 后端：
  - `UserFileController.Upload` 新增可选表单参数 `overwriteId`（提供时走覆盖）；
    新增 `GET /api/UserFile/FindExisting?displayName=&type=` 作 preflight（大小写
    不敏感匹配当前用户下同类型资源，返回含 `urlThumb` 的 `UserFileDto`）。
  - `UserFileRepo.Overwrite`（`UserFileRepo.cs:73`）：校验所有权后写入新文件，
    旧 `StoreName` 无其他实体引用时经 `UserFileService.DeletePhysical` 清理物理文件
    及其缩略图；`intro` 不传时保留原简介；`base.Update(model, true)` 刷新 `LastActive`。
- web（弹窗与资源类型无关，后续其他类型资源上传可直接复用）：
  - `app/globalStores/overwriteConfirmStore.ts`：`request(items)` 返回
    `Promise<boolean>`，items 为 `{ name, existingThumbUrl?, newThumbUrl? }[]`。
  - `components/common/userFile/OverwriteConfirmPrompt.vue`：基于 core 的
    `Prompt.vue`，挂载于 `App.vue`，展示"当前 → 新上传"预览对比 + 确认/取消。
  - `app/com/userFileUploadGuard.ts` 的 `uploadUserFileGuarded`：preflight →
    （有同名则弹窗确认）→ `api.userFile.upload(..., overwriteId)`，返回
    `'ok'/'canceled'/'failed'` 三态；新内容预览图用 `URL.createObjectURL(thumb)`，
    弹窗关闭后回收。
  - 接入点：`App.vue` 的 `userFileResourceUploader`（core 线路样式上传）与
    `GenericFileUpload.vue`（"文件"页手动上传）。
- core：`UserFileResourceUploader` 返回值改为 `'ok'/'canceled'/'failed'` 三态，
  `LineStylesConfigReuse.vue` 对"取消"与"失败"分别提示。

### 第 3 步：改造收藏回调 store 以支持多消费方（core）✅ 已完成

`userFileFavoriteStore.ts` 已改为支持一次性取用意图：

- `openFavoritesSidebar(intent?: FavoritesPickIntent)`：intent 含一次性 `onSelected`
  回调与可选 `fileType` 过滤（如 `'lineStyle'`，具体枚举由宿主映射）；每次打开重置。
- 宿主选中文件时调 `notifyFileSelected(file)`：优先消费一次性 `onSelected`（消费后
  失效），否则回退到全局 `onFavoriteFileSelected`（图标流程不变，见 web 侧
  `UserFileFavorites.vue` 的 `select`）。
- 收藏列表过滤：`UserFavoriteController.GetUserFiles` 新增可选 `fileType` 参数，
  web 侧把 `'lineStyle'` 映射为 `UserFileType.LineStyle`。

### 第 4 步：从收藏引入为数据源（core）✅ 已完成

`DataSourcesConfig.vue` 的"添加数据源"区有"从收藏选择线路样式"按钮（仅宿主注入
收藏夹侧栏时显示，经 `hasOpenFavoritesSidebar` 判断）：

1. 用第 3 步的机制打开收藏夹（`fileType: 'lineStyle'` 过滤），回调中拿到
   `UserFileDto`（窄投影含 `id`/`displayName`）。
2. 拼**按 id 的固定链接**：`{apiUrlBase || window.location.origin}/api/UserFile/Content?id={id}`。
   后端 `UserFileController.Content`（匿名可访问）按 id 解析当前 `StoreName` 输出
   物理文件——覆盖上传后 md5 物理路径变化也不影响引用；响应带
   `Cache-Control: no-cache` + ETag（内容 md5），配合 `fetchDataSource` 的
   `cache: 'no-cache'`，新版内容下次拉取即生效，未变时命中 304。
3. 自动填入创建表单（type 固定 `lineStyles`，name 取 displayName，**默认开启**
   "自动更新"与"覆盖同名"，用户可在添加前调整），走现有 `addDataSource` 流程
   （URL 查重、id 分配不变）。

引入后的拉取、合并、自动更新全部由现有 `dataSourceOps.ts` 与 core 会话 API
（`editorSession.ts` 的 `loadSaveIntoEditor` 内部调 `autoUpdateDataSources`）接管，
无需改动。样式变化后 `lineStyles` 的 watch 会自动触发 `envStore.rerender()` 重绘
（DataSourcesConfig 的 `loadDataSource` 已处理）。

## 风险与注意点

- **数据源 URL 必须绝对化**：相对路径在非编辑器域名下会拉取失败；且 dev 环境前端
  与 API 不同源。core 内拼 URL 只能用 `getCoreConfig().apiUrlBase` /
  `window.location.origin`，不能读 `import.meta.env`。
- **内容寻址 = 不可变**：`/userfile/{md5}.json` 静态 URL 内容永远相同（改样式重新上传
  会得到新 md5 URL），数据源的 `autoUpdate` 对这类 URL 实际无意义。需要"引用最新版"
  时应改用按 id 的 `/api/UserFile/Content?id=` 链接（"从收藏选择"入口生成的就是它），
  其 ETag/no-cache 保证覆盖上传后客户端能拿到新版。
- **预览图颜色固定**：必须用固定 dynaColor 渲染预览，否则同一样式每次上传缩略图
  md5 不同、产生垃圾文件；服务端目前不清理失去引用的文件（`UserFileRepo.cs` 内有
  TODO）。
- **缩略图不跟随背景色**：`colorMode==='bg'`（跟随背景色）的层在上传缩略图中按
  白色渲染（缩略图固定白底），若存档背景也是白色，该层在缩略图中不可见——为保持
  缩略图 md5 稳定，这是有意取舍；配置页内的预览则用实际背景色，所见即所得。
- **嵌入 pattern 的 id 跨存档无意义**：`patternEmbedded` 随样式携带的 `pattern` id
  来自源存档，渲染时优先使用嵌入对象、不按 id 查找；"移除嵌入"会连同该 id 一并
  清除，避免撞上目标存档中同 id 的其他 pattern。嵌入是确定性的（同样式+同 pattern
  产出相同 JSON），不影响内容寻址稳定性。
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
| `aarc-core/src/models/cvs/common/lineStylePreview.ts` ✅ | 已新建：`drawLineStylePreview`（含可选 `bgColor`）+ `renderLineStylePreviewBlob`（正方形 webp，固定白底） |
| `aarc-core/src/components/sidebars/configs/LineStylesConfig.vue` | ✅ 已改为复用 `drawLineStylePreview`（传实际背景色）；待做：可选单条上传按钮 |
| `aarc-core/src/components/sidebars/configs/LineStylesConfigReuse.vue` | ✅ 已加"上传为资源"按钮（仅宿主注入上传器时显示）；上传前 `embedReferencedPatterns` 嵌入引用的 pattern |
| `aarc-core/src/models/save.ts` ✅ | LineStyle 层新增 `patternEmbedded`（嵌入完整 pattern）与 `colorMode:'bg'`（跟随背景色） |
| `aarc-core/src/models/cvs/common/strokeStyledLine.ts` + `patternStore.ts` ✅ | 渲染支持 `bgColor` 选项与嵌入 pattern（`getRenderedOf` 直接渲染 Pattern 对象） |
| `aarc-core/src/models/save/lineStyleResourceOps.ts` + `aarc-web/src/App.vue` ✅ | 已新建 `initUserFileUploader`/`uploadLineStylesAsResource` 注入口，web 经 `initCoreHostServices` 用 `api.userFile.upload` 实现 |
| `aarc-core/src/models/stores/utils/userFileFavoriteStore.ts` ✅ | 已支持一次性取用意图（`openFavoritesSidebar(intent)` + `notifyFileSelected`） |
| `aarc-web/src/components/common/userFile/UserFileFavorites.vue` ✅ | 选中时调 `notifyFileSelected`（一次性回调优先）；按 `pickFileType` 过滤列表 |
| `aarc-core/src/components/sidebars/configs/DataSourcesConfig.vue` ✅ | 已加"从收藏选择线路样式"入口（生成 `/api/UserFile/Content?id=` 固定链接，默认开自动更新+覆盖同名） |
| 后端 ✅（id 固定链接 + 收藏过滤） | 已完成：`UserFileController.Content`（匿名，ETag=内容md5 + no-cache）、`UserFavoriteController.GetUserFiles` 加 `fileType` 过滤 |
| （可选，已无需）`aarc-web/.../GenericFileUpload.vue` | ~~支持携带缩略图上传~~（改走注入口路线，未采用）✅ 另已接入同名覆盖预检 |
| 后端 ✅（同名覆盖部分） | 已完成：`Upload` 加 `overwriteId`、新增 `FindExisting` preflight、`UserFileRepo.Overwrite` + `UserFileService.DeletePhysical`；（可选：GetUserFiles 加 type 过滤） |
| `aarc-web/src/app/globalStores/overwriteConfirmStore.ts` ✅ | 已新建：覆盖确认弹窗状态（`request(items): Promise<boolean>`），与资源类型无关 |
| `aarc-web/src/components/common/userFile/OverwriteConfirmPrompt.vue` ✅ | 已新建：基于 core `Prompt.vue` 的覆盖确认弹窗（名称+当前/新预览图），挂载于 `App.vue` |
| `aarc-web/src/app/com/userFileUploadGuard.ts` ✅ | 已新建：`uploadUserFileGuarded`（preflight → 确认 → upload(overwriteId)，三态返回） |
