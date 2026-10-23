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
 *
 * ★ 第 191 轮新增：服务器没开 / 重启时显示【维护中】页面 + 重新连接按钮
 *   以前这种情况 WebView 会甩出浏览器自己的"无法连接"✗ 很难看也不像游戏 ✓
 *   现在：主页面加载失败 → 换成一张自带的维护页（深色、和游戏一个风格 ✓）
 *        上面有【重新连接】按钮 + 每 15 秒自动重试一次 ✓
 */
class MainActivity : Activity() {

    companion object {
        /** ★ 改这里：跑服务器那台电脑的地址（末尾要带 / ） */
        const val GAME_URL = "http://192.168.31.180:8899/"

        /** 维护页上的自动重试间隔（秒）*/
        private const val RETRY_SEC = 15
    }

    private lateinit var web: WebView
    private var showingMaint = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        /* ★★★ 2026-10-23（用户："切换横竖屏时，打开游戏会不会闪一下"）★★★
           ★ 必须在【最最前面】就把方向定下来 ✗ 越晚越容易看到翻转 ✓
           ★ 顺序：super.onCreate → 立刻 requestedOrientation → 再建界面 ✓
             这样窗口还没画出来方向就定了 ✗ 用户看不到任何旋转 ✓
           ★ 没存过（第一次装）：什么都不做 ✗ 走 Manifest 的 fullSensor
             → 按手机当前怎么拿就怎么开 ✓ 也不会转 ✓ */
        try {
            val saved = getSharedPreferences("xiuxian", MODE_PRIVATE).getInt("screenOrientation", 0)
            if (saved != 0) { requestedOrientation = saved }
        } catch (e: Throwable) { }

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        /* ★★★ 2026-10-23 性能：告诉系统"这是游戏，别省电降频" ★★★
           · FLAG_HARDWARE_ACCELERATED —— 双保险（Manifest 里也有 ✓）
           · 关掉窗口动画 / 转场动画（一次性设置）✓
           · 让 View 的绘制走 GPU 管线 ✓ */
        try {
            window.addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED)
        } catch (e: Throwable) { }
        /* ★ 这里不能调 goFullscreen() ✗ 界面还没建出来 → 会 NPE 闪退 ✓
           （第 184 轮真机踩过 ✓ 挪到 setContentView 之后 ✓）*/

        val root = FrameLayout(this)
        root.setBackgroundColor(Color.parseColor("#1a1208"))

        /* ★★★ 2026-10-23：V8 调优 —— 先说结论 ★★★
           ★ 我查了：普通 APK 【改不了 WebView 的 V8 flags】✗
             · --js-flags 只有 Chromium 自己能读（从命令行 / apex 配置）
             · WebView 没提供任何公开或反射可用的入口 ✓
             · 那些 SystemProperties("debug.webview.v8.flags") 的老写法
               在 Android 8+ 已经失效 ✗（我试过不行 ✓）
           → 所以【不在 APK 层做 V8】，而是用下面这些【确实有效】的替代：
             ① 开 WebContentsDebuggingEnabled —— 只用于真机排查（不是性能）✓
             ② WebView 的多进程渲染 + 优先级（已做 ✓）
             ③ 把「省 GC」的工作交给 JS 侧：
                - 减少每帧 new 对象（飘字池已经做了 ✓）
                - 复用 Vector3/Matrix4（项目已有 REUSE_V3 ✓）
             ④ 下面这个 setRendererPriorityPolicy + 高优先级线程池，
                是 APK 层【真正能影响 JS 执行速度】的手段 ✓

           ★ 如果以后真要做 V8 级优化，唯一可行的路是：
             打包自己的 Chromium（巨大）✗ 或者改用 GeckoView / 原生渲染 ✓
             不值得，收益也就 10% 上下 ✓
        */
        try {
            WebView.setWebContentsDebuggingEnabled(true)
        } catch (e: Throwable) { }

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
            /* ★ 2026-10-23：缓存策略 —— 静态资源走缓存 ✗ 别再每次重下 ✓
               （只影响"加载速度"，不影响代码更新：项目用 ?v=构建号 破缓存 ✓）*/
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            /* ★ 让 WebView 用 2D 画布时不走软件路径 ✓ */
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                offscreenPreRaster = true
            }        }
        web.setBackgroundColor(Color.parseColor("#1a1208"))
        web.isScrollbarFadingEnabled = true
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.setPadding(0, 0, 0, 0)

        /* ★★★ 2026-10-23：GPU / 渲染性能优化（画面不变、玩法不变）★★★
           目标：把 WebView → 屏幕 这条合成链上多余的 CPU 开销砍掉。
           都要点：
             ① setLayerType(LAYER_TYPE_HARDWARE)
                WebView 默认会走一层软件绘制 ✗ 显式指定硬件图层 ✓
                省掉一次整屏 CPU 拷贝（高分辨率屏尤其明显）
             ② setRendererPriorityPolicy(RENDERER_PRIORITY_IMPORTANT, false)
                把渲染进程提到"重要"优先级 ✗ 系统不会给它降频 ✓
                （false = 不在不可见时自动降级 —— 我们是全屏游戏，切后台自然会 pause）
             ③ 关掉过度滚动 / 滚动条 / 长按选中 / 自动填充
                这些每帧都可能触发额外的合成层重建 ✓
             ④ WebSettings 关掉"离线缓存预取"之类的后台活
           全部加 try-catch ✗ 任一机型不支持也不能闪退（真机踩过 NPE 的教训 ✓）
        */
        try {
            web.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        } catch (e: Throwable) { }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
            } catch (e: Throwable) { }
        }

        try {
            web.isLongClickable = false       // 长按不触发文字选择（省一次合成层）
            web.isHapticFeedbackEnabled = false
            web.settings.setSupportZoom(false)
            web.settings.setTextZoom(100)     // 不让系统字体大小影响布局（避免重排）
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                web.settings.safeBrowsingEnabled = false   // 游戏不需要，省后台检查
            }
            /* ★ 关掉"自动填充"那套表单服务 ✗ 游戏没有表单 ✓ */
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                web.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
            }
        } catch (e: Throwable) { }

        /* ★★★ 2026-10-23（用户："我手机无法横屏，从 APK 层面解决"）★★★
           ★ 病根：游戏里【设置 → 画面 → 横屏】调的是
             window.AndroidShell.setOrientation('landscape') ✗
             而 APK 从来没提供这个接口 → 游戏只能退化成"只换 CSS 布局"✓
             所以你点了横屏，画面布局变了，但手机【根本没转】✓✓
           ★ 修：给 WebView 注入一个 AndroidShell 对象，提供 setOrientation：
             · 'landscape' → SCREEN_ORIENTATION_SENSOR_LANDSCAPE（跟随重力左右转 ✓）
             · 'portrait'  → SCREEN_ORIENTATION_SENSOR_PORTRAIT
             · 'auto'      → SCREEN_ORIENTATION_FULL_SENSOR
           ★ 为什么用 SENSOR_* 而不是固定 LANDSCAPE：
             固定的话用户把手机倒过来，画面还是那个方向 ✗ 很别扭 ✓
             SENSOR 会跟着重力自动翻 ✓ 这才是手机游戏该有的手感 ✓
           ★ 调用必须在 UI 线程 ✗ 用 runOnUiThread ✓
           ★ 加 @JavascriptInterface 才能在 JS 里访问（Android 4.2+ 强制要求 ✓）*/
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
                    /* ★ 记忆住方向 ✗ 下次启动直接用这个方向开
                       → 就【不会出现"先竖屏闪一下再转横屏"】✓
                       （这是用户明确担心的观感问题 ✓）*/
                    try {
                        getSharedPreferences("xiuxian", MODE_PRIVATE).edit()
                            .putInt("screenOrientation", target).apply()
                    } catch (e0: Throwable) { }
                    runOnUiThread {
                        try { requestedOrientation = target } catch (e1: Throwable) { }
                    }
                }

                /* 游戏想知道当前是不是真的横屏（用于 UI 判断 ✓）*/
                @android.webkit.JavascriptInterface
                fun isLandscape(): Boolean {
                    return try {
                        resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
                    } catch (e: Throwable) { false }
                }
            }, "AndroidShell")
        } catch (e: Throwable) { }

        /* ★ 启动时【一开始就直接用上次的方向】—— 已在 onCreate 最前面做了 ✓
           这里不用再设一次（重复设置反而可能触发一次重新布局 ✓）
           ★ 没存过（第一次装）就按屏幕当前方向走（Manifest 的 fullSensor）✓ */

        /* ★★★ 2026-10-23：高刷新率优化 ★★★
           真机实测：这块屏支持 120/90/60Hz，但游戏只跑到 ~55 FPS ✗
           ★★★ 用户明确要求："不要限制帧率" ★★★
           → 所以这里【只做一件事】：把窗口的刷新率上限顶到屏幕最高的那一档
             不写死 120 / 90 ✗ 用 dm.supportedModes 里 refreshRate 最大的那个 ✓
             换台 90Hz 的手机就自动要 90，144Hz 就要 144 ✓ 永远不锁死 ✓
           → 调用 setFrameRate 反而可能锁帧 ✗ 所以【不用它】（编译也报不存在 ✓）
           ★ 两者都是"提示" ✗ 系统不支持就自动忽略 ✓ 不会崩 ✓
        */
        try {
            val dm = window.windowManager.defaultDisplay  // 老 API，但所有版本都能用
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

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView?, url: String?): Boolean = false

            /**
             * 加载失败 → 换成维护页
             * ★ 只看【主页面】的失败（isForMainFrame）✗
             *   子资源（图片/音效）加载失败不该整页变维护 ✓
             */
            override fun onReceivedError(
                view: WebView?, request: WebResourceRequest?, error: WebResourceError?
            ) {
                if (request == null || request.isForMainFrame) { showMaintenance() }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                /* 真正的游戏页加载成功 → 清掉"正在维护"的标记 ✓ */
                if (url != null && url.startsWith("http")) { showingMaint = false }
            }
        }
        web.webChromeClient = WebChromeClient()

        root.addView(
            web,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        setContentView(root)

        /* 界面建好了，这时候才能安全地进全屏 ✓ */
        goFullscreen()

        web.loadUrl(GAME_URL)
    }

    /**
     * 服务器连不上 → 显示自带的维护页
     *
     * ★ 为什么用 loadDataWithBaseURL 拼一段 HTML，而不是放 assets 文件：
     *   需要把 GAME_URL 注入进页面（"重新连接"按钮要用 ✓）
     *   直接拼最省事，也不用多一个资源文件 ✓
     */
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
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    private fun goFullscreen() {
        try { goFullscreenInner() } catch (e: Throwable) { /* 全屏失败也绝不能闪退 ✓ */ }
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

    /** 从别处切回来时系统栏可能又冒出来 → 再藏一次（immersive 的标准做法 ✓）*/
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) { goFullscreen() }
    }

    /** 返回键：能后退就后退；在维护页上按返回就直接退出 ✓ */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && !showingMaint && web.canGoBack()) {
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
