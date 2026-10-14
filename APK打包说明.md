# APK 打包说明（PWABuilder 在线打包 · 不用装 Android SDK）

> 机器现状（2026-10-12 实测）：**java ✓ node ✓ npm ✓**，但 **gradle ✗ adb ✗ Android SDK ✗**
> → 所以本地打 APK 不可行（要下 1~2 GB SDK + 授权）；**走 PWABuilder 在线打包最快** ✓

## 方式 A（推荐 · 3 分钟出 APK）
1. 打开 https://www.pwabuilder.com
2. 选 **「Package for Stores」→ Android**（或首页直接选 Android）
   - 输入网址：`http://192.168.31.180:8899`（需手机/浏览器能访问 ✓ 同一局域网即可）
   - 若它要求公网地址 → 用**方式 B**（上传 zip ✓ 不需要公网 ✓）
3. 选 **Test package**（签名版）→ 它会生成 `.apk` + `signing.keystore`
   - **keystore 一定要保存**（以后升级 APK 要用同一个签名 ✓）
4. 下载 `.apk` → 传到手机 → 安装（需允许"未知来源" ✓）

## 方式 B（上传 zip · 不需要公网）
1. 打开 https://www.pwabuilder.com → **「Package for Stores」→ Android**
2. 选 **「Upload your PWA package」** → 上传 `C:\mc\xiuxian-2d\dist\xiuxian2d-pwa.zip`
3. 同样生成 APK + keystore → 下载安装

## 方式 C（本地打 · 以后想自动化再走）
需要先装 Android SDK（约 1~2 GB）：
```
1) 装 Android Studio 或 commandline-tools（含 sdkmanager）
2) sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
3) npm i -g @bubblewrap/cli
4) bubblewrap init --manifest http://192.168.31.180:8899/manifest.webmanifest
5) bubblewrap build          # 出 app-release-signed.apk
```
（费用：下载 + 构建 30~60 分钟 ✓ 好处是以后改版可一键重打 ✓）

## 说明
- 打出来的 APK 本质是 **TWA/WebView 壳**：内容仍从你的后端加载 ✓
  → **前端改动不需要重发 APK**（热更新 ✓✓ 这是选 H5 的核心好处 ✓）
- 手机也可**不装 APK**：Chrome 打开 `http://192.168.31.180:8899` → 菜单 → **「安装应用/添加到主屏幕」**
  → 全屏、带图标、离线可开 ✓ 体验已接近原生 APP ✓
- 后端要一直在跑：`python C:\mc\xiuxian-2d\server\app.py`

> ★ **关于"离线可开 / 添加到主屏幕"（第 28 轮修的）**：
> 这两件事都依赖 **Service Worker**，而浏览器规定 SW **只在 `https` / `localhost` / `127.0.0.1`
> 下才允许注册**。所以：
> ```
> 电脑上  http://127.0.0.1:8899      → SW 能装 ✓ 离线可开 ✓
> 手机上  http://192.168.31.180:8899 → SW 装不上，能正常玩，但没有离线/真·安装 ✗
> ```
> 手机想要真·PWA 就得 **https**（域名 + 证书 + nginx 反代，见交接文档 §7 的部署清单），
> 或者走 APK 壳（TWA 里是 https 或允许 http 的受控环境）✓
> 第 28 轮之前 `sw.js` 写了却**从来没注册过**，而且清单里有个不存在的 `./app.js`
> 导致安装必失败 —— 现在都修好了，`test_browser.js` 里有一条断言盯着它是 `active` ✓
