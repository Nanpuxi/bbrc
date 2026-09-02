import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import App from './App.vue'
import './styles/styles.scss'
import '@aurouscia/au-color-picker/style.css'
import '@anilkumarthakur/vue3-json-viewer/styles.css'
import { appSetup } from './app/setup/appSetup'
import { enforceNoGesture } from './utils/eventUtils/enforceNoGesture'
import { configureCore } from 'aarc-core/app/coreConfig'

// 把 web 的环境变量注入 core（core 不直接读 import.meta.env）
configureCore({
    apiUrlBase: import.meta.env.VITE_ApiUrlBase,
    guideResetPassword: import.meta.env.VITE_GuideResetPassword,
    guideFindHelp: import.meta.env.VITE_GuideFindHelp,
    guideExtra: import.meta.env.VITE_GuideExtra,
    logMainCvsRendering: import.meta.env.VITE_LogMainCvsRendering === 'true',
    adsTextLess: import.meta.env.VITE_AdsTextLess,
    adsTextMore: import.meta.env.VITE_AdsTextMore
})

const pinia = createPinia().use(piniaPluginPersistedstate)
const app = createApp(App).use(pinia);

const router = appSetup()

enforceNoGesture()
app.use(router).mount('#app')