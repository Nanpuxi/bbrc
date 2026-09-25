import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import fullReload from 'vite-plugin-full-reload'
import { resolve } from 'path'

// tauri android/ios dev 时 CLI 会注入 TAURI_DEV_HOST（开发机局域网 IP），
// 需让 vite 监听该地址并放行其 Host 头，真机/模拟器才能访问 dev server
const devHost = process.env.TAURI_DEV_HOST
const localOrigins = ['http://127.0.0.1:5174', 'http://localhost:5174']

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    fullReload(["../aarc-core/src/**"])
  ],
  server: {
    host: devHost || '127.0.0.1',
    port: 5174,
    watch: {
      // android dev 时 gradle 会向 src-tauri/gen 写构建产物，
      // chokidar watch 到被占用的 .so 会以 EBUSY 直接崩掉 vite
      ignored: ['**/node_modules/**', '**/.git/**', '**/src-tauri/**']
    },
    cors: {
      origin: devHost ? [...localOrigins, `http://${devHost}:5174`] : localOrigins,
      credentials: true
    },
    allowedHosts: devHost ? ['127.0.0.1', 'localhost', devHost] : ['127.0.0.1', 'localhost']
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  }
})
