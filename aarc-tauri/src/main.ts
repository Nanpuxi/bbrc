import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import App from './App.vue'
import './styles/styles.scss'
import '@aurouscia/au-color-picker/style.css'
import { configureCore } from 'aarc-core/app/coreConfig'
import { initFileSaver, initSaveInfoProvider } from 'aarc-core/components/sidebars/export/composables/useImageExport'
import { isTauri } from '@tauri-apps/api/core'
import { tauriFileSaver } from './fileSaver'
import { saveStorage } from './saves/saveStorage'

// 把宿主环境变量注入 core（core 不直接读 import.meta.env）
// minimal 阶段只注入 apiUrlBase，其余留 undefined
configureCore({
    apiUrlBase: import.meta.env.VITE_ApiUrlBase
})

// tauri 内 webview 的浏览器下载不可靠：注入原生"另存为"+写盘实现
//（浏览器 dev 模式下 isTauri() 为 false，保持 core 的 <a download> 兜底）
if (isTauri())
    initFileSaver(tauriFileSaver)

// 存档信息提供者：core 导出图片时用存档名命名文件（存档 id 为数值字符串，见 saves/saveStorage.ts）
initSaveInfoProvider(async (saveId) => {
    const entry = (await saveStorage.list()).find(x => x.id === String(saveId))
    return entry ? { name: entry.name } : undefined
})

const pinia = createPinia().use(piniaPluginPersistedstate)
createApp(App).use(pinia).mount('#app')
