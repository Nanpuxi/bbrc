# AARC 项目 Agent 指南

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

对 vue、ts、json 文件进行任何改动后，运行 `pnpm type-check` 确保没有类型问题

## 前端 workspace

前端位于 pnpm-workspace 中（根 `pnpm-workspace.yaml`），包含两个包：
- `aarc-core`：编辑器核心（Cvs/Menu 及其依赖闭包、单元测试），以源码经 `exports` 通配导出，内部 import 一律用 `aarc-core/` 自引用，不依赖 web 侧任何东西
- `aarc-web`：站点（pages、router、API 层等），依赖 `aarc-core`（`workspace:*`）

在根目录或包目录内运行 pnpm 命令均可；在根目录时可用 `pnpm --filter <包名> <script>` 指定包。`aarc-web` 的 `test`/`test:run` 已透传到 `aarc-core`（测试随核心迁移）。详见 `aarc-web/docs/decoupling.md`。

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