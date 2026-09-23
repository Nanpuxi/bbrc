# UserFile 上传组件与存储机制

> 架构说明：前端拆分为 `aarc-core`（编辑器核心）与 `aarc-web`（站点）后，UserFile 的
> 上传/收藏/文件管理 UI 与 API 层全部位于 **aarc-web**；编辑器核心不接触 API 层，只通过
> core 侧 store 的双向回调拿到用户选中的文件（见下文"收藏夹与编辑器的双向回调"）。

## 组件概述

`aarc-web/src/components/common/userFile/UserFileUpload.vue` 是一个按资源类型分派的上传入
口组件，本身不含 UI 逻辑，只渲染两个子组件并转发 `open()` / `close()`：

```
const props = defineProps<{
    type: UserFileType;
    onSuccess?: () => void;
}>();
```

- `type === UserFileType.Icon` → 由 `ImageUpload.vue` 处理（图片类，带前端图像处理，
  UserFileUpload.vue:16）
- 其他类型（`LineStyle`、`ColorSet`）→ 由 `GenericFileUpload.vue` 处理（JSON 文件，:24）

父组件通过 ref 调用 `open()` 展开侧边栏上传面板；上传成功后触发 `onSuccess` 回调。
两个子组件都用 `SideBar` 承载界面，支持点击选择和拖拽上传。

## UserFileType 枚举

定义于 `AARC.WebApi/Models/DbModels/Enums/UserFileType.cs`（前端镜像
`aarc-web/src/app/com/apiGenerated.ts`）：

| 值 | 名称 | 含义 |
|---|---|---|
| 0 | `Icon` | 车站图标（图片，默认值） |
| 1 | `LineStyle` | 线路样式（JSON） |
| 2 | `ColorSet` | 配色集（JSON） |

## ImageUpload.vue（图片上传，Icon 专用）

核心特点是**图像处理在前端完成**，服务端不做任何转码。

- 接受 `png / jpeg / webp / svg`。
- 选择文件后：
  - 生成缩略图：固定压缩为最大 256×256、quality 0.5 的 **webp**（`processThumb`）。
  - 主图处理（SVG 且未勾选"转换为位图"时跳过）：用 `@aurouscia/image-compress` 的
    `resizeImage` 按用户设定的宽/高/质量输出 webp（`processImage`，:61/:86）。宽、高、
    质量变化时经 500ms 防抖重新处理。
- 尺寸控制：`initDimensions` 初始化（超过 1024 则等比缩小，短边至少 8px），
  `applyDimension` 保证用户改宽或高时**长宽比锁定**，且不超过原图、不小于 8px。
- SVG 特殊处理（:36/:111）：默认保持原样上传（`keepSvgOriginal`），此时
  `convertSvgToBitmap` 未勾选则不生成处理后位图，仅生成 webp 缩略图；>100KB 的 SVG
  会提示转换。
- 显示名称约定：建议"分类名-图片名"格式（恰好一个连字符），否则给出提示
  （`showNameHint`）。后端 `GetPrefixes` 依赖此前缀做分类筛选。
- 上传时调用 `api.userFile.upload`（`ImageUpload.vue:368`）：
  - 主文件：处理后的 `processed.webp`，或原 SVG 文件
  - 缩略图：`thumb.webp`
  - `displayName`、固定 `type = UserFileType.Icon`
- 预览用 `URL.createObjectURL`，在 `reset`/`onUnmounted` 中统一 `revokeObjectURL`。

## GenericFileUpload.vue（通用 JSON 上传）

简单得多：只接受 `application/json`（:131），选中文件后自动以文件名作为 displayName
初值，上传时不带缩略图（:89，`userFileThumb` 传 `undefined`），`type` 取自父组件传入的
props。

## 收藏夹与编辑器的双向回调

`aarc-web/src/components/common/userFile/UserFileFavorites.vue` 是收藏夹侧栏 UI（web 侧），
它通过 core 的 store 与编辑器交互
（`aarc-core/src/models/stores/utils/userFileFavoriteStore.ts`）：

- web 侧在 `UserFileFavorites.vue:37` 调 `initOpenFavoritesSidebar(open)` 注册"打开侧栏"
  实现；编辑器内（如 `aarc-core/.../TextTagIconConfig.vue:69` 的"添加资源"按钮）调
  `userFileFavoriteStore.openFavoritesSidebar()` 触发打开，未注入时 `console.warn`。
- 反向：core 的 `iconStore.ts:167-168` 给 `onFavoriteFileSelected` 赋值；用户在收藏夹点
  "取用"时（`UserFileFavorites.vue:45-46`）调用它，把选中的 UserFile 转成
  `textTagIcons` 条目。
- 传给 core 的 `UserFileDto` 是**窄投影**（`aarc-core/models/types/apiShapes.ts`，仅
  `displayName`/`urlOriginal` 等少数字段），web 侧 `apiShapesAssert.ts` 在编译期断言
  生成客户端的完整 DTO 兼容该投影。
- 收藏入口为 `aarc-web/src/pages/components/UserFavoriteStar.vue`（文件列表
  `aarc-web/src/pages/files/component/UserFiles.vue:101` 等处使用）。

## API 调用链

