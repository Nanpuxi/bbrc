import { getCoreConfig } from "./coreConfig"

// 以 getter 透传宿主注入的配置（configureCore），保持调用方“guideInfo.xxx”的用法不变
export const guideInfo = {
    get resetPassword() { return getCoreConfig().guideResetPassword },
    get findHelp() { return getCoreConfig().guideFindHelp },
    get extra() { return getCoreConfig().guideExtra }
}
