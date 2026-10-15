# 安卓试玩包（把 H5 游戏装进 APK）

给好友试玩用的壳：一个纯 WebView，打开就是游戏页面。
**没有任何第三方依赖**（依赖越少，编译越不容易出问题，包也越小）。

---

## 一、先决条件：好友的手机要能连到你的服务器

游戏不是单机的 —— 所有伤害、掉落、魔气都在服务器上算。
所以手机必须能访问到跑服务器的那台电脑。

### 方案 A：同一个 WiFi（最快，适合身边的朋友）

1. 查到这台电脑的局域网 IP（已经查过了：**192.168.31.180**）
   命令：`ipconfig` → 看「IPv4 地址」
2. 手机连**同一个 WiFi**
3. 手机浏览器打开 `http://192.168.31.180:8899/`
   - 能出登录界面 → 网络通了 ✓ 可以去装 APK
   - 打不开 → 多半是 Windows 防火墙拦了（见下面第 4 条）
4. **放行防火墙**（用管理员权限的 PowerShell 跑一次就行）：
   ```powershell
   New-NetFirewallRule -DisplayName "xiuxian2d" -Direction Inbound -Protocol TCP -LocalPort 8899,8900 -Action Allow
   ```
5. 注意：电脑休眠 / 服务器关掉，手机就连不上（游戏内会提示"已断开"）

### 方案 B：外网（要发给不在同一个 WiFi 的朋友）

局域网 IP 出了家门就没用了。两个办法：

- **内网穿透**（推荐，不用有公网 IP）
  用 `cloudflared` / `frp` / `ngrok` 之类，把本机 8899 和 8900 映射出去，
  然后把 `GAME_URL` 改成映射出来的地址。
  ⚠ 必须**两个端口都要映射**：8899 是网页，8900 是游戏通道
  ⚠ 如果映射出来的地址是 `https://xxx`，游戏通道要是 `wss://` 才算安全 ——
    现在客户端是自动拼 `ws://`，用 https 的话要改一行（见 `web/platform/web.js`
    里的 `wsUrl()`）
- **端口转发**（家里路由器上把 8899/8900 转到这台电脑 + 用公网 IP）
  麻烦些，而且把家里的机器暴露在公网，试玩阶段不太建议

---

## 二、用 Android Studio 打包

1. Android Studio → **Open** → 选这个 `android` 目录（不是仓库根目录）
2. 等它自动 Sync（第一次会下载 Gradle 和构建工具，几分钟）
3. **先在模拟器/真机上试**
   真机：手机打开「开发者选项 → USB 调试」，插上 USB，点绿色 ▶ Run
4. **打 APK 给朋友**
   `Build → Build Bundle(s) / APK(s) → Build APK(s)`
   产物在 `android/app/build/outputs/apk/debug/app-debug.apk`
   （debug 包可以直接装 ✓ 朋友手机要允许"安装未知来源应用"）
5. **正式一点的话**：`Build → Generate Signed Bundle / APK` → 建一个签名 → release

---

## 三、要改地址的话，改哪里

只有一个地方：

```
android/app/src/main/java/com/xiuxian/game/MainActivity.kt
    第 40 行左右：const val GAME_URL = "http://192.168.31.180:8899/"
```

末尾那个 `/` 要留着 ✓ 改完重新 Run 一次就生效 ✓

**为什么不用 127.0.0.1**：那是手机自己，游戏服务器在电脑上，不是同一台机器。

**WebSocket 端口不用单独配**：客户端会拿网页地址的主机名 + 8900 自动拼
（`web/platform/web.js` 里的 `wsUrl()`）→ 网页地址对了，游戏通道就对了 ✓

---

## 四、已知的坑（试玩前先看一眼）

| 现象 | 原因 | 怎么办 |
|---|---|---|
| 一打开就白屏、提示连不上 | 服务器没开 / 地址不对 / 防火墙 | 先用**手机浏览器**打开那个地址试试 |
| 能进游戏但打怪没反应 | WebSocket（8900）没通 | 防火墙要放行**两个**端口，不只是 8899 |
| 手机切后台一会儿回来要重登 | WebView 暂停后 WebSocket 断了 | 服务器有 6 秒离线宽限；久了就重新进一次 |
| 画面卡 | 老手机 GPU 弱 | 游戏里可以调画质（菜单 → 画面） |
| ⚠ 音效不对劲 | 现在用的是 Minecraft 的音效**（版权问题）** | **给别人玩之前应该换掉**，见 `docs/交接.md` |

---

## 五、还没做的（后面可以加）

- **摇杆手感**：现在手机上就是「左半屏拖动 = 走，右半屏点 = 攻击」，先用着
- 应用图标（现在用系统默认图标）
- 自动重连提示优化（现在是游戏内一条横幅）
- 版本号显示 / 强制更新（服务器发构建号，客户端不一致就提示更新）


---

## 六、版本要求（对不上会 Sync 失败）

这套工程钉的是一组**互相兼容**的版本，别单独改其中一个：

| 项 | 版本 | 写在哪 |
|---|---|---|
| Gradle | **8.7** | gradle/wrapper/gradle-wrapper.properties |
| Android Gradle Plugin | **8.5.2** | build.gradle |
| Kotlin | **1.9.24** | build.gradle |
| **Gradle JDK** | **17 或 21** | ★ 见下面这条，最容易踩 |
| compileSdk | **34** | 没装的话 Sync 会提示你装 |

### ★ 最常见的报错：Gradle JDK 版本不对

报错长这样：

```
Incompatible Gradle JVM version
The project's Gradle version 8.7 is incompatible with the Gradle JVM version 25 ...
Gradle 8.7 supports Java versions between 1.8 and 21
```

**原因**：Gradle 8.7 最高只支持 Java 21，而电脑上装了 Java 25 并被选中了。

**修法（二选一）**：

1. 报错框里直接点 **Apply compatible Gradle JDK configuration and sync** —— 最省事
2. 手动改：
   File → Settings → Build, Execution, Deployment → Build Tools → Gradle
   → **Gradle JDK** 下拉框 → 选 **jbr-21** 或 **jbr-17**（带 jbr- 前缀的是 Android Studio 自带的）
   → Apply → File → Sync Project with Gradle Files

**不要选**：Java 25 / 系统里那个最新的 JDK

### 网络慢怎么办

工程里已经把两处换成国内镜像了（第 178 轮）：

- Gradle 本体下载 → 腾讯镜像（gradle-wrapper.properties 里的 distributionUrl）
- 依赖仓库 → 阿里云优先 + 官方兜底（settings.gradle）

如果哪天镜像失效，把 distributionUrl 换回官方
https://services.gradle.org/distributions/gradle-8.7-bin.zip 即可。
