/**
 * selectionStore 等 store 在 setup 时注册全局键盘监听，
 * node 测试环境提供最小 document 桩（在使用这些 store 的测试文件顶部调用）
 */
export function ensureDomStub() {
  if (typeof document === 'undefined') {
    (globalThis as Record<string, unknown>).document = { addEventListener: () => {} }
  }
}
