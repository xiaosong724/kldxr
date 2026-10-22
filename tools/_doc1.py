# -*- coding: utf-8 -*-
"""给排行榜方案补 §13 实现记录"""
import io

p = 'docs/\u6392\u884c\u699c\u65b9\u6848.md'
s = io.open(p, encoding='utf-8').read()
add = """

---

## 13. 实现记录（round424 · 2026-10-18）

### 13.1 落地了什么

| 层 | 文件 | 内容 |
|---|---|---|
| 数据 | `server/db.py` | 迁移 **v10**：`role_stats`（kills/deaths/pvp_kills/play_sec）+ `roles.title_board` + 4 个索引 |
| 榜单 | `server/rankboard.py`（新） | 5 个榜的定义 / 算榜 `refresh()` / 名次表 `build_map()` / 称号文本 `title_text()`（**只读，不写库**）|
| 计数 | `server/world.py` | 杀僵尸 `_mob_died` +1、杀玩家 `_pvp_killed` +1（和魔气共用 10 分钟防刷锁）、在线时长每帧累加；每 15 秒/下线随存档 upsert |
| 称号 | `server/world.py` | `rank_map`（HTTP 线程发布、tick 只读）+ `_title_of()`；快照 `others`/`me` 增加 `tt`（文本）、`tm`（1/2/3 奖牌） |
| 接口 | `server/app.py` | `GET /api/rank?board=&page=&size=`（只排前 100 · 每页 10 · `me` 永远给）+ 60 秒缓存 + 测试号过滤 + `?force=1` 仅管理员；后台每 60 秒刷新榜单线程 |
| 协议 | `server/protocol.py`、`server/net.py`、`server/auth.py` | C2S `ranktitle` / S2C `ranktitleok`；写库在网络线程；登录装载 `role_stats` 与 `title_board` |
| 界面 | `web/index.html`、`web/platform/web.js` | 设置里新增「排行」页：5 个 chip + 10 行/页 + 翻页 + 「我的名次」+ 称号勾选；名牌顶部竖排（称号 → 魔气 → 名字） |
| 客户端 | `web/core/game.js` | 映射层加 `tt`/`tm`（★ 这层漏了就是静默失效，`check_field_map.py` 会拦）|

### 13.2 和方案不一样的两处（都是有意改的）

1. **前三名用「金 / 银 / 铜」文字牌，不用 emoji**
   原因：① 老安卓/部分浏览器字体没有 emoji → 显示豆腐块；② 这个项目里 emoji 已经被编码坑过两次。颜色仍然是金/银/铜。
2. **`/api/rank` 多了一个 `?force=1`**
   只给管理员 token 用（测试/排查时强刷，不然要等 60 秒缓存）。普通玩家传了会 403。

### 13.3 验收结果（全部实测通过）

| 项 | 结果 |
|---|---|
| `tools/test_rank.py` | **ALL PASS**（21 条）：5 个榜排序、魔气榜同分看魔气、前 100/每页 10/第 11 页空、我的名次（含 121 名以后）、测试号不上榜、参数校验、缓存、落库 |
| `tools/smoke_rank.js` | **ALL PASS**（15 条）：排行页 5 chip / 10 行 / 金牌 / 第 10 页 / 下一页禁用 / 魔气榜双数值 / 称号开关 / **另一个客户端看得到** / 关掉后 1 秒内消失 / 0 异常 |
| 截图 | `docs/shots/r424-rank.png`（排行页）· `docs/shots/r424-nameplate.png`（称号在最顶：金 国服境界top1 → 👿520 → 血条） |

### 13.4 已知取舍

- **历史数据**：屠戮 / 魔气（击杀玩家）/ 在线时长 **从 0 开始**（以前没记过）。境界 / 财富 / 魔气值立刻有榜。
- **名次会有最长 60 秒延迟**（榜单线程每 60 秒刷一次）；称号随之更新。
- **在线时长**：只要在世界里就累加（挂机也算，用户确认）。
- **PvP 击杀**：同一对手 10 分钟内只算 1 次（和魔气同一把防刷锁）。
"""
assert '\u5b9e\u73b0\u8bb0\u5f55' not in s
io.open(p, 'w', encoding='utf-8').write(s.rstrip('\n') + add)
print('\u5df2\u8ffd\u52a0 \u00a713')
