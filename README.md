# 末日丧尸 × 组队修仙

俯视 3D、无限开放世界、三人组队的丧尸生存 + 开放 PvP + 修仙成长（炼气 XX 级，1 ~ 无上限）。
**独立项目**，与 `xiuxian-java`（Minecraft 插件）完全不互通。

> **新会话 / 新接手先看 [docs/交接.md](docs/交接.md)** —— 现状、怎么跑、坑、下一步、云服务器连接都在里面。
> 完整设计见 **[docs/方案.md](docs/方案.md)**（数值公式、接口定义、性能架构、分期计划都在里面）

---

## 怎么跑

```
双击  启动服务器.bat          ← 会开一个窗口，关掉窗口 = 停服
      停止服务器.bat          ← 或者用这个
```

启动后控制台会打印本机地址和**局域网地址**（手机用局域网那个）：

```
本机      : http://127.0.0.1:8899/
局域网    : http://192.168.31.180:8899/   ← 手机用这个
健康检查  : http://127.0.0.1:8899/api/health
```

命令行跑也行：

```
cd server
python app.py                # 用 config.json
python app.py --port 9000    # 临时改端口
python db.py                 # 只建库（幂等，可重复跑）
```

---

## 目录

```
server\
  app.py           入口：HTTP 静态服务 + /api/health + 账号接口 + 起 WS/tick 线程
  db.py            数据库：表结构（版本化迁移）+ 连接工具
  auth.py          账号：注册/登录/token/失败退避（PBKDF2-SHA256 + 盐）
  ws.py            手写 WebSocket（RFC 6455）
  world.py         世界：状态 + tick 线程 + 存档线程
  net.py           网络层：asyncio 侧认证与派发
  protocol.py      协议表 v1
  config.json      配置（${HERE} 占位 → 整个项目可以挪位置）
  game.db          存档（运行时生成）
web\
  index.html       薄壳：CSS + 页面结构 + script 标签（9 KB）
  core\game.js     ★ 玩法 + 渲染（零浏览器 API，97 KB）
  platform\web.js  ★ 唯一允许碰浏览器 API 的文件（27 KB）
  3d-v4.html       旧客户端（HTTP 轮询版，保留作对照，不要改）
  assets\3d\       地表 / 方块贴图
  assets\sfx\      音效（31 个）
  assets\cc0\      CC0 无版权素材
  lib\three.min.js 3D 引擎
tools\
  check_core_dom.py   闸门：core/ 里不许出现浏览器专有对象（必须退出码 0）
  check_free_vars.js  闸门：core/platform 里不许有"用了但没声明"的自由变量
  test_auth.py        回归：账号系统（25 条断言）
  test_ws.py          回归：WebSocket / 协议 / tick 线程（30 条断言）
  test_client.js      回归：端到端，Node 全局 WebSocket 走浏览器同一条协议路径（21 条）
  test_smooth.js      回归：走路平滑度（双客户端 + core 真实插值函数回放）
  test_browser.js     回归：真浏览器端到端，两个无头 Chrome 各登一个号、互相看见（12 条）
  diag_sample.js      离线单测：插值数学（应全 0）
  diag_standstill.js  离线单测：队友站住不动时不该被外推
docs\
  方案.md          完整设计文档
```

**分层铁律**（见方案 §1.3）：

```
core\      玩法 + 渲染        ★ 不许出现任何浏览器专有对象
platform\  画布/UI/网络/音频/存储/支付/广告
```

微信 / 抖音小游戏**没有浏览器 DOM**。core 保持干净，将来上小程序时
只换 `platform/` 一层（换成 weapp.js），core 一行都不用改。

**改完 core 必须跑**：`python tools\check_core_dom.py`

---

## 当前进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| **P0** 骨架 | 项目结构、数据库、账号、WebSocket、tick 分离、客户端接入、UI 分层、联调（走路平滑）| ✅ 完成（第 26 轮收口，第 27 轮已在真浏览器端到端验过）|
| P1 世界 | 无限区块地形 + 末日美术 + 按区域组织数据 | 🔄 进行中（**无限区块地形 ✅**、末日美术 ✅ 调色/氛围/残骸；**差原创素材**）|
| P2 战斗 | 服务端权威战斗、属性系统、僵尸职业、掉率 | 🔄 进行中（**僵尸上服务器 + 服务器判定伤害 + 经验升级 + 掉落拾取 ✅**；差职业/掉率细化/装备属性）|
| P3 成长 | 天赋点、装备、技能、突破 | ⬜ |
| P4 组队 PvP | 组队、经验分配、抢背包、安全区仓库 | ⬜ |
| P5 压测 | 50 人并发、区域分片、带宽优化 | ⬜ |
| P6 打磨 | UI、音效、引导；再决定是否上小程序 | ⬜ |

P0 细分与验收标准见 [docs/方案.md](docs/方案.md) §15.1（含第 26 轮的收口结论）。

---

## 几条不能忘的规矩

- **`web\core\` 里不许出现 `document` / `window` / `wx.*`** —— 为了将来能上微信/抖音小游戏（那些平台**没有 DOM**）
- **伤害 / 死亡 / 掉落 / 经验 / 装备 / 加点都由服务器算**，客户端只发意图（见方案 §1.4）
- **音效现在是 MC 原版提取的（自用）**，对外发布前必须换成原创音频
- 写 Python 脚本：带 `# -*- coding: utf-8 -*-`，显式 `encoding='utf-8'`、`newline='\n'`
