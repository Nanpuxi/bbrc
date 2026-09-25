# aarc-tauri 安卓初始化与打包

> 面向开发者的安卓构建指南。目标：从零把 `aarc-tauri` 打到安卓 debug APK。
> 本文区分"**理论上可用**"（官方文档/版本约束推导的选项）与"**实测已成功**"的组合。
> 实测环境：**macOS（Apple Silicon），tauri-cli 2.11.4**（2026-09）。

## 一、最终产物

```
src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

debug universal 包含全部 4 个 ABI 且 Rust 为 dev profile（未优化 + 调试符号），体积 400+MB 属正常；release 构建会 strip/优化，可再配 `--split-per-abi` 按 ABI 分包。

## 二、环境依赖

### 2.1 JDK

约束链：AGP 要求 JDK ≥ 17 运行 Gradle；而模板的 Gradle 8.14.x 守护进程最高支持 Java 24。

- **理论上可用**：任何 17~24 的 JDK，包括 Android Studio 自带的 JBR（`Android Studio.app/Contents/jbr/Contents/Home`）——但仅限 JBR ≤ 24 的 Android Studio 版本。
- **实测**：实测环境中 Android Studio 较新，自带的是 **JBR 25**（过新，Gradle 8.14 拒绝在其上运行守护进程）；改用 `brew install --cask temurin@17` 安装的 **Temurin 17** 跑通。注意 tauri-cli 会自动选用 Android Studio 的 JBR，必须通过 `org.gradle.java.home` 显式覆盖（见 3.5）。

### 2.2 Android SDK 组件

假设 SDK 位于 macOS 默认位置 `~/Library/Android/sdk`（Android Studio 安装）。所需组件：

| 组件 | 说明 | 实测版本 |
|---|---|---|
| `cmdline-tools/latest` | **必需**，`tauri android init` 要调 `sdkmanager` 校验/补齐组件 | 1.0.16261425 |
| `platforms;android-36` | **必需**，模板 `compileSdk = 36`；只装更高版本（如 android-37）不够 | platform-36_r02 |
| `build-tools` | 必需 | 36.0.0 |
| `ndk` | 必需，Rust 交叉编译用 | 30.0.16138531（**beta 版也跑通了**，稳定版如 27.x 理论上更稳妥） |
| `cmake` | 随 NDK 常规安装 | 4.1.2 |
| `platform-tools` | adb，装包/调试用 | — |

安装途径：Android Studio → Settings → Android SDK → **SDK Tools** 页勾选（看不到 Command-line Tools 时勾上 "Show Package Details"）；或走命令行 `sdkmanager`（见 3.4）。

### 2.3 Rust Android targets

`aarch64-linux-android`、`armv7-linux-androideabi`、`i686-linux-android`、`x86_64-linux-android`。**无需手动装**：`tauri android init` 会自动 `rustup target add`。

### 2.4 项目侧条件（仓库已具备，无需操作）

- `src-tauri/src/lib.rs` 有 `#[cfg_attr(mobile, tauri::mobile_entry_point)]`；`Cargo.toml` crate-type 含 `cdylib`/`staticlib`（tauri 模板默认就满足）。
- 安卓图标已生成：`src-tauri/icons/android/mipmap-*`（见 README「图标生成」；克隆仓库后需先跑一次 `pnpm --filter aarc-tauri gen:icons`）。
- `tauri.conf.json` 的 `bundle.android.debugApplicationIdSuffix` 会反映到生成工程的 debug `applicationIdSuffix`。

## 三、操作步骤（实测流程）

### 3.1 安装 cmdline-tools

Android Studio SDK Manager 勾选 "Android SDK Command-line Tools (latest)"，装完应存在：

```
~/Library/Android/sdk/cmdline-tools/latest/bin/sdkmanager
```

### 3.2 `tauri android init`

```sh
pnpm --filter aarc-tauri android:init    # 即 tauri android init
```

生成 `src-tauri/gen/android/`（Gradle 工程），并自动安装 Rust Android targets。

### 3.3 同步安卓图标（本项目必需）

**`tauri android init` 不会使用 `src-tauri/icons/android/` 里的定制图标**——它在 `gen/android/app/src/main/res/mipmap-*/` 里生成的是 tauri 默认 logo（蓝绿/橙色圆环），AndroidManifest 直接引用 `@mipmap/ic_launcher`，不打出来看不会发现。`pnpm gen:icons` 已内置同步步骤（把 `icons/android/mipmap-*` 拷入 `gen/android/app/src/main/res/`，并清除默认模板残留的矢量背景/前景），**init 之后重跑一次即可**：

