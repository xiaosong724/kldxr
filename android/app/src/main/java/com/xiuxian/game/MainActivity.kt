package com.xiuxian.game

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView

/**
 * 块来修仙 —— 安卓壳（把 H5 游戏装进 APK 给好友试玩）
 *
 * ★★★ 唯一需要你改的东西：GAME_URL ★★★
 *   改成【跑服务器那台电脑】的地址：
 *     · 同一个 WiFi：http://192.168.31.180:8899/
 *     · 外网：见 android/README.md 的方案 B
 *
 *   WebSocket 端口不用单独配 —— 客户端会拿网页地址的主机名 + 8900 自动拼
 *
 * ★ 关于屏幕方向（第 180 轮改动）
 *   以前写死 sensorLandscape（只能横屏）✗ 用户要求横竖都能用 ✓
 *   → Manifest 改成 fullSensor（四个方向都允许 ✓ 跟着重力感应转 ✓）
 *   → 这里【不做】任何强制旋转 ✗ 交回给系统 ✓
 *
 * ★ 关于"横屏下面没铺满"（第 180 轮改动）
 *   原因是这个 Activity 没有真正全屏 ✗
 *   系统栏（导航条 / 手势条）占着屏幕底下一条 ✗ 网页只能用剩下的部分 ✓
 *   而且横屏时刘海那侧还会留黑边 ✓
 *   → 见下面 goFullscreen()：把系统栏藏掉 + 允许内容铺到刘海区 ✓
 */
class MainActivity : Activity() {

    companion object {
        /** ★ 改这里：跑服务器那台电脑的地址（末尾要带 / ） */
        const val GAME_URL = "http://192.168.31.180:8899/"

        private const val HINT_OFFLINE =
            "连不上服务器。\n\n请确认：\n" +
            "① 电脑上游戏服务器已经启动\n" +
            "② 手机和电脑在同一个 WiFi\n" +
            "③ 地址填对了（现在填的是：%s）\n\n" +
            "点屏幕任意位置重试"
    }

    private lateinit var web: WebView
    private lateinit var cover: TextView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        /* 屏幕常亮：玩久了不该自动锁屏 */
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        goFullscreen()

        val root = FrameLayout(this)
        root.setBackgroundColor(Color.parseColor("#1a1208"))

        web = WebView(this)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            loadsImagesAutomatically = true
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = false
            displayZoomControls = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            }
        }
        web.setBackgroundColor(Color.parseColor("#1a1208"))
        web.isScrollbarFadingEnabled = true
        web.overScrollMode = View.OVER_SCROLL_NEVER
        /* ★ 第 180 轮：不要让 WebView 自己留边距 ✗ 让它铺满整个窗口 ✓ */
        web.setPadding(0, 0, 0, 0)
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView?, url: String?): Boolean = false
            override fun onReceivedError(
                v: WebView?, errorCode: Int, description: String?, failingUrl: String?
            ) {
                showCover(true)
            }

            override fun onPageFinished(v: WebView?, url: String?) {
                showCover(false)
            }
        }
        web.webChromeClient = WebChromeClient()

        cover = TextView(this)
        cover.setTextColor(Color.parseColor("#f2e8d8"))
        cover.setBackgroundColor(Color.parseColor("#1a1208"))
        cover.textSize = 15f
        cover.setPadding(60, 60, 60, 60)
        cover.gravity = android.view.Gravity.CENTER
        cover.text = String.format(HINT_OFFLINE, GAME_URL)
        cover.visibility = View.GONE
        cover.setOnClickListener {
            showCover(false)
            web.reload()
        }

        root.addView(
            web,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        root.addView(
            cover,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        setContentView(root)

        web.loadUrl(GAME_URL)
    }

    /**
     * 真·全屏：把状态栏和导航条都藏掉，并允许内容铺到刘海区域
     *
     * ★ 不这么做会怎样（用户报的"横屏下面没铺满"）：
     *   导航条占着底部一条 ✗ 网页高度 = 屏幕高 − 导航条高 ✓
     *   横屏时刘海那侧也会被让开 → 一侧留黑边 ✓
     */
    private fun goFullscreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            /* Android 11+：新的 insets API */
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            /* Android 10 及以下：老 API（还能用，先留着） */
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                )
        }
    }

    /**
     * 从别的地方切回来时，系统栏可能又冒出来了 → 再藏一次
     * （immersive 模式的标准做法，不加的话过一会儿底部又会多一条）
     */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) { goFullscreen() }
    }

    private fun showCover(show: Boolean) {
        runOnUiThread { cover.visibility = if (show) View.VISIBLE else View.GONE }
    }

    /** 返回键：网页能后退就后退，不能再退就退出 */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) {
            web.goBack()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onPause() {
        super.onPause()
        web.onPause()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        goFullscreen()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }
}
