# QQ 群转发 · 上线清单（round421）

> 本地服 → **1103784008**（小D助手 · 测试群）
> 云服务器 → **346049634**（我的世界国际服 · 主群）
>
> 记：`qq-forwarder` 跑在云上 `43.138.171.250:8099`，游戏服只调它的
> `POST /api/bridge/send`（`{token, group_id, message}`），**不改云端任何代码**。

---

## 一、转发的是什么

| 事件 | 什么时候发 | 例子 |
|---|---|---|
| 滚动通知（ticker） | 升级 / 击杀玩家 / 夺取 / 拾取 / 管理广播 | `半个六道 突破到第 29 层` |
| 玩家上线 | 真的进世界之后（重连刷屏会被过滤） | `🟢 半个六道 上线了（炼气 28 层 · 当前在线 1 人）` |

开关：**管理页 → 刷怪上限那张卡下面的「QQ 群转发」**（开/关立刻生效，不用重启）
存库：`meta.admin_tune.qq_on`，重启自动恢复；管理页设过就**优先于** `config.json`

---

## 二、配置在哪里

`server/config.json` 的 `qq` 段：

```json
"qq": {
  "enabled": true,
  "url": "http://43.138.171.250:8099/api/bridge/send",
  "token": "N7hyNbxaEVK2f2PxL_75gYlk",
  "group": "1103784008",          ← 本地是测试群，云上要改 346049634
  "minIntervalMs": 1500,
  "kinds": ["up", "kill", "mq", "tier", "join", "sys"]
}
```

★ **`tools/deploy_cloud.py` 故意不传 `config.json`**（只用 `cp server/*.py`），
  所以云上那份是独立的 —— 本地改成测试群**不会**影响云。

### 云上怎么设成主群（两种，选一个）

**A. 环境变量（推荐 ✗ 不动配置文件）**

systemd 的 unit 里加：

```ini
Environment=XIUXIAN_QQ_GROUP=346049634
```

或者临时手跑：

```bash
XIUXIAN_QQ_GROUP=346049634 python app.py
```

支持四个：`XIUXIAN_QQ_GROUP` / `XIUXIAN_QQ_URL` / `XIUXIAN_QQ_TOKEN` / `XIUXIAN_QQ_ENABLED`
（`XIUXIAN_QQ_ENABLED=0` 就能整条关掉 ✓ 优先级最高）

**B. 直接改云上那份 `server/config.json`**

把 `qq.group` 改成 `"346049634"`。★ 云上原来**没有** `qq` 这段（这功能是新加的），
所以要么整段粘过去，要么用 A。

---

## 三、同步云端要传什么

| 文件 | 说明 |
|---|---|
| `server/qqbridge.py` | **新文件**（转发桥）✗ 漏传 = 启动时 import 失败（有空 try，只是不转发 ✓）|
| `server/app.py` | 建桥 + `/api/health` 的 qq 段 + 环境变量覆盖 + `qq` 管理动作白名单 |
| `server/world.py` | `_ticker` / `_qq_join` / `_handle_admin('qq')` / 管理设置存盘 |
| `server/weapons.py` | 弓进掉落表（round420）|
| `server/talents.py` | 天赋 11 项（round411）|
| `server/value.py` | 坏武器/防具 10 金币 |
| `server/auth.py` | 背包排序（品阶优先）|
| `server/market.py` / `server/db.py` / `server/protocol.py` / `server/net.py` | 交易所过期、启动清锁、协议白名单、bagsort |
| `web/core/game.js` / `web/platform/web.js` / `web/index.html` / `web/admin.html` | 客户端 + 管理页 |
| **`server/config.json`** | **不要传**（云上自己那份；要开转发就按第二节 A/B 配）|
| `server/game.db` | **不要传**（玩家数据）|

---

## 四、上线后怎么验

```bash
# ① 转发状态（on=true / group 对不对 / sent 在涨 / fails=0）
curl -s http://127.0.0.1:8899/api/health | python -m json.tool | grep -A8 '"qq"'

# ② 云端 qq-forwarder 活着、机器人在线
curl -s http://43.138.171.250:8099/api/health
```

然后**在游戏里上线一次** —— 群里应该出现
`🟢 你的名字 上线了（炼气 N 层 · 当前在线 M 人）`。

---

## 五、已知行为（免得以为是 bug）

| 现象 | 原因 |
|---|---|
| 群里没消息，但 `sent` 在涨 | 云端 qq-forwarder 的 `bridgeStats.sends` **只统计 WS 那条链**，HTTP 这条不计 ✓ 以游戏服 `fails=0` 为准 |
| `fails` 涨、`lastErr` 有 HTTP 500 | 群号没在 qq-forwarder 的 `botOfficial.groups` 里（或 openid 没学到）→ 先在群里 @机器人 发一句 |
| 测试号上线不转发 | 名字里含 `config.test_name_keys`（"测试"等）会被过滤 ✓ 防止自己跑冒烟刷群 |
| 一分钟最多 20 条、每 1.5 秒一条 | 官方机器人有频率限制 ✓ 多了会被丢 |
| 关了再开，之前积压的消息不会补发 | 队列在关掉时不进（`post()` 直接丢弃）✓ 只发关掉之后的新消息 |
