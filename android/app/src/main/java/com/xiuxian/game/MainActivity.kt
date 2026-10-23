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
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout

/**
 * 块来修仙测试版 —— 安卓壳（把 H5 游戏装进 APK 给好友试玩）
 *
 * ★★★ 唯一需要你改的东西：GAME_URL ★★★
 *   改成【跑服务器那台电脑】的地址（同一个 WiFi 用局域网 IP ✓ 外网见 android/README.md）
 *   WebSocket 端口不用单独配 —— 客户端会拿网页地址的主机名 + 8900 自动拼 ✓
 *
 * ★ 历次真机问题（都别改回去）：
 *   · 全屏那句必须放在 setContentView 之后 ✗ 放前面会 NPE 闪退（第 184 轮 ✓）
 *   · Manifest 用 fullSensor（横竖都能转 ✓）不能写死横屏（第 180 轮 ✓）
 *   · 明文 http / ws 必须放行（usesCleartextTraffic + MIXED_CONTENT ✓）第 175 轮 ✓
 *   · WebGL 拿不到上下文 → 必须【重建 WebView】✗ reload 没用（第 202 轮 ✓）
 *   · 横屏要真转屏 → 提供 AndroidShell.setOrientation 给网页调（第 202 轮 ✓）
 *
 * ★ 第 191 轮：服务器没开 / 重启时显示【维护中】页面 + 重新连接按钮
 * ★ 第 202 轮：WebView 崩溃 / GL 上下文失败 → 销毁重建（最多 3 次）
 */
class MainActivity : Activity() {

    companion object {
        /** ★ 改这里：跑服务器那台电脑的地址（末尾要带 / ） */
        const val GAME_URL = "http://192.168.31.180:8899/"

        /** 维护页上的自动重试间隔（秒）*/
        private const val RETRY_SEC = 15

        /** WebView 最多重建几次（防死循环 ✓ 页面加载成功就清零 ✓）*/
        private const val MAX_REBUILD = 3
    }

