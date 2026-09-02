import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import fullReload from 'vite-plugin-full-reload'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    fullReload(["../aarc-core/src/**"])
  ],
  server: {
    host: '127.0.0.1',
    port: 5174,
    cors: {
      origin: ['http://127.0.0.1:5174', 'http://localhost:5174'],
      credentials: true
    },
    allowedHosts: [
      '127.0.0.1',
      'localhost'
    ]
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  }
})
