package com.xiuxian.game.lan

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.content.pm.ActivityInfo
import android.content.res.Configuration
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
import android.webkit.JavascriptInterface
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

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        /* ★ 这里不能调 goFullscreen() ✗ 界面还没建出来 → 会 NPE 闪退 ✓
           （第 184 轮真机踩过 ✓ 挪到 setContentView 之后 ✓）*/

        val root = FrameLayout(this)
        root.setBackgroundColor(Color.parseColor("#1a1208"))

        web = WebView(this)
        web.addJavascriptInterface(NativeBridge(), "AndroidShell")
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
        web.setPadding(0, 0, 0, 0)

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

        /* 启动后检查更新；失败静默，不打扰进游戏 */
        UpdateManager(this, GAME_URL, "local").check()
    }

    inner class NativeBridge {
        @JavascriptInterface
        fun setOrientation(mode: String) {
            runOnUiThread {
                try {
                    requestedOrientation = when (mode) {
                        "landscape" -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                        "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                        "sensor" -> ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
                        else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                    }
                } catch (e: Throwable) { }
            }
        }
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

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        try {
            web.requestLayout()
            web.evaluateJavascript("window.dispatchEvent(new Event('resize'));", null)
            goFullscreen()
        } catch (e: Throwable) { }
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
