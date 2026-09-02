/**
 * core 的运行配置注入入口（替代 import.meta.env，见 decoupling.md §3.1"环境变量"行）。
 * 宿主须在启动早期注入（web：main.ts 顶层；tauri：应用入口），
 * 未注入的项按 undefined/false 处理（与不设置对应环境变量时的旧行为一致）。
 */
export interface CoreConfig {
    /** API 基础 URL（代理转换、云端SVG分享链接用）；部分场景缺省时回退 window.location.origin */
    apiUrlBase?: string
    /** 指引文案：重置密码方式 */
    guideResetPassword?: string
    /** 指引文案：求助/反馈渠道 */
    guideFindHelp?: string
    /** 指引文案：附加信息（可含 HTML） */
    guideExtra?: string
    /** 主画布渲染耗时日志开关 */
    logMainCvsRendering?: boolean
    /** 导出图片广告水印文案（少） */
    adsTextLess?: string
    /** 导出图片广告水印文案（多） */
    adsTextMore?: string
}

let coreConfig: CoreConfig = {}

/** 由宿主在启动早期调用，注入运行配置 */
export function configureCore(config: CoreConfig): void {
    coreConfig = config
}

/** core 内部读取配置（每次调用读取最新值） */
export function getCoreConfig(): Readonly<CoreConfig> {
    return coreConfig
}
