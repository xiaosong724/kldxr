package com.xiuxian.game.lan

import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * APK 内置更新检测。
 *
 * 版本文件： {GAME_URL}/downloads/{channel}.json
 * 字段：versionCode / versionName / apkUrl / notes
 *
 * 下载用系统 DownloadManager（不需要第三方库），
 * 进度用 AlertDialog + ProgressBar 轮询显示。
 */
class UpdateManager(
    private val activity: Activity,
    private val baseUrl: String,
    private val channel: String
) {
    private val ui = Handler(Looper.getMainLooper())

    fun check() {
        Thread {
            try {
                val url = URL(baseUrl.trimEnd('/') + "/downloads/" + channel + ".json?ts=" + System.currentTimeMillis())
                val conn = url.openConnection() as HttpURLConnection
                conn.connectTimeout = 4000
                conn.readTimeout = 4000
                conn.requestMethod = "GET"
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                conn.disconnect()
                val obj = JSONObject(body)
                val code = obj.optInt("versionCode", 0)
                val pi = activity.packageManager.getPackageInfo(activity.packageName, 0)
                val curCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) pi.longVersionCode.toInt() else pi.versionCode
                if (code > curCode) {
                    ui.post { showDialog(obj) }
                }
            } catch (_: Throwable) {
                /* 更新检查失败不打扰玩家 */
            }
        }.start()
    }

    private fun showDialog(obj: JSONObject) {
        if (activity.isFinishing) return
        val notes = obj.optString("notes", "")
        AlertDialog.Builder(activity)
            .setTitle("发现新版本  " + obj.optString("versionName", ""))
            .setMessage(if (notes.isBlank()) "有新版本可用，是否现在更新？" else notes)
            .setPositiveButton("立即更新") { _, _ -> startDownload(obj.optString("apkUrl", "")) }
            .setNegativeButton("稍后", null)
            .show()
    }

    private fun startDownload(path: String) {
        if (path.isBlank()) return
        val url = if (path.startsWith("http")) path
        else baseUrl.trimEnd('/') + "/" + path.trimStart('/')

        val dm = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val fileName = "update-$channel-${System.currentTimeMillis()}.apk"
        val req = DownloadManager.Request(Uri.parse(url))
            .setTitle("块来修仙更新")
            .setDescription("正在下载新版本")
            .setMimeType("application/vnd.android.package-archive")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, fileName)

        val id = try {
            dm.enqueue(req)
        } catch (_: Throwable) {
            toast("下载失败，请检查网络")
            return
        }

        val box = LinearLayout(activity)
        box.orientation = LinearLayout.VERTICAL
        val pad = (18 * activity.resources.displayMetrics.density).toInt()
        box.setPadding(pad, pad / 2, pad, 0)

        val bar = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal)
        bar.max = 100
        bar.progress = 0
        val txt = TextView(activity)
        txt.text = "准备下载…"
        txt.setPadding(0, (10 * activity.resources.displayMetrics.density).toInt(), 0, 0)
        box.addView(bar, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ))
        box.addView(txt, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ))

        var finished = false
        val dlg = AlertDialog.Builder(activity)
            .setTitle("正在下载更新")
            .setView(box)
            .setCancelable(false)
            .setNegativeButton("取消") { _, _ ->
                finished = true
                try { dm.remove(id) } catch (_: Throwable) { }
            }
            .create()
        dlg.show()

        val poll = object : Runnable {
            override fun run() {
                if (finished || !dlg.isShowing) return
                val q = DownloadManager.Query().setFilterById(id)
                val c = try { dm.query(q) } catch (_: Throwable) { null }
                if (c != null && c.moveToFirst()) {
                    val status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                    val total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                    val now = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                    if (total > 0) {
                        val pct = ((now * 100L) / total).toInt().coerceIn(0, 100)
                        bar.progress = pct
                        txt.text = "已下载 " + pct + "%  (" + mb(now) + " / " + mb(total) + ")"
                    } else {
                        txt.text = "已下载 " + mb(now)
                    }
                    if (status == DownloadManager.STATUS_SUCCESSFUL) {
                        finished = true
                        c.close()
                        dlg.dismiss()
                        install(dm.getUriForDownloadedFile(id))
                        return
                    }
                    if (status == DownloadManager.STATUS_FAILED) {
                        finished = true
                        c.close()
                        dlg.dismiss()
                        toast("下载失败，请重试")
                        return
                    }
                }
                c?.close()
                ui.postDelayed(this, 300)
            }
        }
        ui.post(poll)
    }

    private fun install(uri: Uri?) {
        if (uri == null) { toast("安装包下载失败"); return }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !activity.packageManager.canRequestPackageInstalls()) {
            toast("请允许安装未知应用，然后重新点击更新")
            try {
                activity.startActivity(Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.packageName)
                ))
            } catch (_: Throwable) { }
            return
        }
        try {
            val i = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(i)
        } catch (_: Throwable) {
            toast("无法启动安装器")
        }
    }

    private fun mb(v: Long): String {
        if (v <= 0) return "0 KB"
        return if (v >= 1024 * 1024) String.format("%.1f MB", v / 1024.0 / 1024.0)
        else String.format("%.0f KB", v / 1024.0)
    }

    private fun toast(s: String) {
        ui.post { Toast.makeText(activity, s, Toast.LENGTH_SHORT).show() }
    }
}
