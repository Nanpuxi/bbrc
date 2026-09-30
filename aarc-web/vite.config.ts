import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { appVersionMark } from '@aurouscia/vite-app-version'
import fullReload from 'vite-plugin-full-reload'
import { signalrCommentFixerPlugin } from '@aurouscia/signalr-comment-fixer'
import { resolve } from 'path'

const __dirname = import.meta.dirname

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const envDir = 'env'
  const env = loadEnv(mode, resolve(__dirname, envDir), '')
  
  return {
    plugins: [
      vue(),
      appVersionMark(),
      fullReload([
        "../aarc-core/src/**", "src/app/**", "src/models/**", "src/utils/**"
      ]),
      signalrCommentFixerPlugin()
    ],
    server: {
      host: '127.0.0.1',
      port: 5173,
      cors: {
        origin: ['http://127.0.0.1:5173', 'http://localhost:5173'],
        credentials: true
      },
      allowedHosts: [
        '127.0.0.1',
        'localhost'
      ],
      proxy: {
        '/proxy': {
          target: env.VITE_DevProxyTarget,
          changeOrigin: true,
        },
        '/api': {
          target: env.VITE_DevProxyTarget,
          changeOrigin: true,
        },
        '/sudo': {
          target: env.VITE_DevProxyTarget,
          changeOrigin: true,
        },
        '/f3sso': {
          target: env.VITE_DevProxyTarget,
          changeOrigin: true,
        },
        '/chat': {
          target: env.VITE_DevProxyTarget,
          changeOrigin: true,
          ws: true,
        }
      }
    },
    build:{
      emptyOutDir:true,
      outDir:"../AARC.WebApi/wwwroot",
      chunkSizeWarningLimit: 600,
      rolldownOptions: {
        output: {
          // Vite 8 起 function 形式的 manualChunks 部分失效（vite#23153），改用 rolldown 原生 codeSplitting
          codeSplitting: {
            groups: [
              { name: 'au', test: /node_modules[\\/]@aurouscia/, priority: 60 },
              { name: 'svgo', test: /node_modules[\\/]svgo/, priority: 50 },
              // 拼音词典经动态 import 懒加载，独立命名 chunk
              { name: 'pinyin', test: /node_modules[\\/]pinyin-pro/, priority: 40 },
              { name: 'jyutping', test: /node_modules[\\/](?:to-jyutping|jyutping-data)/, priority: 40 },
              // node_modules 组优先级须高于 core：core 捕获模块时会递归带入其依赖，
              // 优先占位可防止 aarc-core 的依赖（pako/pinia 等）被拖进 core chunk
              { name: 'libs', test: /node_modules/, priority: 30 },
              { name: 'core', test: /aarc-core[\\/]src[\\/]/, priority: 10 },
            ]
          }
        }
      },
      target: ['es2020', 'ios14'],
    },
    resolve:{
      alias:{
        '@': resolve(__dirname, './src')
      }
    },
    envDir: envDir
  }
})