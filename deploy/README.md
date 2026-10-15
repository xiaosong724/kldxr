# 云服务器部署指南（块来修仙）

给不在同一个 WiFi 的朋友玩，就得放到云上。
**这游戏零第三方依赖**（纯 Python 标准库 ✓）→ 部署比一般项目简单得多：
不用 pip、不用虚拟环境、不用装数据库 ✓ 只需要 python3 ✓

---

## 一、你需要什么

| 东西 | 要求 | 说明 |
|---|---|---|
| 云服务器 | 1 核 1G 就够 | 几个人玩完全够 ✓ 阿里云/腾讯云/搬瓦工都行 |
| 系统 | Ubuntu 22.04 / Debian 12 | 别的 Linux 也行 ✓ 只要能用 systemd ✓ |
| python3 | 3.8 以上 | Ubuntu 22.04 自带 3.10 ✓ 不用装 |
| 放行端口 | **8899 和 8900** | ★ 两个都要 ✗ 这是最容易漏的一步 ✓ |

★ 不用装：MySQL、Redis、Nginx、Node、pip 包 —— 一个都不用 ✓

---

## 二、部署（三条命令）

在**本地**仓库根目录，把代码传到服务器（下面把 `你的IP` 换掉）：

```bash
# 方式 A：用 git（推荐，以后更新方便）
ssh root@你的IP
git clone <你的仓库地址> /root/xiuxian2d

# 方式 B：直接传（不想在服务器上配 git 就用这个）
scp -r server web deploy root@你的IP:/root/xiuxian2d/
```

然后在**服务器**上跑一键脚本：

```bash
cd /root/xiuxian2d
sudo bash deploy/install.sh
```

它会：装 python3（如果没有）→ 复制到 `/opt/xiuxian2d` → 建一个专用用户 `xiuxian`
→ 装 systemd 服务（开机自启 + 崩了自动重启）→ 放行系统防火墙 ✓

跑完会打印一行 `http://<内网IP>:8899/` —— 那个是**内网** IP ✓ 外面用不了 ✓
真正要给朋友的是**公网 IP** ✓

---

## 三、★ 必须在云控制台放行端口（最容易漏的一步）

系统里的防火墙放行了**还不够** ✗
云服务商那层还有个**安全组** ✓ 也要放行 ✓

去你买服务器的那家控制台，找到「安全组 / 防火墙」，加两条**入方向**规则：

| 协议 | 端口 | 来源 |
|---|---|---|
| TCP | **8899** | 0.0.0.0/0（网页 + 接口）|
| TCP | **8900** | 0.0.0.0/0（游戏通道 ★ 别漏）|

★ 只开 8899 的症状：**能打开网页、能登录、但打怪没反应** ✓
（网页是 8899 ✓ 游戏数据走 8900 ✓ 一个不通就只成功一半 ✓）

放行后，手机浏览器打开：

```
http://你的公网IP:8899/
```

能出登录界面 = 通了 ✓ 可以去改 APK 的地址了 ✓

---

## 四、客户端要改的地方

### APK（给朋友装的）

一处：

```
android/app/src/main/java/com/xiuxian/game/MainActivity.kt
    const val GAME_URL = "http://你的公网IP:8899/"
```

改完在 Android Studio 里重新打一个 APK ✓ 发给朋友 ✓

### 网页（自己用浏览器玩）

不用改 ✓ 直接开 `http://你的公网IP:8899/` 就行 ✓
（游戏通道的地址是客户端拿网页地址自动拼的 ✓）

---

## 五、开服前一定要做的两件事

```bash
# 1. 改管理页密码（默认是 xiuxian-admin ✗ 谁都能进）
vim /opt/xiuxian2d/server/config.json
#    "admin_password": "改成一个强密码"
sudo systemctl restart xiuxian

# 2. 确认关掉了玩家调试开关（默认就是 false ✓ 别打开）
#    "allow_player_debug": false
```

---

## 六、日常运维

```bash
systemctl status xiuxian        # 看状态
journalctl -u xiuxian -f        # 看日志（实时）
sudo systemctl restart xiuxian  # 重启
sudo systemctl stop xiuxian     # 停服（玩家那边会看到「服务器维护中」✓）
```

**更新代码**（改了游戏之后）：

```bash
cd /root/xiuxian2d && git pull
sudo cp -r server web /opt/xiuxian2d/     # ★ 别覆盖 game.db ✗
sudo chown -R xiuxian:xiuxian /opt/xiuxian2d
sudo systemctl restart xiuxian
```

★ **存档就是 `game.db` 一个文件** ✓ 别弄丢 ✓ 建议每天备份：

```bash
# 加到 crontab（crontab -e）：每天 4 点备份一次，留 7 天
0 4 * * * cp /opt/xiuxian2d/server/game.db /opt/xiuxian2d/backup-$(date +\%F).db && find /opt/xiuxian2d -name 'backup-*.db' -mtime +7 -delete
```

---

## 七、常见问题

| 现象 | 原因 | 怎么修 |
|---|---|---|
| 手机打不开网页 | 安全组没放行 8899 | 云控制台加规则 |
| 能进游戏但**打怪没反应** | 8900 没放行 | 云控制台再放行 8900 |
| 能玩但一直"连接断开" | 8900 被挡 / 网络抖 | 同上；客户端断线会自动重连 + 刷新一次 |
| 服务器重启后要手动开 | 服务没设开机自启 | `sudo systemctl enable xiuxian` |
| 更新代码后存档没了 | 覆盖了 game.db | 按上面第六节的办法更新 ✓ |
| 玩家那边显示"服务器维护中" | 服务器没开 / 正在重启 | 这是对的 ✓ 起来后点重新连接就行 |

---

## 八、关于 HTTPS（可选，先不用管）

现在的流程是 `http://` + `ws://`（明文）。给朋友试玩**够用** ✓
但如果你以后要挂域名 + HTTPS ✗ 要注意：

- 网页变 `https://` 之后，浏览器**不允许**它去连 `ws://`（明文）✗
  必须也升级成 `wss://` ✓
- 客户端里拼地址的地方在 `web/platform/web.js` 的 `wsUrl()`
  （现在固定拼 `ws://` ✗ 要改成"网页是 https 就用 wss"✓）
- 走 HTTPS 的话通常还会在前面挂 Nginx 做反向代理 ✓
  那时 8899/8900 都不直接对外 ✗ 由 Nginx 转发 ✓

★ 试玩阶段先别折腾这个 ✓ 等稳定了再做 ✓

---

## 九、一句话总结

```bash
# 服务器上：
sudo bash deploy/install.sh
# 云控制台：放行 8899 + 8900
# 然后手机浏览器开 http://公网IP:8899/ 验证
# 最后改 APK 里的 GAME_URL → 重新打包发给朋友
```