```sh
pnpm --filter aarc-tauri gen:icons
```

同步后 `res/` 下应包含 `mipmap-anydpi-v26/ic_launcher.xml`（adaptive icon 定义）与各密度的 `ic_launcher_background.png`。拷进 `res/` 的 `mipmap-*` 与 `src-tauri/icons/` 一样是**生成产物，已加入 `.gitignore` 不入库**——克隆或 init 后跑一次 `pnpm gen:icons` 即重建，图标源在 `aarc-web/public/aarc-logo-*.svg`。不要用 `tauri icon` 重新生成（它会把 adaptive icon 前景塞成满幅、背景改回纯色，见 README「图标生成」）。

### 3.4 补 platform-36

```sh
~/Library/Android/sdk/cmdline-tools/latest/bin/sdkmanager "platforms;android-36"
```

### 3.5 配置 `~/.gradle/gradle.properties`（开发机配置）

在文件末尾追加：

```properties
# Gradle 8.14 守护进程不支持 Java 25，显式指向 JDK 17（路径按实际安装调整）
org.gradle.java.home=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home
# 如需要代理（gradle 不读 http_proxy 环境变量）
systemProp.http.proxyHost=127.0.0.1
systemProp.http.proxyPort=7890
systemProp.https.proxyHost=127.0.0.1
systemProp.https.proxyPort=7890
```

这些是**开发机特有配置，勿提交**，建议改放 `~/.gradle/gradle.properties`（全局生效，不进仓库）。

### 3.6 构建

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/<ndk版本目录>"
export JAVA_HOME=<JDK17 的 Home 路径>
pnpm --filter aarc-tauri android:build           # debug 包（等价 tauri android build --apk --debug）
pnpm --filter aarc-tauri android:build:release   # release 包（按 ABI 分包；需先配签名，见六）
```

### 3.7 安装运行

```sh
~/Library/Android/sdk/platform-tools/adb install \
  src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

## 四、模板版本信息（tauri-cli 2.11.4 生成）

| 项 | 值 | 位置 |
|---|---|---|
| Gradle wrapper | 8.14.3 | `gen/android/gradle/wrapper/gradle-wrapper.properties` |
| Android Gradle Plugin | 8.11.0 | `gen/android/build.gradle.kts` |
| Kotlin Gradle Plugin | 1.9.25 | `gen/android/build.gradle.kts` |
| compileSdk / targetSdk | 36 | `gen/android/app/build.gradle.kts` |
| minSdk | 24（Android 7.0） | 同上 |
| jvmTarget | 1.8（仅字节码目标，与 Gradle JVM 无关） | 同上 |
| applicationId | `com.jowei19.aarc`（debug 包加 `.debug` 后缀） | 同上 |

## 五、网络与代理注意事项

`tauri android init` 的 "ensure Android environment" 步骤与 gradle 构建都需要访问 Google/Maven 仓库（`dl.google.com`、`maven.google.com`、`services.gradle.org`），网络不通时可能长时间卡住无输出。不同工具吃代理的方式不一样：

- **sdkmanager**（Java 工具）：不认 `http_proxy` 环境变量，用 JVM 参数传入：
  ```sh
  export JAVA_TOOL_OPTIONS="-Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7890 -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7890"
  ```
- **gradle**：不认 `http_proxy`，必须用 `gradle.properties` 的 `systemProp.*`（见 3.5，wrapper 下载也走它）。
- **rustup / cargo / pnpm**：认 `http_proxy`/`https_proxy` 环境变量。

sdkmanager 输出里的 `Failed to upload metrics: Failed to connect to https://play.google.com/log...` 只是统计上报失败，**无害**，不影响下载结果。

## 六、其他注意事项与待办

