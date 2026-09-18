# AARC 项目 Agent 指南

## 项目结构

- `AARC.WebApi/`：ASP.NET Core 后端（解决方案入口 `AARC.slnx`）
- `AARC.Collab/`：多人协作核心类库（房间管理器、DTO、`CollabException`，零外部依赖）；SignalR Hub 与快照 Controller 胶水层留在 `AARC.WebApi/Services/Collab/`
- `AARC.Collab.Test/`：协作核心并发语义测试（xUnit）
- `AARC.Diff/`、`AARC.Diff.Test/`：C# diff 类库及其测试
- `aarc-core/`：前端编辑器核心包（见下文"前端 workspace"）
- `aarc-web/`：前端站点包（见下文"前端 workspace"），内含 `docs/decoupling.md`（core/web 拆分方案与进度）
- `Dockerfile`：完整构建（前端 + 后端）

## 启动 WebApi 服务

如果需要用 CLI 启动 WebApi 服务，应该先查看 `AARC.WebApi/Properties/launchSettings.json`，使用其中的 **"http"** profile 的端口启动服务。

当前 "http" profile 配置：
- URL: `http://localhost:5250`
- 环境变量: `ASPNETCORE_ENVIRONMENT=Development`

启动命令示例：
```bash
cd AARC.WebApi
ASPNETCORE_ENVIRONMENT=Development dotnet run --urls "http://localhost:5250"
```

## 改动 cs 代码后

对 cs 文件或 csproj 文件进行任何改动后，运行 `dotnet build` 确保没有构建问题

如果 `dotnet build` 因 dll/exe 被正在运行的 WebApi 进程或 Visual Studio 锁定而失败，可改为输出到临时目录验证，验证完成后清理：
```bash
dotnet build AARC.WebApi/AARC.WebApi.csproj -o temp-build
rm -rf temp-build
```

如果发生了 api 变动：需要运行`gen-ts-client.ps1`或`gen-ts-client.sh`，以重新生成ts客户端代码

## 改动前端代码后

对 vue、ts、json 文件进行任何改动后，运行 type-check 确保没有类型问题。注意**根目录没有 `type-check` 脚本**，需在包目录内运行 `pnpm type-check`，或在根目录按包指定：

```bash
pnpm --filter aarc-web type-check    # 改动 aarc-web 后
pnpm --filter aarc-core type-check   # 改动 aarc-core 后
```

## 前端 workspace

前端位于 pnpm-workspace 中（根 `pnpm-workspace.yaml`），包含三个包：
- `aarc-core`：编辑器核心（Cvs/Menu 及其依赖闭包、单元测试），以源码经 `exports` 通配导出，内部 import 一律用 `aarc-core/` 自引用，不依赖 web 侧任何东西
- `aarc-web`：站点（pages、router、API 层等），依赖 `aarc-core`（`workspace:*`）
- `aarc-tauri`：编辑器的最小 Tauri 宿主（浏览器 dev 与 `pnpm --filter aarc-tauri tauri:dev` 均可运行编辑器并本地保存；尚未做 fs 化），依赖 `aarc-core`（`workspace:*`），功能清单与实现步骤见其 README

在根目录或包目录内运行 pnpm 命令均可；在根目录时可用 `pnpm --filter <包名> <script>` 指定包。`aarc-web` 的 `test`/`test:run` 已透传到 `aarc-core`（测试随核心迁移）。core 需要宿主（web/未来 tauri）提供的功能清单及 web 对照实现见 `aarc-core/README.md`。详见 `aarc-web/docs/decoupling.md`。

## 前端单元测试（aarc-core，vitest node 环境）

跑单个测试文件用 `cd aarc-core && pnpm vitest run <文件路径>`；不要写成 `pnpm --filter aarc-core test:run -- <文件>`（`--` 会被当成位置参数，过滤失效、跑成全量）。

写/改测试时反复踩过的坑：

- **node 环境没有 DOM**：store 里的 `document`（全局键盘监听等）用 `src/tests/helpers/domStub.ts` 的 `ensureDomStub()` 桩掉；`window`/`Image`/`fetch` 没有桩。隐蔽触发点：`normalizeSave` 的升级逻辑会给缺版本号的存档注入默认文本图标（url 以 `/` 开头），之后任何 `relaunchDerivedStores`（远程 op 应用、快照装填等）都会进 `iconStore.ensureAllLoaded` 访问 `window.location.origin` 而崩溃。测试构造 Save 时带 `meta: { textTagIconsVersion: 1 }` 可避免注入。
- **异步流程跨用例泄漏**：pinia 每用例重建（`createTestPinia`），store 闭包内的作废机制（如 `sessionEpoch`）随之失效，但模块级单例（如 `getCollabTransport()` 指向的 mock）已是新实例——上一用例遗留的后台异步循环会操作新 mock，表现为灵异断言失败或 unhandled rejection，且报错挂在别的用例头上。对策：mock 的失败/异常必须是**有限次**的（如"gap 只报一次"，不要永远失败）；会留下后台流程的用例，结束前用 `flush()`/`waitFor` 等其收尾。
- **改了全局时序参数要在 afterEach 还原**（如 `collabSessionTiming`），否则泄漏的流程会按生产时序（秒级轮询）长时间悬挂。
- **`void promise` 必须接 `.catch`**：vitest 会把未处理拒绝报为 "Vitest caught 1 unhandled error"，污染整个运行、掩盖真实失败位置。

测试输出默认已精简（`vitest.config.ts` 的 `silent: 'passed-only'`）：通过用例的 console 输出（`[初始化]`/`[协作]` 等日志）不打印，失败用例的保留。调试单个文件时可临时去掉该选项。

## 当用户要求“从 upstream 同步”

如果用户要求“从 upstream 同步”：
- 检查当前是否在非 master 分支
- 检查当前是否有名为 upstream 的 git 远程，如果没有则创建它：https://gitee.com/au114514/aarc
- 检查当前是否有名为 up-master 的 git 分支，如果没有则创建它，跟踪 upstream 的 master 分支
- 对 up-master 运行一次 pull
- 把 up-master 分支 merge 到当前分支
- 如果出现意外情况，例如当前 origin 和 upstream 的 url 一样，或者当前在 master 分支，则不做任何操作，除非用户进一步指示
- 如果遇到冲突，手动解决（关于逻辑的冲突尽量 upstream 优先、关于样式冲突的尽量本地优先）并告知用户有哪些改动丢失，询问需不需要补回来
- 如果没有冲突，则合并完成后 push 当前分支
- push 完分支后，进入 aarc-web 目录，运行 `pnpm build`

## 子代理

仅在“了解情况编写文档”时才可以使用子代理功能

实现代码时禁止使用