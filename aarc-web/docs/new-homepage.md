# 新首页

任务：在 `aarc-web/src/pages/homes/` 新建一个 `HomePageOfficial.vue` 页面，不动原版首页（`HomePage.vue`）。在路由中检查环境变量的 isFork，如果为否，则 `/` 路由到新版首页。

特别注意：全端友好（桌面端与移动端均需良好展示与交互）。

## 路由与 isFork 分流

- 路由注册位置：`aarc-web/src/pages/homes/routes/routesInit.ts`，当前 `path: "/"` 指向 `HomePage`（name 为 `homePage`，见 `routesNames.ts`）。
- isFork 的读取方式沿用现有先例：`import.meta.env.VITE_IsFork == "true"`（参考 `HomePage.vue` 与 `aarc-web/src/app/topbar/topbarData.ts` 中的用法）。
- 注意取值现状：基础 `aarc-web/env/.env` 中 `VITE_IsFork = "true"`（默认视为 fork），官方站由 `.env.local` / `.env.demo-au` 覆盖为 `"false"`。因此分流逻辑为：isFork 为否（非 fork，即官方站）→ `HomePageOfficial`；否则 → 旧版 `HomePage`。
- 实现方式：在 `routesInit.ts` 中根据上述常量选择 `/` 的 component，两个页面组件均保留，旧版首页代码不做任何改动。

## 技术惯例（必须遵守）

- vue 组件一律 `script-template-style` 顺序；`<script setup lang="ts">`；`<style scoped lang="scss">` 嵌套语法（见 `aarc-web/AGENTS.md`）。
- 响应式断点沿用项目事实标准 `max-width: 768px`（先例：`ClientDownload.vue`、`DeriveMetroShuttle.vue` 等）；首页旧版完全没有媒体查询，新首页需自行补齐。
- 移动端细节：可拖动元素加 `touch-action: pan-y`（先例 `PaneCarousel.vue`）；贴底元素考虑 `env(safe-area-inset-bottom)`（先例 `RecentUpdates.vue`）。
- 布局参照旧首页的流式分节：各区块用统一的 `margin: 16px 0` 间隔，局部限宽（如 `max-width: 600px`）居中。

# 必需的元素

按页面从上到下顺序排列。

## 顶部滚动元素

- 从 0 实现的 vue 可复用走马灯组件，放在 aarc-core 项目，然后引用到 aarc-web 来。
    - 建议路径：`aarc-core/src/components/common/Carousel.vue`（与 `Notice.vue`、`Prompt.vue` 等通用件同级；aarc-core 以源码经 exports 通配导出，web 侧引用形如 `import Carousel from 'aarc-core/components/common/Carousel.vue'`）。
    - 该组件会被多宿主（web / tauri）复用，不得依赖 aarc-web 侧任何东西。
    - 参考实现（在 aarc-web，仅作交互参考，不直接复用）：`aarc-web/src/pages/components/PaneCarousel.vue`（Pointer Events 拖拽、滑动阈值切页、`@interaction`/`@change` 事件、`defineExpose({ goTo, getIndex, isDragging })`）、`TwinCarousel.vue`（自动滚动调度：`setTimeout` + `onBeforeUnmount` 清理）。新组件的"用户操作打断自动滚动"需求与 PaneCarousel 的 `@interaction` 机制高度契合。
    - 组件应保持通用：卡片内容通过 slot 传入，页数、自动滚动间隔、是否循环等通过 props 配置；提供指示器（圆点）与（桌面端）左右切换箭头。
- 滚动部分的卡片分为几块，每一块有一个大文本和一个小文本：
    - 大：**共享**、小：团队协作，无限可能，可追踪可审计
    - 大：**开放**、小：完全开源，自主可控，随心 fork 定制
    - 大：**永久免费**、小：过去免费，现在免费，未来也免费，不设会员升级
    - 大：**AARC**、小：方便快捷的线路图绘制工具
- 首次显示时，自动由 1 滚到 4，间隔 2s（被用户操作打断时停止），然后停在 4。
    - 即：非循环、一次性的引导式滚动；用户拖拽/点击/触碰后立即终止自动滚动，停留在用户操作的页面，不再恢复。
    - 注意组件卸载（路由切换）时清理定时器，避免泄漏。
- 移动端：卡片宽度自适应屏宽，支持触摸滑动；桌面端可居中限宽展示。

## 转正提示

参考旧版首页的显示条件和文本（`HomePage.vue` 中 `<template v-if="!isFork">` 内的 Notice 区块），但重新设计。

- **未转正**（已登录且为游客，旧版条件为 `userInfoStore.userInfo.id && userInfoStore.userInfo.isTourist`）：重新设计样式与文案，引导用户去绑定邮箱完成转正。
    - 旧版文案（供参考改写）："现在无需加 qq 群即可免费转为正式用户，公开展示作品，使用多人协作功能：立即转正"（链接到 `userUpgradeToMemberName` 路由）。新文案应以"绑定邮箱"为核心动作，并说明转正后的权益（公开展示作品、多人协作等）。