- **gen/android 的 git 跟踪**：`gen/android/` 工程本体**应当提交**（tauri 约定——它自带的 `.gitignore` 只排除构建产物、`local.properties`、keystore 配置等，说明其余部分就是要进仓库的，后续签名/清单定制都在里面维护）；仓库已收窄为仅忽略可再生的 `gen/schemas/`，外加 `app/src/main/res/mipmap-*/`（图标生成产物，由 `pnpm gen:icons` 重建，见 3.3）。3.5 的开发机配置（`org.gradle.java.home`、代理）不要留在工程的 `gradle.properties` 里提交，应放 `~/.gradle/gradle.properties`。
- **API 地址**：`.env.development` 的 `VITE_ApiUrlBase=http://localhost:5250` 在安卓上指向设备自身；模拟器需改为 `http://10.0.2.2:5250`，真机需局域网 IP（离线用编辑器可不管）。
- **dev 模式**：`tauri android dev` 时设备要访问开发机的 vite dev server，`vite.config.ts` 已按 `TAURI_DEV_HOST` 调整——CLI 注入该变量（开发机局域网 IP）时，vite 自动改为监听该地址并放行对应 Host/CORS origin，真机与开发机需在同一局域网（无线 adb 场景天然满足）；未注入时仍绑 `127.0.0.1`，桌面/浏览器 dev 行为不变。macOS 防火墙若拦截 node 入站连接需放行 5174 端口。
- **release 签名（已配好）**：方案为"本地持有 keystore + `keystore.properties`"，两者均被 `gen/android/.gitignore` 排除（含追加的 `*.keystore`/`*.jks` 规则），不入库：
  - keystore 生成（JDK 的 `keytool`，有效期 10000 天）：
    ```sh
    cd aarc-tauri/src-tauri/gen/android
    keytool -genkeypair -v -keystore aarc-release.keystore -alias aarc \
      -keyalg RSA -keysize 2048 -validity 10000
    ```
    **注意**：JDK 17 默认生成 **PKCS12** 格式，它不支持独立的 key password——若生成时指定的 keypass 与 storepass 不同，keypass 会被静默忽略，之后打包报 `Get Key failed: Given final block not properly padded`（实测踩过）。**keystore.properties 里 `keyPassword` 必须与 `storePassword` 一致**。
  - `gen/android/keystore.properties`（格式）：`storeFile` / `storePassword` / `keyAlias` / `keyPassword` 四项
  - `app/build.gradle.kts` 已实现**条件启用**：`keystore.properties` 存在且含 `storeFile` 才创建 `release` signingConfig 并挂到 release buildType；没有该文件的开发者 debug/release 构建不受影响（release 产出未签名包）
  - 验证签名：`~/Library/Android/sdk/build-tools/<版本>/apksigner verify --print-certs <apk>`
  - **keystore 与密码必须安全备份**（丢失则永远无法以同一身份发布更新，应用商店会拒收）；团队协作时通过安全渠道分发，不要进任何仓库/聊天记录
- **真机回归重点**：取色器显示（依赖 `@aurouscia/au-color-picker` 版本对齐，其 scoped CSS 的 `data-v` 哈希须与组件 JS 一致）、导出/存档的 fs 落盘（Android 走应用私有目录/SAF，行为与桌面不同）、`window.confirm/alert` 行为、触屏下右键菜单交互。编辑器 UI 未做触屏适配，功能可用但体验是桌面版原样。

## 七、gen/android 的手工定制（**不要轻易重新 init**）

`gen/android/` 里除图标（3.3）外还有以下**手工定制**，`tauri android init` 重建工程时会按模板覆盖：

- **`app/src/main/java/com/jowei19/aarc/MainActivity.kt`（安全区内缩）**：`onCreate` 里在根 view（`android.R.id.content`）上 `setOnApplyWindowInsetsListener`，把 `systemBars() or displayCutout()` insets 以 padding 形式消费并返回 `WindowInsetsCompat.CONSUMED`。效果：WebView 视口整体收缩到安全区内，CSS fixed/absolute 贴边元素与按画布 JS 坐标定位的浮层都天然避让状态栏/刘海/手势条；同时 insets 不再传给 WebView，CSS 的 `env(safe-area-inset-*)` 恒为 0，避免与原生 padding 双重内缩。同处还用 `WindowInsetsControllerCompat` 强制 `isAppearanceLightStatusBars/isAppearanceLightNavigationBars = true`（应用不做深色模式、页面白底，深色系统主题下需深色图标才可见）。
- **`app/src/main/res/values/themes.xml` 与 `values-night/themes.xml`（白底窗口背景）**：`android:windowBackground` 设为白色。WebView 被 inset padding 让出的条带露出的是窗口背景，须与白底页面一致；night 同样白底（应用不做深色模式）。
- **配套约束（不在 gen/ 内）**：`aarc-tauri/index.html` 的 viewport meta **不得**加 `viewport-fit=cover`（当前即不带）——Android 侧靠原生 padding 内缩，CSS env() 必须为 0；iOS 下 WKWebView 默认视口即落在安全区内，同样无需 cover。

**恢复方式**：以上定制随 `gen/android/` 一起入库（见六），万一误执行 init，可用 `git diff` 逐文件恢复，并记得重跑 `pnpm gen:icons`（3.3）。非必要（如升级 tauri-cli 必须重建模板）不要重新 init。
