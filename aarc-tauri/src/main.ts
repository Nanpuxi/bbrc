import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import App from './App.vue'
import './styles/styles.scss'
import '@aurouscia/au-color-picker/style.css'
import { configureCore } from 'aarc-core/app/coreConfig'

// 把宿主环境变量注入 core（core 不直接读 import.meta.env）
// minimal 阶段只注入 apiUrlBase，其余留 undefined
configureCore({
    apiUrlBase: import.meta.env.VITE_ApiUrlBase
})

const pinia = createPinia().use(piniaPluginPersistedstate)
createApp(App).use(pinia).mount('#app')