    private lateinit var web: WebView
    private var showingMaint = false
    private var glRebuildCount = 0
    private var root: FrameLayout? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        /* ★★★ 方向必须在【最最前面】定下来 ✗ 越晚越容易看到翻转 ✓
           → 用户在启动瞬间看不到任何旋转 ✓
           → 没存过（第一次装）就按手机当前怎么拿就怎么开 ✓ */
        try {
            val saved = getSharedPreferences("xiuxian", MODE_PRIVATE).getInt("screenOrientation", 0)
            if (saved != 0) { requestedOrientation = saved }
        } catch (e: Throwable) { }

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        try {
            window.addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED)
        } catch (e: Throwable) { }

        /* ★ 全屏不能在这里调 ✗ 界面还没建 → NPE 闪退（第 184 轮真机踩过 ✓）*/

        val r = FrameLayout(this)
        r.setBackgroundColor(Color.parseColor("#1a1208"))
        root = r

        /* ★★★ 2026-10-23：高刷新率（用户："不要限制帧率"）★★★
           只把窗口的上限顶到屏幕支持的最高档 ✗ 不写死 120 / 90 ✓ */
        try {
            @Suppress("DEPRECATION")
            val dm = window.windowManager.defaultDisplay
            @Suppress("DEPRECATION")
            val best = dm.supportedModes?.maxByOrNull { it.refreshRate }
            if (best != null) {
                val lp = window.attributes
                lp.preferredRefreshRate = best.refreshRate
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    lp.preferredDisplayModeId = best.modeId
                }
                window.attributes = lp
            }
        } catch (e: Throwable) { }

        initWebView()
        r.addView(
            web,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        setContentView(r)

        /* 界面建好了，这时候才能安全地进全屏 ✓ */
        goFullscreen()

        web.loadUrl(GAME_URL)
    }

    /* ==================================================================
       WebView 创建（首次 / 崩溃重建 都走这里 ✓ 配置完全一致 ✓）
       ================================================================== */
    @SuppressLint("SetJavaScriptEnabled")
    private fun initWebView() {
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
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                offscreenPreRaster = true
            }
        }
        web.setBackgroundColor(Color.parseColor("#1a1208"))
        web.isScrollbarFadingEnabled = true
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.setPadding(0, 0, 0, 0)

        /* ★ GPU / 渲染优化：
           ① 显式硬件图层（省一次整屏 CPU 拷贝 ✓）
           ② 渲染进程提到"重要"优先级（系统不给它降频 ✓）
           ③ 关掉长按选中 / 自动填充 / 安全浏览（省合成层和后台活 ✓）*/
        try { web.setLayerType(View.LAYER_TYPE_HARDWARE, null) } catch (e: Throwable) { }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
            } catch (e: Throwable) { }
        }
        try {
            web.isLongClickable = false
            web.isHapticFeedbackEnabled = false
            web.settings.setSupportZoom(false)
            web.settings.setTextZoom(100)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                web.settings.safeBrowsingEnabled = false
                web.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
            }
        } catch (e: Throwable) { }

        /* ★ JS 可以调的原生能力（方向 + 硬重启）*/
        try {
            web.addJavascriptInterface(object : Any() {
                @android.webkit.JavascriptInterface
                fun setOrientation(mode: String?) {
                    val m = (mode ?: "").lowercase()
                    val target = when {
                        m.startsWith("land") -> android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                        m.startsWith("port") -> android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
                        else -> android.content.pm.ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
                    }
                    try {
                        getSharedPreferences("xiuxian", MODE_PRIVATE).edit()
                            .putInt("screenOrientation", target).apply()
                    } catch (e0: Throwable) { }
                    runOnUiThread {
                        try { requestedOrientation = target } catch (e1: Throwable) { }
                    }
                }

                @android.webkit.JavascriptInterface
                fun isLandscape(): Boolean {
                    return try {
                        resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
                    } catch (e: Throwable) { false }
                }

                /** ★ WebGL 彻底拿不到上下文时调这个 → 真的重建 WebView ✓ */
                @android.webkit.JavascriptInterface
                fun hardRestart() {
                    glRebuildCount += 1
                    if (glRebuildCount > MAX_REBUILD) {
                        runOnUiThread { showMaintenance() }
                        return
                    }
                    rebuildWebView()
                }

                @android.webkit.JavascriptInterface
                fun rebuildCount(): Int = glRebuildCount
            }, "AndroidShell")
        } catch (e: Throwable) { }

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView?, url: String?): Boolean = false

            /** 加载失败 → 维护页（只看主页面 ✓ 子资源失败不算 ✓）*/
            override fun onReceivedError(
                view: WebView?, request: WebResourceRequest?, error: WebResourceError?
            ) {
                if (request == null || request.isForMainFrame) { showMaintenance() }
            }

            /* ★★★ 2026-10-23（用户："显卡上下文创建不出来，玩家反复反馈"）★★★
               ★ 这是【渲染进程崩溃】的兜底 ✓ 真机常见 ✓
               ★ 为什么 JS 的 location.reload 没用：
                 渲染进程挂了以后，同一个 WebView 里【再也拿不到新的 GL 上下文】✗
                 玩家看到的"自动恢复 2 次都失败"就是这个原因 ✓✓
               ★ 唯一有效：销毁整个 WebView → 系统起新的渲染进程 → GL 重新分配 ✓ */
            override fun onRenderProcessGone(
                view: WebView?, detail: android.webkit.RenderProcessGoneDetail?
            ): Boolean {
                glRebuildCount += 1
                if (glRebuildCount > MAX_REBUILD) {
                    showMaintenance()
                    return true
                }
                rebuildWebView()
                return true     // ★ true = 我们自己处理了 ✗ 别让系统杀掉 Activity ✓
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                if (url != null && url.startsWith("http")) {
                    showingMaint = false
                    glRebuildCount = 0      // ★ 加载成功 → 计数器清零 ✓
                }
            }
        }
        web.webChromeClient = WebChromeClient()
    }

    /* ==================================================================
       重建 WebView（GL 失败 / 渲染进程崩溃 都走这里 ✓）
       ================================================================== */
    private fun rebuildWebView() {
        runOnUiThread {
            try {
                val parent = root ?: (web.parent as? ViewGroup)
                val idx = parent?.indexOfChild(web) ?: -1
                try { parent?.removeView(web) } catch (e0: Throwable) { }
                try {
                    web.stopLoading()
                    web.loadUrl("about:blank")
                    web.clearHistory()
                    web.removeAllViews()
                    web.destroy()
                } catch (e1: Throwable) { }
                initWebView()
                val w2 = web
                if (parent != null && idx >= 0) {
                    parent.addView(w2, idx, FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT))
                } else {
                    parent?.addView(w2, FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT))
                }
                w2.loadUrl(GAME_URL)
            } catch (e: Throwable) {
                showMaintenance()
            }
        }
    }

    /* ==================================================================
       维护页（服务器连不上 / 重建失败）
       ================================================================== */
    private fun showMaintenance() {
        if (showingMaint) { return }
        showingMaint = true
        val html = """
<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 html,body{margin:0;height:100%;background:#1a1208;color:#f2e8d8;
   font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
   display:flex;align-items:center;justify-content:center;
   -webkit-user-select:none;user-select:none}
 .box{text-align:center;padding:0 28px;max-width:440px}
 .t{font-size:22px;font-weight:800;color:#ffd83d;letter-spacing:2px;margin-bottom:10px}
 .s{font-size:13px;line-height:1.9;opacity:.86}
 button{margin-top:22px;padding:12px 30px;font-size:15px;font-weight:700;
   color:#1a1208;background:#ffd83d;border:0;border-radius:24px;cursor:pointer}
 button:active{background:#e0b800}
 .cd{margin-top:12px;font-size:12px;opacity:.6}
</style></head><body><div class="box">
 <div class="t">服务器维护中</div>
 <div class="s">
   正在等待服务器重新上线。
 </div>
 <button onclick="retry()">重新连接</button>
 <div class="cd" id="cd"></div>
</div>
<script>
 var left = $RETRY_SEC;
 var cd = document.getElementById('cd');
 function tick() {
   cd.textContent = left + ' 秒后自动重试';
   if (left <= 0) { retry(); return; }
   left--; setTimeout(tick, 1000);
 }
 function retry() { location.replace('$GAME_URL'); }
 tick();
</script></body></html>
"""
        try {
            web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
        } catch (e: Throwable) { }
    }

    /* ==================================================================
       全屏
       ================================================================== */
    private fun goFullscreen() {
        try { goFullscreenInner() } catch (e: Throwable) { /* 全屏失败也不能闪退 ✓ */ }
    }

    private fun goFullscreenInner() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
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

    /** 从别处切回来时系统栏可能又冒出来 → 再藏一次 ✓ */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) { goFullscreen() }
    }

    /** 返回键：能后退就后退；维护页上按返回直接退出 ✓ */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && !showingMaint && web.canGoBack()) {
            web.goBack()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onPause() {
        super.onPause()
        try { web.onPause() } catch (e: Throwable) { }
    }

    override fun onResume() {
        super.onResume()
        try { web.onResume() } catch (e: Throwable) { }
        goFullscreen()
    }

    override fun onDestroy() {
        try { web.destroy() } catch (e: Throwable) { }
        super.onDestroy()
    }
}