前端 `aarc-web/src/app/com/apiStore.ts` 创建生成的 `UserFileClient`（`apiGenerated.ts:5346`）
并经 `wrapClientWithHandling` 包装为 `api.userFile`。生成代码签名（`apiGenerated.ts:5359`）：

```ts
upload(userFile, userFileThumb, displayName, intro, type, signal?): Promise<boolean>
```

- 请求：`POST /api/UserFile/Upload`，`multipart/form-data`
- 表单字段：`userFile`（主文件）、`userFileThumb`（缩略图，可空）、`displayName`、`intro`、
  `type`（枚举数字）
- 另有 `Edit`（改 displayName/intro）和 `Delete`（假删除）接口。

## 后端处理与存储

### Controller：`AARC.WebApi/Controllers/Files/UserFileController.cs`

- 类级 `[Authorize]`，路由 `api/UserFile/[action]`；`Upload` 在 :17-19。
- `Upload` / `Edit` / `Delete` 均有 `[UserCheck(UserType.Member)]`——**只有正式会员
  可上传**（游客 403），且编辑/删除仅限文件属主本人。
- `Get` / `GetPrefixes`：仅返回自己的文件。
- `Search`：`[AllowAnonymous]`，结果经 `AuthGrantCheckService` 过滤，只有被授予
  `AuthGrantTypeOfUserFile.View` 的文件对外可见。

### 数据库表（EF Core，实体 `Models/DbModels/Files/UserFile.cs`）

字段：`Id`、`DisplayName`（≤64）、`StoreName`（≤64，磁盘文件名）、`OwnerUserId`、
`Intro`（≤128）、`Size`（字节）、`Type`、`Priority`、`LastActive`、`Deleted`（假删除）。

### 磁盘存储：`Services/Files/UserFileService.cs`

- 根目录：`<ContentRoot>/Data/UserFiles`
- **命名规则**：计算文件内容 MD5（小写十六进制），文件名 = `md5 + 原后缀(小写)`，
  放入以 **md5 前两位**命名的一级子目录（如 `Data/UserFiles/ab/ab12cd….png`），
  见 `UserFileService.cs:8-9`、`:47-50`。
  内容相同的文件直接复用，不重复写盘（去重）；数据库 `StoreName` 只存文件名，
  访问时由 md5 前两位推导子目录。
- **缩略图**：由前端生成上传，存为同目录 `<md5>_tb.webp`（`_tb` 后缀 :18，webp :19）。
- 校验（`UserFileRepo.Add`）：必须有后缀；允许 `.png .jpg .jpeg .svg .webp .json`
  （`UserFileRepo.cs:29-30`）；普通文件 ≤ 3MB（:27/:48），SVG 单独限制 ≤ 1024KB
  （:28/:52-53）；displayName < 64、intro < 128。

### 读取/下载

无专用下载 API。`Data/UserFiles` 通过静态文件中间件直接挂载到 **`/userfile`**
（`UserFileMapping.UseUserFiles`，`UserFileService.cs:155`，注册于 `FilesServices.cs:22`）：

- 原文件 URL：`/userfile/{md5前两位}/{md5}.{ext}`
- 缩略图 URL：`/userfile/{md5前两位}/{md5}_tb.webp`（不存在时回退原文件 URL）

URL 由 `UserFileService.GetUrl` 生成，Repo 组装 `UserFileDto` 时填充 `UrlThumb` /
`UrlOriginal`。静态文件路径**无鉴权**，靠 md5 文件名不可枚举保证不被遍历。

## 权限与生命周期小结

| 操作 | 权限 |
|---|---|
| 上传 / 编辑 / 删除 | 登录会员（Member），编辑删除仅限属主 |
| Get / GetPrefixes | 仅自己的文件 |
| Search | 匿名可用，但仅返回有 View 授权的文件 |
| `/userfile/**` 静态访问 | 无鉴权 |

删除为假删除（仅置 `Deleted` 标记），磁盘文件不清理（代码内有 TODO）。

## 关键文件索引

- 前端组件（web）：`aarc-web/src/components/common/userFile/UserFileUpload.vue`、`ImageUpload.vue`、`GenericFileUpload.vue`、`UserFileFavorites.vue`
- 前端 API（web）：`aarc-web/src/app/com/apiStore.ts`、`aarc-web/src/app/com/apiGenerated.ts`
- 编辑器侧回调 store（core）：`aarc-core/src/models/stores/utils/userFileFavoriteStore.ts`；窄投影 `aarc-core/src/models/types/apiShapes.ts`
- 文件列表/管理页面（web）：`aarc-web/src/pages/files/component/UserFiles.vue`；收藏星标 `aarc-web/src/pages/components/UserFavoriteStar.vue`
- 后端 Controller：`AARC.WebApi/Controllers/Files/UserFileController.cs`
- 后端业务/校验：`AARC.WebApi/Repos/Files/UserFileRepo.cs`（含 `UserFileDto`、AutoMapper Profile）
- 后端磁盘存储：`AARC.WebApi/Services/Files/UserFileService.cs`
- 实体与枚举：`AARC.WebApi/Models/DbModels/Files/UserFile.cs`、`Models/DbModels/Enums/UserFileType.cs`