- **已转正**（或未登录，即旧版 `v-else` 分支）：显示创作规范，沿用旧版"合作提示"文本：
    - ✅ 推荐：存档明显位置展示你建的QQ群号，让协作者在QQ群讨论发展方向/团队规定
    - ✅ 可以：在存档中添加与存档发展有关的留言
    - ❌ 请不要：把存档当聊天室/贴吧/论坛使用
    - ❓ 如有疑问请咨询QQ交流群群主
- 以上两者均可**持久化折叠**。
    - 已有先例：旧版"合作提示"的折叠开关 `simpleCoopRulesDisplay` 定义在 `aarc-web/src/app/localConfig/saveListLocalConfig.ts`，通过 pinia persist 插件整体持久化到 localStorage。新首页的两个折叠状态应沿用同一机制（在该 localConfig store 中新增字段，或新建同级 store），不得做成刷新即失效的组件内 `ref`。
    - 折叠/展开状态应有明确的小按钮（参考旧版"展开/收起合作提示"）。

## 最新更新存档

直接复用 `NewestSaves` 组件（`aarc-web/src/pages/components/NewestSaves.vue`），占满整个宽度。

- 组件现状：props 仅 `forAuditor?: boolean`；单行横向滚动（`flex-wrap: nowrap; overflow-x: auto`），项宽固定 120px、间距 15px；含自动刷新（10s 轮询）与数据源切换（全站最新/我的收藏）控制条。
- "占满整个宽度"指区块容器不额外限宽、随页面通栏展示；组件内部仍保持横向滚动行为，不为本需求修改 `NewestSaves` 本身。
- 保留旧版附加提示：游客登录时显示"当前账号为游客，作品无法公开展示"；管理员显示审核列表（`<NewestSaves :for-auditor="true">`）及其提示文案。这部分逻辑可从旧首页照搬。

## 教程入口

多张卡片，每个卡片需要一个大标题（约 16px 深色）和一个小标题（约 14px 浅色）以及一个图片位置。

卡片需要分组，例如"基础教程"下有数个卡片，"最新功能"下有数个卡片。

- 现状：项目中尚不存在教程页面或教程数据（FAQ 页 `aarc-web/src/pages/homes/FAQ.vue` 是纯文字问答，结构为 h3 + 若干 p，无图片无分组）。"使用说明"目前是外链到只读存档。
- 数据结构建议（新首页自建）：分组数组，每组含组名与卡片列表；卡片字段含大标题、小标题、图片路径、跳转链接（内部路由或外链）。
    - 数据可硬编码于页面组件（先例：`Combinations.vue` 的卡片数组），或放 `aarc-web/public/` 下的静态 JSON 由组件 fetch（先例：`public/recentUpdates.json` + `RecentUpdates.vue`）。图片资源放 `aarc-web/public/`。
- 布局：桌面端卡片网格多列（`grid`，先例：`ClientDownload.vue` 的卡片网格），`max-width: 768px` 以下降为单列；图片位置预留固定比例占位，避免加载抖动。
- 分组标题样式需与卡片标题区分层级。

## 最近更新

复用已有 `RecentUpdates` 组件（`aarc-web/src/pages/components/RecentUpdates.vue`，数据来自 `aarc-web/public/recentUpdates.json`），但在其外包一层新首页自建的折叠容器，**不修改 `RecentUpdates` 本身**。

- 折叠行为（模仿 `DonorList.vue` 的折叠模式）：
    - **不持久化**：折叠状态为包装组件内的 `ref`，刷新后回到默认的折叠态（与"转正提示"的持久化折叠刻意不同）。
    - 未展开时内容最多占 **50vh** 高度（`max-height: 50vh; overflow: hidden`），超出部分裁掉。
    - 下方用**阴影/渐变遮罩**提示"还有更多"：在裁切边缘叠一个由透明到页面背景色的渐变层（参考 `DonorList.vue` 折叠态的 `max-height` + 渐变遮罩实现），使用户能直觉感到下方内容被截断。
    - 渐变层上放"查看全部▼"按钮，点击后展开为完整高度、遮罩消失、按钮变为"收起▲"，再次点击回到折叠态。
- 仅当内容实际高度超过 50vh 时才显示遮罩与按钮（内容不足时不截断、不显示按钮；可用 `scrollHeight` 与容器高度比较判断，注意内容 fetch 完成后再测量）。
- 展开/收起可配 `max-height` 过渡动画；注意 `max-height: 50vh` 与"展开为 auto"之间不能直接过渡，展开时改用足够大的 `max-height` 数值或切换为 `none`。

## 更多说明

