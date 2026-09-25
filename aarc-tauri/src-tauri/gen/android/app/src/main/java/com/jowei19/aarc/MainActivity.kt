package com.jowei19.aarc

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // 把系统栏/刘海 insets 以 padding 形式消费在根 view 上，让 WebView 视口整个落在安全区内：
    // CSS fixed/absolute 贴边元素与按画布坐标(JS)定位的浮层都会天然避开状态栏/手势条。
    // CONSUMED 不再把 insets 传给 WebView，使 CSS 的 env(safe-area-inset-*) 恒为 0，避免二次内缩。
    val root = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
    // 页面为白底，强制状态栏/导航栏图标为深色（否则深色模式下白图标不可见）
    WindowInsetsControllerCompat(window, window.decorView).apply {
      isAppearanceLightStatusBars = true
      isAppearanceLightNavigationBars = true
    }
  }
}
