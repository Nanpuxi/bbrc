import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // 只保留失败用例的 console 输出（通过用例的 [初始化]/[协作] 等日志属噪音）
    silent: 'passed-only',
  }
})