以下为扩充后的完整文案（实现时可微调措辞，但保留要点与链接）。各小节建议统一为"小节标题 + 正文 + （可选）链接"的卡片或分节样式。

### 协作功能

可多人同时编辑同一线路图：一人画线、一人排站、一人校订，分工协作互不等待。所有改动实时同步给房间内的每个人，并完整留痕——谁在什么时间改了什么，可追踪、可审计，出现分歧可以回溯每一处变更的来源。

组件自己的创作团队：在存档明显位置留下你们的 QQ 群号，把线路图变成团队的共同作品，而不只是一个人的草稿。

### 本地运行

如果对在线服务的稳定性或数据托管不放心，可以下载本地运行版：完全离线使用，线路图数据存储在自己的设备上，不经任何服务器；版本更新由你自主决定，不存在"强制升级后才能继续使用"。

（链接：/#/client-download —— 已有页面 `ClientDownload.vue`，提供 Windows 绿色版/安装版与 Android 版下载及注意事项）

### 软件自由

软件自由意味着你对软件有完整的控制权：不会被账号体系、订阅制或平台政策捆绑，你使用本工具的权利任何人无法剥夺——因为源代码完全公开，运行什么样的服务、改成什么样子，都由你决定。

例如，如果你对官方站的某项政策不满，可以自行部署一个实例、迁移全部数据并继续创作，而不是被迫接受或放弃积累已久的作品。

（链接：/#/fork-aarc —— 已有页面 `ForkAarc.vue`，介绍私服部署）
（链接：http://u.fsf.org/16e —— FSF 关于软件自由的说明，与旧首页的 FSF 声明呼应）

### 模块化架构

本应用的"网站部分"与"编辑器部分"是解耦的：编辑器是独立的 `aarc-core` 包，不依赖站点的任何功能。

你可以把编辑器部分单独取出，嵌入自己另外开发的网站或本地应用中，或者与其他工具组成工具集（桌面宿主先例见 `aarc-tauri`）。

### 永久免费

本应用为公益性项目，承诺永久开源免费：过去免费，现在免费，未来也免费。不管后期添加多少功能，永不以任何形式收取任何费用，不设会员、不设付费解锁。

### 特别鸣谢

使用 `DonorList` 组件（`aarc-web/src/pages/components/DonorList.vue`，旧首页同款；注意 `aarc-web/src/pages/etc/Donors.vue` 是 `/donors` 路由页，只是它的包装）。

- 组件从 `@/data/donate/donors.json` 读取静态名单，自带"前往资助"按钮与排序/匿名说明。
- prop `collapsible`（默认 `true`）控制折叠展示；其折叠状态是组件内 `ref`、不持久化，新首页直接沿用默认行为即可。

# 从旧首页继承的其他事项

- `onMounted` 中的 `appVersionCheck()` 与 `setEnteredFrom()` 调用需在新首页保留（旧首页 `HomePage.vue` 同款逻辑）。
- 旧首页的以下区块**不进入**新首页（其功能已被新设计覆盖或有意舍弃）：欢迎区块的试用/说明/FAQ 链接（由教程入口承接）、MetroShuttle 广告、Combinations、GiteeInfo、roadmap 占位、底部开源说明（要点并入"更多说明"各小节）、FSF 声明原文（并入"软件自由"小节）。RecentUpdates 以"最近更新"节的形式进入新首页（见上文，含新的折叠包装）。
- `SearchSaveEntrance`（存档搜索入口）可酌情保留在新首页"最新更新存档"附近，视整体版面决定。

# 验收要点

1. `pnpm --filter aarc-web type-check` 与 `pnpm --filter aarc-core type-check` 均通过（新增 Carousel 组件在 aarc-core，改动后两边都要查）。
2. 官方站环境（`VITE_IsFork = "false"`）访问 `/` 显示新首页；fork 环境（`"true"`）访问 `/` 仍显示旧首页且行为完全不变。
3. 走马灯：首屏自动 1→4（间隔 2s）并停在 4；中途任何拖拽/点击立即打断；移动端可触摸滑动。
4. 转正提示：游客/正式用户两种状态文案与旧版条件一致；两者折叠状态刷新后保持。
5. 最近更新：内容超过 50vh 时折叠态正确截断、渐变遮罩与"查看全部▼"可见，展开后完整显示且可收起；内容不足 50vh 时不出现遮罩与按钮；刷新页面后回到折叠态（不持久化）。
6. 窄屏（≤768px）与宽屏下各区块均无横向溢出、无布局错乱。
7. aarc-core 的 Carousel 不 import 任何 aarc-web / aarc-tauri 侧代码；如需测试，按惯例把自动滚动调度等纯逻辑抽成 ts 后在 `aarc-core/src/tests/unit/` 下测纯逻辑（node 环境无 DOM，组件本身不测）。
