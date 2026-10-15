package com.xiuxian.game

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView

/**
 * 末日丧尸 · 组队修仙 —— 安卓壳（把 H5 游戏装进 APK 给好友试玩）
 *
 * ★★★ 这个文件里唯一需要你改的东西：GAME_URL ★★★
 *
 *   把下面的地址改成【跑服务器那台电脑】的地址：
 *     · 同一个 WiFi（最快，适合给身边的朋友）：http://192.168.31.180:8899/
 *     · 外网（要给不在同一个 WiFi 的朋友）：见 android/README.md 里的"外网方案"
 *
 *   为什么不用 127.0.0.1：那是【手机自己】✗
 *     手机上的 127.0.0.1 指的是手机本身，而游戏服务器在电脑上 ✗
 *
 * ★ 另外注意：游戏的 WebSocket 端口（8900）是客户端自动拼的
 *   规则是 ws://<和网页一样的地址>:8900/ws
 *   → 所以只要网页地址填对了，WebSocket 自动就对了 ✓ 不用单独配
 */
class MainActivity : Activity() {

    companion object {
        /** ★ 改这里：跑服务器那台电脑的地址（末尾要带 / ） */
        const val GAME_URL = "http://192.168.31.180:8899/"

        /** 连不上时显示的提示（用户可以点一下重试） */
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

        /* 横屏游戏 + 屏幕常亮（玩久了不该自动锁屏） */
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val root = FrameLayout(this)
        root.setBackgroundColor(Color.parseColor("#1a1208"))

        web = WebView(this)
        web.settings.apply {
            javaScriptEnabled = true                 /* 游戏是 JS 写的，必须开 */
            domStorageEnabled = true                 /* localStorage 存登录 token */
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false /* 音效不用先点一下才响 */
            loadsImagesAutomatically = true
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = false
            displayZoomControls = false
            /* 允许混合内容：网页是 http，WebSocket 是 ws —— 都是明文，必须放行 */
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            }
        }
        web.setBackgroundColor(Color.parseColor("#1a1208"))
        web.isScrollbarFadingEnabled = true
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.webViewClient = object : WebViewClient() {
            /** 页面内的跳转都留在 App 里（不要甩到浏览器） */
            override fun shouldOverrideUrlLoading(v: WebView?, url: String?): Boolean {
                return false
            }

            /** 页面加载失败（服务器没开 / 地址不对）→ 出提示，别白屏 */
            override fun onReceivedError(
                v: WebView?, errorCode: Int, description: String?, failingUrl: String?
            ) {
                showCover(true)
            }

            override fun onPageFinished(v: WebView?, url: String?) {
                /* 页面能加载出来就先把遮罩收掉（内部再断线由游戏自己提示） */
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
        cover.setOnClickListener {   /* 点一下重试 */
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

    private fun showCover(show: Boolean) {
        runOnUiThread { cover.visibility = if (show) View.VISIBLE else View.GONE }
    }

    /** 返回键：网页能后退就后退，不能再退就退出 App（免得一点就掉出去） */
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
        /* ★ 退到后台就暂停 JS ✗ 这样 WebSocket 会断 ✓
           游戏的服务器有 6 秒离线宽限（第 168 轮）→ 短暂切出去不会被立刻踢 ✓ */
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }
}
