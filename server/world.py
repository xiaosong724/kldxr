# -*- coding: utf-8 -*-
"""世界：世界状态 + tick 线程（P0-6）

★★ 线程纪律 —— 这是整个架构的地基（方案 §13.5）★★

    世界状态（玩家 / 以后的怪物 / 掉落 / 弹道…）**只允许 tick 线程读写**
    网络线程只做两件事：
      ① 把玩家意图丢进 inbox 队列（线程安全的 queue.Queue）
      ② 从 fanout 批量把快照交给各自的连接（走 loop.call_soon_threadsafe）

    → 天生没有锁竞争，也不用给世界状态加任何锁 ✓
    → tick 再慢（以后加僵尸 AI）也不会让人收不到 / 发不出消息 ✓

    DB 读写同样不在 tick 线程里（一次磁盘 IO 就能把整个世界卡住），
    统一丢进 saves 队列，由存档线程慢慢落盘。

数据流：
    网络线程 ──post_*──▶ inbox/saves ──▶ tick线程(step) ──fanout──▶ 网络线程 ──▶ socket
"""

import json
import math
import queue
import random
import threading
import time

import affixes
import armor as armormod
import db as dbmod      # round304b: 存档线程要用 dbmod.now_ms() / dbmod.db()
                        #   ★ 之前 world.py 里全是【函数内】import db as dbmod ✗
                        #     模块级没有这个名字 ✗ 我新写的落库代码直接用 now_ms()
                        #     → NameError ✗ 被 run_saver 的 except 吞掉 ✓
                        #     自测一条一条抓出来的（第 3 个同类错误 ✗ 都长一个样 ✓）
import drops
import market as mkmod  # ★ round304b：交易所规则中心（纯函数 ✗ 可离线测 ✓）
import mobs
import mq as mqmod      # ★ 第 149 轮：魔气规则中心 ✓
import value as valuemod  # ★ round304b：价格/上限（和卖系统同一份 ✓）
import weapons
import worldgen
import terrain as termod   # ★ round306：僵尸也要认地形高度 ✓
import protocol as P

TICK_HZ = 30
TICK_DT = 1.0 / TICK_HZ
VIEW = 100.0                     # round 244: user wants players visible at 100m (was 60)
MAX_DRAIN = 4000                # 单个 tick 最多处理多少条意图（防止一条洪水把 tick 打饿）
MAX_INTENT_PER_TICK = 90        # 单连接每 tick 的意图上限（30Hz 正常也就 30 条，3 倍冗余）
SPAWN_SAFE = 20.0               # 出生点/安全区半径：这里不刷怪（方案 §2.1 末日堡垒）


REVIVE_INVULN = 1.5

# ★★ 第 81 轮：组队（用户确认版）★★
PARTY_MAX = 5                     # round 244: user wants 5 (was 3)
PARTY_SHARE = 0.10            # 队友分到的经验比例（该僵尸经验的 10% ✓）
# ★★ 第 118 轮（用户："基础减伤不能低于实际受到伤害的 10%，改成 30%"）★★
#   含义：不管减伤堆多高，最后至少要挨【原来伤害的 30%】✗
#   → 也就是减伤最多只能减掉 70% ✓（原来是 90% ✗ 太狠了 ✓）
#   为什么抽成常量：原来这个 0.10 在两处各写了一遍 ✗（防具一处 / 天赋一处 ✓）
#     改一个漏一个的坑等着呢 ✗ —— 现在只有这一个地方定义 ✓
DMG_FLOOR = 0.30
# ★★ 第 186 轮修的 bug：这个常量上一轮【根本没插进去】✗
#   而 safetp 分支里用了它 → NameError → 被意图派发的 try 吞掉 → 静默失效 ✓
#   表现：点传送没反应、界面上也不出读条 ✓（因为客户端永远收不到 tpcast ✓）
TELEPORT_CAST = 6.0            # 传送回安全区的读条秒数               # 减伤地板：至少吃原来伤害的 30%（第 118 轮 ✓）
PARTY_SHARE_DIST = 9999999.0   # round 241: user wants NO distance limit for party exp
PARTY_INVITE_DIST = 9999999.0   # round259: user wants NO party distance limit at all (was 20)
PARTY_INVITE_TTL = 60.0       # ★ 第 82 轮用户改：10 秒 → 1 分钟 ✓
                              #   （原因：弹窗没看到就没了 ✗
                              #    现在界面里也有待处理列表 ✓ 给一分钟才够用 ✓）
PARTY_INVITE_RATE = 3         # 10 秒最多发 3 次邀请 ✓
AUTO_SAVE_INTERVAL = 15.0   # ★ 第 109 轮：定时存盘（防崩溃/重启丢状态 ✗）
# ★★ round304b：交易所（方案 v3 §9 —— 货架在内存里 ✗ 绝不查库 ✓）★★
MKT_SWEEP_INTERVAL = 5.0    # 过期检查间隔（秒 ✗ 只动内存 + 投一条 UPDATE ✓）
#   ★ 为什么 5 秒而不是"每次浏览时顺手扫"：人不在线时过期的东西也得退回去 ✗
#     挂在 tick 上才不依赖"有没有人在看"✓
MKT_BAG_MAX = 2000          # 背包行数上限（防背包无限涨 ✗ 不是玩法限制 ✓）
#   ★★ round304t：用户报"用另一个号购买显示背包满了"★★
#     根因：这里原来是 500 ✗ 而【整个项目没有别的地方限制背包行数】✓
#       （客户端没有格数上限 ✗ 捡东西 / 买系统 / 退回也都不看行数 ✓）
#       → 于是这 500 就是唯一的、而且玩家看不见的"背包上限"✓
#     活证据：真库里角色 fangou 有 775 行（材料都堆叠了 ✗ 装备一件一行 ✓）
#       → 他一买东西就被这句话挡住 ✗ 而界面上看不出哪里"满"了 ✓
#   ★ 这个数的本意是"别让内存/库无限涨"✗ 该按这个本意取值 ✓
#     500 行对一个刷了很久的号太容易到 ✗ 2000 才是"明显异常"的量级 ✓
#   ★ 判据为什么用【行数】而不是"总件数"：
#     材料合堆后一件一行已经很省 ✓ 装备本来就该一件一行 ✓
#     行数才是内存/查询的真实开销 ✓
MKT_ROW_MAX = 4000          # 内存行数硬上限（超过就不让再上架 ✗ 保护 tick ✓）

# ★★★ round305：余额的写法（"值 + 代号"）✗ 收成一个函数 ★★★
#   为什么需要代号：gold 是【内存权威】✗ 而存档是【半秒攒一批】的 ✓
#     排队那一刻的值随时可能过期 ✓
#     真 bug（用户脚本踩出来的）：新号离线卖东西 → 马上登录 →
#       登录排的存档里 gold=0 ✗ 同一拍 tick 把 pending 入账 535 ✓
#       存档线程随后把 0 写回库 ✗ 钱就没了 ✓
#   做法：每次钱变 → 序号 +1 ✗ 并把 (值, 序号) 排进队列 ✓
#     存档时比一下序号 ✗ 对不上就【作废这一笔】✓（新的那笔一定会跟着来 ✓）
#   ★ 收成函数是因为【离线测试会自己跑一遍队列】✗
#     它们要是各写一份 ✗ 迟早和我这里不一致 ✓（这次就是这么炸的 ✓）
GOLD_SQL_PREFIX = 'GOLD:'


def gold_sql(seq, role_id, gold):
    """排一笔"带代号的余额写入"（★ 全项目只有这一个地方拼这条 ✗ 别在别处手写 ✓）"""
    return (GOLD_SQL_PREFIX + str(int(seq)), (int(role_id), int(gold)))


def gold_sql_split(sql):
    """'GOLD:<seq>' → seq ✗ 不是这种写法就返回 None ✓（给存档线程和测试共用 ✓）"""
    if isinstance(sql, str) and sql.startswith(GOLD_SQL_PREFIX):
        try:
            return int(sql[len(GOLD_SQL_PREFIX):] or 0)
        except Exception:
            return 0
    return None


# ★★ round302：金币的"内存权威"要给重连让路 ★★
#   问题：刷新页面时【新会话】在登录那一步就把 roles.gold 读进来了 ✗
#     而旧会话（幽灵）的金币要先落库 ✗ 落库又是异步的 ✓
#     → 新会话读到的还是旧值 ✗ 表现就是"卖完刷新一下钱没了"✓（实测 141 → 0 ✓）
#   修：模块级 _live_gold 记住【每个角色最后一次的内存余额】✗
#     进世界时它比库里的新 ✗ 就用它 ✓ 落库照旧（不丢数据 ✓）
_live_gold = {}
PARTY_PUSH_INTERVAL = 1.0     # roster 每秒补推一次（血条要动 ✓）
# ★ 第 82 轮：大厅（独立页 ✓ 队长邀请 + 玩家申请 两条路 ✓）
PARTY_APPLY_TTL = 60.0        # ★ 第 82 轮用户改：30 秒 → 1 分钟 ✓（和邀请一致 ✓）
PARTY_APPLY_RATE = 3          # 每人 10 秒最多 3 次申请 ✓
LOBBY_INTERVAL = 1.0          # 大厅名单发布频率 ✓

# ★★ 第 69 轮：箭（弓的投射物）★★
ARROW_SPEED = 14.0        # 米/秒（比僵尸快得多，但不至于一帧穿过一片 ✓）

# ★★★ 第 227 轮：反作弊（用户点名的三条，这是第 1 条：位移校验）★★★
#   为什么要它：服务器原来直接采信客户端报的坐标 ✗
#     p.x = _f(d.get('x'), p.x)     ← 一点校验都没有 ✓
#   → 改个包就能【瞬移】✗ 于是能：贴脸砍人 / 一帧逃命 / 抢刷新点 /
#     站边界外一毫米瞬移进安全区砍人 / 配合透视补刀抢魔气 ✓✓
#   ★ 做法照 Grim Anticheat 那套思路（服务器自己算"你最多能走多远"✗
#     超了就【不采纳】+ 给客户端回推一个纠正位置 ✓）
#   ★★ 阈值只在这个文件里 ✗ 一个字都不发客户端 ✓
#      （发过去等于告诉外挂"卡在 X-1 走就行"✓）
PLAYER_SPEED = 4.4        # 必须和客户端 web/core/game.js 的 G.SPEED 一致 ✓
MOVE_TOL = 2.4            # 容差倍数：网络抖动时客户端会一次报一大步 ✓
MOVE_SLACK = 1.6          # 再加固定余量（米）：连接卡一下再恢复 ✓
MOVE_CORRECT_AT = 4.0     # 超过程度达到这个倍数才回推纠正（免得正常抖动被拉回 ✗）
ARROW_HIT_R = 0.75        # 命中半径（僵尸体积约 0.5 + 一点余量 ✓）
ARROW_MAX = 60            # 同时在飞的箭上限（防刷 ✗）        # ★ 复活无敌时长（秒）—— 用户指定 ✓


def tier_no(t):
    """★ 第 57 轮：品阶【显示】用 1~12（内部数据仍是 0~11 ✓ 用户要求）

    ★ 为什么不在数据层就改成 1~12：
      数组下标、LOOT_COL、TIER_BASE、TIER_NAME 全是按 0 起的 ✓
      动了数据层要改的地方一大片，还容易越界 ✗
      → 只在【显示】时 +1 ✓ 数据层一律不动 ✓
    """
    return int(t or 0) + 1


def now_s():
    return time.time()


class _MktRollback(Exception):
    """交易所事务里"业务性失败"（东西被买走了 / 物品不在背包 ✓）

    ★ 为什么不用普通 Exception：存档线程要区分两种情况 ✗
        · _MktRollback  = 这笔本来就不该成 ✗ 回滚 + 告诉 tick 退钱 ✓（不用打日志 ✗ 不是故障 ✓）
        · 其它异常      = 数据库/代码出问题 ✗ 回滚 + 打日志 + 退钱 ✓
      （方案 §6："每条落库都要带回滚"✓）
    """


class Player(object):
    """一个已进入世界的玩家。★ 只有 tick 线程碰"""
    __slots__ = ('cid', 'role', 'x', 'z', 'yaw', 'ct', 'hp', 'qi', 'atk',
                 'intents', 'joined', 'name', 'role_id', 'warned', 'atkT', 'lastMe',
                 'weapon', 'weaponItemId',
                 'invulnT',
                 'wDur', 'wDurMax', 'wDurDirty',
                 'atkSeq',
                 'armor', 'armorItemId',
                 'aDur', 'aDurMax', 'aDurDirty',
                 'tal', 'talRaw', 'talEff', 'talDirty', 'resetT',
                 'mq', 'mqAt',
                 'ghostAt', 'tpEnd',
                 # ★ 第 227 轮：反作弊（位移校验用 ✓）
                 #   ★ 加字段一定要记得加到这里 ✗ 不然 __init__ 里赋值就报
                 #     AttributeError: 'Player' object has no attribute 'moveT' ✓
                 #     （这个坑我踩过两次了：Player 一次、Mob 一次 ✓）
                 # round293: gold. Memory is authoritative (docs v3 section 1);
                 #   goldDirty = client has not seen it; goldLog = ring buffer.
                 'gold', 'goldDirty', 'goldLog',
                 'moveT', 'moveBad', 'suspect',
                 # ★ round330（用户："看不到其他玩家的跳跃动作"）
                 #   jy = 离地高度（跳起来那一段 ✗ 0 = 站在地上 ✓）
                 'jy')   # 第 173 轮：传送读条结束时刻（0 = 没在读条）      # ★ 第 168 轮（用户 #5）：离线宽限的时刻 ✓

    def __init__(self, cid, role):
        self.cid = cid
        self.role = role
        # round302: gold lives in memory while playing, so it MUST be seeded from the
        # db on the way in - otherwise _gain_gold()'s getattr fallback starts every
        # session at 0 and a reload silently wipes the balance (verified: 159 -> 0).
        self.gold = int(role.get('gold') or 0)
        self.goldDirty = False
        self.goldLog = []
        self.name = role.get('name') or '?'
        self.role_id = role.get('id')
        # ★ 第 227 轮：反作弊用的三个字段（位移校验 ✓）
        self.moveT = 0.0        # 上一个【被采纳】的移动包时刻
        self.moveBad = 0        # 连续被拦次数
        self.suspect = 0        # 累计可疑次数（管理页看 ✓）
        self.x = float(role.get('x') or 0.0)
        self.z = float(role.get('z') or 0.0)
        self.yaw = float(role.get('yaw') or 0.0)
        self.ct = 0.0
        # ★★ 第 62 轮修的真 bug：这里以前直接写 role.hp ✗
        #   DB 的约定是【hp = 0 表示按公式满值】（见 db.py 的列注释 ✓）
        #   但 0 传进来就是 0 → 服务器当他是个死人 ✗
        #   → 僵尸的活人过滤（hp>0）把他排除 → 不打他 ✗（用户报的"假死"✓）
        #   ★ 第 57 轮我去掉"客户端上报 hp"之后才暴露：
        #     以前客户端每个移动包都把 200 推上来，正好盖住了这个 0 ✓
        self.hp = int(role.get('hp') or 0)
        if self.hp <= 0:
            # ★ 第 225 轮：先用等级血占位（真正的上限由 _hp_max 在进世界时算 ✓）
            import mobs as _mobs0
            self.hp = int(_mobs0.level_hp(role.get('level') or 1))
        self.qi = int(role.get('qi') or 0)
        self.atk = 0
        # ★★ 第 66 轮：挥砍序号 ★★
        #   客户端一直拿快照里的 'atk' 当"他挥了几刀"的计数器 ✓
        #   但服务器发的一直是 o.atk（攻击力，而且从没赋过值 → 永远是 0 ✗）
        #   → 客户端那句 wk > o.atkSeq 永远不成立
        #   → 别人【永远看不到挥砍动作】✗（用户报的"攻击动画没有"✓）
        self.atkSeq = 0
        # ★ 第 67 轮：防具（穿着的那件 ✓）
        self.armor = role.get('armor') or None
        self.armorItemId = role.get('armorItemId')
        # ★ 第 114 轮：天赋（登录时由 net.py 装载进 role ✓ 这里只读内存 ✗）
        import talents as _tal2
        self.tal = dict(role.get('talents') or {})
        self.talRaw = _tal2.raw_of(self.tal)
        self.talEff = _tal2.effective(self.talRaw)
        self.talDirty = False
        self.resetT = 0.0
        # ★ 第 149 轮：魔气值（登录时已经算过自然衰减了 ✓）
        self.mq = int(role.get('mq') or 0)
        self.mqAt = int(role.get('mqAt') or 0)
        self.ghostAt = None
        self.moveT = 0.0        # 第 227 轮：上一个被采纳的移动包时刻
        self.moveBad = 0
        self.suspect = 0
        self.tpEnd = 0.0        # 第 173 轮（用户 #6）：传送读条（0 = 没在读）     # ★ 第 168 轮：不是 None 就表示“断线幽灵”✓
        _ar0 = self.armor or {}
        self.aDur = int(_ar0.get('dur') or 0)
        self.aDurMax = int(_ar0.get('durMax') or 0)
        self.aDurDirty = 0
        self.atkT = 0.0          # ★ 挥刀冷却（服务器自己也算一份，防连点刷伤害）
        self.lastMe = None       # ★ 上次推给他的 exp/等级（变了才推，省带宽）
        self.intents = 0
        self.joined = now_s()
        self.warned = set()      # 已经提示过"还没实现"的消息类型（别刷屏）
        # ★★ 手上那把武器（第 47 轮）★★
        #   由 net.py 在登录时查出来放进 role['weapon'] ✓
        #   查不到就发一把【默认单手剑】—— 数值正好等于以前写死的 2.4/1.05/0.62，
        #   所以"还没有武器"的老角色手感一点没变 ✓ 不会让人觉得改坏了 ✓
        # ★ 第 58 轮：兜底从"0 阶单手剑"改成【空手】（弱基线 ✓ 见 weapons.FIST）
        self.weapon = role.get('weapon') or dict(weapons.FIST)
        self.weaponItemId = role.get('weaponItemId')     # 背包里的那件（默认武器是 None ✓）
        # ★ 第 56 轮：复活无敌（秒）—— 无敌期间僵尸咬不动 ✓ 客户端也会穿怪 ✓
        self.invulnT = 0.0
        # ★★ 第 59 轮：手上武器的耐久 ★★
        #   为什么放内存里、不每次挥砍写库：一次挥砍一次写盘 = 磁盘要炸 ✗
        #   → 内存里扣，攒够了（或卸下/下线时）再落一次库 ✓
        _w = self.weapon or {}
        self.wDur = int(_w.get('dur') or 0)
        self.wDurMax = int(_w.get('durMax') or 0)
        self.wDurDirty = 0        # 攒了多少次没落库


class World(object):
    def __init__(self, cfg):
        self.cfg = cfg
        self.loop = None
        self.running = False

        # ---- 跨线程队列 ----
        self.inbox = queue.Queue()      # 网络线程 → tick 线程
        self.saves = queue.Queue()      # 任何线程 → 存档线程
        self._joinq = queue.Queue()     # 认证通过的人（网络线程放，tick 消费）
        # ★ round304b：上线时读好的货架（网络线程读 ✓ tick 只往内存里放 ✓）
        self._joinq2 = queue.Queue()

        # ---- 世界状态（★ 只有 tick 线程读写）----
        self.players = {}               # cid -> Player
        self.mobs = {}
        # ★ 第 69 轮：在飞的箭（只在 tick 线程动 ✓）
        self.arrows = {}
        # ★ 第 81 轮：组队状态（全在 tick 线程 ✓ 纯内存 ✓ 不加锁 ✓ 不入库 ✓）
        self.parties = {}         # pid -> {'id','leader'(role_id),'members':[role_id...]}
        self.party_of = {}        # role_id -> pid（反查 ✓）
        self.party_inv = {}       # role_id -> [(from_role_id, ts), ...]
        self.party_rate = {}      # role_id -> [ts, ...]（邀请限流 ✓）
        self._party_seq = 0
        self._party_acc = 0.0
        # ★ 第 82 轮：申请入队 + 招募开关 + 大厅名单
        self.party_apply = {}     # pid -> [(role_id, ts)...]
        self.party_open = {}      # pid -> 是否出现在招募列表里
        self.lobby_stat = {'players': [], 'parties': []}   # tick 发布 ✓ HTTP 只读 ✓
        self._lobby_acc = 0.0
        self._save_acc = 0.0   # ★ 第 109 轮：定时存盘用 ✓
        # ★★ round304b：交易所（内存货架 ✗ 只有 tick 线程碰 ✓）★★
        #   ★ 为什么用 mkmod.new_mkt() 而不是在这里写死结构：
        #     结构和 market.py 的增删逻辑必须一致 ✗ 一处定义 ✓
        self.mkt = mkmod.new_mkt()
        #   上架请求在【落库成功之前】物品还在背包里（saver 是异步的 ✗）
        #   → 这段时间里同一件东西还能被再点一次上架 ✗
        #   → 记一张"正在上架"的表 ✗ 落库回执清掉 ✓（防重复上架 ✓）
        self.mkt_locking = set()      # {(role_id, iid), ...}
        #   同一个 sid 正在处理哪一件（防连点 ✗ 只留最近几十条 ✓）
        self.mkt_sids = {}
        #   ★ 落库失败要回滚（买家扣的钱 / 上架费 ✗ 都在内存里 ✓）
        #     失败只可能是"别人先动了这件东西"✗ 或者数据库出错 ✓
        #     两种都必须把钱退回去 ✗ 绝不能出现"扣了钱没拿到货"✓（方案 §6 ✓）
        self.mkt_failq = queue.Queue()
        self._mkt_acc = 0.0
        self.talent_rate = {}   # ★ 第 116 轮：加点限流（长按会刷屏 ✗）
        # ★★ 第 133 轮（用户："在管理里可以调整单人上限的功能"）★★
        #   为什么不直接改 mobs.MOB_PER_PLAYER ✗
        #     那是模块常量 ✗ 改了全进程生效、重启就没、而且没办法单独给某个人调 ✗
        #   → 放在 World 里存一份【全局值】✓ + 一张【单人覆盖表】✓
        #     全局值默认取 mobs.MOB_PER_PLAYER（8 ✓）→ 没改过时行为和之前完全一样 ✓
        self.mob_per_player = int(mobs.MOB_PER_PLAYER)
        self.mob_cap = int(mobs.MOB_CAP)
        self.spawn_interval = float(mobs.SPAWN_INTERVAL)
        self.mob_cap_of = {}      # {role_id: 该人的上限} ✓ 没记录就用全局值
        self._tune_sig = None     # 第 216 轮：管理员设置的指纹（变了就存 ✓）
        self.pvp_pair = {}        # ★ 第 150 轮：{(killer,victim): 上次算数时刻} —— 同一对 10 分钟只算一次 ✓
        self.pvp_pair_steal = {}  # ★ 第 167 轮：夺取自己一张表（默认 1 分钟 ✓）
        self.ghost_grace = 6.0     # ★ 第 168 轮（用户 #5）：离线宽限（秒）
        # ★★ 第 134 轮（用户要求）：两组开关（全人 / 单人）★★
        #   PVP：开了才能互相打 ✓（现在是【闸门】：PvP 功能还没做 ✗
        #         但状态已经存下来了 ✓ 将来那段代码直接读 _pvp_on() 就行 ✓）
        #   妖兽伤害：关了妖兽就不会咬人 ✓（这个立刻真实生效 ✓）
        #   ★ 默认值：PVP 关 ✗（朋友之间玩，默认不互相打 ✓）
        #               妖兽伤害 开 ✓（原来就会咬 ✓ 不改现有体验 ✓）
        self.pvp_all = False
        self.pvp_of = {}          # {role_id: True/False} 单人覆盖 ✓
        self.mob_atk_all = True
        self.mob_atk_of = {}
        self._arrow_id = 0                  # mid -> mobs.Mob（P2：僵尸也归 tick 线程独占 ✓）
        self.mob_seq = 0
        self.loot = {}                  # lid -> {'x','z','item','ttl'}（P2 第二刀：地上掉的 ✓）
        self.loot_seq = 0
        self.role_seq = 0               # 给"公共妖兽"发号用（也用 mob_seq，这里只做语义区分）
        self._spawn_acc = 0.0           # 刷怪节流
        self.pvp = False                # ★ PvP 总开关（服务器权威；客户端只是请求开/关 ✓）
        self._pend = {}                 # cid -> {'hurts': [...], 'mhits': [...], 'me': {...}}
        # ★ round305：余额的"代号"（role_id -> 递增序号 ✗ 每改一次钱 +1 ✓）
        #   存档线程拿它判断"这一笔排队之后钱有没有又被改过"✓
        #   （过期的写入直接作废 ✗ 不给它把新值盖回去的机会 ✓）
        self._gold_seq = {}
        # ★★★ round310（P1 破坏）★★★
        #   ter_over ：被破坏的格子 → 新高度（覆盖 terrain.height 的纯函数值 ✓）
        #   ter_hp   ：打到一半的格子 → 剩余耐久（没碎就不用覆盖地形 ✓）
        #   ★ 为什么"破坏"要一张覆盖表：地形是纯函数（种子算出来的 ✗ 改不了 ✓）
        #     破坏 = 在纯函数之上【记一笔覆盖】✗ 客户端收到同一份覆盖 ✓
        #   ★ 自愈：每格记一个时刻 ✗ 超过 REGEN_MS 就删掉覆盖 ✓ 地形自己回来 ✓
        self.ter_over = {}
        self.ter_hp = {}
        # ★★★ round318（F1 流水）★★★
        #   fluid_ov  ：和生成值不同的格子 → (kind, level) ✓
        #   fluid_act ：【活跃集合】✗ 只有这里面的格子会被更新 ✓
        #   ★ 这是 F1 的性能命门：全世界 100 万格 ✗ 平时这里只有几十个 ✓
        self.fluid_ov = {}
        self.fluid_act = set()
        self.FLUID_MAXLV = {2: 7, 3: 3}  # 水铺 7 格 ✗ 地火只铺 3 格 ✓
        self.FLUID_BC = []               # 本 tick 要广播的流体变化
        self.TER_REGEN_MS = 20 * 60 * 1000     # 20 分钟完全恢复（方案 §5.7 ✓）
        self._ter_bc = []                      # 本 tick 要广播的破坏事件
        # ★ round329：树/石的破坏（和地形同一套思路 ✗ 只存"和生成值不同"的 ✓）
        self.prop_hp = {}
        self.prop_dead = set()
        self._prop_bc = []
        self._ter_load()                       # ★ 启动时读一次（这是 boot ✗ 不是 tick ✓）
        self._fluid_load()                     # ★ round347：流体也要读回来 ✓
        self._ticker_last = {}          # 第 247 轮：同类弹幕最后发送时间（1 秒合并）
        self._ticker_dup = {}           # 被合并掉了几条
        # ★ 本 tick 的治疗事件（第 46 轮）：[[医生x, 医生z, 目标x, 目标z, 回了多少], ...]
        #   医生一多，玩家必须能看出【谁给谁回了多少】✗ → 所以发事件、客户端画连线+数字 ✓
        self.heals = []
        # ★★ 第 48 轮：后台管理 ★★
        #   admin_stat = 给管理页看的【只读快照】，每隔十几 tick 换一个新 dict
        #   （HTTP 线程读它：读一次引用是安全的 ✓ 绝不让 HTTP 线程直接遍历世界状态 ✗）
        self.admin_stat = {'tick': 0, 'online': 0, 'mobs': 0, 'loot': 0, 'players': []}
        self._admin_acc = 0
        self.srv_conns = {}             # ★ 由 net.Net 填：连接表（只在 asyncio 循环里访问）
        self.tick_count = 0
        self.tick_ms = 0.0              # 上一帧耗时
        self.tick_max_ms = 0.0          # 历史峰值（排查卡顿）
        self.dropped_intents = 0

        self._th = None
        self._saver = None

    # ============================================================ 网络线程调用

    def _drop_ghosts_of(self, role_id):
        """★ 第 168 轮：同一个角色的幽灵先清掉 ✗

        为什么：6 秒宽限里他又登进来 →
          幽灵（6 秒后落库）会把新会话的存档覆盖掉 ✗✓
        """
        for cid, q in list(self.players.items()):
            if getattr(q, 'role_id', None) == role_id and getattr(q, 'ghostAt', None) is not None:
                # round302: 先落一次档 ✗ 再删 ✓
                #   为什么：幽灵身上可能有【还没落库的内存金币】✓
                #   （卖东西刚入账 ✗ 玩家就刷新了 ✗ 定时存盘还没轮到 ✓）
                #   直接 pop 掉 = 那笔钱凭空消失 ✗（实测：卖了 141 ✗ 刷新后变 0 ✓）
                try:
                    self._save_player(q)
                except Exception:
                    pass
                self.players.pop(cid, None)

    def post_join(self, conn, role):
        """认证通过：入队，等 tick 线程把他放进世界"""
        self._joinq.put((conn, role))

    def post_leave(self, cid):
        self.inbox.put(('leave', cid, None))

    def post_intent(self, cid, t, d):
        self.inbox.put(('intent', cid, (t, d)))

    def post_admin(self, act, payload=None):
        """HTTP 线程（管理页）→ tick 线程 的管理操作

        ★ 和玩家意图走同一个 inbox ✓ 所以照样是【只有 tick 线程改世界状态】✓
        """
        self.inbox.put(('admin', None, (act, payload or {})))

    def _tp_break(self, p):
        # 第 173 轮（用户 #6）：打断传送读条（受伤就断）
        if float(getattr(p, 'tpEnd', 0) or 0) > 0:
            p.tpEnd = 0.0
            self._send_cid(p.cid, P.pack('tpcast', t=0))     # 告诉客户端收掉进度条 ✓
            self._send_cid(p.cid, P.pack('notice', text='受到攻击，传送被中断'))

    def _tp_tick(self):
        # 第 173 轮（用户 #6）：传送读条 —— 时间到就真的把人挪进安全区
        #   ★ 打断不在这里判 ✗ 在受伤那两处判（_mob_bite / _pvp_hit）✓
        now = now_s()
        for cid, p in list(self.players.items()):
            e = float(getattr(p, 'tpEnd', 0) or 0)
            if e <= 0 or now < e:
                continue
            p.tpEnd = 0.0
            # 挪到安全区中心附近（±3 随机一点，免得所有人叠在一起）
            p.x = round(random.uniform(-3, 3), 2)
            p.z = round(random.uniform(-3, 3), 2)
            p.invulnT = max(float(getattr(p, 'invulnT', 0) or 0), 1.5)   # 落地给 1.5 秒无敌 ✓
            self._send_cid(p.cid, P.pack('tp', x=p.x, z=p.z))
            self._send_cid(p.cid, P.pack('notice', text='已传送回安全区'))

    def _ghost_tick(self):
        """★ 第 168 轮（用户 #5）：收回超时的幽灵玩家

        离线后先保留 ghost_grace 秒 ✓ 超时才真删 + 落库 ✓
        """
        now = now_s()
        for cid, p in list(self.players.items()):
            ga = getattr(p, 'ghostAt', None)
            if ga is None:
                continue
            if now - ga >= self.ghost_grace:
                self.players.pop(cid, None)
                try:
                    self._save_player(p)
                except Exception:
                    pass
                # round302: 幽灵真走了 ✗ 这条"内存余额"记录就没用了 ✓
                #   留着只会让人以为还有旧会话活着 ✓（落库已经在上面做了 ✓）
                try:
                    _live_gold.pop(int(getattr(p, 'role_id', 0)), None)
                except Exception:
                    pass

    def _publish_admin(self):
        """每十几 tick 发布一次给管理页看的快照（只读 ✓）

        ★ 为什么是"发布"而不是"直接查"：世界状态只有 tick 线程能碰 ✗
          HTTP 线程直接遍历 players/mobs 就是数据竞争 ✗
          这里换一个新 dict，HTTP 那边读引用 —— 安全又便宜 ✓
        """
        ps = []
        for q in self.players.values():
            ps.append({'name': q.name, 'level': int(q.role.get('level') or 1),
                       'hp': int(q.hp), 'x': round(q.x, 1), 'z': round(q.z, 1),
                       'weapon': ((q.weapon or {}).get('name') or '（默认单手剑）')})
        self.admin_stat = {
            'tick': self.tick_count, 'online': len(self.players),
            'mobs': len(self.mobs), 'loot': len(self.loot),
            'tickMs': round(self.tick_ms, 3), 'tickMaxMs': round(self.tick_max_ms, 3),
            'dropped': self.dropped_intents, 'pendingSave': self.saves.qsize(),
            'players': ps,
        }

    def post_save(self, sql, params=()):
        self.saves.put((sql, params))

    # ============================================================ tick 线程

    def start(self, loop):
        """启动 tick 线程 + 存档线程"""
        self.loop = loop
        self.running = True
        self._th = threading.Thread(target=self._run, name='world-tick', daemon=True)
        self._th.start()
        self._saver = threading.Thread(target=self._run_saver, name='world-saver', daemon=True)
        self._saver.start()
        return self._th

    def stop(self):
        self.running = False

    def _run(self):
        next_t = time.perf_counter()
        while self.running:
            t0 = time.perf_counter()
            try:
                self._step()
            except Exception as e:
                print('  [tick] 出错：%r' % e)
            dt = (time.perf_counter() - t0) * 1000.0
            self.tick_ms = dt
            if dt > self.tick_max_ms:
                self.tick_max_ms = dt
            # 固定步长：落后了就重置基准，不追帧（追帧会让延迟越积越大）
            next_t += TICK_DT
            slp = next_t - time.perf_counter()
            if slp > 0:
                time.sleep(slp)
            else:
                next_t = time.perf_counter()

    def _step(self):
        # ① 新人入世
        while True:
            try:
                conn, role = self._joinq.get_nowait()
            except queue.Empty:
                break
            # ★★ 第 168 轮（用户 #5）：先清掉同角色的【幽灵】★★
            #   为什么：6 秒离线宽限里他又登进来 →
            #     幽灵 6 秒后落库 → 把新会话的存档覆盖掉 ✗✓
            #   ★ 放在 Player() 之前 ✗ 保证新会话不会被旧的清掉 ✓
            try:
                self._drop_ghosts_of(role.get('id'))
            except Exception:
                pass
            # round302: 上一个会话（刚被清掉的幽灵）的内存余额比库里新 ✗ 用它 ✓
            #   网络线程那边是【异步投递】的 ✗ 所以这一句要放在它后面 ✓
            #   ★ 顺序很重要：先拿到旧会话的余额 ✗ 再建新会话 ✓
            try:
                _lg = _live_gold.get(int(role.get('id')))
                if _lg is not None and int(_lg) >= int(role.get('gold') or 0):
                    role['gold'] = int(_lg)
            except Exception:
                pass
            _np = Player(conn.cid, role)
            # ★★★ round320 修的真 bug（自测挖不动方块才发现）★★★
            #   根因：服务端记着"这几格已经被挖过"（内存 + 库）✗
            #         但客户端【登录时从来没收到过】这份状态 ✓
            #         → 玩家看到原始地形 ✗ 挖的时候服务端说"已经到底了"✗ 拒绝 ✓
            #         → 表现："这块地我明明没挖过，却挖不动"✓
            #   修：进世界时把当前的破坏 + 流体覆盖【全量】发一次 ✓
            #   ★ 为什么可以全量：只存"和生成值不同"的格子 ✗ 平时是空的 ✓
            try:
                if self._ter_bc is not None and False:
                    pass
                _to = [[k[0], k[1], v[0]] for k, v in self.ter_over.items()]
                if _to:
                    self._send_cid(conn.cid, P.pack('teredit', cells=_to))
                _fo = self._flux()
                if _fo:
                    self._send_cid(conn.cid, P.pack('fluedit', cells=_fo))
            except Exception as _ov:
                print('[ter] initial override send failed: %r' % (_ov,))
            # round304b: 上线时读好的货架（网络线程读 ✓ 这里只入内存 ✓）
            #   ★ 为什么不走 intent：那一整行货架有十几 KB ✗
            #     走 intent 会占限流额度 ✗ 而且和玩家操作抢 tick ✓
            #   → 单独一条队列 ✗ _mkt_tick 里消费 ✓（本拍就入内存 ✓）
            try:
                _mr = role.get('mktRows') or []
                if _mr:
                    self._joinq2.put((role.get('id'), _mr))
            except Exception as _mre:
                print('[mkt] join load failed: %r' % (_mre,))
            # round302: 离线期间的入账（网络线程已经读好了 ✗ 这里只入账 ✓）
            #   ★ 走 _gain_gold ✗ 所以上限/黄金转换/流水 全都照常生效 ✓
            #   ★ done=1 交给存档线程（tick 线程不碰磁盘 ✓）
            try:
                for _pg in (role.get('pendingGold') or []):
                    _amt = int(_pg.get('amount') or 0)
                    if _amt:
                        self._gain_gold(_np, _amt, str(_pg.get('why') or 'pending'))
                    self.post_save('UPDATE pending_gold SET done=1 WHERE id=?',
                                   (int(_pg.get('id') or 0),))
            except Exception as _pge:
                print('[gold] pending drain failed: %r' % (_pge,))
            # ★★ 第 192 轮（用户）：刷新一下血量不回满 ★★
            #   用户原话："如果玩家死亡后，不是点的复活，而是刷新复活的血量不会恢复满"
            #
            #   根因：数据库里的 hp=0 有两种来源 ✗
            #     ① 新角色的默认值（本来就没血 ✓）
            #     ② 上次死在世界里、临下线/掉线时被存档写下去的 0 ✓
            #   而登录时 Player.hp 直接读这个 0 ✗ → 一进游戏就是尸体 ✓
            #   → 僵尸不打你（它们跳过 hp<=0 的）→ 也点不到复活按钮 ✓
            #     刷新一百次还是尸体 ✓✓ 一字不差地解释了他的现象 ✓
            #
            #   修：进世界那一刻，血量 <= 0 的【一律按满血算】✓
            #   ★ 用 _hp_max（含防具 + 天赋加成 ✓）不是写死的 200 ✓
            #   ★ 等于把"重新登录"当成一次复活 ✗ 这正是玩家期望的行为 ✓
            if int(_np.hp or 0) <= 0:
                _np.hp = int(self._hp_max(_np))
                _np.invulnT = max(float(getattr(_np, 'invulnT', 0) or 0), 1.5)   # 落地保护 ✓
            self.players[conn.cid] = _np
            # ★ 第 63 轮：上线也让附近的人"看得见"✓（不是凭空冒出来 ✗）
            # ★★ 第 102 轮：进世界时主动告诉他【穿着的防具 + 有效血量上限】★★
            #   不然客户端登录后不知道上限（它那边原来是写死的 200 ✗）
            #   → 表现就是"穿了防具血量没变化"✓
            try:
                self._tal_send(_np)      # ★ 第 116 轮：进世界先把天赋状态告诉他 ✓
            except Exception:
                pass
            try:
                if getattr(_np, 'armor', None):
                    self._send_cid(conn.cid, P.pack('armor', a=_np.armor,
                                                    hpm=self._hp_max(_np)))
                else:
                    self._send_cid(conn.cid, P.pack('armor', a=None, hpm=self._hp_max(_np)))
            except Exception:
                pass
            self._evt_near(_np.x, _np.z, 'evt',
                           {'kind': 'join', 'id': _np.role_id,
                            'name': _np.name, 'x': round(_np.x, 2),
                            'z': round(_np.z, 2)}, exclude=conn.cid)

        # ①·5 无敌时间递减（第 56 轮）
        for _q in self.players.values():
            if _q.invulnT > 0:
                _q.invulnT = max(0.0, _q.invulnT - (1.0 / max(1, TICK_HZ)))

        # ② 处理意图（有上限，防一条连接把 tick 打饿）
        n = 0
        while n < MAX_DRAIN:
            try:
                kind, cid, payload = self.inbox.get_nowait()
            except queue.Empty:
                break
            n += 1
            if kind == 'admin':
                # ★ 管理操作（第 48 轮）：没有 cid，走单独一支 ✓
                try:
                    self._handle_admin(payload[0], payload[1])
                except Exception:
                    pass
                continue
            if kind == 'gain':
                # round296: HTTP (selling / trading) asks the tick thread to credit
                #   gold. Memory is authoritative, so ONLY the tick thread may touch
                #   it - the HTTP layer just posts here.
                #   payload = (role_id, amount, why)
                try:
                    _gr = int(payload[0])
                    _ga = int(payload[1])
                    _gw = str(payload[2])[:24]
                    _gt = None
                    for _gc, _gq in self.players.items():
                        if (getattr(_gq, 'role_id', None) == _gr
                                and getattr(_gq, 'ghostAt', None) is None):
                            _gt = _gq
                            break
                    if _gt is not None:
                        self._gain_gold(_gt, _ga, _gw)
                    else:
                        # offline -> leave it in pending_gold, credited on next login
                        import db as _dbmod
                        self.post_save(
                            'INSERT INTO pending_gold(role, amount, why, ts, done)'
                            ' VALUES(?,?,?,?,0)',
                            (_gr, _ga, _gw, _dbmod.now_ms()))
                except Exception as _ge:
                    print('[gold] gain intent failed: %r' % (_ge,))
                continue

            if kind == 'leave':
                # ★★ 第 168 轮（用户 #5）：离线先保留 6 秒 ★★
                #   用户原话："玩家离开或离线后服务器让他保留 6 秒
                #             再算真离开，防止打不过直接退游戏"
                #   ★ 血还没空 → 变成"幽灵"先留着 ✓ 怪物还能把他打死 ✓
                #     血已经空了 → 直接删 ✗（都死了就不用留了 ✓）
                p = self.players.get(cid)
                if p is None:
                    continue
                if int(p.hp or 0) > 0:
                    p.ghostAt = now_s()
                else:
                    self.players.pop(cid, None)
                    self._save_player(p)
            else:
                p = self.players.get(cid)
                if p is None:
                    continue
                p.intents += 1
                if p.intents > MAX_INTENT_PER_TICK:
                    self.dropped_intents += 1
                    continue
                self._handle_intent(p, payload[0], payload[1])

        # ②·5 交易所的非玩家消息（载入货架 / 落库失败回滚 / 过期回收 ✓）
        #   ★ 为什么单独一支：它们没有 cid ✗ 走不到上面那个 players 查找 ✓
        try:
            self._mkt_tick()
        except Exception as _mke:
            print('[mkt] tick failed: %r' % (_mke,))

        # ★★★ round312（用户："破坏延迟高了一点点"）★★★
        #   根因：我把破坏广播塞进了"一秒一次"的节流里 ✗
        #         → 打碎之后最多要等 1 秒客户端才看到 ✓
        #   拆成两件事：
        #     ① 广播【每帧都发】✗ 破坏是低频操作（一次几格 ✓ 不刷屏 ✓）
        #     ② 自愈清扫还是【一秒一次】✗ 它没必要那么勤 ✓
        # ★ F1 流水：每 tick 跑一小批（★ 有预算 ✗ 平时活跃集合是空的 ✓）
        try:
            pass
        except Exception as _fe:
            print('[fluid] tick failed: %r' % (_fe,))
        try:
            self._ter_flush(0)
            self._prop_flush(0)
        except Exception as _te:
            print('[ter] flush failed: %r' % (_te,))
        self._ter_acc = getattr(self, '_ter_acc', 0.0) + TICK_DT
        if self._ter_acc >= 1.0:
            self._ter_acc = 0.0
            try:
                self._ter_sweep(dbmod.now_ms())
            except Exception as _te2:
                print('[ter] sweep failed: %r' % (_te2,))

        # ③ 僵尸：刷怪 / 回收 / AI（P2 第一刀）
        #    ★ 和玩家一样【只在 tick 线程跑】→ 一张快照发出去时，世界是"冻结"的 ✓
        # ★★ 第 109 轮（用户要求：血量/坐标要保存）★★
        #   查下来：存档只发生在【离开世界】那一刻 ✗ 没有定时存盘 ✗
        #   → 服务器崩溃 / 重启 / 被强杀 → 状态回到上次离开时 ✗
        #   （我这几轮 taskkill 重启了很多次 ✗ 所以用户每次都感觉"没保存"✓）
        #   → 每 15 秒给所有在线玩家排一次存档 ✓ 最多丢 15 秒 ✓
        self._save_acc += TICK_DT
        if self._save_acc >= AUTO_SAVE_INTERVAL:
            self._save_acc = 0.0
            for _q9 in self.players.values():
                try:
                    self._save_player(_q9)
                except Exception:
                    pass
            # round302: 顺手刷新"内存余额"表 ✓
            #   为什么需要：_gain_gold 只在【钱变了】的时候记 ✗
            #   长时间不掉钱的人 ✗ 这张表里可能还是很早以前的值 ✓
            #   刷新一次才敢保证"比库里的新"✓
            for _q9 in self.players.values():
                try:
                    _live_gold[int(getattr(_q9, 'role_id', 0))] = int(getattr(_q9, 'gold', 0) or 0)
                except Exception:
                    pass

        # ★ 第 82 轮：大厅名单（每秒发布一次 ✓ HTTP 只读 ✓ 不加锁 ✓）
        self._lobby_acc += TICK_DT
        if self._lobby_acc >= LOBBY_INTERVAL:
            self._lobby_acc = 0.0
            _lp = []
            for _q in self.players.values():
                _w = _q.weapon or {}
                _hm = max(1, self._hp_max(_q))
                _qm = max(1, int((_q.role or {}).get('qiMax') or 100))
                _lp.append({'id': _q.role_id, 'name': _q.name,
                            'lv': int((_q.role or {}).get('level') or 1),
                            'look': _w.get('look') or 'sword',
                            'tier': int(_w.get('tier') or 0),
                            'hp': int(round(100.0 * max(0, int(_q.hp or 0)) / _hm)),
                            'qi': int(round(100.0 * max(0, int(_q.qi or 0)) / _qm)),
                            'x': round(_q.x, 1), 'z': round(_q.z, 1),
                            'party': (self.party_of.get(_q.role_id) is not None)})
            _lq = []
            for _pid, _pt in self.parties.items():
                if not self.party_open.get(_pid, True):
                    continue
                if len(_pt['members']) >= PARTY_MAX:
                    continue
                _nm, _ld = [], ''
                for _q2 in self._party_members(_pid):
                    _nm.append(_q2.name)
                    if _q2.role_id == _pt['leader']:
                        _ld = _q2.name
                _lq.append({'pid': _pid, 'leader': _ld, 'n': len(_pt['members']),
                            'max': PARTY_MAX, 'names': _nm})
            # ★ 整对象替换（读的人拿到旧的也没事 ✓ 不会读到半个 ✗）
            self.lobby_stat = {'players': _lp, 'parties': _lq}
            # ★★ 第 82 轮：待处理列表每秒补推一次 ★★
            #   用户要求："不仅有弹窗，界面里也应该有可以同意拒绝的地方"
            #   → 弹窗是一次性的 ✗ 没看到就没了 ✗
            #   → 现在每秒把【谁邀请了我】和【谁申请了我的队】都推一遍 ✓
            #     客户端拿到就能在面板里列出来 ✓ 刷新也不丢 ✓
            _now2 = now_s()
            for _rid3, _lst3 in list(self.party_inv.items()):
                _ok3 = [x for x in _lst3 if _now2 - x[1] < PARTY_INVITE_TTL]
                self.party_inv[_rid3] = _ok3
                if not _ok3:
                    continue
                for _q3 in self.players.values():
                    if getattr(_q3, 'role_id', None) == _rid3:
                        _out3 = []
                        for _f3, _ts3 in _ok3:
                            for _q4 in self.players.values():
                                if getattr(_q4, 'role_id', None) == _f3:
                                    # ★ 第 84 轮：给【绝对到期时刻】✗ 不给剩余秒数
                                    #   （剩余秒数靠每秒补推算 → 推送一丢就卡住 ✗
                                    #    绝对时刻 + 客户端本地时钟 → 一定在动 ✓）
                                    _out3.append([_f3, _q4.name, round(_ts3 + PARTY_INVITE_TTL, 2)])
                                    break
                        self._send_cid(_q3.cid, P.pack('partyinv', list=_out3))
                        break
            for _pid4, _pt4 in list(self.parties.items()):
                _ap4 = [x for x in self.party_apply.get(_pid4, [])
                        if _now2 - x[1] < PARTY_APPLY_TTL]
                self.party_apply[_pid4] = _ap4
                if not _ap4:
                    continue
                for _q5 in self._party_members(_pid4):
                    if _q5.role_id != _pt4['leader']:
                        continue
                    _out4 = []
                    for _r4, _ts4 in _ap4:
                        for _q6 in self.players.values():
                            if getattr(_q6, 'role_id', None) == _r4:
                                _out4.append([_r4, _q6.name, round(_ts4 + PARTY_APPLY_TTL, 2)])
                                break
                    self._send_cid(_q5.cid, P.pack('partyapply', pid=_pid4, list=_out4))
                    break

        self._party_acc += TICK_DT
        if self._party_acc >= PARTY_PUSH_INTERVAL:
            self._party_acc = 0.0
            for pid in list(self.parties.keys()):
                self._party_push(pid)        # ★ 每秒补推一次（血条要动 ✓）
        self._mob_tick(TICK_DT)
        self._arrow_tick(TICK_DT)   # ★ 第 69 轮：箭（要在僵尸移动之后算 ✓）
        self._loot_tick(TICK_DT)          # ★ 地上掉的也归 tick 线程管 ✓
        for p in self.players.values():
            if p.atkT > 0:
                p.atkT -= TICK_DT

        # ④ 生成快照并批量交给网络线程（一次跨线程调用，不是每个玩家一次）
        if self.players:
            batch = []
            for p in self.players.values():
                d = {'ts': round(now_s(), 3), 'players': self._snapshot_for(p)}
                ms = self._mobs_for(p)
                if ms:
                    d['mobs'] = ms
                # ★ 第 69 轮：在飞的箭（[id,x,z,yaw] ✓ 只发附近的 ✓）
                if self.arrows:
                    _ar = []
                    for _a in self.arrows.values():
                        if (_a['x'] - p.x) ** 2 + (_a['z'] - p.z) ** 2 > VIEW * VIEW:
                            continue
                        _ar.append([_a['id'], round(_a['x'], 2), round(_a['z'], 2),
                                    round(_a['yaw'], 2)])
                    if _ar:
                        d['ar'] = _ar
                lt = self._loot_for(p)          # ★ 地上掉的（第 38 轮）
                if lt:
                    d['loot'] = lt
                # ★ 本 tick 攒的反馈：hurts=我挨的打，mhits=我打中僵尸（弹伤害数字用）✓
                pend = self._pend.get(p.cid)
                # ★★★ 第 239 轮：每帧都把"我自己的血量"带上 ★★★
                #   为什么：客户端原来那份血量是【本地算的】✗
                #     服务器打它多少 ✗ 它不知道 ✓
                #     → 血条不跟着掉 ✓ 一直到服务器判死 ✗ 客户端才突然变尸体 ✓
                #     → 这就是用户报的"假死"（别人看你死了 ✗ 你看自己活着 ✓）
                #   ★ 为什么现在可以【每帧直接赋值】而不是插值：
                #     服务器 30Hz 推 ✓ 客户端 60Hz 画 ✓
                #     30 次/秒的更新已经足够平滑 ✗ 不会抖 ✓
                #     （第 140 轮那次抖 ✗ 是因为只发"变化时"✗ 间隔不均匀 ✓）
                if pend is None:
                    pend = self._pend[p.cid] = {}
                _me0 = pend.get('me')
                if _me0 is None:
                    _me0 = pend['me'] = {}
                _me0['hp'] = int(p.hp or 0)
                _me0['hpm'] = int(self._hp_max(p))
                # round294: gold goes out with `me` (one extra int, no new message).
                #   The client adopts it field-wise, so a missing value never zeroes it.
                _me0['gold'] = int(getattr(p, 'gold', 0) or 0)
                # ★★★ round349 修的真 bug（用户："没有听到逃跑音效"）★★★
                #   根因：这里【只认 hurts / mhits】✗ 别的事件被静默丢掉 ✓
                #         我加的 'flee' 走 _add_pend 上来 ✗ 到这里就被扔了 ✓
                #   ★ 改成【通用拷贝】：除了 'me'（单独处理）其它 key 一律带上 ✓
                #     以后再加事件（逃跑/播报/特效）不用改这里 ✓
                if pend:
                    for _pk, _pv in pend.items():
                        if _pk == 'me' or not _pv:
                            continue
                        d[_pk] = _pv
                if pend and pend.get('me'):
                    d['me'] = pend['me']          # 升级/涨经验了才带 ✓
                # ★ 治疗事件（第 46 轮）：只发这个玩家看得见的（别把全图的都塞给他 ✗）
                if self.heals:
                    hv = []
                    v2 = mobs.MOB_VIEW * mobs.MOB_VIEW
                    for he in self.heals:
                        if (he[2] - p.x) ** 2 + (he[3] - p.z) ** 2 <= v2:
                            hv.append(he)
                    if hv:
                        d['heals'] = hv
                batch.append((p.cid, P.pack_str('world', d)))
            self._to_net(self._fanout, batch)
        self._pend = {}
        self.heals = []                       # ★ 治疗事件每 tick 清空（第 46 轮）

        # ⑤ 重置每 tick 的计数
        for p in self.players.values():
            p.intents = 0
        self.tick_count += 1
        # ★ 第 48 轮：每 15 tick 发一次管理页快照（15 × 33ms ≈ 半秒，够实时了 ✓）
        self._admin_acc += 1
        if self._admin_acc >= 15:
            self._admin_acc = 0
            self._publish_admin()
            self._ghost_tick()
            self._admin_tune_check()   # ★ 第 168 轮（用户 #5）：收回超时的幽灵 ✓
            self._tp_tick()      # 第 173 轮（用户 #6）：推进传送读条 ✓

    def _talent_op(self, p, d):
        """天赋加点 / 洗点（方案 §7.1 · 第 116 轮）

        ★ 三个校验缺一不可（方案 §7 明写 ✓）：
            ① stat 白名单   防刷不存在的属性
            ② n 范围 1~50   防一次刷爆
            ③ n ≤ 免费点数  防刷成负数
        ★ 限流 10 次 / 10 秒：界面上是"按住连加"✗ 不挡会打满 tick ✗
        ★ 落库用 post_save（saver 线程写 ✓）tick 线程不碰 DB ✓（铁律 ✓）
        """
        import talents as _tal
        now = now_s()
        op = str(d.get('op') or '')

        # ---- 限流 ----
        lst = self.talent_rate.get(p.role_id) or []
        lst = [x for x in lst if now - x < 10.0]
        if len(lst) >= 10:
            self._send_cid(p.cid, P.pack('notice', text='点太快了，歇一下再点 ✓'))
            return
        lst.append(now)
        self.talent_rate[p.role_id] = lst

        lv = int((p.role or {}).get('level') or 1)

        if op == 'reset':
            # ---- 洗点（v1 免费 + 5 分钟冷却 ✓ 方案 §3.4）----
            left = 300.0 - (now - float(p.resetT or 0.0))
            if p.resetT and left > 0:
                self._send_cid(p.cid, P.pack(
                    'notice', text='洗点冷却中，还得等 %d 秒' % int(left + 0.9)))
                return
            p.resetT = now
            p.tal = {}
            p.talDirty = True
            self.post_save('DELETE FROM talents WHERE role_id=?', (p.role_id,))
            self._tal_send(p)
            self._send_cid(p.cid, P.pack('notice', text='已洗点，天赋点全部返还 ✓'))
            return

        if op != 'add':
            return

        # ---- 加点 ----
        stat = str(d.get('stat') or '')
        if stat not in _tal.KEYS:                 # ① 白名单
            return
        try:
            n = int(d.get('n') or 1)
        except Exception:
            n = 1
        # ★★★ 第 255 轮修的真 bug（用户："天赋加点玩家点减号也是增加"）★★★
        #   病根：原来这里写的是 n = max(1, min(50, n)) ✗
        #     → 客户端点"减号"发的 n = -1 ✗ 被这句【夹成了 +1】✓✓
        #     → 所以减号反而加点 ✓ 用户报的一字不差 ✓
        #     （客户端那边其实是对的 ✓ 它算出来的 n 就是 -1 ✓
        #       坏在服务器这一句"保护性夹取"✗ 把符号吃了 ✓）
        #   ★ 修：正数照旧夹到 1~50 ✗ 负数单独夹到 -50~-1 ✓
        if n < 0:
            n = max(-50, min(-1, n))              # ② 负范围：减点
        else:
            n = max(1, min(50, n))                # ② 正范围：加点
        free = _tal.free_points(lv, p.tal)
        if n > 0 and n > free:                    # ③ 加点才检查剩余点数
            self._send_cid(p.cid, P.pack('notice', text='天赋点不够了 ✓'))
            return
        if n < 0 and int(p.tal.get(stat) or 0) + n < 0:   # ③' 减点不能减成负数
            self._send_cid(p.cid, P.pack('notice', text='这项已经清零了 ✓'))
            return

        p.tal[stat] = int(p.tal.get(stat) or 0) + n
        p.talDirty = True
        cur = p.tal[stat]
        self.post_save('INSERT INTO talents(role_id, stat, points) VALUES(?,?,?) '
                       'ON CONFLICT(role_id, stat) DO UPDATE SET points=excluded.points',
                       (p.role_id, stat, cur))
        self._tal_send(p)

    def _tal_send(self, p):
        """把天赋状态推给客户端（加点/洗点/升级/进世界 都要发 ✓ 方案 §7.2）"""
        import talents as _tal
        lv = int((p.role or {}).get('level') or 1)
        st = _tal.pack_state(lv, p.tal)
        p.talRaw = _tal.raw_of(p.tal)
        p.talEff = _tal.effective(p.talRaw)
        # ★ 第 117 轮：血量天赋会改生命上限 → 必须一起带上 ✓
        #   不然加完血量，界面上的血量上限不动 ✗（用户一定会问"生效了吗"✗）
        st['hpm'] = self._hp_max(p)
        self._send_cid(p.cid, P.pack('talents', **st))

    def _handle_intent(self, p, t, d):
        if t == 'move':
            # ★ round330：收下"离地高度"✗ 夹在 0..3 格（≈1.9 米）✓
            try:
                _jy = float(d.get('jy') or 0)
            except Exception:
                _jy = 0.0
            if _jy < 0:
                _jy = 0.0
            elif _jy > 3.0:
                _jy = 3.0
            p.jy = _jy
            # ★ 用 World 上的集合 ✗ 不能存在 Player 上（__slots__ 会报错 ✓）
            if _jy > 0.2:
                if not hasattr(self, '_jy_logged'):
                    self._jy_logged = set()
                if p.cid not in self._jy_logged:
                    self._jy_logged.add(p.cid)
                    print('[jy] %s 发来跳跃高度 %.2f（服务端收到了 ✓）' % (p.name, _jy))
            # ★★★ 第 227 轮：位移校验（反瞬移 / 反加速）★★★
            #   思路（照 Grim Anticheat）：服务器自己算"这么久最多能走多远"
            #   超出了就不采纳这次位置 ✓ 超得离谱还回推一个纠正 ✓
            #   ★ 为什么不"一刀切拒绝"：网络抖动 / 切后台回来，
            #     客户端会一次报一大步 ✗ 拒绝的话正常玩家会被卡住 ✓
            #     → 所以给了 MOVE_TOL 倍容差 + MOVE_SLACK 米余量 ✓
            _nx = _f(d.get('x'), p.x)
            _nz = _f(d.get('z'), p.z)
            _now = now_s()
            _last = float(getattr(p, 'moveT', 0) or 0)
            _dt = _now - _last if _last > 0 else 0.05
            if _dt < 0.02:
                _dt = 0.02
            elif _dt > 3.0:
                _dt = 3.0                    # ★ 隔太久（切后台/卡顿）按最多 3 秒算 ✓
                #   ★ 为什么从 1 秒放宽到 3 秒（第 227 轮实测改的）：
                #     手机切后台 5 秒再回来 ✗ 客户端会一次报 20 米 ✓
                #     按 1 秒算只允许 12 米 → 正常玩家被误拦 ✗（体感：走不动 ✓）
                #     按 3 秒算允许 33 米 ✓ 不误伤 ✗ 而瞬移 1000 米照样拦得住 ✓
                #   ★ 代价：作弊者可以「等 3 秒跳 33 米」✗ 但那只是快走 ✓ 可接受 ✓
            _dist = ((_nx - p.x) ** 2 + (_nz - p.z) ** 2) ** 0.5
            _allow = PLAYER_SPEED * _dt * MOVE_TOL + MOVE_SLACK
            # ★★★ 第 280 轮（用户要求：先把移动速度的作弊检测关了看看）★★★
            #   ★ 开关：False = 完全关闭位移检测（用来排查"移速飞快"✓）
            #     想开回来改成 True 就行 ✓ 代码全留着 ✗ 只是不执行 ✓
            #   ★ 第 277 轮已经去掉了"把玩家拉回"✗ 按理服务器不会再改位置 ✓
            #     但用户实测问题还在 ✗ 所以先整个关掉 ✗ 一刀切干净 ✓
            #     —— 关掉之后如果【还是飞快】✗ 那就和这个检测完全无关 ✓
            #        嫌疑就转到【客户端插值】那边 ✓（我改的 120ms 缓冲 ✓）
            _MOVE_CHECK_ON = False
            if _MOVE_CHECK_ON and _dist > _allow:
                # round277 fix (user: other players fly around, the mover sees himself fine)
                #   OLD: reject the position AND send a 'tp' correction when way over.
                #   WHY IT BROKE: position is client-authoritative; at 30Hz with jitter the
                #     move packets bunch up, so dt is tiny while the displacement is large
                #     -> false positive -> server yanks the player back -> everyone else
                #     sees a jump. The mover never notices because his client is the boss.
                #   NEW: always accept the position, but still count it as suspicious
                #     (log + suspect counter -> admin page can ban the real cheaters).
                p.moveT = _now
                p.moveBad = int(getattr(p, 'moveBad', 0)) + 1
                p.suspect = int(getattr(p, 'suspect', 0)) + 1
                if p.moveBad == 1 or p.moveBad % 20 == 0:
                    print('[ac] move over limit (record only, never yank back): %s reported %.1f m / allowed %.1f m (x%d)'
                          % (p.name, _dist, _allow, p.moveBad))
            p.x = _nx
            p.z = _nz
            p.moveT = _now
            if _dist <= _allow:
                p.moveBad = 0
            p.yaw = _f(d.get('yaw'), p.yaw)
            p.ct = _f(d.get('t'), p.ct)
            # ★★ 第 57 轮：客户端上报的 hp / qi 【不再采信】★★
            #   和上面 atk 那条一个道理 —— 改个包就能报 hp=999999 变成不死身 ✗
            #   （方案 §5：伤害/死亡/血量归服务器权威，客户端只有【位置】是权威的 ✓）
            #
            #   踩到的真 bug：管理页把某个玩家治好（hp=200）✓
            #   但那个玩家的客户端本地 hp 还是 0 → 每个移动包又把 0 覆盖回来 ✗
            #   → 管理员治疗/复活【永远不生效】✗
            #
            #   ★ 客户端照旧发这两个字段，服务器只是不理它 ✓（省得改协议 ✗）
            # ★★ 第 39 轮：客户端上报的 atk 【不再采信】★★
            #    攻击力由服务器按角色等级自己算（mobs.player_atk，方案 §4.5）——
            #    以前直接存客户端的值，改个包就能一刀秒天秒地 ✗
            #    （客户端那边照旧发这个字段，服务器只是不理它了 ✓）
        elif t == 'ping':
            self._send_cid(p.cid, P.pack('pong', t=d.get('t'), st=round(now_s(), 3)))
        if t == 'safetp':            # 第 173 轮（用户 #6）：请求传送回安全区
            #   ★ 服务器说了算：只是【开始读条】✗ 6 秒后才真挪人 ✓
            #   ★ 已经在安全区里就不用传了 ✓ 读条中也不重复开 ✓
            _in_safe = (abs(p.x) <= mqmod.SAFE_HALF and abs(p.z) <= mqmod.SAFE_HALF)
            if _in_safe:
                self._send_cid(p.cid, P.pack('notice', text='你已经在安全区里了'))
            elif float(getattr(p, 'tpEnd', 0) or 0) > now_s():
                pass                                   # 正在读条，忽略重复请求 ✓
            else:
                p.tpEnd = now_s() + float(TELEPORT_CAST)
                self._send_cid(p.cid, P.pack('tpcast', t=TELEPORT_CAST))
                self._send_cid(p.cid, P.pack(
                    'notice', text='开始传送回安全区（%.0f 秒，期间受伤会中断）' % TELEPORT_CAST))
        elif t == 'chat':
            txt = str(d.get('text') or '')[:200]
            if txt:
                self._to_net(self._broadcast, P.pack_str(
                    'chat', {'from': p.name, 'text': txt, 'ch': d.get('ch') or 'world'}))
        elif t == 'talent':
            self._talent_op(p, d)          # ★ 第 116 轮：天赋加点 ✓
        elif t == 'atk':
            self._intent_atk(p, d)
        elif t == 'pick':
            self._intent_pick(p, d)           # ★ 捡东西（第 38 轮）
        elif t == 'spawn':
            # ★★ 第 48 轮：这个能力【搬到管理页】了 ✗ ★★
            #   以前任何玩家发一个 spawn 就能自己刷一堆怪（还能指定职业/等级/清场）✗
            #   要临时给玩家用，只能改 config 的 allow_player_debug=true（本地调试用 ✓）
            if not (self.cfg or {}).get('allow_player_debug'):
                if 'spawn' not in p.warned:
                    p.warned.add('spawn')
                    self._send_cid(p.cid, P.pack('error', msg='刷怪已移到管理页（/admin）'))
                return
            self._debug_spawn(p, int(_f(d.get('n'), 5)), bool(d.get('clear')),
                              d.get('kind') or None,
                              d.get('lv'))
        elif t == 'giveweapon':
            # ★ 同上：发武器也搬到管理页了 ✗（玩家端默认不给 ✓）
            if not (self.cfg or {}).get('allow_player_debug'):
                if 'giveweapon' not in p.warned:
                    p.warned.add('giveweapon')
                    self._send_cid(p.cid, P.pack('error', msg='发武器已移到管理页（/admin）'))
                return
            # ★ 调试：直接往背包里塞一件武器（打开背包就能穿）★
            #   为什么要这个：装备栏还没做的时候，玩家/测试【没法验证武器手感】✗
            #   有了它，双击一下就能立刻试"匕首快 / 斧头慢" ✓
            import json
            import db as dbmod
            lv = max(1, int(p.role.get('level') or 1))
            w = weapons.roll_weapon(lv + 6, lv)
            # ★ 第 56 轮：不再强制 reqLevel=1（保留真实建议等级 ✓ 反正不拦穿戴）
            self.post_save(
                'INSERT INTO items(role_id, in_storage, slot_index, stack, item_json, created_at)'
                ' VALUES(?,0,-1,1,?,?)',
                (p.role_id, json.dumps(w, ensure_ascii=False), dbmod.now_ms()))
            self._send_cid(p.cid, P.pack('notice',
                                         text='调试：背包里多了一件【%s】—— 打开背包就能穿上 ✓' % w['name']))
        elif t == 'party':
            self._party_op(p, d)          # ★ 第 81 轮：组队 ✓
        elif t == 'mktopen':
            # round304c：网络线程刚读了库（全服在售 + 我此刻的背包 ✓）
            self._mkt_open_fresh(p, d)
        elif t in ('lists', 'mylists', 'mklist', 'buyitem', 'unlist', 'listclaim'):
            self._mkt_do(p, t, d)         # ★ round304b：交易所（纯内存 ✓）
        elif t == 'armorset':
            # ★ 第 67 轮：穿/脱防具（网络线程已经查库校验完了 ✓）
            self._flush_adur(p)                     # ★ 换防具前先把旧的落库 ✓
            p.armor = d.get('armor') or None
            p.armorItemId = d.get('itemId')
            _ar = p.armor or {}
            p.aDurMax = int(_ar.get('durMax') or 0)
            p.aDur = int(_ar.get('dur') or p.aDurMax)
            p.aDurDirty = 0
            nm = (p.armor or {}).get('name')
            self._send_cid(p.cid, P.pack('notice',
                                         text=('穿上：%s' % nm) if nm else '脱下防具'))
            self._send_cid(p.cid, P.pack('armor', a=p.armor or None,
                                         hpm=self._hp_max(p)))
        elif t == 'mineprop':
            self._prop_mine(p, d)
        elif t == 'mine':
            self._ter_mine(p, d)
        elif t == 'falldmg':
            # ★ round306（地形）：掉落伤害
            #   ★ 客户端算落差 ✗ 服务端【夹住】✓ 不能让它改包自杀/刷血 ✓
            #     （完整防作弊在 P3：服务端按 terrain.py 自己算落差 ✓）
            try:
                _fd = int((d or {}).get('d') or 0)
            except Exception:
                _fd = 0
            if 0 < _fd <= 60 and int(p.hp or 0) > 0:
                self._tp_break(p)
                p.hp = max(0, int(p.hp) - _fd)
                self._add_pend(p.cid, 'hurts',
                               {'dmg': _fd, 'x': round(p.x, 2), 'z': round(p.z, 2),
                                'by': '摔落', 'kind': 'fall', 'crit': False})
                # 摔死也要掉魔气（和被打死同一条规矩 ✓ 第 166 轮）
                if int(p.hp or 0) <= 0 and int(p.mq or 0) > 0:
                    import mq as _mqf
                    _lost = min(int(p.mq or 0), int(_mqf.cfg('killed_loss', _mqf.KILLED_LOSS)))
                    p.mq = max(0, int(p.mq or 0) - _lost)
                    self._mq_save(p)
                    self._send_cid(p.cid, P.pack(
                        'notice', text='你摔死了，魔气 −%d（现在 %d）' % (_lost, int(p.mq or 0))))
        elif t == 'equipset':
            #   （tick 线程不许碰磁盘 ✗ 所以查库那步在 net.py 做）
            w = d.get('weapon')
            self._flush_dur(p)                       # ★ 换武器前先把旧的耐久落库 ✓
            p.weapon = w or dict(weapons.FIST)   # ★ 第 58 轮：空手 ✓
            p.weaponItemId = d.get('itemId')
            # ★★ 第 59 轮：读出手上这把的耐久（没记录就从上限开始 ✓）
            p.wDurMax = int((w or {}).get('durMax') or 0)
            p.wDur = int((w or {}).get('dur') or p.wDurMax)
            p.wDurDirty = 0
            bb = (w or {}).get('base') or {}
            self._send_cid(p.cid, P.pack('notice', text=(
                '装上：%s（%d 阶）攻速 ×%.2f 射程 %.1f 米'
                % (w.get('name'), tier_no(w.get('tier')), bb.get('atkSpeed') or 1.0,
                   bb.get('reach') or 2.4)) if w else '卸下武器（换回默认单手剑）'))
            # ★ 把新的武器告诉客户端 —— 客户端的挥刀冷却/射程预测要跟着换 ✓
            #   ★ 第 59 轮：顺带把耐久带上（不然换完武器条子就空了 ✗）
            ww = dict(w) if w else None
            if ww:
                ww['dur'] = p.wDur
                ww['durMax'] = p.wDurMax
            self._send_cid(p.cid, P.pack('weapon', w=ww))
        elif t == 'pvp':
            # ★★★ 第 243 轮修的真 bug（用户："我测试了开了pvp好像还是无法攻击玩家"）★★★
            #   病根：这里原来写的是 self.pvp = ... ✗
            #     而 self 是【World 世界对象】✗ 不是这个玩家 ✓
            #     → 玩家点开关只改了世界身上一个没人读的字段 ✓
            #     → 玩家自己的 PVP 状态从来没被设上 ✓✓
            #   而判定能不能打人的 _pvp_on(q) 读的是：
            #     · pvp_of[role_id]（单人覆盖 ✓）
            #     · pvp_all（管理页的全局开关 ✓）
            #     → 玩家自己那个开关跟这两个都没关系 ✓✓
            #   → 结果：你开了 PVP ✗ 服务器眼里你还是没开 → 打不到人 ✓
            #   ★ 修法：把玩家自己的开关写进 pvp_of（单人覆盖 ✓）
            #     → 三层关系变成：
            #         单人覆盖 > 全局开关 ✓（管理页那两层照旧有效 ✓）
            _pv_on = bool(d.get('on')) if 'on' in d else not self._pvp_on(p)
            self.pvp_of[getattr(p, 'role_id', None)] = _pv_on
            self._send_cid(p.cid, P.pack('notice', text='PvP 已%s' % ('开' if _pv_on else '关')))
            # ★ 顺便告诉客户端一声 ✓ 让界面上的开关状态跟服务器一致 ✓
            self._send_cid(p.cid, P.pack('pvp', on=1 if _pv_on else 0))
        elif t == 'revive':
            # ★★ 第 56 轮：复活真正实装 ★★
            #   以前这是纯客户端行为 ✗ —— 服务器不知道 → 也就给不了无敌 ✓
            #   现在：补满血 + 1.5 秒无敌（§用户要求）✓
            # ★ 血量上限：和管理页"治疗"用同一口径（role.hpMax，兜底 200 ✓）
            #   P1 阶段玩家血量还没有按等级成长（§4.5 的成长曲线是 P3 的事 ✓）
            hpmax = self._hp_max(p)     # ★ 第 67 轮：含防具加成 ✓
            p.hp = hpmax
            p.invulnT = REVIVE_INVULN
            p.role['hp'] = p.hp
            self._send_cid(p.cid, P.pack('revived', invuln=REVIVE_INVULN, hp=p.hp, hpMax=hpmax))
            self._send_cid(p.cid, P.pack('notice',
                                         text='复活成功 —— %.1f 秒无敌，快跑！' % REVIVE_INVULN))
            # ★★ 第 63 轮：让【附近的人】看出他是复活了 ★★
            #   不然在队友眼里他就是"凭空站起来了"✗（用户原话）
            self._evt_near(p.x, p.z, 'evt',
                           {'kind': 'revive', 'id': p.role_id,
                            'name': p.name, 'x': round(p.x, 2),
                            'z': round(p.z, 2), 'inv': REVIVE_INVULN},
                           exclude=p.cid)
        elif t in ('skill', 'team', 'dead', 'respawn'):
            # 这些要等 P3/P4 的世界规则。
            # ★ 只提示一次（不然每挥一刀都弹一句，把玩家烦死）
            if t not in p.warned:
                p.warned.add(t)
                self._send_cid(p.cid, P.pack('error', msg='%s 还没实现' % t))

    # ============================================================ 地形破坏（P1）
    #  ★ 硬度表（方案 §5.2）✗ 和材质一一对应 ✓
    # ★★★ round313（用户："最少 2 次才能破坏，不能攻击一次就破坏了"）★★★
    #   原来草/土/泥是 1 ✗ 一刀就没 → 手感像"擦一下就没了"✓
    #   现在【最低 2】✗ 第一刀一定只出裂纹 ✓ 第二刀才碎 ✓
    #   材质差靠 2 / 4 / 6 拉开（草 2 · 砖 4 · 石 6 ✓）
    TER_HARD = {'grass': 2, 'dirt': 2, 'ice': 2, 'swamp': 2,
                'brick': 4, 'stone': 6}
    #  ★ 能打多远的格子（格 ✗ 玩家离格子的距离上限 ✓）
    TER_REACH = 3

    # ------------------------------------------------ 流体（★ 不模拟 ✗ 只"灌一格" ✓）
    # ★★★ round321（用户 2026-10-18）★★★
    #   用户："水流动也不做了，直接挖了，就在旁边加一格水，这样简单性能也好，
    #         岩浆也是一样" + "水+火变成石头没必要做，没有用"
    #   → 活跃集合 / 每帧预算 / 平衡规则 / 水+火=石头【全部删掉】✓
    #   ★ 换来：挖一格只查 4 个邻居 ✗ 零模拟开销 ✓ 不会震荡 ✓ 不会失控扩散 ✓
    #   ★ 失去：挖一条 3 格的沟只有贴着水那一格有水 ✓（用户接受 ✓）

    def fstate(self, gx, gz):
        """这一格有没有流体 → (kind, level) ✗ level −1 = 没有 ✓"""
        ov = self.fluid_ov.get((gx, gz))
        if ov is not None:
            return ov
        k, _d = termod.fluid_of(gx, gz)
        if k:
            return (k, 0)
        return (0, -1)

    def ffill_around(self, gx, gz):
        """这一格刚被挖空 ✗ 看四邻有没有水/地火 ✗ 有就灌进来（只灌这一格 ✓）

        ★ 为什么这样就够：玩家挖坑就是为了"挖到水"✓
          灌进来之后它自己就是一个新水源 ✗ 再挖旁边又会被灌 ✓
          → 连挖几格就是一条水渠 ✓ 观感和流水几乎一样 ✗ 但没有模拟开销 ✓
        """
        nk = 0
        for (dx, dz) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            k, _l = self.fstate(gx + dx, gz + dz)
            if k:
                nk = k
                break
        if not nk:
            return
        self.fluid_ov[(gx, gz)] = (nk, 0)
        self._fluid_save(gx, gz, nk, 0)      # ★ round347：落库（重启后还在 ✓）
        msg = [[gx, gz, nk, 0]]
        for p in self.players.values():
            ddx = gx * termod.LEVEL_H - p.x
            ddz = gz * termod.LEVEL_H - p.z
            if ddx * ddx + ddz * ddz <= 3600:
                try:
                    self._send_cid(p.cid, P.pack('fluedit', cells=msg))
                except Exception:
                    pass

    def _flux(self):
        """当前所有"和生成值不同"的流体格（登录时全量发一次 ✓）"""
        return [[k[0], k[1], v[0], v[1]] for k, v in self.fluid_ov.items()]

    def ter_h_at(self, gx, gz):
        """这一格【当前】的高度（含破坏覆盖 ✓ 和客户端的 terH 等价 ✓）"""
        ov = self.ter_over.get((gx, gz))
        if ov is not None:
            return ov[0]
        return termod.height(gx, gz)

    def _ter_load(self):
        """启动时把上次的破坏读回内存（★ 只读一次 ✗ 不进 tick ✓）"""
        try:
            with dbmod.db(self.cfg) as c:
                rows = c.execute(
                    'SELECT x, z, h, ts FROM terrain_damage').fetchall()
        except Exception:
            return
        now = dbmod.now_ms()
        n = 0
        for x, z, h, ts in rows:
            # ★ 已经过期的不读（启动时就把它清掉 ✓ 免得白占内存）
            if now - int(ts) >= self.TER_REGEN_MS:
                try:
                    with dbmod.db(self.cfg) as c:
                        c.execute('DELETE FROM terrain_damage WHERE x=? AND z=?',
                                  (int(x), int(z)))
                except Exception:
                    pass
                continue
            self.ter_over[(int(x), int(z))] = [float(h), int(ts)]
            n += 1
        if n:
            print('[ter] 读回 %d 格破坏记录' % n)

    def _fluid_load(self):
        """启动时把上次的水/地火读回内存（★ 只读一次 ✗ 不进 tick ✓）"""
        try:
            with dbmod.db(self.cfg) as c:
                rows = c.execute(
                    'SELECT x, z, kind, level FROM terrain_fluid').fetchall()
        except Exception:
            return
        n = 0
        for x, z, kind, level in rows:
            try:
                self.fluid_ov[(int(x), int(z))] = (int(kind), int(level))
                n += 1
            except Exception:
                pass
        if n:
            print('[fluid] 读回 %d 格流体记录' % n)

    def _fluid_save(self, gx, gz, kind, level):
        """写一格流体（★ 只在【变化时】写 ✗ 不是每帧 ✓）"""
        try:
            self.post_save('INSERT OR REPLACE INTO terrain_fluid(x, z, kind, level, ts)'
                           ' VALUES(?,?,?,?,?)',
                           (int(gx), int(gz), int(kind), int(level), dbmod.now_ms()))
        except Exception as _fe:
            print('[fluid] save failed: %r' % (_fe,))

    def _ter_sweep(self, now):
        """自愈：过期的破坏全部撤销（★ 惰性 ✗ 不在每格上跑定时器 ✓）

        ★ 为什么这样做：100 万格被破坏也只是字典里 100 万条
          每次扫一遍字典 ✗ 太贵 ✓ → 所以【每秒最多扫一次】✗ 而且只扫到期的 ✓
          （实测：破坏是低频操作 ✗ 字典通常只有几十条 ✓ 扫一遍是微秒级 ✓）
        """
        if not self.ter_over:
            return
        dead = []
        for k, v in self.ter_over.items():
            if now - v[1] >= self.TER_REGEN_MS:
                dead.append(k)
        for k in dead:
            self.ter_over.pop(k, None)
            self.post_save('DELETE FROM terrain_damage WHERE x=? AND z=?',
                           (int(k[0]), int(k[1])))
            self._ter_bc.append([k[0], k[1], -999])   # -999 = 恢复了（客户端删覆盖 ✓）

    def _prop_mine(self, p, d):
        """砍一棵树 / 砸一块石头（★ round329 ✓ 方案 §5.4）

        ★ 服务端怎么知道"这一格真的长着树"：
          worldgen.kind_at(哈希) 是纯函数 ✗ 和服务端生成用的是同一套 ✓
          所以它自己算一遍就知道 ✗ 不用信客户端 ✓
        """
        try:
            gx = int((d or {}).get('gx'))
            gz = int((d or {}).get('gz'))
        except Exception:
            return
        px, pz = termod.cell_of_world(p.x, p.z)
        if max(abs(gx - px), abs(gz - pz)) > self.TER_REACH:
            return
        if abs(p.x) <= mqmod.SAFE_HALF and abs(p.z) <= mqmod.SAFE_HALF:
            return
        # ★ 让 worldgen 算一遍"这一格是什么"（和客户端同一个哈希 ✓）
        try:
            kind = worldgen.kind_of_cell(gx, gz)
        except Exception:
            kind = None
        if not kind:
            return
        # ★ round339：每种物件砍几下 + 掉什么（用户：树掉木材 / 石掉石块 / 房掉砖头）
        if kind.startswith('tree') or kind == 'dead':
            need, drop = 2, '木材'
        elif kind.startswith('fence'):
            need, drop = 2, '木材'
        elif kind.startswith('rock') or kind == 'rubble':
            need, drop = 3, '石块'
        elif kind.startswith('house') or kind == 'ruin':
            # ★ round344（用户发图指明："我说的这个围墙" = 断墙 ruin）
            #   它之前【两边都没列进可破坏】✗ 所以完全打不动 ✓
            need, drop = 4, '砖头'        # ★ 房子/断墙最硬（砖结构 ✓）
        else:
            return                         # 车 / 桶：这一轮不做
        key = (gx, gz)
        got = self.prop_hp.get(key, 0) + 1
        if got < need:
            self.prop_hp[key] = got
            self._prop_bc.append([gx, gz, 0, got, need])
            return
        self.prop_hp.pop(key, None)
        self.prop_dead.add(key)
        # ★ round346：把【种类】也广播出去 ✗ 别人的客户端拿它倒正确的模型 ✓
        self._prop_bc.append([gx, gz, 1, 0, 0, kind])
        # ★ 掉建材（直接往地上放 ✗ 复用现成的 loot 表 ✓ 客户端会自动捡 ✓）
        try:
            _wx = (gx + 0.5) * termod.LEVEL_H
            _wz = (gz + 0.5) * termod.LEVEL_H
            self.loot_seq += 1
            self.loot[str(self.loot_seq)] = {
                'x': _wx, 'z': _wz, 'ttl': drops.DROP_TTL,
                # ★ round340（用户："这个也有做掉落的随机品阶吗"）
                #   原来固定 0 阶 ✗ 现在随机 0~2 ✗ 10% 出 3 阶（稀有一点 ✓）
                'item': {'name': drop,
                         'tier': (3 if random.random() < 0.10 else random.randint(0, 2)),
                         'kind': 'material'}}
            for _p4 in self.players.values():
                _dx4 = _wx - _p4.x
                _dz4 = _wz - _p4.z
                if _dx4 * _dx4 + _dz4 * _dz4 <= 900:
                    self._add_pend(_p4.cid, 'notice',
                                   {'text': '掉落：%s 走过去自动捡 ✓' % drop})
        except Exception as _de:
            print('[prop] drop failed: %r' % (_de,))

    def _prop_flush(self, now):
        if not self._prop_bc:
            return
        batch = self._prop_bc
        self._prop_bc = []
        for p in self.players.values():
            near = []
            for c in batch:
                ddx = c[0] * termod.LEVEL_H - p.x
                ddz = c[1] * termod.LEVEL_H - p.z
                if ddx * ddx + ddz * ddz <= 3600:
                    near.append(c)
            if near:
                try:
                    self._send_cid(p.cid, P.pack('propedit', cells=near))
                except Exception:
                    pass

    def _ter_mine(self, p, d):
        """打一格地形（★ 服务端权威 ✗ 客户端只是"请求"✓）"""
        try:
            gx = int((d or {}).get('gx'))
            gz = int((d or {}).get('gz'))
        except Exception:
            return
        # ① 够不够得着（防作弊：不能隔半个地图拆地形 ✓）
        px, pz = termod.cell_of_world(p.x, p.z)
        if max(abs(gx - px), abs(gz - pz)) > self.TER_REACH:
            return
        # ② 安全区不许拆
        if abs(p.x) <= mqmod.SAFE_HALF and abs(p.z) <= mqmod.SAFE_HALF:
            return
        key = (gx, gz)
        cur = self.ter_h_at(gx, gz)
        # ★ 用户："可以往下破坏，但是只能破坏一层"（2026-10-17）
        #   往下最多挖到 −1（一个坑 ✓）✗ 再挖就到底了 ✓
        if cur <= -1.0:
            return
        mat = termod.material(gx, gz)
        need = self.TER_HARD.get(mat, 1)
        got = self.ter_hp.get(key, 0) + 1
        if got < need:
            self.ter_hp[key] = got
            # ★ 广播裂纹进度（方案 §5.6 第③层：让玩家看得出还要几刀 ✓）
            self._ter_bc.append([gx, gz, None, got, need])
            return
        # ③ 碎了：高度 −1（用户：往下只能破坏一层 ✓ 从 0 到 −1 就到底）
        self.ter_hp.pop(key, None)
        nh = cur - 1.0
        if nh < -1.0:
            nh = -1.0
        _ts = dbmod.now_ms()
        self.ter_over[key] = [nh, _ts]
        # ★ 落库（只存被打过的格子 ✗ 平时这张表是空的 ✓）
        self.post_save('INSERT OR REPLACE INTO terrain_damage(x, z, h, ts)'
                       ' VALUES(?,?,?,?)', (int(gx), int(gz), float(nh), int(_ts)))
        # ★★★ round319 修的真 bug（用户："水和岩浆都不会流动"）★★★
        #   round321：改成"挖空之后看四邻有没有水 ✗ 有就灌一格" ✓
        self.ffill_around(gx, gz)
        # ★ 广播给附近的人（★ 用 _evt_near ✗ 和现有的特效/音效同一套 ✓）
        self._ter_bc.append([gx, gz, nh])
        # ★ 掉东西（P1 先不掉 ✗ 等背包/掉落接进来 ✓ 方案 §5.2 写着 ✓）
        self._send_cid(p.cid, P.pack('notice', text='这一格碎了（%s）' % mat))

    def _flux(self):
        """把 fluid_ov 里"和生成值不同"的格子整理成要广播的样子"""
        return [[k[0], k[1], v[0], v[1]] for k, v in self.fluid_ov.items()
                if v[1] >= 0 or v[0]]

    def _fluid_flush(self, now):
        """把流体变化发给附近的人（★ 一秒最多 4 次 ✗ 流体不用每帧同步 ✓）

        ★ 为什么不每帧发：水的流动是"慢慢铺"的 ✗ 每帧发一次的话
          每秒 30 条 ✗ 手机上真没必要 ✓ 4 次看起来已经连续了 ✓
        """
        self._fl_acc = getattr(self, '_fl_acc', 0.0) + TICK_DT
        if self._fl_acc < 0.25:
            return
        self._fl_acc = 0.0
        if not self.fluid_ov:
            return
        cells = self._flux()
        if not cells:
            return
        for p in self.players.values():
            try:
                self._send_cid(p.cid, P.pack('fluedit', cells=cells))
            except Exception:
                pass

    def _ter_flush(self, now):
        """把本 tick 的破坏广播出去（★ 一秒最多一次 ✗ 别刷屏 ✓）"""
        if not self._ter_bc:
            return
        _ = now
        batch = self._ter_bc
        self._ter_bc = []
        # ★ round319（用户："我破坏方块为什么离得远的玩家也能听到"）
        #   根因：这里【发给了所有人】✗ 客户端收到就播破坏音 ✓
        #   修：只发给【附近】的人（方案 §13 兴趣管理 ✓）
        #   ★ 为什么按 60 格：比一个画面略大 ✓ 保证画面里的人都收得到 ✓
        for p in self.players.values():
            near = []
            for c in batch:
                ddx = c[0] * termod.LEVEL_H - p.x
                ddz = c[1] * termod.LEVEL_H - p.z
                if ddx * ddx + ddz * ddz <= 3600:      # 60 格
                    near.append(c)
            if not near:
                continue
            try:
                self._send_cid(p.cid, P.pack('teredit', cells=near))
            except Exception:
                pass

    # ============================================================ 僵尸（P2 第一刀）

    def _arrow_tick(self, dt):
        """箭的推进与命中（第 69 轮 ✓ 只在 tick 线程跑）

        ★ 命中判定用【线段】扫过（起点 → 终点）✗ 不是看终点一个点
          箭一 tick 走 26×0.033 = 0.86 米，僵尸半径 0.5 米
          只看终点的话高速箭会【穿过】僵尸 ✗（实测过：打不中 ✓）
        """
        if not self.arrows:
            return
        step = ARROW_SPEED * dt
        hr2 = ARROW_HIT_R * ARROW_HIT_R
        for a in list(self.arrows.values()):
            x0, z0 = a['x'], a['z']
            a['x'] = x0 + a['dx'] * step
            a['z'] = z0 + a['dz'] * step
            a['life'] -= dt
            hit = None
            for m in self.mobs.values():
                if m.hp <= 0:
                    continue
                # 点到线段的距离（箭这一段轨迹 ✓）
                vx, vz = a['x'] - x0, a['z'] - z0
                wx, wz = m.x - x0, m.z - z0
                L2 = vx * vx + vz * vz
                u = 0.0 if L2 <= 1e-9 else max(0.0, min(1.0, (wx * vx + wz * vz) / L2))
                cx, cz = x0 + vx * u, z0 + vz * u
                if (m.x - cx) ** 2 + (m.z - cz) ** 2 <= hr2:
                    hit = m
                    break
            if hit is not None:
                shooter = self.players.get(a['by'])
                dv = int(a['dmg'])
                hit.hp -= dv
                if shooter is not None:
                    self._add_pend(shooter.cid, 'mhits',
                                   {'mid': hit.mid, 'dmg': dv, 'crit': bool(a['crit']),
                                    'arrow': True,
                                    'x': round(hit.x, 2), 'z': round(hit.z, 2)})
                else:
                    self._add_pend(None, 'mhits',
                                   {'mid': hit.mid, 'dmg': dv, 'crit': bool(a['crit']),
                                    'arrow': True,
                                    'x': round(hit.x, 2), 'z': round(hit.z, 2)})
                if hit.hp <= 0:
                    hit.hp = 0
                    if shooter is not None:
                        self._mob_died(shooter, hit)
                self.arrows.pop(a['id'] and str(a['id']), None)
                continue
            if a['life'] <= 0:
                self.arrows.pop(str(a['id']), None)

    def _mob_tick(self, dt):
        """刷怪 / 回收 / 追击 / 咬人 —— ★ 只在 tick 线程里跑"""
        if not self.players:
            if self.mobs:
                self.mobs.clear()       # 没人了 → 全收掉（省 CPU；下次来的是新世界 ✓）
            return
        ps = list(self.players.values())

        # ---- ① 刷怪（节流 + 上限）----
        self._spawn_acc += dt
        if self._spawn_acc >= self.spawn_interval:   # ★ 第 133 轮：可调 ✓
            self._spawn_acc = 0.0
            for _ in range(mobs.SPAWN_PER_TRY):
                if len(self.mobs) >= self.mob_cap and not self._evict_far():   # ★ 可调 ✓
                    break
                self._spawn_one(ps)

        # ---- ② 每只僵尸：找最近的【活着的】玩家 → 追 / 咬；没目标就漫无目的地散开 ----
        #   ★★ 死掉的玩家不算目标（第 37 轮，用户反馈"玩家死后僵尸还在攻击"）★★
        #      hp<=0 就当他不存在 → 僵尸立刻失去目标，转去漫游散开 ✓
        #      但"消失计时"仍然用【所有】玩家算距离（尸体旁边也算有人，怪不该凭空消失 ✓）
        # 第 174 轮（用户）：★ 在安全区里的玩家【不算目标】
        #   效果就是"玩家一进安全区，僵尸立刻丢失目标"（②）
        #   ★ 只影响【选目标】✗ "消失计时"那边仍然用所有玩家算距离 ✓
        #     （不然站在安全区里的人旁边，怪会凭空消失 ✓）
        live = [q for q in ps
                if int(q.hp or 0) > 0
                and not (abs(q.x) <= mqmod.SAFE_HALF and abs(q.z) <= mqmod.SAFE_HALF)]
        away2 = mobs.AWAY_DIST * mobs.AWAY_DIST
        agg2 = mobs.AGGRO * mobs.AGGRO
        for m in list(self.mobs.values()):
            # ★★★ round322（用户："僵尸进岩浆不会掉血，僵尸也要掉血"）★★★
            #   地火对僵尸一视同仁 ✗ 每 0.5 秒 5 点（和玩家一个量）✓
            #   ★ 为什么要它：僵尸不会躲地火 ✗ 走进去就该被烧死 ✓
            #     这是"引怪入火"这个战术能成立的前提 ✓
            if int(getattr(m, 'hp', 0)) > 0:
                _mcx, _mcz = termod.cell_of_world(m.x, m.z)
                _ov = self.fluid_ov.get((_mcx, _mcz))
                _fk = _ov[0] if _ov is not None else termod.fluid_of(_mcx, _mcz)[0]
                if _fk == 3:
                    m.lavaT = getattr(m, 'lavaT', 0.0) - dt
                    if m.lavaT <= 0:
                        m.lavaT = 0.5
                        m.hp = int(m.hp) - 5
                        # ★ round323（用户："僵尸进岩浆也要飘字和受伤音效"）
                        #   走 mhits 这条现成的路 ✓ 客户端会弹伤害数字 + 出打击音效 ✓
                        #   只发给【附近】的人（30 格）✗ 远处的人不用知道 ✓
                        for _p3 in self.players.values():
                            _dx3 = m.x - _p3.x
                            _dz3 = m.z - _p3.z
                            if _dx3 * _dx3 + _dz3 * _dz3 <= 900:
                                # ★ round324（用户："僵尸进岩浆受伤，为什么我的屏幕也会抖动"）
                                #   根因：mhits 默认是"我砍中了"✗ 会触发震屏 + 顿帧 ✓
                                #   修：加 env=1 标记 ✗ 客户端看到就不震屏（只飘字+音效）✓
                                self._add_pend(_p3.cid, 'mhits',
                                               {'dmg': 5, 'x': round(m.x, 2),
                                                'z': round(m.z, 2), 'mid': m.mid,
                                                'env': 1})
            # ★ 第 59 轮：武器机制的状态衰减（先衰减再判断行为 ✓）
            if m.stunImmune > 0:
                m.stunImmune = max(0.0, m.stunImmune - dt)
            if m.knockImmune > 0:
                m.knockImmune = max(0.0, m.knockImmune - dt)
            if m.bleedT > 0:
                # 流血：每秒扣一次（按 dt 连续扣 ✓ 结算到整数就用累加器 ✗ 太绕 → 直接浮点扣 ✓）
                m.bleedT = max(0.0, m.bleedT - dt)
                m.hp -= m.bleedDmg * dt
                if m.hp <= 0:
                    m.hp = 0
                    self._mob_died(m.bleedFrom or ps[0] if ps else None, m)
                    continue
            if m.hp <= 0:
                m.deadT += dt
                if m.deadT >= mobs.MOB_KEEP_DEAD:
                    self.mobs.pop(m.mid, None)
                continue
            near, nd2 = None, None
            for q in live:
                dx = q.x - m.x
                dz = q.z - m.z
                d2 = dx * dx + dz * dz
                if nd2 is None or d2 < nd2:
                    nd2 = d2
                    near = q
            # ★ 消失计时（用户要求）：离所有玩家都超过 20 米 → 开始计时；
            #   连续 60 秒都这样 → 自然消失 ✓（有人靠近就清零 ✓）
            allnd2 = None
            for q in ps:
                d2 = (q.x - m.x) ** 2 + (q.z - m.z) ** 2
                if allnd2 is None or d2 < allnd2:
                    allnd2 = d2
            if allnd2 is None or allnd2 > away2:
                m.awayT += dt
            else:
                m.awayT = 0.0
            if m.awayT >= mobs.AWAY_GRACE:
                self.mobs.pop(m.mid, None)
                continue
            if m.atkT > 0:
                m.atkT -= dt
            # ★ 挥爪动画：衰减到 -1（没在攻击时必须是 -1，不然客户端会一直摆攻击姿势 ✗）
            if m.atkAnim >= 0:
                m.atkAnim -= dt
                if m.atkAnim < 0:
                    m.atkAnim = -1.0
            if m.healCd > 0:                 # ★ 被治疗冷却（第 46 轮）—— 衰减到 0 才能再被治 ✓
                m.healCd -= dt
            # ★★ 第 59 轮：被锤砸【晕住】了 —— 不能动、不能咬、也不蓄力 ✓
            #   拦在"有目标"判断之前 ✓ 晕着就是彻底停下（这才叫眩晕 ✓）
            if m.stunT > 0:
                m.stunT = max(0.0, m.stunT - dt)
                m.windT = 0.0                 # 蓄力也取消 → 醒来要重新起手 ✓
                continue                      # 跳过后面所有追击/咬人逻辑 ✓
            if near is not None and nd2 <= agg2:
                # ---- 有目标：追 / 咬（外卖残血时改成逃，见下）----
                m.tgt = near.cid
                d = math.sqrt(nd2) if nd2 > 0 else 0.0
                # ★ 外卖骑手：残血就逃（方案 §3.3"移速最快，会逃跑"）
                if m.kind == '外卖' and m.fleeT <= 0 and m.hp < m.mhp * mobs.FLEE_HP:
                    m.fleeT = mobs.FLEE_TIME
                    # ★ round348（用户："外卖僵尸逃跑时播放逃跑音效"）
                    #   只发给 30 格内的人 ✓ 太远听不到也没意义 ✓
                    # ★ round350（用户："旁边还有一个满血外卖僵尸，打一下就会播放一次"）
                    #   根因：fleeT 减到 0 之后条件又成立 ✗ 每 2.5 秒重播一次 ✓
                    #   修：一只僵尸【只播一次】（fleeSnd 标记 ✓ __slots__ 里加了 ✓）
                    if not m.fleeSnd:
                        m.fleeSnd = True
                        for _pf in self.players.values():
                            _dxf = m.x - _pf.x
                            _dzf = m.z - _pf.z
                            if _dxf * _dxf + _dzf * _dzf <= 900:
                                self._add_pend(_pf.cid, 'flee', {'mid': m.mid})
                if m.fleeT > 0:
                    m.fleeT -= dt
                    m.yaw = math.atan2(m.x - near.x, m.z - near.z)   # 背对着人 ✓
                    step = m.spd * dt
                    self._move_mob(m, math.sin(m.yaw) * step, math.cos(m.yaw) * step)
                    continue
                m.yaw = math.atan2(near.x - m.x, near.z - m.z)
                if d > mobs.CONTACT:
                    step = m.spd * dt
                    if step > d - mobs.CONTACT:
                        step = max(0.0, d - mobs.CONTACT)
                    self._move_mob(m, math.sin(m.yaw) * step, math.cos(m.yaw) * step)
                    m.windT = 0.0            # ★ 走开了就取消蓄力（重新贴身要重新起手 ✓）
                else:
                    # ★★ 僵尸的起手（第 41 轮，方案 §5.1）★★
                    #   用户反馈"贴近了就算直接打，应该慢一点点" ✓
                    #   现在是：贴到身前 → 蓄力 WINDUP 秒 → 咬 → 收招 RECOVER 秒
                    #   客户端从"开始蓄力"这一刻就抬手（atkAnim 给满）→ 有前摇可看 ✓
                    if m.atkT <= 0 and m.windT <= 0:
                        m.windT = mobs.windup_of(m.kind)
                        m.atkAnim = mobs.ATK_ANIM
                    if m.windT > 0:
                        m.windT -= dt
                        if m.windT <= 0:
                            m.windT = 0.0
                            m.atkT = mobs.RECOVER      # 咬完收招，之后才能重新起手 ✓
                            self._mob_bite(m, near)
            else:
                # ---- 没目标：漫无目的地散开（用户要求）----
                #      ★ 玩家死后没有目标时，僵尸就散开了 ✓
                m.tgt = None
                self._mob_wander(m, dt)

        # ---- ③ 僵尸之间不要堆在一起（用户要求）----
        self._mob_separate(dt)

        # ---- ④ 职业行为（第 40 轮，方案 §3.3）----
        self._mob_heal(dt)          # 医生给周围僵尸回血 ✓

    def _mob_heal(self, dt):
        """医生：定期把周围僵尸的血拉回来（方案 §3.3"给周围僵尸回血"）

        ★ 第 46 轮重写（用户反馈"治疗效果看不出关联 + 医生一多就打不动僵尸"）：
          ① 一只僵尸【同一个周期内只会被治疗一次】（m.healCd ✓）——
             所以医生多只是"能同时救更多不同的僵尸"，不是"同一只被奶更多次" ✓
             （原来是每个医生各自结算 → 线性叠加 ✗ 几个医生就能把僵尸奶成不死 ✗）
          ② 每次治疗都记一条事件发下去 → 客户端能画出"医生 → 僵尸"的连线和数字 ✓
             原来只在服务器内部改血量 ✗ 玩家完全看不出来谁给谁回了多少 ✗
        ★ 只在 tick 线程跑 ✓ 量很小 ✓
        """
        medics = [m for m in self.mobs.values() if m.hp > 0 and m.kind == '医生']
        if not medics:
            return
        r2 = mobs.HEAL_R * mobs.HEAL_R
        for doc in medics:
            doc.healT -= dt
            if doc.healT > 0:
                continue
            doc.healT = mobs.HEAL_PERIOD * (0.85 + random.random() * 0.3)   # 别整齐划一 ✓
            hurt = []
            for m in self.mobs.values():
                if m.hp <= 0 or m is doc:
                    continue
                if m.hp >= m.mhp * mobs.HEAL_MAX_HP:
                    continue                    # 血还很足的不奶（别浪费 ✓）
                if m.healCd > 0:
                    continue                    # ★★ 关键：这只刚被治过，别的医生也插不上 ✓★
                if (m.x - doc.x) ** 2 + (m.z - doc.z) ** 2 > r2:
                    continue
                hurt.append(m)
            if not hurt:
                continue
            hurt.sort(key=lambda m: m.hp / float(m.mhp or 1))   # 先奶最惨的 ✓
            for m in hurt[:mobs.HEAL_MAX_TARGETS]:
                add = max(1, int(round(m.mhp * mobs.HEAL_PCT)))
                before = m.hp
                m.hp = min(m.mhp, m.hp + add)
                real = m.hp - before
                if real <= 0:
                    continue
                m.healCd = mobs.HEAL_PERIOD     # ★ 这一只下个周期前不再被任何人治 ✓
                # ★ 治疗事件：[医生x, 医生z, 目标x, 目标z, 回了多少] → 客户端画连线+数字 ✓
                self.heals.append([round(doc.x, 2), round(doc.z, 2),
                                   round(m.x, 2), round(m.z, 2), real])

    def _mob_blocked(self, x, z, hw):
        """僵尸的碰撞（★ round351：只忽略【已经被砍掉】的物件 ✓）

        ★★ 自测踩到两次：
           ① 第一版没改 → 砍掉的物件还挡僵尸（用户报"僵尸过不来"）
           ② 第二版写"这格没东西就放行" → 太宽松 ✗
              **连站着的物件也被无视了**（用户报"我都还没砍掉就穿过去了"）
           ★ 现在逐盒判定：
             盒子中心 = (i*TS, j*TS) ✗ 反推格子 ✓
             那一格在 prop_dead 里 → 跳过这个盒子（不挡 ✓）
             否则 → 挡 ✓
        """
        try:
            boxes = worldgen.solids_near(x, z, 3.0)
        except Exception:
            boxes = ()
        for (sx, sz, shw, shd) in boxes:
            if not (x + hw > sx - shw and x - hw < sx + shw and
                    z + hw > sz - shd and z - hw < sz + shd):
                continue
            try:
                i = int(round(sx / termod.LEVEL_H))
                j = int(round(sz / termod.LEVEL_H))
            except Exception:
                return True
            if (i, j) in self.prop_dead:
                continue          # ★ 这件已经被砍掉了 → 不挡 ✓
            return True           # ★ 站着的物件 → 照常挡 ✓
        return False

    def _move_mob(self, m, dx, dz):
        """僵尸移动 —— ★ 会被建筑挡住（第 41 轮，用户要求"僵尸不应该穿墙"）

        · 分轴尝试（和客户端 blocked() 一个思路）：能走 x 就走 x、能走 z 就走 z
          → 贴着墙【滑】过去 ✓ 不会一头顶死在那里 ✗
        · **工人可以穿过去** —— 用户明确说了"建筑工除外" ✓（能钻废墟抄近路，算个职业特色）
        ★ 判定用的是【服务端自己算的】建筑（worldgen），不是客户端上传的 ✗
          所以改包说"我这边没有墙"没用 ✓
        """
        # round256 fix (user: mobs must not enter the safe zone)
        #   BUG: this safe-zone check used to live INSIDE the worker branch,
        #        so only workers were stopped and all other kinds walked in.
        #   FIX: check the safe zone FIRST for every kind, then split by kind.
        _nx = m.x + dx
        _nz = m.z + dz
        _outside = not (abs(m.x) <= mqmod.SAFE_HALF and abs(m.z) <= mqmod.SAFE_HALF)
        _would_in = (abs(_nx) <= mqmod.SAFE_HALF and abs(_nz) <= mqmod.SAFE_HALF)
        if _outside and _would_in:
            return                      # stop at the gate (do not push out - that jitters)
        if m.kind == '工人':
            # workers may pass through buildings (user request) and may walk OUT
            # of the zone if they somehow got in (old save / knockback).
            m.x, m.z = _nx, _nz
            return
        # ★★★ round306 修的真 bug（用户："僵尸怎么无视方块可以直接穿模了"）★★★
        #   根因：这里原来【只查 worldgen.blocked】（也就是树/房子那些 2D 盒子）
        #         完全没查【地形高度】✗
        #         而第 306 轮给玩家加了地形判定（terrainStepOk）✗ 僵尸没加 ✓
        #         → 玩家爬不上去的墙，僵尸直接走上去 ✓ 看着就是"穿模" ✓
        #   ★ 现在僵尸和玩家【用同一套规矩】✗ 只差各自的跳跃高度 ✓
        #     落差 ≤ STEP_JUMP(1.15) → 跳上去 ✓
        #     更大 → 过不去 ✗ 要绕路 ✓（这就是"峭壁挡僵尸"✓）
        #   ★ 改这个文件的时候注意：地形是【纯函数】✗ 不查库 ✓ 直接算 ✓
        hw = mobs.MOB_BODY / 2.0
        # ★ round316（P2 收尾）：僵尸也受地貌影响 ✓
        #   冰原 ×1.45（它们也会滑过头 ✗ 很好笑 ✓）
        #   沼泽 ×0.58（陷在泥里 ✓ 玩家会拿沼泽当退路 ✓ 这是玩法 ✓）
        _bcell = termod.cell_of_world(m.x, m.z)
        _bsp = termod.BIOME_SPEED.get(termod.biome(_bcell[0], _bcell[1]), 1.0)
        if _bsp != 1.0:
            dx *= _bsp
            dz *= _bsp
        _cur = termod.height(*termod.cell_of_world(m.x, m.z))
        nx = m.x + dx
        if not self._mob_blocked(nx, m.z, hw):
            _nh = termod.height(*termod.cell_of_world(nx, m.z))
            if _nh - _cur <= termod.STEP_JUMP:
                m.x = nx
                _cur = _nh
        nz = m.z + dz
        if not self._mob_blocked(m.x, nz, hw):
            _nh2 = termod.height(*termod.cell_of_world(m.x, nz))
            if _nh2 - _cur <= termod.STEP_JUMP:
                m.z = nz

    def _mob_wander(self, m, dt):
        """没目标时的漫游：过一会儿换个方向，慢慢挪 ✓"""
        m.wT -= dt
        if m.wT <= 0:
            m.wT = mobs.WANDER_EVERY * (0.6 + random.random() * 0.8)   # 别整齐划一 ✓
            a = random.random() * math.pi * 2
            m.wx = math.sin(a)
            m.wz = math.cos(a)
        sp = m.spd * mobs.WANDER_SPEED * dt
        self._move_mob(m, m.wx * sp, m.wz * sp)
        m.yaw = math.atan2(m.wx, m.wz)

    def _mob_separate(self, dt):
        """两只僵尸靠太近就慢慢推开 —— ★ 渐进推，不是瞬移（瞬移会看得一抖 ✗）

        60 只 → 1770 对/帧，30Hz 下也就几万次乘法，可以忽略 ✓
        （真到几百只再上空间网格，方案 §13.2 有现成的 SGrid 思路 ✓）
        """
        ms = [m for m in self.mobs.values() if m.hp > 0]
        sep = mobs.SEP_DIST
        sep2 = sep * sep
        lim = mobs.SEP_SPEED * dt
        for i in range(len(ms)):
            a = ms[i]
            for j in range(i + 1, len(ms)):
                b = ms[j]
                dx = b.x - a.x
                dz = b.z - a.z
                d2 = dx * dx + dz * dz
                if d2 >= sep2 or d2 < 1e-9:
                    continue
                d = math.sqrt(d2)
                push = min((sep - d) * 0.5, lim)
                if push <= 0:
                    continue
                ux = dx / d
                uz = dz / d
                a.x -= ux * push
                a.z -= uz * push
                b.x += ux * push
                b.z += uz * push

    def _evict_far(self):
        """僵尸满了 → 把"离所有玩家最远"的那只收掉，腾一个位置出来 ✓

        ★ 为什么需要这个（第 35 轮踩的坑）：
          原来的规则是"离所有玩家都超过 140 米才回收"。
          于是老玩家附近刷满 60 只之后，**新来的玩家周围一只都刷不出来** ✗
          （僵尸都堆在别人那边不动，上限却已经占满了）
          现在改成"满了就淘汰最远的" → 人口永远跟着玩家跑 ✓
        """
        if not self.players:
            return False
        worst, wd = None, -1.0
        for m in self.mobs.values():
            if m.hp <= 0:
                continue
            try:
                dmin = min((q.x - m.x) ** 2 + (q.z - m.z) ** 2 for q in self.players.values())
            except ValueError:
                return False
            if dmin > wd:
                wd = dmin
                worst = m
        if worst is None:
            return False
        self.mobs.pop(worst.mid, None)
        return True

    def _near_count(self, x, z, r):
        """这个点周围 r 米内有多少只活僵尸（每人上限 8 只要用 ✓）"""
        r2 = r * r
        n = 0
        for m in self.mobs.values():
            if m.hp > 0 and (m.x - x) ** 2 + (m.z - z) ** 2 <= r2:
                n += 1
        return n

    def _spawn_one(self, ps):
        """在一个随机玩家周围刷一只（等级按方案 §3.1 抽）

        ★ 每人上限（用户要求）：只在"周围还没到 8 只"的玩家附近刷 ✓
        """
        # ★★★ 第 131 轮修的真 bug（用户："每人 8 只上限，但多个玩家时还是 8 只"）★★★
        #   病根：原来是"数他 60 米内有几只"✗
        #         两个人站得近时，两个 60 米圈【几乎完全重叠】✗
        #         → A 周围 8 只，B 周围也是这 8 只 ✗
        #         → 结果两个人加起来还是 8 只 ✓✓ 用户描述一字不差 ✓
        #   修：改成【按归属算】—— 一只僵尸算谁的就看它离谁最近 ✓
        #       （两个人站一起 → 各分一半 ✓ 于是每人能各刷到 8 ✓ 总共 16 ✓）
        cand = [q for q in ps
                if self._owned_count(q) < self._cap_of(q)]   # ★ 第 133 轮：可调上限 ✓
        if not cand:
            return
        p = random.choice(cand)
        ang = random.random() * math.pi * 2
        dist = mobs.SPAWN_MIN + random.random() * (mobs.SPAWN_MAX - mobs.SPAWN_MIN)
        x = p.x + math.sin(ang) * dist
        z = p.z + math.cos(ang) * dist
        if x * x + z * z < SPAWN_SAFE * SPAWN_SAFE:
            return                       # 安全区里不刷（方案 §2.1 末日堡垒）✓
        # 组队时：以刷新点 SPAWN_TEAM_R 内【随机一个】队员的等级为准（§3.1）✓
        near = [q for q in ps if (q.x - x) ** 2 + (q.z - z) ** 2 <= mobs.SPAWN_TEAM_R ** 2]
        base = (random.choice(near) if near else p).role.get('level', 1) or 1
        self.mob_seq += 1
        _m = mobs.Mob(self.mob_seq, mobs.roll_level(base), x, z)
        # ★ 第 132 轮：打上【替谁刷的】标记 ✓（硬配额的依据 ✓）
        _m.owner = getattr(p, 'role_id', None)
        self.mobs[str(self.mob_seq)] = _m

    def _cap_of(self, q):
        """这个玩家的僵尸上限（第 133 轮）—— 单人覆盖优先，否则用全局值 ✓"""
        rid = getattr(q, 'role_id', None)
        v = self.mob_cap_of.get(rid)
        return int(v) if v is not None else int(self.mob_per_player)

    def _pvp_on(self, q):
        """这个人现在能不能参与 PVP（第 134 轮）—— 单人覆盖优先 ✓"""
        rid = getattr(q, 'role_id', None)
        v = self.pvp_of.get(rid)
        return bool(v) if v is not None else bool(self.pvp_all)

    def _mob_atk_on(self, q):
        """妖兽现在能不能打这个人（第 134 轮）—— 单人覆盖优先 ✓

        ★ 关掉之后：僵尸照样刷、照样追、照样围着你 ✗ 但咬不动你 ✓
          （这样比"关掉就不刷怪"更好用 ✓ 想安全看风景/截图时用 ✓）
        """
        rid = getattr(q, 'role_id', None)
        v = self.mob_atk_of.get(rid)
        return bool(v) if v is not None else bool(self.mob_atk_all)

    def _owned_count(self, q):
        """数"标记给他"的僵尸有几只（第 132 轮：硬配额 ✓）

        ★ 第 131 轮是"按距离算归属"✗ 有两个毛病：
            ① 软上限：替 A 刷的那只后来离 B 更近 → 归属变了 → A 可能超过 8 ✓
            ② 分配不均：僵尸追人跑 → 往一个人身边聚 → 别人刷不到 ✗
        ★ 现在改成【刷的时候就打标记】✓（Mob.owner = 那个玩家的 role_id ✓）
            · 每人严格 8 只 ✓ 谁都不会多也不会少 ✓
            · 而且更快：O(僵尸数) ✓ 不用再跟每个玩家比距离 ✗
        ★ 标记【不进协议】✗ 客户端不需要知道 ✓
        """
        rid = getattr(q, 'role_id', None)
        if rid is None:
            return 0
        n = 0
        for m in self.mobs.values():
            if m.owner == rid:
                n += 1
        return n

    def _evt_near(self, x, z, mtype, d, exclude=None):
        """给【附近】的人发一个可见事件（第 63 轮）

        ★ 为什么要"附近"而不是全体广播：远处的人根本不关心 ✗
          而且这样带宽也省 ✓（和兴趣管理一个思路 ✓）
        ★ 踩过的坑：P.pack 的第一个参数叫【mtype】不是 t ✗
          我一开始写成 P.pack(**{'t': 'evt', ...}) → TypeError → 事件根本没发出去 ✗
          （表现就是"别人看不到复活特效"，而且不报错、只静默失败 ✗）
        """
        v2 = mobs.MOB_VIEW * mobs.MOB_VIEW
        raw = P.pack(mtype, **d)
        for q in self.players.values():
            if q is exclude or q.cid == exclude:
                continue
            if (q.x - x) ** 2 + (q.z - z) ** 2 > v2:
                continue
            self._send_cid(q.cid, raw)

    def _find_player(self, name):
        """按名字找在线玩家（管理页用 ✓ 找不到返回 None）"""
        if not name:
            return None
        for q in self.players.values():
            if q.name == name:
                return q
        return None

    def _admin_tune_save(self):
        """把管理员改的开关排队存进 meta（第 216 轮用户要求）

        用户原话：刷怪上限和 PVP、妖兽伤害也是要保存的，
                  不要重启服务器后也恢复默认了
        ★ 为什么排队而不是直接写库：tick 线程不许碰磁盘（规矩 1）
          post_save 是入队给存档线程，和玩家存档同一个机制
        ★ 为什么打包成一条字典：以后再加管理员开关只改这一处
        """
        import json as _json
        try:
            blob = _json.dumps({
                'mob_cap': int(getattr(self, 'mob_cap', 0) or 0),
                'mob_cap_of': {str(k): int(v) for k, v in (getattr(self, 'mob_cap_of', {}) or {}).items()},
                'pvp_all': bool(getattr(self, 'pvp_all', False)),
                'pvp_of': {str(k): bool(v) for k, v in (getattr(self, 'pvp_of', {}) or {}).items()},
                'mob_atk_all': bool(getattr(self, 'mob_atk_all', True)),
                'mob_atk_of': {str(k): bool(v) for k, v in (getattr(self, 'mob_atk_of', {}) or {}).items()},
            }, ensure_ascii=False)
            self.post_save("INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)",
                           ('admin_tune', blob))
            print('[admin] 管理员设置已排队保存')
        except Exception as e:
            print('[admin] 管理员设置保存失败：%r' % (e,))

    def _admin_tune_check(self):
        """每约 2 秒比对一次指纹，变了就排队存

        ★ 为什么不写在 _handle_admin 里：那几个分支里有 return
          第一次就是这么失败的：接口返回 ok，库里啥也没有
        ★ 谁改的都能兜住：HTTP、命令行、以后加的任何入口
        """
        try:
            sig = (
                int(getattr(self, 'mob_cap', 0) or 0),
                tuple(sorted((k, int(v)) for k, v in (getattr(self, 'mob_cap_of', {}) or {}).items())),
                bool(getattr(self, 'pvp_all', False)),
                tuple(sorted((k, bool(v)) for k, v in (getattr(self, 'pvp_of', {}) or {}).items())),
                bool(getattr(self, 'mob_atk_all', True)),
                tuple(sorted((k, bool(v)) for k, v in (getattr(self, 'mob_atk_of', {}) or {}).items())),
            )
            # ★★★ 第 278 轮修的真 bug（用户："管理页面的设置不是说了要保存吗，
            #     为什么你重启服务器后又恢复默认了"）★★★
            #   病根：self._tune_sig 初值是 None ✗
            #     启动后第一次检查时 sig(默认值) != None ✗ 成立 ✓
            #     → 【立刻把默认值保存进数据库】✗✓
            #     → 如果这次启动没能从库里读回来（读失败/顺序不对 ✓）
            #       存档就被默认值覆盖了 ✗ 用户的设置就"恢复默认"了 ✓✓
            #   ★ 修：第一次检查【只记指纹 ✗ 不保存】✓
            #     这样"没读回来"最坏也只是本次用默认值 ✗ 不会毁掉存档 ✓
            if self._tune_sig is None:
                self._tune_sig = sig          # ★ 第一次：只初始化指纹 ✓ 不写库 ✓
                print('[admin] 管理员设置指纹已初始化（本次不写库 ✓ 避免默认值覆盖存档）')
            elif sig != self._tune_sig:
                self._tune_sig = sig
                self._admin_tune_save()
        except Exception as e:
            print('[admin] 管理员设置检查失败：%r' % (e,))

    def _handle_admin(self, act, d):
        """管理页的操作（第 48 轮）—— ★ 只有 tick 线程会进来 ✓

        ★ 管理页通过 HTTP 进来，但真正改世界状态的是这里（tick 线程）✓
          所以"只有 tick 线程碰世界"这条规矩没破 ✓
        """
        if act == 'notify':
            q = self._find_player(d.get('name'))
            if q is not None:
                self._send_cid(q.cid, P.pack('notice', text=str(d.get('text') or '')[:120]))
            return
        if act == 'say':
            txt = str(d.get('text') or '')[:80]
            if txt:
                # ★ 第 254 轮（用户要求）：管理公告改成走【弹幕】（全服滚动 ✓）
                #   原来是 notice（屏幕中间弹一下 ✗ 容易被错过 ✓）
                self._broadcast(P.pack('ticker', text='[管理] ' + txt, kind='sys'))
            return
        # ★★ 第 133 轮：调整刷怪上限（用户要求）★★
        #   ★ 这一支【不需要 name】✗（全局设置人人可用 ✓）
        #     所以必须放在下面那个"先找人、找不到就 return"之前 ✗
        # ★★ 第 134 轮：PVP 开关 / 妖兽伤害开关（全人 + 单人）★★
        #   和 mobcap 一样：不需要名字就是全局 ✗ 所以放在"先找人"之前 ✓
        if act in ('pvp', 'mobatk'):
            who = str(d.get('name') or '').strip()
            on = 1 if d.get('on') else 0
            if act == 'pvp':
                tab, gall, gname = self.pvp_of, 'pvp_all', 'PVP'
            else:
                tab, gall, gname = self.mob_atk_of, 'mob_atk_all', '妖兽伤害'
            if who:
                q = self._find_player(who)
                if q is None:
                    return
                rid = getattr(q, 'role_id', None)
                if d.get('clear'):
                    tab.pop(rid, None)
                    self._send_cid(q.cid, P.pack('notice',
                        text='管理员取消了你的【%s】单独设置' % gname))
                else:
                    tab[rid] = bool(on)
                    self._send_cid(q.cid, P.pack('notice',
                        text='管理员把你的【%s】设成了%s' % (gname, '开' if on else '关')))
            else:
                setattr(self, gall, bool(on))
                self._broadcast(P.pack('notice',
                    text='[管理] 【%s】已全服%s' % (gname, '开启' if on else '关闭')))
            return
        # ★ 第 139 轮：管理员"看某人实时状态"（只读 ✓ 不改任何东西 ✓）
        #   为什么需要：用户报"只有某个角色打不到/被打死卡住"✗
        #     光看数据库看不出问题 ✗（数据库的 hp 和内存里的不是一回事 ✓）
        #     必须能看到【tick 线程里那个 Player 的真实状态】✓
        if act == 'who':
            q = self._find_player(str(d.get('name') or ''))
            if q is None:
                self._send_cid_who = None
                return
            near = 0
            for m in self.mobs.values():
                if m.hp <= 0:
                    continue
                if (m.x - q.x) ** 2 + (m.z - q.z) ** 2 <= 60.0 * 60.0:
                    near += 1
            rid = getattr(q, 'role_id', None)
            self.lobby_stat = self.lobby_stat or {}
            self.who_dump = {
                'name': q.name, 'role_id': rid,
                'hp': int(q.hp or 0), 'hp_max': self._hp_max(q),
                'invulnT': round(float(getattr(q, 'invulnT', 0) or 0), 2),
                'is_dead_in_world': int(q.hp or 0) <= 0,
                'x': round(q.x, 1), 'z': round(q.z, 1),
                'pvp': self._pvp_on(q), 'mob_atk': self._mob_atk_on(q),
                'mob_cap': self._cap_of(q),
                'owned_mobs': self._owned_count(q), 'near_mobs_60m': near,
                'overrides': {'pvp': rid in self.pvp_of, 'mobatk': rid in self.mob_atk_of,
                              'cap': rid in self.mob_cap_of},
                'talents': dict(self.tal.get(q.role_id, {}) or {}) if False else dict(getattr(q, 'tal', {}) or {}),
                'armor': (q.armor or {}).get('name'),
                # ★ 第 155 轮：排障用 —— 魔气在【内存里】到底是多少 ✓
                'mq': int(q.mq or 0), 'mqAt': int(q.mqAt or 0),
                'weapon': (q.weapon or {}).get('name'),
                'last_hurt_at': round(float(getattr(q, 'lastHurtT', 0) or 0), 1),
            }
            return
        # ★★ 第 153 轮：魔气配置（用户要求"加到管理页面"）★★
        #   ★ 和 mobcap 一样：全局设置不需要名字 ✗ 所以放在"先找人"之前 ✓
        if act == 'mqcfg':
            # ★ 第 158 轮：改配置 + 落库的活【全在 HTTP 层做完了】
            #   这里只负责广播一句提示（只有 tick 线程能广播）
            if d.get('done'):
                self._broadcast(P.pack(
                    'notice', text='[管理] 魔气配置已更新并保存（重启也在）'))
            return
        # ★ 单人魔气调整（测试用：直接给 500 就能看头顶最深档 ✓）
        if act == 'mqset':
            # ★ 第 154 轮：库已经由 HTTP 层写好了 ✓
            #   这里只负责【改在线玩家的内存值】+ 推给他 ✓
            #   （★ 千万别再写库 ✗ 两处都写就会出现"谁后写谁赢"✗ 最难查 ✓）
            q = self._find_player(str(d.get('name') or ''))
            if q is None:
                return                        # 离线：库已经改了 ✓ 他下次登录就是新值 ✓
            if d.get('exact'):
                q.mq = max(0, min(int(mqmod.cfg('mq_max', mqmod.MQ_MAX)), int(d.get('v') or 0)))
            elif d.get('clear'):
                q.mq = 0
            elif d.get('add') is not None:
                q.mq = max(0, min(int(mqmod.cfg('mq_max', mqmod.MQ_MAX)),
                                  int(q.mq or 0) + int(d.get('add') or 0)))
            else:
                q.mq = max(0, min(int(mqmod.cfg('mq_max', mqmod.MQ_MAX)), int(d.get('v') or 0)))
            # ★★ 第 155 轮修的真 bug：这里原来写的是 dbmod.now_ms() ✗
            #   而 world.py 里【没有导入 dbmod】✗（那是 app.py 的东西 ✗）
            #   → NameError → 而 tick 派发那边把异常吞了 ✗
            #   → 表现就是【接口返回 200、但魔气根本没变】✗✓
            #     （用户报的就是这个 ✓ 这种最难查 ✗）
            #   ★ 改用 world.py 自己就有的 now_s() → 毫秒 ✓
            #     （第 149 轮 net.py 用 dbmod.now_ms() 存的 ✓ 两边单位必须一致 ✗）
            q.mqAt = int(now_s() * 1000)
            self._send_cid(q.cid, P.pack('mq', v=int(q.mq or 0)))   # ★ 客户端立刻刷新 ✓
            self._send_cid(q.cid, P.pack(
                'notice', text='管理员把你的魔气值设成了 %d' % int(q.mq or 0)))
            return
        if act == 'mobcap':
            who = str(d.get('name') or '').strip()
            if 'per' in d and d.get('per') is not None:
                v = max(1, min(30, int(d.get('per'))))
                if who:
                    q = self._find_player(who)
                    if q is None:
                        return
                    self.mob_cap_of[getattr(q, 'role_id', None)] = v
                    self._send_cid(q.cid, P.pack('notice',
                        text='管理员把你的僵尸上限调成了 %d 只' % v))
                else:
                    self.mob_per_player = v
                    self._broadcast(P.pack('notice',
                        text='[管理] 每人僵尸上限改为 %d 只' % v))
            if 'cap' in d and d.get('cap') is not None and not who:
                self.mob_cap = max(1, min(300, int(d.get('cap'))))
            if 'interval' in d and d.get('interval') is not None and not who:
                self.spawn_interval = max(0.2, min(30.0, float(d.get('interval'))))
            if 'clearOne' in d and who:
                q = self._find_player(who)
                if q is not None:
                    self.mob_cap_of.pop(getattr(q, 'role_id', None), None)
            return
        q = self._find_player(d.get('name'))
        if q is None:
            return
        if act == 'spawn':
            n = max(0, min(int(d.get('n') or 5), mobs.MOB_CAP))
            self._debug_spawn(q, n, bool(d.get('clear')), d.get('kind') or None, d.get('lv'))
            if n:
                self._send_cid(q.cid, P.pack('notice',
                                             text='管理员在你附近放了 %d 只僵尸' % n))
        # ★ give 不在这里做 —— 它是【写库】，放在 HTTP 层（离线玩家也能收到 ✓）
        #   见 app.py 的 _admin_give()
        elif act == 'kick':
            self._send_cid(q.cid, P.pack('kick', code='admin', msg='管理员把你请下线了'))
        elif act == 'kill':
            # ★ 第 57 轮：管理页把某个玩家打倒（测试死亡/复活/同步用 ✓）
            q.hp = 0
            self._add_pend(q.cid, 'hurts', {'dmg': 0, 'x': round(q.x, 2), 'z': round(q.z, 2),
                                            'by': '管理员', 'kind': 'admin'})
            self._send_cid(q.cid, P.pack('dead', by='管理员'))
        elif act == 'heal':
            q.hp = self._hp_max(q)     # 满血（★ 第 67 轮：含防具加成 ✓）
            self._send_cid(q.cid, P.pack('notice', text='管理员把你治好了'))

    def _debug_spawn(self, p, n, clear, kind=None, lv=None):
        """调试：在我附近直接刷 n 只 / 清空（不做安全区判断 —— 就是要能立刻试 ✓）

        ★ 第 46 轮加了 kind：可以指定职业（不指定就随机 ✓）
          为什么需要：验证"医生的治疗"这类【按职业】的行为时，
          随机刷可能刷半天刷不出医生 ✗ 测试和调试都不该靠运气 ✓
        """
        if clear:
            self.mobs.clear()
            return
        n = max(0, min(int(n), mobs.MOB_CAP))
        for _ in range(n):
            # ★ 调试刷怪不受上限"挡住"：满了就淘汰最远的那只腾位置 ✓
            #   （以前这里是 break → 上限被远处的僵尸占满时，调试按钮点了没反应 ✗）
            if len(self.mobs) >= mobs.MOB_CAP and not self._evict_far():
                break
            ang = random.random() * math.pi * 2
            dist = 3.0 + random.random() * 6.0
            self.mob_seq += 1
            # ★ 第 46 轮加了 lv：可以指定等级（不指定就按玩家等级随机 ✓）
            #   为什么需要：验证"打残 → 医生回血"时，怪的血量必须落在
            #   【一刀打不死、但能打到 85% 以下】那个区间里 —— 随机刷做不到 ✓
            _lv = int(lv) if lv else mobs.roll_level(p.role.get('level', 1) or 1)
            self.mobs[str(self.mob_seq)] = mobs.Mob(
                self.mob_seq, _lv, p.x + math.sin(ang) * dist, p.z + math.cos(ang) * dist,
                kind=kind)

    def _hp_max_hint(self, role):
        """给 HTTP 线程用的血量上限估算（第 102 轮）

        ★ 为什么不直接调 _hp_max()：那要一个 Player 对象 ✗
          而 Player 是 tick 线程的东西 ✗ HTTP 线程不许碰 ✓
        → 这里只按【角色基础 + 数据库里那件防具】算 ✓ 够用 ✓
        """
        try:
            import mobs as _mobs1
            # ★ 第 225 轮：按等级算（和 tick 线程的 _hp_max 口径一致 ✓）
            base = int(_mobs1.level_hp((role or {}).get('level') or 1))
            import auth as _auth
            ar = _auth.armor_of(self.cfg if hasattr(self, 'cfg') else None, role.get('id'))
            st = armormod.stats_of((ar[0] if ar else None))
            return max(1, int(round((base + st['hp']) * (1.0 + st['hp_pct'] / 100.0))))
        except Exception:
            import mobs as _mobs2
            return int(_mobs2.level_hp((role or {}).get('level') or 1))

    def _hp_max(self, p):
        """生命上限（角色基础 + 防具的 hp / hp%% ✓ 第 67 轮）

        ★ 一定要【一处算、处处用】✗
          以前 hpMax 散在好几处（role['hpMax'] or 200 ✗）
          加了防具之后再散着写，迟早出现"治疗治不满 / 复活半血"✗
        """
        # ★★★ 第 225 轮（用户："玩家成长生命值是不是忘记做了"）★★★
        #   原来这里是 int(role['hpMax'] or 200) —— 建号写死的 200 ✗
        #   → 血量【完全不随等级成长】✗（方案 §4.5 要求 100 + 22L + 0.6L²）
        #   → 63 级只有 249 血，而同级僵尸一口 403 → 一口就死 ✓
        #   ★ 现在按等级算 ✓ 老角色不用迁移 ✗ 下次登录自动就对了 ✓
        #   ★ 顺序保持不变：等级血 + 防具血 → 乘防具 hp% → 再加天赋血 ✓
        #     （方案 §5 第 3 条特意写了：天赋要加在百分比【之后】✓ 免得被二次放大 ✓）
        import mobs as _mobs
        base = int(_mobs.level_hp((p.role or {}).get('level') or 1))
        # ★ 第 232 轮：坏掉的防具不提供任何加成 ✗（不然"坏了还加血"很怪 ✓）
        _ar = p.armor
        if isinstance(_ar, dict) and _ar.get('broken'):
            _ar = None
        st = armormod.stats_of(_ar)
        v = (base + st['hp']) * (1.0 + st['hp_pct'] / 100.0)
        # ★★ 第 117 轮（方案第 4 步）：天赋血量加进来 ★★
        #   ★ 故意加在【百分比之后】✗ 免得被防具的 hp% 二次放大 ✓
        #     （方案 §5 第 3 条特意写了这一句 ✓）
        v += float((p.talRaw or {}).get('hp') or 0.0)
        return max(1, int(round(v)))

    # ================= round293: gold =================
    GOLD_CAP = 1000000000
    GOLD_PER_BULLION = 100000000

    # ================= round304b: exchange (tick-side, memory-authoritative) =================

    def _mkt_player(self, role_id):
        """按角色找【在线且不是幽灵】的会话（金币/背包都挂在它身上 ✓）"""
        try:
            rid = int(role_id)
        except Exception:
            return None
        for q in self.players.values():
            if (getattr(q, 'role_id', None) == rid
                    and getattr(q, 'ghostAt', None) is None):
                return q
        return None

    def _mkt_send(self, p, ok, msg='', **kw):
        """交易所统一回执：★ 文案一律服务器写 ✗ 客户端不许自己编 ✓（方案 v1 §5）"""
        d = {'ok': bool(ok), 'msg': str(msg or '')}
        for k, v in kw.items():
            if v is not None:
                d[k] = v
        self._send_cid(p.cid, P.pack('listres', **d))

    def _mkt_bag_room(self, p):
        """还能不能往背包里塞东西（★ 上架退回 / 购买前都要看 ✓）

        ★★ round304t：用户报"用另一个号购买显示背包满了"★★
          原来两处各写一遍同一句判断 ✗ 提示只写"满了"✓
          现在收成一个函数 ✗ 并把【当前行数 / 上限】写进提示 ✓
            · 玩家一眼能看出是真满还是卡了 ✓
            · 排查时也不用再猜"它算的到底是哪个数"✓
        ★ 判据是【行数】（材料合堆后一行一堆 ✗ 装备一件一行 ✓）
          行数才是内存和查询的真实开销 ✓
        """
        n = len(p.role.get('bag') or [])
        if n >= MKT_BAG_MAX:
            return False, ('背包满了（%d / %d 行）✗ 先卖掉或用掉一些'
                           % (n, MKT_BAG_MAX))
        return True, ''

    def _mkt_load(self, role_id, rows, replace=False):
        """把（网络线程读好的）货架装进内存（★ tick 只装配 ✗ 一步都不查库 ✓）

        role_id : 是谁在装载（只在 replace=False 时用来筛"他自己的单"✓）
        rows    : auth.market_rows_of() 读出来的行 ✓
        replace : round304c ★ 全量替换（打开交易所时用 ✓）
                  False = 登录时那条老路（只补自己的 ✗ 不动已有的 ✓）
        """
        n = 0
        seen = set()
        now = now_s()
        if replace:
            # ★ 全量替换：先清空 ✗ 但【正在上架中的占位行】不能丢 ✓
            #   （那些行是负数 lid ✗ 库里还没有它们 ✓ 清掉就等于玩家白点了一下 ✓）
            keep = {l: r for l, r in self.mkt['by_lid'].items() if int(l) < 0}
            for l in list(self.mkt['by_lid'].keys()):
                if int(l) >= 0:
                    mkmod.drop(self.mkt, l)
            for l, r in keep.items():
                mkmod.add(self.mkt, r)
        for row in mkmod.load_rows(rows):
            if int(row.get('lid') or 0) < 0:
                # ★ 负数 lid 是【内存占位】（正在上架 ✗ 还没落库 ✓）不入内存 ✓
                continue
            if not replace and int(row.get('seller') or 0) != int(role_id):
                # 登录那条老路只认自己的（★ 默认现在是全量读 ✗ 所以这个分支少走 ✓）
                continue
            if float(row.get('exp') or 0) <= now:
                # ★ 已经过期的：不进内存 ✗ 直接排一条"退回过期"✓
                self.post_save(('MKT', 'exp', {'lid': int(row['lid']),
                                               'seller': int(row.get('seller') or 0)}))
                continue
            mkmod.add(self.mkt, row)
            seen.add(int(row['lid']))
            n += 1
        if n or replace:
            print('[mkt] %s loaded %d listing(s), shelf now %d'
                  % ('reload' if replace else ('role %s' % role_id), n,
                     len(self.mkt['by_lid'])))

    def _mkt_open_fresh(self, p, d):
        """round304c：打开交易所 = 网络线程刚读了库 ✗ 这里只装配 + 回第一页 ✓"""
        try:
            bag = d.get('bag')
            if isinstance(bag, list):
                # ★ 背包快照刷新（方案 §9 那条"刚捡的东西挂不上去"的解药 ✓）
                p.role['bag'] = bag
        except Exception as e:
            print('[mkt] bag refresh failed: %r' % (e,))
        try:
            self._mkt_load(p.role_id, d.get('rows') or [], replace=True)
        except Exception as e:
            print('[mkt] reload failed: %r' % (e,))
        self._mkt_browse(p, d.get('req') or {})
        # ★ 顺手把"我的上架"也给一份：面板上"我的上架 N/10"那个角标要立刻有数 ✓
        self._mkt_mine(p)

    @staticmethod
    def _mkt_exp_s(row):
        """内存行里的到期时刻 → 秒（★ 换算口只有一处 ✗ 在 market.exp_s ✓）"""
        return mkmod.exp_s(row)

    @staticmethod
    def _mkt_ts_s(row):
        """同上：内存行里的上架时刻 → 秒（★ 同一套判据 ✗ 一起归一化 ✓）"""
        return mkmod.exp_s({'exp': row.get('ts')})

    def _mkt_rows_of(self, mkt, seller, now=None):
        """我的上架（含过期待领取的 ✓ 方案 §9 第二条 ✓）"""
        now = now_s() if now is None else now
        out = []
        n_on = 0
        for row in mkt['by_lid'].values():
            if int(row.get('seller') or 0) != int(seller):
                continue
            exp = self._mkt_exp_s(row)
            state = 'on' if exp > now else 'expired'
            if state == 'on':
                n_on += 1
            out.append({'state': state, 'row': row})
        out.sort(key=lambda x: -self._mkt_ts_s(x['row']))
        return out, n_on

    def _mkt_mine(self, p):
        """推"我的上架"给本人（★ 一页 20 条够用 ✗ 每人最多 10 件 ✓）"""
        rows, n_on = self._mkt_rows_of(self.mkt, p.role_id)
        body = []
        _now = now_s()
        for x in rows[:20]:
            r = x['row']
            _exp = self._mkt_exp_s(r)          # ★ 一律先归一化成秒 ✓
            body.append({'lid': int(r['lid']), 'price': int(r['price']),
                         'tier': int(r['tier']), 'lv': int(r['lv']),
                         'name': r['name'], 'state': x['state'],
                         # ★ left 单位 = 【秒】（和列表页同一个口径 ✓）
                         'left': int(max(0, _exp - _now)),
                         # ★ exp 给的是【毫秒】（★ 客户端拿它直接和 Date.now() 比 ✓）
                         #   为什么这里给毫秒：JS 那边 Date.now() 就是毫秒 ✗
                         #   让它自己去 /1000 就是又造一个单位混用的机会 ✓
                         'exp': int(_exp * 1000),
                         'tax': mkmod.tax_of(r['price']),
                         'net': mkmod.net_of(r['price']),
                         'it': r['it']})
        self._send_cid(p.cid, P.pack('listpage', rows=body, page=1, pages=1,
                                     total=len(rows), mine=1, on=n_on,
                                     max=int(valuemod.MKT_MAX_PER_PLAYER),
                                     gold=int(getattr(p, 'gold', 0) or 0)))

    def _mkt_browse(self, p, d):
        """浏览货架（★ 纯内存 ✗ 一步也不查库 ✓ 方案 §9 最后一条 ✓）"""
        cat = str(d.get('cat') or 'all')
        if cat not in ('all',) + tuple(valuemod.CAT_ORDER):
            cat = 'all'
        sort = str(d.get('sort') or 'price')
        if sort not in ('price', 'price_desc', 'new', 'tier', 'tier_desc'):
            sort = 'price'
        try:
            page = int(d.get('page') or 1)
        except Exception:
            page = 1
        # 阶数筛选：客户端传 1~3 / 4~6 / 7~9 这样的档 ✗ 这里换算成区间 ✓
        lo = hi = None
        try:
            tb = int(d.get('tier') or 0)
        except Exception:
            tb = 0
        if tb == 1:
            lo, hi = 0, 2      # ★ 材料是 0 阶 ✗ 归进"1-3 阶"这档才找得到 ✓
        elif tb == 2:
            lo, hi = 3, 5
        elif tb == 3:
            lo, hi = 6, 99
        afford = None
        if d.get('afford'):
            afford = int(getattr(p, 'gold', 0) or 0)
        res = mkmod.browse(self.mkt, cat=cat, q=str(d.get('q') or ''),
                           tier_lo=lo, tier_hi=hi, afford=afford,
                           sort=sort, page=page)
        self._send_cid(p.cid, P.pack(
            'listpage', rows=mkmod.pub_rows(res['rows']), page=res['page'],
            pages=res['pages'], total=res['total'],
            gold=int(getattr(p, 'gold', 0) or 0),
            pageSize=int(valuemod.MKT_PAGE)))

    def _mkt_open(self, p, d):
        """客户端打开交易所：一次给齐（余额 + 我的上架 + 第一页商品 ✓）"""
        op = str(d.get('op') or 'all')
        if op == 'mine':
            self._mkt_mine(p)
            return
        self._mkt_browse(p, d)

    def _mkt_list(self, p, d):
        """上架（★ 先查余额 ✗ 再扣上架费 ✗ 再入内存 ✗ 落库 ✗ 回滚兜底 ✓）"""
        try:
            iid = int(d.get('iid'))
        except Exception:
            return self._mkt_send(p, False, '参数不对')
        okp, price = mkmod.price_ok(d.get('price'))
        if not okp:
            return self._mkt_send(p, False, price)
        rec = None
        for x in (p.role.get('bag') or []):
            try:
                if int(x.get('id')) == iid:
                    rec = x
                    break
            except Exception:
                continue
        if rec is None:
            return self._mkt_send(p, False, '背包里没有这件东西（刷新一下再看看）')
        it = rec.get('item') or {}
        if not isinstance(it, dict) or not it.get('name'):
            return self._mkt_send(p, False, '这件东西不能上架')
        if rec.get('lock') or it.get('locked_by') or it.get('locked'):
            return self._mkt_send(p, False, '这件东西正在上架中')
        key = (int(p.role_id), iid)
        if key in self.mkt_locking:
            return self._mkt_send(p, False, '正在上架，稍等一下')
        # ★★ 这一件是不是【已经挂在货架上了】（自测抓到的那条路 ✓）★★
        #   为什么非要显式查一遍：role['bag'] 快照是打开交易所那一刻的副本 ✗
        #     它不跟着背包刷新 ✓ 所以"同一件挂两次"用背包根本拦不住 ✓
        #     （上架时存的就是【同一份 item_json】✗ 所以拿字典相等来认领位最准 ✓
        #      用 lid == -iid 认领位 ✗ 落库换过 lid 之后就认不出来了 ✓）
        try:
            for _r in self.mkt['by_lid'].values():
                if (int(_r.get('seller') or 0) == int(p.role_id)
                        and (_r.get('it') or {}) == it):
                    return self._mkt_send(p, False, '这件东西已经挂在货架上了')
        except Exception:
            pass
        try:
            n_on = mkmod.count_of(self.mkt, p.role_id)
        except Exception:
            n_on = 0
        n_on += sum(1 for k in self.mkt_locking if k[0] == int(p.role_id))
        if n_on >= int(valuemod.MKT_MAX_PER_PLAYER):
            return self._mkt_send(p, False, '最多同时上架 %d 件' % valuemod.MKT_MAX_PER_PLAYER)
        if len(self.mkt['by_lid']) + len(self.mkt_locking) >= MKT_ROW_MAX:
            return self._mkt_send(p, False, '货架满了，过一会儿再试')
        bal = int(getattr(p, 'gold', 0) or 0)
        fee = mkmod.fee_of(bal, price)
        if fee > 0 and bal < fee:
            return self._mkt_send(p, False,
                                  '上架费 %d 金币，你的余额不够' % fee)
        # ★★★ round304l（用户："上架时，如果是堆叠的物品，可以拉动数量条选择数量上架"）★★★
        #   · 装备（有 slot）→ 只能 1 件（它本来就不堆叠 ✓）
        #   · 材料/黄金（没 slot）→ 1 ~ 背包里那一堆的数量 ✓
        #   ★ 单价的校验在 mkmod.price_ok 里做过了 ✗ 这里管【数量 × 单价】✓
        stack = max(1, int(rec.get('stack') or 1))
        can_stack = mkmod.is_stack(it)
        try:
            qty = int(d.get('qty') or 1)
        except Exception:
            qty = 1
        if not can_stack:
            qty = 1
        if qty < 1:
            qty = 1
        if qty > stack:
            return self._mkt_send(p, False, '你只有 %d 个（选了 %d）' % (stack, qty))
        total = int(price) * int(qty)
        if total > int(valuemod.MKT_PRICE_MAX):
            return self._mkt_send(p, False, '总价超出上限（单价 × 数量）')
        if fee > 0:
            self._gain_gold(p, -fee, 'mkt_fee')
        self.mkt_locking.add(key)
        # ★ 乐观入货架：lid 先用【负数占位】（-iid ✗ 一定不会和真 lid 撞 ✓）
        #   真正落库之后 saver 会把真 lid 回灌 ✗ 那时再换掉这一行 ✓
        #   为什么不等落库再入：等的这段时间里货架上没有它 ✗
        #   而玩家可能已经在"我的上架"里找它了 ✓（体验 ✗ 不是正确性 ✓）
        lid_tmp = -iid
        try:
            _t0 = valuemod.now_s()
            # ★ round304q：把"原来那件物品的 id"记进这一行 ✗ 发给客户端 ✓
            #   （it 是物品本身 ✗ 不该污染它 → 行里单独存一份 ✓）
            _row = mkmod.row_of(lid_tmp, p.role_id, int(price), it, _t0,
                                _t0 + int(valuemod.MKT_DAYS) * 86400,
                                int(stack), int(qty), int(iid))
            mkmod.add(self.mkt, _row)
        except Exception as e:
            print('[mkt] optimistic add failed: %r' % (e,))
        self.post_save(('MKT', 'list', {'sid': str(d.get('sid') or ''),
                                        'seller': int(p.role_id), 'iid': int(iid),
                                        'price': int(price), 'fee': int(fee),
                                        'qty': int(qty), 'stack': int(stack),
                                        'it': it, 'lid_tmp': lid_tmp}))
        # ★ 回执先回"处理中"✗ 真回执等落库（几百毫秒 ✗ 免得说成功了其实没成 ✓）
        _qtxt = (' ×%d' % qty) if qty > 1 else ''
        self._mkt_send(p, True,
                       '正在上架【%s】%s（%s 金币 ✗ 上架费 %d）…'
                       % (it.get('name'), _qtxt,
                          ('单价 %d × %d = %d' % (price, qty, total)) if qty > 1
                          else ('%d' % price), fee),
                       lid=None, gold=int(getattr(p, 'gold', 0) or 0),
                       name=str(it.get('name') or ''), price=int(price))

    def _mkt_fail(self, p, msg, refund=0):
        """落库失败的回滚（★ 钱是在内存里扣的 ✗ 必须退回 ✓ 方案 §6 ✓）"""
        if p is None:
            return
        if refund:
            self._gain_gold(p, int(refund), 'mkt_fee_back')
        self._mkt_send(p, False, msg, gold=int(getattr(p, 'gold', 0) or 0))

    def _mkt_unlist(self, p, d):
        """下架（★ 上架费不退 ✗ 东西原样回背包 ✓ 方案 v2 ✓）"""
        try:
            lid = int(d.get('lid'))
        except Exception:
            return self._mkt_send(p, False, '参数不对')
        row = self.mkt['by_lid'].get(lid)
        if row is None:
            return self._mkt_send(p, False, '这件商品已经不在了（刷新一下）')
        if int(row.get('seller') or 0) != int(p.role_id):
            return self._mkt_send(p, False, '这不是你的上架')
        expired = float(row.get('exp') or 0) <= now_s()
        mkmod.drop(self.mkt, lid)
        # ★ 文案必须在【投给 saver 的那条】里就带上 ✓
        #   落库回执是 drain 用的 ✗ 它拿不到这里的局部变量 ✓
        #   （自测抓到的第 8 个坑：不带 msg → 界面显示成兜底的"操作完成"✓）
        _msg = ('【%s】过期了，已退回背包' if expired else '已下架：%s 退回背包') % row.get('name')
        self.post_save(('MKT', 'unlist', {'lid': int(lid),
                                          'seller': int(p.role_id),
                                          'expired': 1 if expired else 0,
                                          'msg': _msg,
                                          'it': row.get('it') or {},
                                          'stack': int(row.get('stack') or 1)}))
        # ★★ 这里【不回执】✗ 让落库那条回执来说话 ✓
        #   为什么：回执一定要唯一 ✗ 回两条客户端会当成两次操作 ✓
        #   （自测抓到的第 9 个坑：这一条 + drain 那条 = 两条一模一样的 listres ✓）
        #   ★ 好处还顺带把"落库失败"说清楚 ✗ 不会先说成功再改口 ✓

    def _mkt_claim(self, p, d):
        """领取（★ 落库失败时东西还在货架上 ✗ 清出空位后点这个拿回来 ✓ 方案 §9 ✓）"""
        try:
            lid = int(d.get('lid'))
        except Exception:
            return self._mkt_send(p, False, '参数不对')
        row = self.mkt['by_lid'].get(lid)
        if row is None:
            return self._mkt_send(p, False, '这件商品已经不在了（刷新一下）')
        if int(row.get('seller') or 0) != int(p.role_id):
            return self._mkt_send(p, False, '这不是你的上架')
        if float(row.get('exp') or 0) > now_s():
            return self._mkt_send(p, False, '还在上架中，先下架再领')
        _ok, _why = self._mkt_bag_room(p)
        if not _ok:
            return self._mkt_send(p, False, _why)
        mkmod.drop(self.mkt, lid)
        self.post_save(('MKT', 'unlist', {'lid': int(lid),
                                          'seller': int(p.role_id),
                                          'expired': 1,
                                          'msg': '已取回：%s' % row.get('name'),
                                          'it': row.get('it') or {},
                                          'stack': int(row.get('stack') or 1)}))
        # ★ 同上：回执只由落库那条发（★ 唯一 ✗ 见 _mkt_unlist 的注释 ✓）

    def _mkt_buy(self, p, d):
        """购买（★ 校验+扣钱在同一拍 ✗ 交货和卖家到账等落库成功 ✓）"""
        try:
            lid = int(d.get('lid'))
        except Exception:
            return self._mkt_send(p, False, '参数不对')
        row = self.mkt['by_lid'].get(lid)
        if row is None:
            return self._mkt_send(p, False, '这件商品已经不在了（刷新一下）')
        if float(row.get('exp') or 0) <= now_s():
            return self._mkt_send(p, False, '这件商品已过期')
        if int(row.get('seller') or 0) == int(p.role_id):
            return self._mkt_send(p, False, '这是你自己的上架')
        # 重复点击 / 网络重发：同一个 sid 直接回"处理中"（真正的幂等在落库那一层 ✓）
        if str(d.get('sid') or ''):
            if lid in self.mkt_sids.get(str(d['sid']), ()):
                return self._mkt_send(p, False, '这笔交易正在处理，别重复点')
        # ★★★ round304l（用户："购买时也是一样拖动数量选择数量购买"）★★★
        unit = int(row['price'])                     # ★ 单价
        avail = max(1, int(row.get('qty') or 1))     # ★ 货架上还剩几个
        try:
            qty = int(d.get('qty') or 1)
        except Exception:
            qty = 1
        if qty < 1:
            qty = 1
        if qty > avail:
            return self._mkt_send(p, False, '货架上只剩 %d 个（你选了 %d）' % (avail, qty))
        # ★ 可堆叠的才允许一次买多个 ✗ 装备永远 1 件 ✓
        if not mkmod.is_stack(row.get('it') or {}):
            qty = 1
        price = unit * qty                          # ★ 这一笔的总价
        if int(getattr(p, 'gold', 0) or 0) < price:
            return self._mkt_send(p, False, '金币不够（要 %d ✗ 你有 %d）'
                                  % (price, int(getattr(p, 'gold', 0) or 0)))
        _ok, _why = self._mkt_bag_room(p)
        if not _ok:
            return self._mkt_send(p, False, _why)
        applied = self._gain_gold(p, -price, 'mkt_buy')
        if applied != -price:
            if applied:
                self._gain_gold(p, -applied, 'mkt_buy_back')
            return self._mkt_send(p, False, '金币不够')
        seller = self._mkt_player(row.get('seller'))
        tax = mkmod.tax_of(price)
        net = mkmod.net_of(price)      # ★ 卖家到手（落库回执要用 ✗ 自测抓到漏了这个 ✓）
        # 内存里先扣数量 ✗ 免得两个人同一拍买同一批 ✓（落库失败会由 _mkt_drain 退回钱 ✓）
        #   ★ 买完才 drop ✗ 买一半要留着继续卖 ✓
        row['qty'] = avail - qty
        if int(row['qty']) <= 0:
            mkmod.drop(self.mkt, lid)
        if str(d.get('sid') or ''):
            self._mkt_sid_note(str(d['sid']), lid)
        self.post_save(('MKT', 'buy', {'sid': str(d.get('sid') or ''),
                                       'lid': int(lid),
                                       'buyer': int(p.role_id),
                                       'reply': int(p.role_id),
                                       'seller': int(row.get('seller') or 0),
                                       'price': price, 'unit': unit, 'qty': qty,
                                       'tax': tax, 'net': net,
                                       'seller_online': 1 if seller is not None else 0,
                                       'it': row.get('it') or {},
                                       'stack': int(row.get('stack') or 1)}))
        # ★ 卖家到账【不在这里做】✗ 在落库成功之后（_mkt_drain ✓）
        #   为什么：万一落库失败 ✗ 卖家已经拿到钱 ✗ 买家又全额退回 ✓ = 凭空多钱 ✓✓
        #   ★ 买家这一半是安全的：扣钱和校验在【同一拍】✗ 失败全额退 ✓
        self._mkt_send(p, True, '正在购买【%s】%s（%s）…'
                       % (row.get('name'),
                          (' ×%d' % qty) if qty > 1 else '',
                          ('单价 %d × %d = %d 金币' % (unit, qty, price)) if qty > 1
                          else ('%d 金币' % price)),
                       lid=int(lid), kind='buy', gold=int(getattr(p, 'gold', 0) or 0),
                       name=str(row.get('name') or ''), price=price)

    def _mkt_offline_pay(self, seller_id, amount):
        """离线卖家的钱 → 走 pending_gold（★ 上线时自动入账 ✗ 不绕过上限 ✓ 方案 §3 ✓）"""
        try:
            if int(amount) <= 0:
                return
            import db as dbmod
            self.post_save(
                'INSERT INTO pending_gold(role, amount, why, ts, done)'
                ' VALUES(?,?,?,?,0)',
                (int(seller_id), int(amount), 'trade_sell', dbmod.now_ms()))
        except Exception as e:
            print('[mkt] offline pay failed: %r' % (e,))

    def _mkt_sid_note(self, sid, lid):
        """记一笔"这个 sid 正在处理哪一件"（防连点 ✗ 只记最近 50 条 ✓）"""
        try:
            lst = self.mkt_sids.setdefault(str(sid), [])
            lst.append(int(lid))
            if len(self.mkt_sids) > 50:
                for k in list(self.mkt_sids.keys())[:-40]:
                    self.mkt_sids.pop(k, None)
        except Exception:
            pass

    def _mkt_sweep(self):
        """过期回收（★ 只动内存 + 投一条 UPDATE ✗ tick 不碰磁盘 ✓ 方案 §9 ✓）"""
        now = now_s()
        n = 0
        for lid, row in list(self.mkt['by_lid'].items()):
            if float(row.get('exp') or 0) > now:
                continue
            mkmod.drop(self.mkt, lid)
            self.post_save(('MKT', 'exp', {'lid': int(lid),
                                           'seller': int(row.get('seller') or 0),
                                           'name': str(row.get('name') or ''),
                                           'msg': '【%s】过期了，已退回背包（背包满就去交易所领取）'
                                                  % row.get('name'),
                                           'it': row.get('it') or {},
                                           'stack': int(row.get('stack') or 1)}))
            n += 1
        if n:
            print('[mkt] %d listing(s) expired' % n)

    def _mkt_ack(self, p, text, **kw):
        """先弹一句系统提示 ✗ 再回执 ✓

        ★ 为什么用 notice 而不是编一套"刷新背包"协议：
          notice 是【服务器写的文案】✗ 客户端本来就显示 ✓
          再带一个约定好的尾巴"（背包已更新）"→ 客户端看到就去重拉背包 ✓
          （下一轮做界面时用 ✓ 现在先把文案定死 ✓）
        """
        if text:
            self._send_cid(p.cid, P.pack('notice', text='%s（背包已更新）' % text))

    def _mkt_drain(self):
        """处理落库结果（★ tick 线程唯一能改钱的地方之一 ✓）

        ★★ round304b 的关键顺序（想清楚才写的 ✗ 别改）：
            购买时【钱在 tick 里先扣】✗ 落库是异步的 ✓
            → 落库成功：只补"卖家到账 + 买家拿到货"✓
            → 落库失败：买家全额退回 ✓（绝不会"扣了钱没拿到货"✓）
          ★ 为什么不等落库成功再扣钱：那样 buy 的校验和扣钱会跨 tick ✗
            中间买家可能把钱花在别处 ✗ 变成"余额够 ✗ 扣的时候不够"✓
            现在的写法：扣钱和校验在【同一拍】✗ 不存在这个缝 ✓
        """
        n = 0
        while n < 200:
            try:
                ex = self.mkt_failq.get_nowait()
            except queue.Empty:
                break
            n += 1
            try:
                kind = str(ex.get('kind') or '')
                rid = int(ex.get('role') or 0)
                p = self._mkt_player(rid)
                if ex.get('done'):
                    # ---------------- 落库成功 ----------------
                    if kind == 'list':
                        # 把乐观那行（lid 是负数占位）换成真行（真有 lid 才能买/下架 ✓）
                        tmp = int(ex.get('lid_tmp') or 0)
                        if tmp:
                            mkmod.drop(self.mkt, tmp)
                        # ★★ 到期时刻必须用 saver 回灌的那份 ✗ 别用乐观那个占位 ✓
                        #   自测抓到的：面板显示"剩 20729074 天后过期"✓
                        #   根因：上架那一刻 exp 还是 0（要落库才知道）✓
                        #     → 0 - now = 负数 ✗ 界面把它当成小数天 ✓
                        #   ★ 单位：_mkt_save_list 回灌的 ts/exp 已经是【秒】✓
                        #     （它自己做过 now_ms()/1000 ✓ 和内存行的口径一致 ✓）
                        _ts = float(ex.get('ts') or 0)
                        _exp = float(ex.get('exp') or 0)
                        if _ts <= 0:
                            _ts = now_s()
                        if _exp <= _ts:
                            _exp = _ts + int(valuemod.MKT_DAYS) * 86400
                        _r2 = mkmod.row_of(
                            int(ex.get('lid') or 0), rid, int(ex.get('price') or 0),
                            ex.get('it') or {}, _ts, _exp,
                            int(ex.get('stack') or 1), int(ex.get('qty') or 1),
                            int(ex.get('iid') or 0))
                        mkmod.add(self.mkt, _r2)
                        self.mkt_locking.discard((rid, int(ex.get('iid') or 0)))
                        # ★ 为什么不把这一件从 role['bag'] 快照里删掉：
                        #   那个快照是【打开交易所那一刻的】副本 ✗ 不跟背包刷新 ✓
                        #   删了它 → 玩家把同一件再挂一次 ✗ 快照里已经没有它了 ✗
                        #     于是"正在上架中"这道本地闸门形同虚设 ✓
                        #     （自测抓到的：提示会变成落库阶段的"上架失败"✓ 不该这样 ✓）
                        #   ★ 留着没坏处：真要再挂 ✗ 货架上那一份会先拦下来 ✓
                        if p is not None:
                            self._mkt_send(p, True,
                                           '【%s】已上架：%d 金币（上架费 %d）'
                                           % (ex.get('name'), int(ex.get('price') or 0),
                                              int(ex.get('fee') or 0)),
                                           lid=int(ex.get('lid') or 0),
                                           gold=int(getattr(p, 'gold', 0) or 0),
                                           refresh=1)
                            self._mkt_ack(p, '【%s】已上架（%d 金币）'
                                          % (ex.get('name'), int(ex.get('price') or 0)))
                    elif kind == 'buy':
                        lid = int(ex.get('lid') or 0)
                        # ★★ 先把"还能买几个"按库里的权威值改掉 ✗ 再决定要不要下架 ✓
                        #   （两个买家同时买的时候 ✗ 内存可能慢半拍 ✓ 以库为准 ✓）
                        _left = ex.get('qty_left')
                        if _left is not None:
                            _r = self.mkt['by_lid'].get(lid)
                            if _r is not None:
                                _r['qty'] = int(_left)
                        if _left is not None and int(_left) > 0 and                                 str(ex.get('state_left') or 'on') == 'on':
                            pass          # ★ 还有货 → 留在货架上 ✓
                        else:
                            mkmod.drop(self.mkt, lid)
                        it = ex.get('it') or {}
                        # ★★ 自测抓到的第 6 个坑：成交这条回执【有两个当事人】★★
                        #   上面那句 p = _mkt_player(ex['role']) 里的 role 是
                        #   seller or buyer（卖家优先 ✗）→ 拿到的其实是【卖家】✗
                        #   而这一段把 p 当买家 ✗
                        #   → 结果是：买家那一份"交货通知"发给了卖家 ✓
                        #     而 /api/sell 那边的卖家到账又被"p 就是卖家"覆盖 ✓
                        #     最后账面上【买家只扣 5 ✗ 卖家净得 0】✓✓
                        #   ★ 修：两个当事人各自查一次 ✗ 一个都不许猜 ✓
                        bp = self._mkt_player(int(ex.get('buyer') or 0))
                        sp = self._mkt_player(int(ex.get('seller') or 0))
                        if bp is not None and isinstance(it, dict):
                            # ★ 钱在 _mkt_buy 里已经扣过了 ✗ 这里只交货 ✓
                            if isinstance(bp.role.get('bag'), list):
                                bp.role['bag'].insert(0, {'id': 0, 'item': it,
                                                          'stack': int(ex.get('stack') or 1),
                                                          'lock': 1})
                            _bq = max(1, int(ex.get('qty') or 1))
                            _btxt = ('买到【%s】%s 花了 %d 金币'
                                     % (ex.get('name'),
                                        (' ×%d' % _bq) if _bq > 1 else '',
                                        int(ex.get('price') or 0)))
                            self._mkt_send(bp, True, _btxt, lid=lid, kind='buy',
                                           gold=int(getattr(bp, 'gold', 0) or 0),
                                           name=str(ex.get('name') or ''),
                                           price=int(ex.get('price') or 0), refresh=1)
                            self._mkt_ack(bp, _btxt)
                        sid = int(ex.get('seller') or 0)
                        if sp is not None:
                            # ★ 卖家在线 → 只改内存（他那边下一拍就推金币 ✓）
                            self._gain_gold(sp, int(ex.get('net') or 0), 'trade')
                        else:
                            # ★ 离线 → 走 pending_gold（上线时自动入账 ✓ 方案 §3 ✓）
                            self._mkt_offline_pay(sid, int(ex.get('net') or 0))
                    else:
                        # 下架 / 过期 / 领取：东西已经在库里回到背包了 ✗ 叫客户端重拉 ✓
                        if p is not None:
                            self._mkt_send(p, True, str(ex.get('msg') or '操作完成'),
                                           lid=int(ex.get('lid') or 0), refresh=1)
                            self._mkt_ack(p, str(ex.get('msg') or '操作完成'))
                    continue
                # ---------------- 落库失败 ----------------
                # ★ 乐观加进去的那一行必须先拿掉 ✓
                #   不拿掉的话：货架上留着一行【没有 lid 的假商品】✗
                #     别人看得见却买不了 ✗ 玩家自己也不能再挂它 ✓
                #   （自测那条"不能留负数占位"的断言就是照这个写的 ✓）
                if kind == 'list':
                    # ★ 乐观那行的 lid 就是 -iid（_mkt_list 里定的 ✓）
                    #   为什么要拿掉：不拿掉的话货架上留着一行【没有真 lid 的假商品】✗
                    #     别人看得见却买不了 ✗ 玩家自己也不能再挂它 ✓
                    #   （自测那条"不能留负数占位"的断言就是照这个写的 ✓）
                    mkmod.drop(self.mkt, -int(ex.get('iid') or 0))
                    self.mkt_locking.discard((rid, int(ex.get('iid') or 0)))
                if p is None:
                    continue
                if kind == 'list':
                    # ★ 文案里必须【说清钱退回来了】✗ 不然玩家只看到"上架失败"
                    #   会以为上架费被吞了 ✓（自测的断言就是照这条写的 ✓）
                    why = str(ex.get('msg') or '').replace('操作失败：', '') or '数据库出错'
                    self._mkt_fail(p, '上架失败（%s）✗ 上架费已退还' % why,
                                   refund=int(ex.get('fee') or 0))
                elif kind == 'buy':
                    why = str(ex.get('msg') or '').replace('操作失败：', '') or '数据库出错'
                    self._mkt_fail(p, '购买失败（%s）✗ 金币没有被扣' % why)
                else:
                    why = str(ex.get('msg') or '').replace('操作失败：', '') or '数据库出错'
                    self._mkt_fail(p, '交易落库失败（%s）✗ 钱已退回' % why)
            except Exception as e:
                print('[mkt] drain failed: %r' % (e,))
        # ★ 卡住的锁也要清（玩家掉线 / 回滚 ✗ 不然他永远上架不了这一件 ✓）
        try:
            if self.mkt_locking and (self.tick_count % 300) == 0:
                for key in list(self.mkt_locking):
                    if self._mkt_player(key[0]) is None:
                        self.mkt_locking.discard(key)
        except Exception:
            pass

    def _mkt_do(self, p, t, d):
        """交易所的六条消息（★ 全在 tick 线程 ✗ 纯内存 ✓）"""
        if t == 'lists':
            self._mkt_open(p, d)
        elif t == 'mylists':
            self._mkt_mine(p)
        elif t == 'mklist':
            self._mkt_list(p, d)
        elif t == 'buyitem':
            self._mkt_buy(p, d)
        elif t == 'unlist':
            self._mkt_unlist(p, d)
        elif t == 'listclaim':
            self._mkt_claim(p, d)
        else:
            self._send_cid(p.cid, P.pack('listres', ok=False, msg='未知的交易所操作'))

    def _mkt_tick(self):
        """每 tick 的交易所杂事（★ 全部只碰队列和内存 ✗ 没有磁盘 IO ✓）"""
        # ① 上线时读好的货架（网络线程读的 ✗ 这里只入内存 ✓）
        n = 0
        while n < 50:
            try:
                rid, rows = self._joinq2.get_nowait()
            except queue.Empty:
                break
            n += 1
            try:
                self._mkt_load(rid, rows)
            except Exception as e:
                print('[mkt] load failed: %r' % (e,))
        # ② 落库失败 → 回滚内存里的钱
        if not self.mkt_failq.empty():
            self._mkt_drain()
        # ③ 过期回收（每 5 秒一次 ✗ 只动内存 + 投 UPDATE ✓）
        self._mkt_acc += TICK_DT
        if self._mkt_acc >= MKT_SWEEP_INTERVAL:
            self._mkt_acc = 0.0
            try:
                self._mkt_sweep()
            except Exception as e:
                print('[mkt] sweep failed: %r' % (e,))

    def _gain_gold(self, q, n, why=''):
        """THE only place gold changes. Returns the amount actually applied.

          * memory is authoritative - never write the db here (tick thread)
          * n < 0 -> will not go below zero (returns 0 when it cannot pay)
          * n > 0 -> anything above GOLD_CAP becomes gold bullion automatically
          * every change goes into a small ring buffer (admin / debugging)
        """
        if q is None or not n:
            return 0
        try:
            n = int(n)
        except Exception:
            return 0
        cur = int(getattr(q, 'gold', 0) or 0)
        if n < 0:
            pay = min(cur, -n)
            if pay <= 0:
                return 0
            q.gold = cur - pay
            applied = -pay
        else:
            q.gold = cur + n
            applied = n
            try:
                if q.gold > self.GOLD_CAP:
                    k = (q.gold - self.GOLD_CAP) // self.GOLD_PER_BULLION
                    if k > 0 and self._give_bullion(q, k):
                        q.gold -= k * self.GOLD_PER_BULLION
            except Exception as e:
                print('[gold] bullion convert failed: %r' % (e,))
        q.goldDirty = True
        # ★★★ round305 修的真 bug：钱只在内存里 ✗ 会被一次"早排队的存档"盖掉 ★★★
        #   用户脚本踩到的现象："号里卖过东西 ✗ 余额却是 0"✓
        #   复现：离线卖东西（写 pending_gold）→ 【马上】登录 →
        #     ① 登录时排了一次存档（那一刻 gold=0 ✓）
        #     ② 同一拍 tick 把 pending 入账 535 ✗ 只改了内存 ✓
        #     ③ 存档线程随后把 ① 那份（0）写回库 ✓ → 钱没了①
        #     等 3 秒再登录就不会中（①已经写完 ✗ ②之后 15 秒的定时存档才写 ✓）
        #   ★ 根因：gold 的落库【只有一条路】= _save_player（15 秒 / 下线）
        #     而这条路上的值是【排队那一刻】的快照 ✗ 入账比它晚就丢 ✓
        #   ★ 修法（两处都要 ✗ 少一处都还会丢）：
        #     ① 这里【顺手把存档也排上】✗ 让钱的改动自己触发落库 ✓
        #     ② _save_player 取【当前】内存值 ✗ 不用过期快照 ✓
        try:
            _rid = int(getattr(q, 'role_id', 0) or 0)
            if _rid:
                if isinstance(getattr(q, 'role', None), dict):
                    q.role['gold'] = int(q.gold or 0)      # 内存里那份也跟着对 ✓
                _seq = int(self._gold_seq.get(_rid, 0)) + 1
                self._gold_seq[_rid] = _seq
                self.post_save(*gold_sql(_seq, _rid, q.gold))
        except Exception as e:
            print('[gold] flush queue failed: %r' % (e,))
        # round302: 记住内存余额 ✗ 让【刷新后的新会话】也能拿到最新值 ✓
        #   （只影响重连时的取值 ✗ 落库那条路一点没变 ✓）
        try:
            _rid = getattr(q, 'role_id', None)
            if _rid is not None:
                _live_gold[int(_rid)] = int(q.gold)
        except Exception:
            pass
        # round302: 大额 / 交易类变更【立刻排队落库】✗ 不等 15 秒定时存盘 ✓
        #   为什么：金币是内存权威 ✗ 而落库只在 15 秒定时 + 下线时 ✓
        #   → 这段时间里刷新/崩溃/被踢 = 这笔钱没了 ✓（docs v3 s1 要求关键节点立即入队）
        #   ★ 只入队 ✗ 不做 IO ✓（tick 线程的铁律不变 ✓）
        try:
            if abs(int(applied)) >= 100000 or str(why).startswith('trade'):
                self._save_player(q)
        except Exception:
            pass
        try:
            log = getattr(q, 'goldLog', None)
            if log is None:
                log = q.goldLog = []
            log.append((int(now_s()), int(applied), str(why)[:24]))
            if len(log) > 200:
                del log[:len(log) - 200]
        except Exception:
            pass
        return applied

    def _give_bullion(self, q, k):
        """Hand k gold bullion to the player. True when it was queued.

        post_save() takes SQL, NOT an action name - my first version passed
        'give_bullion' and would have failed at runtime. Pattern copied from
        the debug give-weapon branch near world.py:914.
        """
        try:
            rid = getattr(q, 'role_id', None)
            if not rid:
                return False
            import json
            import db as dbmod
            it = {'name': '黄金', 'tier': 0, 'kind': 'material', 'rarity': 'legend'}
            self.post_save(
                'INSERT INTO items(role_id, in_storage, slot_index, stack, item_json, created_at)'
                ' VALUES(?,0,-1,?,?,?)',
                (rid, int(k), json.dumps(it, ensure_ascii=False), dbmod.now_ms()))
            try:
                self._send_cid(q.cid, P.pack('notice',
                    text='金币已达上限——自动兑换成 %d 个【黄金】' % int(k)))
            except Exception:
                pass
            return True
        except Exception as e:
            print('[gold] give bullion failed: %r' % (e,))
            return False


    def _gain_exp(self, q, amount):
        """给某个玩家加经验 → 够就升级 → 推 me（第 81 轮抽出来的 ✓）

        ★ 为什么抽成函数：队友分经验必须走【一模一样】的逻辑 ✗
          不然会出现"队友升级了但界面没刷新""队友升级没提示"这种鬼问题 ✓
        ★ 注意：me 是【单个对象】不是数组 —— 客户端读 d.me.lv / d.me.exp ✗
          （这是第 39 轮踩过的坑，注释留着 ✓）
        """
        if q is None or amount <= 0:
            return
        role = q.role
        role['exp'] = int(role.get('exp') or 0) + int(amount)
        ups = 0
        while ups < 100:
            lv = int(role.get('level') or 1)
            need = mobs.level_up_need(lv)
            if int(role.get('exp') or 0) < need:
                break
            role['exp'] = int(role.get('exp') or 0) - need
            role['level'] = lv + 1
            ups += 1
        # ★★ 第 168 轮（用户 #1）：升级后恢复满血 ★★
        #   ★ 放在循环【外面】✗ 连升两级也只回一次血 ✓（反正都是回满 ✓）
        #   ★ 用 _hp_max（含防具/天赋加成 ✓）不是写死的 200 ✗
        if ups > 0:
            try:
                q.hp = int(self._hp_max(q))
            except Exception:
                pass
        level = int(role.get('level') or 1)
        e = self._pend.get(q.cid)
        if e is None:
            e = self._pend[q.cid] = {}
        try:
            self._tal_send(q)     # ★ 第 116 轮：升级了点数会变 → 必须重推 ✗（方案 §7.2）
        except Exception:
            pass
        e['me'] = {'lv': level, 'exp': int(role.get('exp') or 0),
                   'hp': int(q.hp or 0),   # ★ 第 168 轮：升级回满血后让客户端跟上 ✓
                   'need': mobs.level_up_need(level),
                   'inv': round(q.invulnT, 2),
                   # ★ 第 102 轮：把【有效血量上限】带上 ✓
                   #   （含防具加成 ✓ 客户端那边原来一直是写死的 200 ✗
                   #    所以"穿了防具血量没变化"✓ 根因就在这 ✗）
                   'hpm': self._hp_max(q)}
        if ups:
            self._send_cid(q.cid, P.pack('notice', text='升到 %d 级！' % level, level=level))
            # ★ 第 247 轮：升级还要播报给全服（用户要求：谁升到了多少级）
            self._ticker('%s 升到了 %d 级' % (q.name, level), 'up', tag='up:%d' % q.role_id)

    # ================================================================ 组队（第 81 轮）

    def _party_members(self, pid):
        """这个队的在线玩家对象列表（离开的人自动跳过 ✓）"""
        pt = self.parties.get(pid)
        if not pt:
            return []
        out = []
        for rid in pt['members']:
            for q in self.players.values():
                if getattr(q, 'role_id', None) == rid:
                    out.append(q)
                    break
        return out

    def _party_roster(self, pid):
        """给客户端的一份队伍名单（紧凑数组 ✓ 只推必要的 ✓）"""
        pt = self.parties.get(pid)
        if not pt:
            return None
        out = []
        for q in self._party_members(pid):
            w = q.weapon or {}
            out.append([q.role_id, q.name, int((q.role or {}).get('level') or 1),
                        int(q.hp or 0), self._hp_max(q), int(q.qi or 0),
                        int((q.role or {}).get('qiMax') or 100),
                        w.get('look') or 'sword', int(w.get('tier') or 0),
                        1 if int(q.hp or 0) <= 0 else 0,
                        1 if q.role_id == pt['leader'] else 0,
                           # ★ 第 264 轮（用户：无论队友多远都显示位置）
                           #   名单里原来没有坐标 ✗ 所以超出视野(100米)就完全看不到队友 ✓
                           #   加上 x / z ✗ 客户端就能画远处队友的方向和距离 ✓
                           #   ★ 名单每秒补推一次(PARTY_PUSH_INTERVAL=1) ✗ 所以坐标够新 ✓
                           round(float(q.x or 0.0), 1), round(float(q.z or 0.0), 1)])
        return out

    def _party_push(self, pid):
        """队伍有变化 → 给每个在线成员推一份完整名单 ✓"""
        pt = self.parties.get(pid)
        if not pt:
            return
        ros = self._party_roster(pid)
        for q in self._party_members(pid):
            self._send_cid(q.cid, P.pack('party', roster=ros, pid=pid,
                                         leader=pt['leader'], me=q.role_id))

    def _party_leave(self, p, quiet=False):
        """离队（退出/被踢/掉线都走这里 ✓）"""
        rid = getattr(p, 'role_id', None)
        pid = self.party_of.pop(rid, None)
        if not pid:
            return
        pt = self.parties.get(pid)
        if pt and rid in pt['members']:
            pt['members'].remove(rid)
        self._send_cid(p.cid, P.pack('party', roster=None, pid=None, me=rid))
        if not pt or len(pt['members']) <= 1:
            # ★ 只剩 1 个人就自动解散（用户方案 §3.1 ✓）
            for rid2 in (pt['members'] if pt else []):
                self.party_of.pop(rid2, None)
                for q in self.players.values():
                    if getattr(q, 'role_id', None) == rid2:
                        self._send_cid(q.cid, P.pack('party', roster=None, pid=None, me=rid2))
            self.parties.pop(pid, None)
            return
        if pt['leader'] == rid:
            pt['leader'] = pt['members'][0]      # 队长走了 → 顺位给第一个 ✓
        self._party_push(pid)

    def _party_op(self, p, d):
        """所有队伍操作（第 81 轮 ✓ 全部在 tick 线程 ✓）"""
        op = (d or {}).get('op') or ''
        rid = getattr(p, 'role_id', None)
        if not rid:
            return
        now = now_s()

        def find_q(role_id):
            for q in self.players.values():
                if getattr(q, 'role_id', None) == role_id:
                    return q
            return None

        if op == 'invite':
            tgt = find_q(int((d or {}).get('cid') or 0))
            if tgt is None or tgt is p:
                return self._send_cid(p.cid, P.pack('notice', text='找不到这个人'))
            if int(tgt.hp or 0) <= 0:
                return self._send_cid(p.cid, P.pack('notice', text='他倒着呢，等起来再说'))
            # 限流 + 距离（防全图骚扰 ✗）
            rl = [x for x in self.party_rate.get(rid, []) if now - x < 10.0]
            if len(rl) >= PARTY_INVITE_RATE:
                return self._send_cid(p.cid, P.pack('notice', text='邀请发太快了，缓一缓'))
            if (tgt.x - p.x) ** 2 + (tgt.z - p.z) ** 2 > PARTY_INVITE_DIST ** 2:
                return self._send_cid(p.cid, P.pack('notice', text='太远了，走近点再邀请'))
            rl.append(now)
            self.party_rate[rid] = rl
            # 我这边先确保有个队（没有就建一个，我是队长 ✓）
            mypid = self.party_of.get(rid)
            if not mypid:
                self._party_seq += 1
                mypid = 'p%d' % self._party_seq
                self.parties[mypid] = {'id': mypid, 'leader': rid, 'members': [rid]}
                self.party_open[mypid] = True      # ★ 建队默认上榜 ✓
                self.party_of[rid] = mypid
                self._party_push(mypid)
            if len(self.parties[mypid]['members']) >= PARTY_MAX:
                return self._send_cid(p.cid, P.pack('notice', text='队伍满了（%d 人）' % PARTY_MAX))
            if tgt.role_id in self.party_of:
                return self._send_cid(p.cid, P.pack('notice', text='他已经在别的队里了'))
            # ★ 第 84 轮用户要求：同一个人重复邀请【只留一条】✓ 只刷新时间 ✓
            _lst = [x for x in self.party_inv.get(tgt.role_id, []) if x[0] != rid]
            _lst.append((rid, now))
            self.party_inv[tgt.role_id] = _lst
            self._send_cid(tgt.cid, P.pack('partyinv', name=p.name, pid=mypid))
            self._send_cid(p.cid, P.pack('notice', text='已邀请 %s' % tgt.name))

        elif op == 'accept':
            pid = (d or {}).get('pid') or None
            lst = self.party_inv.get(rid, [])
            lst = [x for x in lst if now - x[1] < PARTY_INVITE_TTL]
            self.party_inv[rid] = lst
            if not lst:
                return self._send_cid(p.cid, P.pack('notice', text='邀请已经过期了'))
            frm = int((d or {}).get('cid') or 0) or lst[-1][0]
            pid = self.party_of.get(frm)
            if not pid:
                return self._send_cid(p.cid, P.pack('notice', text='那个队已经散了'))
            pt = self.parties.get(pid)
            if not pt or len(pt['members']) >= PARTY_MAX:
                return self._send_cid(p.cid, P.pack('notice', text='队伍满了'))
            if rid in self.party_of:
                self._party_leave(p)
            pt['members'].append(rid)
            self.party_of[rid] = pid
            self.party_inv[rid] = []
            for q in self._party_members(pid):
                self._send_cid(q.cid, P.pack('notice', text='%s 加入了队伍' % p.name))
            self._party_push(pid)

        elif op == 'decline':
            frm = int((d or {}).get('cid') or 0)
            self.party_inv[rid] = [x for x in self.party_inv.get(rid, []) if x[0] != frm]

        elif op == 'leave':
            self._party_leave(p)

        elif op == 'kick':
            pid = self.party_of.get(rid)
            pt = self.parties.get(pid) if pid else None
            if not pt or pt['leader'] != rid:
                return self._send_cid(p.cid, P.pack('notice', text='只有队长能踢人'))
            tgt = find_q(int((d or {}).get('cid') or 0))
            if tgt is None or tgt.role_id == rid:
                return
            self._party_leave(tgt)
            self._send_cid(p.cid, P.pack('notice', text='把 %s 请出了队伍' % tgt.name))

        elif op == 'promote':
            pid = self.party_of.get(rid)
            pt = self.parties.get(pid) if pid else None
            if not pt or pt['leader'] != rid:
                return
            tgt = find_q(int((d or {}).get('cid') or 0))
            if tgt is None or tgt.role_id not in pt['members']:
                return
            pt['leader'] = tgt.role_id
            self._party_push(pid)

        elif op == 'disband':
            pid = self.party_of.get(rid)
            pt = self.parties.get(pid) if pid else None
            if not pt or pt['leader'] != rid:
                return
            for q in self._party_members(pid):
                self.party_of.pop(q.role_id, None)
                self._send_cid(q.cid, P.pack('party', roster=None, pid=None, me=q.role_id))
                self._send_cid(q.cid, P.pack('notice', text='队伍解散了'))
            self.parties.pop(pid, None)

        elif op == 'apply':
            # ★ 玩家 → 申请加入某个队（第 82 轮 ✓）
            pid = (d or {}).get('pid') or None
            pt = self.parties.get(pid)
            if not pt:
                return self._send_cid(p.cid, P.pack('notice', text='这个队伍已经不存在了'))
            if rid in self.party_of:
                return self._send_cid(p.cid, P.pack('notice', text='你已经有队伍了'))
            if len(pt['members']) >= PARTY_MAX:
                return self._send_cid(p.cid, P.pack('notice', text='这个队伍已经满了'))
            rl = [x for x in self.party_rate.get(rid, []) if now - x < 10.0]
            if len(rl) >= PARTY_APPLY_RATE:
                return self._send_cid(p.cid, P.pack('notice', text='申请发太快了，缓一缓'))
            rl.append(now)
            self.party_rate[rid] = rl
            lst = [x for x in self.party_apply.get(pid, [])
                   if now - x[1] < PARTY_APPLY_TTL and x[0] != rid]
            lst.append((rid, now))
            self.party_apply[pid] = lst
            self._send_cid(p.cid, P.pack('notice', text='已申请加入，等队长同意'))
            for q in self._party_members(pid):
                if q.role_id == pt['leader']:
                    self._send_cid(q.cid, P.pack('partyapply', pid=pid, name=p.name,
                                                 cid=rid))

        elif op in ('okapply', 'noapply'):
            pid = self.party_of.get(rid)
            pt = self.parties.get(pid) if pid else None
            if not pt or pt['leader'] != rid:
                return self._send_cid(p.cid, P.pack('notice', text='只有队长能处理申请'))
            who = int((d or {}).get('cid') or 0)
            self.party_apply[pid] = [x for x in self.party_apply.get(pid, []) if x[0] != who]
            tgt = find_q(who)
            if op == 'noapply':
                if tgt:
                    self._send_cid(tgt.cid, P.pack('notice', text='队长拒绝了你的申请'))
                return
            if tgt is None:
                return self._send_cid(p.cid, P.pack('notice', text='那个人不在了'))
            if len(pt['members']) >= PARTY_MAX:
                return self._send_cid(p.cid, P.pack('notice', text='队伍满了'))
            if who in self.party_of:
                return self._send_cid(p.cid, P.pack('notice', text='他已经有队伍了'))
            pt['members'].append(who)
            self.party_of[who] = pid
            self.party_apply[pid] = []
            self._send_cid(tgt.cid, P.pack('notice', text='队长同意你加入了'))
            for q in self._party_members(pid):
                self._send_cid(q.cid, P.pack('notice', text='%s 加入了队伍' % tgt.name))
            self._party_push(pid)

        elif op == 'cancelapply':
            pid = (d or {}).get('pid') or None
            if pid:
                self.party_apply[pid] = [x for x in self.party_apply.get(pid, [])
                                         if x[0] != rid]
            self._send_cid(p.cid, P.pack('notice', text='已取消申请'))

        elif op == 'recruit':
            pid = self.party_of.get(rid)
            pt = self.parties.get(pid) if pid else None
            if not pt or pt['leader'] != rid:
                return
            self.party_open[pid] = bool((d or {}).get('on', True))
            self._send_cid(p.cid, P.pack('notice',
                                         text=('已开启招募（大厅能看到你们队）'
                                               if self.party_open[pid] else '已关闭招募')))
        elif op == 'chat':
            pid = self.party_of.get(rid)
            if not pid:
                return
            txt = str((d or {}).get('text') or '')[:120]
            if not txt:
                return
            for q in self._party_members(pid):
                self._send_cid(q.cid, P.pack('partychat', name=p.name, text=txt))

    def _party_share_exp(self, killer, m):
        """队友分经验（用户确认：每个队友拿该僵尸的 10% ✓ 和人数无关 ✓）"""
        pid = self.party_of.get(getattr(killer, 'role_id', None))
        if not pid:
            return
        share = int(round(int(m.exp) * PARTY_SHARE))
        if share <= 0:
            return
        d2 = PARTY_SHARE_DIST * PARTY_SHARE_DIST
        for q in self._party_members(pid):
            if q is killer or int(q.hp or 0) <= 0:
                continue
            if (q.x - m.x) ** 2 + (q.z - m.z) ** 2 > d2:
                continue                      # round 241: 距离已不限制，这句现在永不触发
            self._gain_exp(q, share)
            # ★★ 第 86 轮（用户报）："这个没有真的加上，一刷新就没有了" ★★
            #   病根：分经验只改了内存里的 role['exp'] ✗
            #         而落库是靠"本人做了什么事"触发的（击杀/拾取时才排队保存 ✓）
            #         → 队友光在旁边蹭，什么都没做 → 他的 exp 一直没落库 ✗
            #         → 一刷新（重新登录读库）就回到旧值 ✓ 用户说的一模一样 ✓
            #   修：分经验时【替他也排一次存档】✓
            try:
                self._save_player(q)
                # ★★★ 第 242 轮修的真 bug（用户：有玩家反馈重新进掉了等级）★★★

                #   病根：上面那句 _save_player 存的是【坐标/朝向/血/气】✗

                #         它的 SQL 里【没有 level 和 exp】✗✗

                #         → 队友蹭经验升了级 ✓ 但等级和经验一直没写库 ✓

                #         → 一重新登录读回旧值 → ★ 掉级 ✓✓ 和玩家反馈一致 ✓

                #   ★ 第 86 轮修「分经验不落库」时加的就是 _save_player ✗

                #     意图是对的（分经验也要替他存一次 ✓）但存错了函数 ✓

                #   ★ 该调的是 _save_role —— 它的 SQL 是 level=?, exp=? ✓

                #   ★ 实测（离线跑真逻辑）：

                #     队友差 3 点升级 → 分到 6 点 → 等级 10 变 11 ✓

                #     但排队写库的操作里【没有 level=?】✗✓ 所以一定会掉级 ✓

                self._save_role(q)
            except Exception:
                pass
            #   ★ 顺手给他飘一个（用户要求：获得经验时头上显示"队伍经验分享 +N"✓）
            try:
                self._send_cid(q.cid, P.pack('fx', kind='pexp', n=int(share)))
            except Exception:
                pass

    def _break_weapon(self, p):
        """武器耐久归零 → ★ 标记为已损坏（不删除）★ 第 232 轮改的

        ★★ 用户原话："武器防具损坏了把穿戴的格子做一个损坏的样式，
                      这样玩家挂机回来后知道是武器防具坏了，
                      而不是不知道是坏了还是丢了"
        ★ 以前的做法：直接 DELETE 掉 ✗ 背包里那件凭空消失 ✓
          挂机一晚上回来只看到"少了一件"✗ 分不清是坏了还是丢了 ✓✓
        ★ 现在的做法：
          · 物品【留在背包里】✗ 标记 broken: true ✓
          · 而且【继续保持穿戴】✗ 这样穿戴格子上能看到"已损坏" ✓
          · 但打不出伤害（_atk_of 里判 ✓）· 也不能再穿（auth 里判 ✓）
        """
        import json
        nm = (p.weapon or {}).get('name') or '武器'
        old_id = p.weaponItemId
        if p.weapon is not None:
            p.weapon['broken'] = True          # ★ 身上这份也标上（画穿戴格子要用 ✓）
        p.wDur = 0
        p.wDurDirty = 0
        if old_id:
            # ★ 不删 ✗ 把物品 JSON 改写成 broken 状态 ✓
            #   ★★ 为什么不用读库：规矩 1 —— tick 线程不许碰磁盘 ✗
            #      而且【根本不用读】✗ 身上这份 p.weapon 就是物品 JSON 本身 ✓
            #      （存的时候就是把它 json.dumps 进去的 ✓）
            try:
                wv = dict(p.weapon or {})
                wv['broken'] = True
                wv['dur'] = 0
                self.post_save('UPDATE items SET item_json=? WHERE id=? AND role_id=?',
                               (json.dumps(wv, ensure_ascii=False), old_id, p.role_id))
            except Exception as e:
                print('[装备] 标记武器损坏失败：%r' % (e,))
        self._send_cid(p.cid, P.pack('notice',
                                     text='⚠ %s 耐久耗尽，已损坏（还在背包里，不能再用了）' % nm))
        self._send_cid(p.cid, P.pack('weapon', w=None))

    def _break_armor(self, p):
        """防具耐久归零 → ★ 标记为已损坏（不删除）★ 第 232 轮（和武器一个规矩 ✓）"""
        import json
        nm = (p.armor or {}).get('name') or '防具'
        old_id = p.armorItemId
        if p.armor is not None:
            p.armor['broken'] = True
        p.aDur = 0
        p.aDurDirty = 0
        if old_id:
            try:
                av = dict(p.armor or {})
                av['broken'] = True
                av['dur'] = 0
                self.post_save('UPDATE items SET item_json=? WHERE id=? AND role_id=?',
                               (json.dumps(av, ensure_ascii=False), old_id, p.role_id))
            except Exception as e:
                print('[装备] 标记防具损坏失败：%r' % (e,))
        self._send_cid(p.cid, P.pack('notice',
                                     text='⚠ %s 耐久耗尽，已损坏（还在背包里，不能再用了）' % nm))
        self._send_cid(p.cid, P.pack('armor', a=None, hpm=self._hp_max(p)))

    def _flush_adur(self, p):
        """防具耐久写回数据库（和武器一个套路：攒够次数才写 ✓）"""
        if p.aDurDirty and p.armorItemId and p.aDurMax > 0:
            import json
            a2 = dict(p.armor or {})
            a2['dur'] = p.aDur
            a2['durMax'] = p.aDurMax
            self.post_save('UPDATE items SET item_json=? WHERE id=? AND role_id=?',
                           (json.dumps(a2, ensure_ascii=False), p.armorItemId, p.role_id))
            p.aDurDirty = 0

    def _flush_dur(self, p):
        """把内存里的耐久写回数据库（攒够次数才写 ✓ 不然磁盘受不了 ✗）"""
        if p.wDurDirty and p.weaponItemId and p.wDurMax > 0:
            import json
            w2 = dict(p.weapon or {})
            w2['dur'] = p.wDur
            w2['durMax'] = p.wDurMax
            self.post_save('UPDATE items SET item_json=? WHERE id=? AND role_id=?',
                           (json.dumps(w2, ensure_ascii=False), p.weaponItemId, p.role_id))
            p.wDurDirty = 0

    def _mob_bite(self, m, p):
        """僵尸咬玩家 —— 伤害由服务器算（§5：僵尸和人走同一套公式）

        ★ 挥爪动画【不在这里】点 —— 已经在"开始蓄力"那一刻点了（第 41 轮）✓
          那样才有前摇可看：抬手 → 咬 → 收招 ✓ 在这里再点一次会把动画重置，看着像抖一下 ✗
        """
        # ★ 第 56 轮：复活无敌期间【咬不动】✓（不然复活的瞬间又被围死 ✗）
        if getattr(p, 'invulnT', 0) > 0:
            return
        # ★★ 第 134 轮：妖兽伤害开关 ✓（关了就咬不动 ✓）
        #   ★ 放在这里（刚进函数、还没算伤害时）✗
        #     比" 算完伤害再丢掉"省 CPU ✓ 而且不会误触发反伤类效果 ✓
        if not self._mob_atk_on(p):
            return
        dv, crit = mobs.roll_damage(m.atk)
        # ★★ 第 118 轮：记下【原始伤害】★★
        #   这一行下面就开始各种减伤了 ✗（招架 / 防具固定 / 天赋百分比）
        #   全局 30% 地板就拿这个值算 ✓
        #   ★ 我前两版都插错了 ✗（一次插在招架分支里 ✗ 一次插在防具之前 ✗）
        #     两次都是"看着像第一次赋值"✗ 实际不是 ✗
        _dv0 = int(dv)
        # ★★ 第 59 轮：单手剑的【招架】—— 按手上武器的概率把这一口减半 ✓
        #   （意图写在武器文案里 ✓ 玩家看得到才不冤 ✓）
        # ★★ 第 67 轮：防具在这里生效（闪避 → 固定减伤 → 受击回灵气 ✓）
        _st = armormod.stats_of(p.armor)
        if _st['dodge'] > 0 and random.random() < (_st['dodge'] / 100.0):
            # 闪开了：这一口完全没打到 ✓ 但也不回灵气（没被打到 ✓）
            self._send_cid(p.cid, P.pack('fx', kind='dodge'))
            return
        # ★ 第 103 轮：挨到了就扣【防具耐久】1 点 ✓（闪避那条已经 return 了 ✓）
        if p.aDurMax > 0:
            p.aDur -= 1
            p.aDurDirty += 1
            if p.aDurDirty >= 50:
                self._flush_adur(p)
            if p.aDur <= 0:
                self._break_armor(p)
        _w = p.weapon or {}
        _fx = weapons.fx_of(_w.get('look'), int(_w.get('tier') or 0))
        if _fx and _fx['name'] == '招架' and random.random() < _fx['chance']:
            dv = max(1, int(round(dv * (1.0 - _fx['value']))))
            # ★ 第 125 轮：这里原本又把 _dv0 覆盖了一次 ✗
            #   （招架后的值 ✗ → 地板跟着变低 ✗）已删✓
            self._send_cid(p.cid, P.pack('fx', kind='parry'))
        # ★ 固定减伤（防具的 dr ✓）：至少挨 1 点（不然穿了甲就无敌了 ✗）
        if _st['dr'] > 0:
            # ★★ 第 106 轮（用户要求）："基础减伤不能[把伤害]低于实际受到伤害的 10%" ★★
            #   也就是：不管减伤多高，最后至少还要吃【原来伤害的 10%】✗
            #   → 不然高品阶防具能把伤害压到 1 点，等于无敌 ✓
            _floor = max(1, int(round(dv * DMG_FLOOR)))   # ★ 第 118 轮：30% 地板 ✓
            dv = max(_floor, int(round(dv - _st['dr'])))
        # ★★ 第 117 轮（方案第 4 步）：天赋减伤 ★★
        #   和防具的【固定减伤】不是一回事 ✗
        #     防具 dr = 固定点数（先扣掉这么多 ✓）
        #     天赋 dr = 百分比（按剩下的伤害按比例减 ✓）
        #   顺序：先扣固定的 → 再打百分比 → 再吃 10% 地板 ✓
        _tdr = float((p.talEff or {}).get('dr') or 0.0)
        if _tdr > 0:
            dv = int(round(dv * (1.0 - _tdr / 100.0)))
        # ★★ 第 118 轮：全局地板（所有减伤算完之后统一过 ✓）★★
        #   至少吃【最初伤害的 30%】✓ 也就是减伤最多 70% ✓
        #   ★ 只在这一处兜底 ✗ 前面几步各自的临时地板拦不住叠加 ✓
        _global_floor = max(1, int(round(_dv0 * DMG_FLOOR)))
        if dv < _global_floor:
            dv = _global_floor
        # ★ 受击回灵气（词条 ✓）
        if _st['qi_hurt'] > 0:
            p.qi = min(int((p.role or {}).get('qiMax') or 100), int(p.qi) + int(_st['qi_hurt']))
        # ★★★ 第 125 轮：30% 地板放在【所有减伤之后、扣血之前】的最后一步 ★★★
        #   为什么要放这么后：
        #     前几版我把它放在"天赋减伤之后"✗
        #     但后面其实还有别的减伤在跑 ✗
        #     （词条里的"受到伤害 -X 点" / 减伤类武器技能 等等 ✗）
        #     → 结果就是"说了 30% 其实没守住"✗（测出 10 阶 28% / 12 阶 25% ✗）
        #   现在放在最后一步 ✓ 不管中间多少道减伤 ✗ 都兜得住 ✓
        #   ★ 而且只用 _dv0（roll_damage 刚出来那个值 ✓）
        #     不依赖中间任何一步 → 不会再出现"插错位置"✗
        dv = max(dv, max(1, int(round(_dv0 * DMG_FLOOR))))
        self._tp_break(p)      # 第 173 轮（用户 #6）：受伤打断传送读条
        _was_alive = int(p.hp) > 0                      # ★ 第 166 轮：记下“刚才还活着”✓
        p.hp = max(0, int(p.hp) - dv)
        self._add_pend(p.cid, 'hurts', {'dmg': dv, 'x': round(m.x, 2), 'z': round(m.z, 2),
                                        'by': m.kind, 'kind': 'mob', 'crit': bool(crit)})
        # ★★ 第 166 轮（用户：被僵尸杀死也会掉 1 点魔气）★★
        #   ★ 只在【从活着变成倒下】的那一下扣 ✗
        #     （不然连续咬尸体会一直扣 ✗ 虽然僵尸不咬死人 ✓）
        #   ★ 和 PVP 那边一样：只会到 0 为止 ✓ 走 post_save 落库 ✓
        if _was_alive and int(p.hp or 0) <= 0 and int(p.mq or 0) > 0:
            _lost = min(int(p.mq or 0), int(mqmod.cfg('killed_loss', mqmod.KILLED_LOSS)))
            p.mq = max(0, int(p.mq or 0) - _lost)
            self._mq_save(p)
            self._send_cid(p.cid, P.pack(
                'notice', text='你被%s打死了，魔气 −%d（现在 %d）'
                              % (m.kind, _lost, int(p.mq or 0))))

    # ================================================================
    #  ★★★ 第 150 轮：PVP（用户确认的规则，方案 §15）★★★
    #    谁能打谁：只要不是队友就能打 ✓ 不需要宣战 ✓
    #              队友之间永远打不到 ✗
    #              总闸门 = 管理页的 PVP 开关（关了全世界都打不到 ✓）
    #    怎么打：普通攻击就能打到 ✓ 以后的技能也按同一套筛选 ✓
    #    伤害：和打怪完全一样 ✓
    #  ================================================================
    def _pvp_ok(self, a_, b_):
        """a 能不能打 b（返回 True/False + 原因，原因只用来排障 ✓）"""
        if a_ is None or b_ is None or a_ is b_:
            return False, 'self'
        if int(b_.hp or 0) <= 0:
            return False, 'dead'                      # 已经倒下的不再打 ✓
        if getattr(b_, 'invulnT', 0) > 0:
            return False, 'invuln'                    # 复活无敌期 ✓
        if not self._pvp_on(a_):
            return False, 'a_off'                     # 自己关了 PVP（双向 ✓ 用户确认 ✓）
        if not self._pvp_on(b_):
            return False, 'b_off'                     # 对方关了 ✓
        # ★ 队友之间永远打不到（硬规则 ✓）
        pa = self.party_of.get(getattr(a_, 'role_id', None))
        pb = self.party_of.get(getattr(b_, 'role_id', None))
        if pa is not None and pa == pb:
            return False, 'teammate'
        # ★ 同一个账号的多个角色不算（防自己杀自己 ✓）
        if (a_.role or {}).get('account_id') and            (a_.role or {}).get('account_id') == (b_.role or {}).get('account_id'):
            return False, 'same_account'
        # ★ 安全区内不夺取、也不算魔气（出生点 20 米内 ✓）
        # 第 173 轮（用户 #6）：安全区是【正方形 30×30】（半边长 15）
        if abs(b_.x) <= mqmod.SAFE_HALF and abs(b_.z) <= mqmod.SAFE_HALF:
            return False, 'safe_zone'
        # ★ 等级差太大不算（防大号刷小号 ✓）
        la = int((a_.role or {}).get('level') or 1)
        lb = int((b_.role or {}).get('level') or 1)
        if abs(la - lb) > mqmod.LEVEL_GAP_MAX:
            return False, 'level_gap'
        return True, 'ok'

    def _pvp_pair_ok(self, a_, b_, kind='mq'):
        """防刷：同一对玩家的冷却（魔气和夺取各一把锁 ✗ 第 167 轮拆开的 ✓）"""
        ka = getattr(a_, 'role_id', None)
        kb = getattr(b_, 'role_id', None)
        now = now_s()
        # ★★ 第 167 轮（用户）：两把独立的锁 ★★
        #   kind='mq'    → 魔气（默认 10 分钟）
        #   kind='steal' → 夺取（默认 1 分钟）
        #   ★ 为什么拆：魔气是长期声望 ✓ 夺取是每次打架的收益 ✓
        #     合用一把锁 → 为了防刷魔气，把夺取也锁死了 ✗
        book = self.pvp_pair_steal if kind == 'steal' else self.pvp_pair
        cd = float(mqmod.cfg('steal_cooldown', mqmod.STEAL_COOLDOWN)) if kind == 'steal' \
            else float(mqmod.cfg('pair_cooldown', mqmod.PAIR_COOLDOWN))
        ts = book.get((ka, kb))
        if ts is not None and now - ts < cd:
            return False
        book[(ka, kb)] = now
        return True

    def _pvp_hit(self, p, q, reach, arc):
        """p 打 q 一下（伤害算法和打怪完全一样 ✓ 用户确认 ✓）

        返回打中了几次（0 或 1 ✓）
        """
        if not mobs.in_front(p.x, p.z, p.yaw, q.x, q.z, reach, arc):
            return 0
        ok, why = self._pvp_ok(p, q)
        if not ok:
            return 0
        # ---- 伤害：走和打怪一样的口径（攻击力 → 随武器系数 → 暴击 ✓）----
        _w = p.weapon or {}
        _T = affixes.totals(_w.get('affixes'))
        atk = self._atk_of(p)
        dv, crit = mobs.roll_damage(atk, crit_pt=_T.get('crit_pt', 0.0),
                                    crit_dmg=_T.get('crit_dmg', 0.0))
        dv = int(dv)
        # ---- 对方的减伤：固定（防具）+ 百分比（天赋）✓ 最后吃 30% 地板 ✓
        _st = armormod.stats_of(q.armor)
        _dv0 = dv
        if _st['dr'] > 0:
            dv = max(max(1, int(round(_dv0 * DMG_FLOOR))), int(round(dv - _st['dr'])))
        _tdr = float((q.talEff or {}).get('dr') or 0.0)
        if _tdr > 0:
            dv = int(round(dv * (1.0 - _tdr / 100.0)))
        dv = max(dv, max(1, int(round(_dv0 * DMG_FLOOR))))
        if dv <= 0:
            return 0
        self._tp_break(q)      # 第 173 轮：被打也打断传送 ✓
        q.hp = max(0, int(q.hp) - dv)
        # ---- 告诉被打的人（红色数字 + 谁打的 ✓ 客户端已有 ✓）----
        self._add_pend(q.cid, 'hurts', {'dmg': dv, 'x': round(p.x, 2), 'z': round(p.z, 2),
                                       'by': p.name, 'kind': 'mob', 'pvp': True,
                                       'crit': bool(crit)})
        # ---- 打人的人的反馈（和打怪一样弹数字 ✓）----
        self._add_pend(p.cid, 'mhits', {'mid': 'p:' + str(getattr(q, 'cid', '')),
                                        'dmg': dv, 'crit': bool(crit),
                                        'x': round(q.x, 2), 'z': round(q.z, 2)})
        # ---- 打死了 → 魔气 + 击杀播报 ----
        if int(q.hp or 0) <= 0:
            self._pvp_killed(p, q)
        return 1

    def _pvp_killed(self, killer, victim):
        """玩家击杀玩家：魔气 +2 / 被杀 −1（用户确认 ✓）+ 防刷判定 ✓"""
        # ★ 第 250 轮（用户要求）：击杀玩家进弹幕（谁杀了谁 ✓）
        #   僵尸打死玩家【不进】弹幕（用户明确说不需要 ✓）
        self._broadcast(P.pack('ticker', text='%s 击杀了 %s' % (killer.name, victim.name), kind='kill'))
        # ★ 防刷：这一对 10 分钟内只算一次 ✗（不然开小号互刷 ✓）
        counted = self._pvp_pair_ok(killer, victim, 'mq')       # ★ 魔气那把锁（10 分钟 ✓）
        steal_ok = self._pvp_pair_ok(killer, victim, 'steal')   # ★ 第 167 轮：夺取另一把锁（1 分钟 ✓）
        if counted:
            killer.mq = min(mqmod.MQ_MAX, int(killer.mq or 0) + mqmod.KILL_GAIN)
            victim.mq = max(0, int(victim.mq or 0) - mqmod.KILLED_LOSS)
            self._mq_save(killer)
            self._mq_save(victim)
        # 播报（附近的人看得到 ✓）
        self._evt_near(victim.x, victim.z, 'notice',
                       {'text': '%s 击杀了 %s' % (killer.name, victim.name)})
        self._send_cid(killer.cid, P.pack(
            'notice', text='你击杀了 %s%s' % (
                victim.name,
                ('，魔气 +%d（现在 %d）' % (mqmod.KILL_GAIN, killer.mq)) if counted
                else '（魔气冷却没到——同一对手 10 分钟内只算一次；夺取是另外一条冷却（1 分钟））')))
        self._send_cid(victim.cid, P.pack(
            'notice', text='你被 %s 击杀了%s' % (
                victim.name if False else killer.name,
                ('，魔气 −%d（现在 %d）' % (mqmod.KILLED_LOSS, victim.mq)) if counted
                else '')))
        # ★★ 第 151 轮：夺取（方案 §5/§6 + 用户确认的 §14）★★
        self._pvp_steal(killer, victim, steal_ok)   # ★ 用夺取自己的锁 ✗ 不再用魔气的 ✓

    def _pvp_steal(self, killer, victim, counted):
        """夺取经验 / 物品（第 151 轮）

        用户确认的规则：
          概率 = 5% + 魔气/2 × 0.2%，封顶 15%；取【魔气高】那边的 ✓
          只掷一次骰子 ✗ 经验比例看【实际夺取方】自己的魔气 ✓
          背包里没装备的随机 1 件必夺 ✓
          ★ 穿戴中的另外掷 1%（耐久原样保留 ✓）
          没经验 → 扣 100 金币（金币系统还没做 ✗ 先留接口 ✓）
          10 分钟限制挡住的那次不夺取 ✗
        """
        if not counted:
            return                                   # 被防刷拦住了 → 不夺取 ✓
        try:
            who, pct = mqmod.pick_stealer(killer.mq, victim.mq)
            stealer = killer if who == 'killer' else victim
            loser = victim if who == 'killer' else killer
            if random.random() * 100.0 >= pct:
                self._send_cid(killer.cid, P.pack(
                    'notice', text='夺取判定：%.0f%% 没中（对方没损失）' % pct))
                return
            # ---- 经验 ----
            pct_exp = mqmod.steal_exp_pct(stealer.mq)
            lrole = loser.role or {}
            have = max(0, int(lrole.get('exp') or 0))
            take = min(int(have * pct_exp), have)     # ★ 不会变负 → 不会掉级 ✓
            got_exp = 0
            if take > 0:
                lrole['exp'] = have - take
                got_exp = take
                self._gain_exp(stealer, take)
                # ★ 第 251 轮（用户要求）：夺取经验要进弹幕 ✗ 显示谁夺取了谁多少 ✓
                self._ticker('%s 夺取了 %s 的 %d 点经验' % (stealer.name, loser.name, take),
                             'mq', tag='stxl:%d' % stealer.role_id)
                self._save_role(stealer)   # 第 242 轮：抢来的经验也要落库         # ★ 走正常升级检查 ✓
                self.post_save('UPDATE roles SET exp=? WHERE id=?',
                               (int(lrole['exp']), loser.role_id))
            else:
                # ★ 没经验 → 改扣 100 金币（用户确认 ✓）
                #   金币系统还没做 ✗ 这里先只提示 ✓
                #   ★ 做金币时：扣 loser 100 金币 → 给 stealer（用户确认：金币归夺取方 ✓）
                #     没金币就什么都不扣 ✓
                self._send_cid(killer.cid, P.pack(
                    'notice', text='%s 没经验了（金币还没上，暂时什么都拿不到）' % loser.name))
            # ---- 背包里没装备的：必夺 1 件 ----
            #   ★ 用 SQL 直接改所有者 ✗ 不用先读出来 ✓
            #     （tick 线程不能查库 ✗ 而 post_save 是把 SQL 交给 saver 线程 ✓）
            taken_item = False
            try:
                n = int(getattr(loser, 'bagN', -1))
                if n != 0:                            # ★ -1 = 不知道 → 还是试一下 ✓
                    self.post_save(
                        'UPDATE items SET role_id=? WHERE id IN ('
                        ' SELECT id FROM items WHERE role_id=? AND in_storage=0'
                        ' ORDER BY RANDOM() LIMIT 1)', (stealer.role_id, loser.role_id))
                    taken_item = True
                    # ★ 第 251 轮：夺取背包物品也进弹幕
                    self._ticker('%s 夺取了 %s 的一件背包物品' % (stealer.name, loser.name),
                                 'mq', tag='stbg:%d' % stealer.role_id)
            except Exception:
                pass
            # ---- ★ 穿戴中的：另外掷 1%（耐久原样保留 ✓）----
            worn_taken = ''
            try:
                if random.random() * 100.0 < mqmod.WORN_STEAL_PCT:
                    if loser.weaponItemId and (not loser.armorItemId or random.random() < 0.5):
                        worn_taken = (loser.weapon or {}).get('name') or '武器'
                        self._steal_worn(loser, stealer, 'weapon')
                    elif loser.armorItemId:
                        worn_taken = (loser.armor or {}).get('name') or '防具'
                        self._steal_worn(loser, stealer, 'armor')
            except Exception:
                worn_taken = ''
            # ---- 双方提示 ----
            bits = []
            if got_exp:
                bits.append('%d 点经验' % got_exp)
            if taken_item:
                bits.append('一件背包物品')
            if worn_taken:
                bits.append('他身上的【%s】' % worn_taken)
            if not bits:
                bits.append('什么都没抢到')
            self._send_cid(stealer.cid, P.pack(
                'notice', text='你夺取了 %s 的 %s（概率 %.0f%% 中了）'
                              % (loser.name, '、'.join(bits), pct)))
            self._send_cid(loser.cid, P.pack(
                'notice', text='%s 夺走了你的 %s' % (stealer.name, '、'.join(bits))))
        except Exception:
            pass

    def _steal_worn(self, loser, stealer, which):
        """把对方【穿着的】抢走（耐久原样保留 ✓）

        ★ 三件事要一起做（少一件就不一致 ✗）：
          ① 对方身上卸下（内存） ② 改库里的所有者（SQL）
          ③ 把 equipment 里那条删掉（不然他重登又穿上了 ✗）
        """
        try:
            rid = loser.role_id
            if which == 'weapon':
                iid = loser.weaponItemId
                loser.weapon = None
                loser.weaponItemId = None
                loser.wDur = loser.wDurMax = 0
            else:
                iid = loser.armorItemId
                loser.armor = None
                loser.armorItemId = None
                loser.aDur = loser.aDurMax = 0
            if iid:
                self.post_save('UPDATE items SET role_id=? WHERE id=? AND role_id=?',
                               (stealer.role_id, iid, rid))
                self.post_save('DELETE FROM equipment WHERE role_id=? AND slot=?', (rid, which))
            # 被抢的人：装备与血量上限都变了 → 重算并告诉他 ✓
            self._send_cid(loser.cid, P.pack('weapon' if which == 'weapon' else 'armor',
                                             **({'w': None, 'hpm': self._hp_max(loser)}
                                                if which == 'weapon'
                                                else {'a': None, 'hpm': self._hp_max(loser)})))
        except Exception:
            pass


    def _mq_save(self, p):
        """魔气变了 → 落库（tick 线程只排队 ✗ saver 线程真写 ✓）"""
        self.post_save('UPDATE roles SET mq=?, mq_at=? WHERE id=?',
                       (int(p.mq or 0), int(p.mqAt or 0), p.role_id))
        # 顺手推给本人（以后属性页/头顶要显示 ✓）
        self._send_cid(p.cid, P.pack('mq', v=int(p.mq or 0)))

    def _atk_of(self, p):
        """玩家的攻击力 —— ★★ 服务器算，不看客户端报什么（第 39 轮 + 第 47 轮接武器）★★

        方案 §4.5 固有属性：攻击 = 10 + 3L + 0.08L²
        方案 §7.5 接武器：攻击 = 固有 + (固有 × 武器系数 + 武器平伤)，装备贡献封顶 60% ✓
        ★ 客户端只在切换武器时【上报意图】，具体是哪把、系数多少 —— 一律服务器说了算 ✓
        """
        lv = int(p.role.get('level') or 1)
        inherent = mobs.player_atk(lv)
        w = p.weapon or {}
        # ★ 第 232 轮：坏了的武器 = 空手打 ✗ 不然会出现"武器坏了伤害照旧"✓
        if w.get('broken'):
            w = {}
        base = w.get('base') or {}
        coeff = float(base.get('coeff') or 1.0)
        # ★ 第 51 轮：用【物品自己的等级】算平伤加成 ✓（原来错用了玩家等级 ✗）
        # ★ 第 53 轮：等级不够不是"不能装"，而是【发挥度打折】✓
        # ★★ 第 149 轮：魔气加成 —— 只加在这一处 ✗ 别处不动 ✓
        #   最终攻击 = 原来的攻击 × (1 + 魔气加成)
        #   ★ 意思是：固有 + 武器 + 词条 + 天赋 先加完 ✓ 最后乘魔气 ✗
        #     → 魔气不会被别的加成二次放大 ✓（和方案 §4.1 一致 ✓）
        #   ★ 打怪也算 ✓（用户确认 ✓）—— 因为打怪也走这个函数 ✓
        _atk0 = weapons.player_atk_with(inherent, w.get('look'), coeff,
                                       w.get('tier') or 0, int(w.get('itemLv') or 1),
                                       weapons.mastery_of(w, lv),
                                       # ★ 第 117 轮：flat 里加上【天赋攻击】✓
                                       #   武器/词条/天赋三者是相加关系 ✓ 走同一个 flat ✓
                                       flat=(weapons.flat_full(w) +
                                             float((p.talRaw or {}).get('atk') or 0.0)),
                                       aff_w=w)                      # ★ 第 60 轮：词条 ✓
        # ★ 注意是 p.mq ✗ 不是 self.mq ✓（self 是 World ✓ 玩家是 p ✓ 我第一版写成 self ✗ 已修 ✓）
        return _atk0 * (1.0 + mqmod.dmg_bonus_pct(p.mq) / 100.0)

    def _intent_atk(self, p, d):
        """玩家挥了一刀 —— ★★ 服务器算伤害（客户端只报"我挥了"，不报打中谁）★★

        为什么不信任客户端报的目标：那样改个包就能隔空打死别人 / 怪 ✗
        服务器自己按【攻击者的权威位置 + 朝向】重算一遍扇形里的目标 ✓
        规则和客户端那条完全一样（mobs.in_front / ATK_RANGE / ATK_ARC）—— 两边常量必须一致 ✓

        ★ 协议里还留着 mid / uid 字段，但这里【故意不看】—— 一律以服务器的扇形为准 ✓
          （客户端传什么都改变不了打中谁，最多只是"我挥了"这个事实）
        """
        # 第 174 轮（用户）：★ 玩家在安全区内不能攻击（③）
        #   ★ 放在最前面：连耐久都不该扣 ✗（挥空也不给 ✓）
        if abs(p.x) <= mqmod.SAFE_HALF and abs(p.z) <= mqmod.SAFE_HALF:
            self._send_cid(p.cid, P.pack('notice', text='安全区内不能攻击'))
            return
        if p.atkT > 0:
            return
        # ★★ 第 47 轮：冷却 / 射程 / 攻击弧 全部按【手上那把武器】算（方案 §5.1 / §7.4）★★
        #   以前这三个是写死的常量（= 单手剑）—— 现在匕首就快而短、长枪就慢而长 ✓
        w = p.weapon or {}
        wlook = w.get('look') or weapons.DEFAULT_TYPE
        wtier = int(w.get('tier') or 0)
        # ★ 第 60 轮：冷却吃【攻速词条】（S 再夹回 §5.1 上下限 ✓）
        _T = affixes.totals(w.get('affixes'))
        p.atkT = weapons.interval_of(wlook, _T.get('spd_pct', 0.0))
        reach = weapons.reach_of(wlook)
        arc = weapons.arc_of(wlook)

        # ★★ 第 59 轮：耐久 —— 每次挥砍扣 1（打空也算 ✓ 更真实）
        #   ★ 归零 → 武器消失（卸下 + 删库 + 告诉他 ✓）
        #   ★ 空手不扣（durMax=0 ✓）
        if p.wDurMax > 0:
            p.wDur -= 1
            p.wDurDirty += 1
            if p.wDurDirty >= 50:
                self._flush_dur(p)                   # ★ 攒 50 次写一次盘 ✓ 不炸磁盘 ✓
            # ★ 第 103 轮：防具耐久也定期推 ✓
            if p.aDurMax > 0 and p.aDurDirty % 10 == 0:
                self._send_cid(p.cid, P.pack('dur', d=p.wDur, m=p.wDurMax,
                                             ad=p.aDur, am=p.aDurMax))
            if p.wDurDirty % 10 == 0:
                # ★ 每 10 次推一次耐久给客户端 ✓（不然界面上的条子会停在旧值 ✗）
                self._send_cid(p.cid, P.pack('dur', d=p.wDur, m=p.wDurMax))
            if p.wDur <= 0:
                self._break_weapon(p)
                return

        p.atkSeq += 1        # ★★ 第 66 轮：这一刀要播给所有人看（别人靠它触发动作 ✓）

        # ★★ 第 69 轮：弓 = 远程投射物（不走下面的近战扇形 ✗）★★
        if wlook in weapons.RANGED:
            if len(self.arrows) < ARROW_MAX:
                self._arrow_id += 1
                _atk = self._atk_of(p)
                _dv, _crit = mobs.roll_damage(
                    _atk, crit_pt=_T.get('crit_pt', 0.0),
                    crit_dmg=_T.get('crit_dmg', 0.0))
                self.arrows[str(self._arrow_id)] = {
                    'id': self._arrow_id,
                    'x': p.x, 'z': p.z, 'yaw': p.yaw,
                    'dx': math.sin(p.yaw), 'dz': math.cos(p.yaw),
                    'dmg': _dv, 'crit': bool(_crit),
                    'life': reach / ARROW_SPEED,      # 飞完射程就落地 ✓
                    'by': p.cid,
                }
            return

        # ★ 这把武器的机制（按品阶加成 ✓）
        fx = weapons.fx_of(wlook, wtier)
        # ①-★ 第 150 轮：先打人✗（PVP ✓一次挥砍两者都能打到 ✓ 用户确认 ✓）
        #   放在前面是为了让 PVP 先结算 ✗（不影响僵尸那边 ✓ 两边各算各的 ✓）
        try:
            for _q in list(self.players.values()):
                if _q is p:
                    continue
                if (abs(_q.x - p.x) > reach + 1.0) or (abs(_q.z - p.z) > reach + 1.0):
                    continue
                self._pvp_hit(p, _q, reach, arc)
        except Exception:
            pass
        # ① 僵尸：扇形里按武器机制结算（第 59 轮 ✓）
        rng = random.random
        _hits = 0
        _pierce = 1
        if fx and fx['name'] == '贯穿' and rng() < fx['chance']:
            _pierce = int(fx['value'])          # 这一刀最多打几个 ✓
        for m in list(self.mobs.values()):
            if m.hp <= 0:
                continue
            if not mobs.in_front(p.x, p.z, p.yaw, m.x, m.z, reach, arc):
                continue
            if _hits >= _pierce:
                break                                # 贯穿次数用完 → 后面的打不到 ✓
            _hits += 1
            atk = self._atk_of(p)

            # ★ 匕首【背击】：从背后打 +X%（僵尸是背对着你 ✓）
            back = False
            backMul = 1.0
            if fx and fx['name'] == '背击':
                # 僵尸的朝向 vs 我从它哪边来：夹角 > 90° = 我在它背后 ✓
                dx, dz = p.x - m.x, p.z - m.z
                fa = math.atan2(dx, dz) - m.yaw
                while fa > math.pi:
                    fa -= math.pi * 2
                while fa < -math.pi:
                    fa += math.pi * 2
                if abs(fa) > math.pi * 0.5:
                    atk *= (1.0 + fx['value'])
                    back = True
                    backMul = 1.0 + fx['value']

            dv, crit = mobs.roll_damage(atk, crit_pt=_T.get('crit_pt', 0.0),
                                        crit_dmg=_T.get('crit_dmg', 0.0))
            # ★ 保安会格挡（方案 §3.3"高防、会格挡"）—— 防御属性已被砍（§4.5），
            #   所以这里用"减伤"实现，和方案 §5"减伤是唯一的减伤属性"一致 ✓
            blocked = False
            if m.kind == '保安' and rng() < mobs.BLOCK_CHANCE:
                dv = max(1, int(round(dv * mobs.BLOCK_MUL)))
                blocked = True
            m.hp -= dv
            self._add_pend(p.cid, 'mhits', {'mid': m.mid, 'dmg': dv, 'crit': bool(crit),
                                            'block': blocked, 'back': back,
                                            # ★ 第 62 轮：背击倍率 → 客户端能算出"额外打了多少"✓
                                            'mb': round(backMul, 2) if back else None,
                                            'heal': _heal,
                                            'x': round(m.x, 2), 'z': round(m.z, 2)})

            # ★★ 第 60 轮：吸血词条 —— 按造成的伤害回血 ✓
            _ls = _T.get('lifesteal', 0.0)
            _heal = 0
            if _ls > 0:
                hpm = self._hp_max(p)     # ★ 第 67 轮：含防具加成 ✓
                _heal = max(1, int(round(dv * _ls / 100.0)))
                p.hp = min(hpm, int(p.hp) + _heal)
                # ★ round352（用户："吸血要飘绿字"）：把数值塞进 mhits ✓
                #   （客户端在同一个循环里就能拿到 ✓ 不用新事件通道 ✓）

            # ★★ 命中后按武器类型触发机制 ★★
            self._weapon_fx(p, m, fx, dv)

            if m.hp <= 0:
                m.hp = 0
                self._mob_died(p, m)
        # ② 玩家：只有 PvP 开着才打得到（服务器权威开关 ✓，不是客户端说了算）
        if self.pvp:
            for q in self.players.values():
                if q is p:
                    continue
                if not mobs.in_front(p.x, p.z, p.yaw, q.x, q.z, reach, arc):
                    continue
                dv, _ = mobs.roll_damage(self._atk_of(p))
                self._add_pend(q.cid, 'hurts', {'dmg': dv, 'x': round(p.x, 2),
                                                'z': round(p.z, 2), 'by': p.name, 'pvp': 1})

    def _weapon_fx(self, p, m, fx, dv):
        """命中后触发武器机制（第 59 轮 ✓ 全部由服务器算 ✓）"""
        if not fx or m.hp <= 0:
            return
        nm = fx['name']
        if nm == '流血':
            if random.random() < fx['chance']:
                m.bleedT = weapons.BLEED_TIME
                m.bleedDmg = max(0.5, dv * fx['value'] / weapons.BLEED_TIME)
                m.bleedFrom = p
                self._send_cid(p.cid, P.pack('fx', kind='bleed', mid=m.mid))
        elif nm == '击退':
            if m.knockImmune <= 0 and random.random() < fx['chance']:
                m.knockImmune = weapons.KNOCK_IMMUNE
                # 顺着"我→他"的方向推出去 ✓
                dx, dz = m.x - p.x, m.z - p.z
                d = max(0.01, (dx * dx + dz * dz) ** 0.5)
                m.x += dx / d * fx['value']
                m.z += dz / d * fx['value']
                self._send_cid(p.cid, P.pack('fx', kind='knock', mid=m.mid))
        elif nm == '眩晕':
            if m.stunImmune <= 0 and random.random() < fx['chance']:
                m.stunT = fx['value']
                m.stunImmune = weapons.STUN_IMMUNE
                self._send_cid(p.cid, P.pack('fx', kind='stun', mid=m.mid))
        elif nm == '溅射':
            # 对主目标 1.5 米内最多 2 个再各打一份 ✓（不触发二次溅射 ✓ 防递归）
            n, r2 = 0, weapons.SPLASH_R * weapons.SPLASH_R
            for o in list(self.mobs.values()):
                if n >= weapons.SPLASH_MAX:
                    break
                if o is m or o.hp <= 0:
                    continue
                if (o.x - m.x) ** 2 + (o.z - m.z) ** 2 > r2:
                    continue
                sdv = max(1, int(round(dv * fx['value'])))
                o.hp -= sdv
                self._add_pend(p.cid, 'mhits', {'mid': o.mid, 'dmg': sdv, 'crit': False,
                                                'splash': True,
                                                'x': round(o.x, 2), 'z': round(o.z, 2)})
                n += 1
                if o.hp <= 0:
                    o.hp = 0
                    self._mob_died(p, o)

    def _mob_died(self, p, m):
        # ★★★ 第 217 轮修的真 bug（用户实测发现）★★★
        #   用户原话："出现给很多经验的情况是自动捡东西触发的，
        #             我看到这个系统提示一下刷新很多条，经验也跟着狂长"
        #
        #   病根：这个函数是"结算一只怪"（给经验 + 队友分经验 + 掉落 ✓）
        #         但它【没有"这只怪已经算过了"的标记】✗
        #         唯一的保护是调用处那句 "血量 <= 0 才结算"✓
        #         而尸体还留在场景里 ✓ 任何一条路径再打到它 ✗
        #         → 就再结算一次 ✓✓
        #   ★ 为什么自动战斗/自动捡东西一开就明显：
        #     自动战斗每 0.62 秒挥一刀 ✓ 全砍在尸体上 ✓
        #     → 一次击杀被结算几十次 → 提示刷屏 + 经验狂涨 ✓✓
        #   ★ 修法：加一个一次性标记 ✗ 一只怪【只可能】结算一次 ✓
        #     这样不管以后谁再写出打到尸体的路径 ✗ 都不会重复给 ✓
        if getattr(m, 'awarded', False):
            return
        m.awarded = True
        # ★ 第 67 轮：击杀回灵气（防具词条 ✓）
        try:
            _qi = armormod.stats_of(p.armor)['qi_kill']
            if _qi > 0:
                p.qi = min(int((p.role or {}).get('qiMax') or 100), int(p.qi) + int(_qi))
        except Exception:
            pass
        """僵尸死了 → 给击杀者经验 → 队友分 10% → 落库"""
        self._gain_exp(p, int(m.exp))
        # round293: gold from kills. Base by kind, scaled by mob level.
        #   Small on purpose (~25 gold per mob) - user decision, see docs v3.
        try:
            _gk = str(getattr(m, 'kind', '') or '')
            if _gk in ('工人', '保安', '健身教练'):
                _gb = 12
            elif _gk in ('医生', '程序员'):
                _gb = 8
            else:
                _gb = 5
            _gl = max(1, int(getattr(m, 'lv', 1) or 1))
            _gg = int(_gb * (1.0 + _gl / 12.0))
            if _gg > 0:
                self._gain_gold(p, _gg, 'kill')
        except Exception as _ge:
            print('[gold] kill drop failed: %r' % (_ge,))
        # ★★ 第 81 轮：队友分经验（用户确认：每个队友拿该僵尸的 10% ✓）★★
        self._party_share_exp(p, m)
        self._save_role(p)
        # ★ 掉落（第 38 轮）：地上生成一件，走过去自动捡 ✓
        self._roll_loot(p, m)

    def _roll_loot(self, p, m):
        """僵尸死了 roll 掉落（方案 §8：每次击杀【逐项独立】roll ✓）

        ★ 第 47 轮：材料和装备各 roll 一次 —— 所以一次击杀有可能两样都掉 ✓
          （§8 开头那句"全部概率到身上"就是这个意思 ✓）
        """
        klv = int(p.role.get('level') or 1)
        # ★ 第 60 轮：寻宝词条会按比例抬掉落概率 ✓
        _t = affixes.totals(((p.weapon or {}).get('affixes')))
        _tb = 1.0 + _t.get('treasure', 0.0) / 100.0
        it = drops.roll_drop(m.lv, klv, luck=_tb)
        # ★ 第 67 轮：掉到东西时有 25% 概率是【防具】✓
        #   （不然防具永远拿不到 ✗ 只能靠管理页发 ✗）
        if it and random.random() < 0.25:
            _ta = max(0, min(11, int(it.get('tier') or 0)))
            # ★★★ 第 104 轮修的真 bug ★★★
            #   原来这里是包了一层：{'name':…, 'kind':'armor', 'slot':'armor',
            #                        'armor': make_armor(...)}
            #     外层【没有 base】✗ 而拾取时是把【外层】直接存进背包 ✗
            #     → 捡起来的防具 = 一个"材料形状的假防具"✗
            #       （名字对、图标是防具、但没有 base → 属性算不出来 ✓
            #         20 件这样的假防具已经在库里了 ✓ 用户报的"材料图标像防具"就是它 ✓）
            #   修：直接存【防具本体】✓ 它的字段本来就是齐的（name/tier/base/slot…）✓
            it = armormod.make_armor(_ta, max(1, klv // 4 + 1))
        self._drop_one(p, m, it)
        eq = drops.roll_equip(m.lv, klv)          # ★ 装备类（独立 roll）
        self._drop_one(p, m, eq)

    def _drop_one(self, p, m, it):
        """把一件掉落物放到地上（it 为 None 就什么都不做 ✓）"""
        if not it:
            return
        self.loot_seq += 1
        lid = str(self.loot_seq)
        # ★ 装备的坐标稍微错开一点 —— 不然和材料叠在同一点，捡的时候看不出来哪件是哪件 ✗
        ox = 0.0 if it.get('slot') != 'weapon' else 0.7
        self.loot[lid] = {'x': m.x + ox, 'z': m.z, 'item': it, 'ttl': drops.DROP_TTL}
        self._send_cid(p.cid, P.pack('notice', text='掉落：%s（%d 阶）走过去自动捡 ✓'
                                     % (it['name'], tier_no(it.get('tier')))))

    def _loot_tick(self, dt):
        """地上物：倒计时 + 过期收掉（不清理的话服务器越积越多 ✗）"""
        for lid in list(self.loot.keys()):
            e = self.loot[lid]
            e['ttl'] -= dt
            if e['ttl'] <= 0:
                self.loot.pop(lid, None)

    def _loot_for(self, p):
        """发给客户端的地上物：范围内、最近的优先、最多 LOOT_SEND_CAP 件
           格式 [id, x, z, name, tier]（和 mobs 一样是紧凑数组 ✓）"""
        if not self.loot:
            return None
        v2 = drops.LOOT_VIEW * drops.LOOT_VIEW
        cand = []
        for lid, e in self.loot.items():
            d2 = (e['x'] - p.x) ** 2 + (e['z'] - p.z) ** 2
            if d2 <= v2:
                cand.append((d2, lid, e))
        if not cand:
            return None
        if len(cand) > drops.LOOT_SEND_CAP:
            cand.sort(key=lambda it: it[0])
            cand = cand[:drops.LOOT_SEND_CAP]
        # ★ 第 70 轮：多带一个 look（客户端要在地上摆【缩小版模型】✓）
        # ★ 第 171 轮（用户 #9）：再追加一位【大类】= slot
        #   客户端要按它选形状（防具用胸甲模型 ✓ 武器用缩小版武器 ✓ 其余方块 ✓）
        #   ★ 只能往后追加 ✗ 前面的下标一个都不能动 ✓（客户端按下标读 ✓）
        return [[lid, round(e['x'], 2), round(e['z'], 2), e['item']['name'],
                 e['item']['tier'], e['item'].get('look') or '',
                 e['item'].get('slot') or 'mat']
                for _, lid, e in cand]

    def _intent_pick(self, p, d):
        """捡东西 —— ★ 服务器判距离（客户端说捡到了不算数 ✓）"""
        lid = str(d.get('id') or '')
        e = self.loot.get(lid)
        if not e:
            return
        if (e['x'] - p.x) ** 2 + (e['z'] - p.z) ** 2 > drops.PICK_RANGE ** 2:
            return                      # 太远 → 不认（防"隔空捡"✗）
        it = e['item']
        # ★ 第 250 轮（用户要求）：捡到 5 阶及以上要播报
        #   tier_no() 是 0 基的（内部 0 = 显示 1 阶）✗ 所以判断用 >= 4 ✓
        try:
            if int(it.get('tier') or 0) >= 4:
                self._ticker('%s 拾取到 %d 阶 · %s' % (
                    p.name, int(it.get('tier') or 0) + 1, it.get('name') or '装备'),
                    'tier', tag='tier:%d' % p.role_id)
        except Exception as _e3:
            print('[ticker] 拾取播报失败：%r' % (_e3,))
        self.loot.pop(lid, None)
        self.loot_seq += 1
        import json
        import db as dbmod
        # ★★ 第 54 轮：不再直接 INSERT ★★
        #   材料要堆叠（同名同阶合到一行 ✓），武器不堆叠 ✓
        #   但"查一下有没有同类的"要读库 ✗ → tick 线程不许碰磁盘 ✗
        #   → 把整件事交给存档线程（它收到 'PICK' 自己决定 +1 还是新建 ✓）
        self.post_save('PICK', (p.role_id, json.dumps(it, ensure_ascii=False),
                                dbmod.now_ms()))
        self._send_cid(p.cid, P.pack('notice',
                                     text='拾取：%s（%d 阶）' % (it['name'], tier_no(it.get('tier')))))

    def _add_pend(self, cid, key, item):
        """攒本 tick 要给某个玩家的反馈（hurts / mhits / me）"""
        e = self._pend.get(cid)
        if e is None:
            e = self._pend[cid] = {}
        lst = e.get(key)
        if lst is None:
            lst = e[key] = []
        if len(lst) < 24:                # 一条快照最多带 24 条（防刷屏 + 防包太大 ✓）
            lst.append(item)

    def _mobs_for(self, p):
        """发视野内的僵尸（近的优先，最多 MOB_RENDER_CAP 只 —— 方案 §3.2）"""
        if not self.mobs:
            return None                  # ★ 返回 None = 快照里干脆不带这个字段 ✓
        v2 = mobs.MOB_VIEW * mobs.MOB_VIEW
        cand = []
        for m in self.mobs.values():
            dx = m.x - p.x
            dz = m.z - p.z
            d2 = dx * dx + dz * dz
            if d2 <= v2:
                cand.append((d2, m))
        if not cand:
            return None
        if len(cand) > mobs.MOB_RENDER_CAP:
            cand.sort(key=lambda it: it[0])
            cand = cand[:mobs.MOB_RENDER_CAP]
        return [m.wire() for _, m in cand]

    def _save_role(self, p):
        """经验 / 等级落库（只入队 ✓ 写盘交给存档线程）"""
        import db as dbmod
        self.post_save('UPDATE roles SET level=?, exp=?, updated_at=? WHERE id=?',
                       (int(p.role.get('level') or 1), int(p.role.get('exp') or 0),
                        dbmod.now_ms(), p.role_id))

    # ============================================================ 发给网络线程

    def _to_net(self, fn, *args):
        """从 tick 线程往 asyncio 循环里投任务。循环已经关了就算了"""
        if self.loop is None:
            return
        try:
            self.loop.call_soon_threadsafe(fn, *args)
        except Exception:
            pass

    def _send_cid(self, cid, text):
        self._to_net(self._send_one, cid, text)

    def _send_one(self, cid, text):
        """★ 在 asyncio 循环里执行"""
        conn = self.srv_conns.get(cid) if self.srv_conns else None
        if conn:
            conn.push_text(text)

    def _fanout(self, batch):
        """★ 在 asyncio 循环里执行：把这一 tick 的快照推给各自的连接"""
        conns = self.srv_conns
        for cid, text in batch:
            c = conns.get(cid)
            if c:
                c.push_text(text)

    def _ticker(self, text, kind='sys', tag=''):
        """第 247 轮（用户要求）：滚动通知（弹幕）

        · notice = 只发给一个人 ✗ 屏幕中间弹一下（"你已经在安全区了"这类）
        · ticker = 广播给所有人 ✗ 屏幕上方【向左滚动】（谁升级了 / 谁杀了谁）
        文案限长 22 字：滚动时长 = (文字宽 + 屏宽) ÷ 速度 ✗ 太长会滚十几秒 ✗ 后面全堵住
        同类 1 秒内合并：打团战 3 秒杀 5 个 ✗ 不然弹幕滚一分钟
        """
        try:
            import time as _t
            now = _t.time()
            if tag:
                last = self._ticker_last.get(tag)
                if last is not None and now - last < 1.0:
                    self._ticker_dup[tag] = self._ticker_dup.get(tag, 0) + 1
                    return
                n = self._ticker_dup.pop(tag, 0)
                if n:
                    text = text + '（等 %d 条）' % n
                self._ticker_last[tag] = now
            if len(text) > 22:
                text = text[:21] + '…'
            self._broadcast(P.pack('ticker', text=text, kind=kind))
        except Exception as e:
            print('[ticker] 发不出去：%r' % (e,))

    def _broadcast(self, text):
        """★ 在 asyncio 循环里执行"""
        for c in list(self.srv_conns.values()):
            c.push_text(text)

    # ============================================================ 快照

    def _snapshot_for(self, p):
        """只发接收者视野内的玩家（方案 §13.2 兴趣管理的第一步）"""
        out = []
        v2 = VIEW * VIEW
        for o in self.players.values():
            if o is p:
                continue
            dx = o.x - p.x
            dz = o.z - p.z
            if dx * dx + dz * dz > v2:
                continue
            out.append({
                'id': o.role_id,
                # ★★ 第 90 轮：直接告诉你"他是不是你队友" ★★
                #   为什么不让客户端自己比 role_id ✗
                #   因为客户端要拿到名单、要判断时机、还可能因为消息没到而判断不出来 ✗
                #   服务器这里一句话就说清了 ✓ 最可靠 ✓
                'mate': 1 if (self.party_of.get(o.role_id) is not None and
                              self.party_of.get(o.role_id) == self.party_of.get(p.role_id)) else 0,
                # ★ 第 152 轮：头顶要显示魔气 → 快照里带上它 ✓
                #   （只有 >0 才有意义 ✗ 客户端拿不到就是 0 ✓）
                'mq': (int(o.mq or 0) if int(o.mq or 0) > 0 else 0),
                'n': o.name,
                'x': round(o.x, 3),
                'z': round(o.z, 3),
                'y': round(o.yaw, 3),
                # ★ round330：离地高度 ✗ 别人的客户端拿它还原跳跃动作 ✓
                'jy': round(getattr(o, 'jy', 0.0) or 0.0, 3),
                't': round(o.ct, 3),      # ★ 对方自己的钟 → 客户端做插值时间轴
                'hp': o.hp,
                # ★★★ 第 220 轮修的真 bug（用户自己发现的！）★★★
                #   用户原话："玩家看到的血量是没有防具加成的，而我自己看是有的"
                #   病根：这里【只发了 hp，没发 hpm（有效上限）】✗
                #         而客户端读别人的血条时兜底值是 100：
                #             hpMax: (w.hpm > 0) ? w.hpm : 100
                #         → 别人看你的血条分母永远是 100 ✗
                #           你实际上限 200+（含防具）→ 血条一直是满的/乱的 ✓
                #   ★ 用 _hp_max（含防具 + 天赋 ✓）和发给你自己的那个口径完全一致 ✓
                #   ★ 客户端本来就在读 w.hpm ✗ 所以只需要服务器补这一行 ✓
                'hpm': self._hp_max(o),
                'lv': (o.role or {}).get('level', 1),
                'atk': o.atkSeq,   # ★ 第 66 轮：发【挥砍序号】✗ 不是攻击力
                                   #   （攻击力是个从不变化的数 ✗ 客户端拿它当计数器 → 动作永远不播 ✗）
                # ★ 第 61 轮：手上的武器类型 —— 别的玩家要按它放对应的动作 ✓
                #   （不然别人砍起来永远是同一套 ✗）
                'w': (o.weapon or {}).get('look') or 'sword',
                # ★ 第 65 轮：连品阶一起发（模型的颜色/发光是按品阶的 ✓
                #   不然别人看你的剑永远是最低阶的颜色 ✗）
                'wt': int((o.weapon or {}).get('tier') or 0),
                # ★★ 第 63 轮：他的无敌剩余 ★★
                #   不然别人看不到"他刚复活"✗ 只能看到一个站着不挨打的人 ✗
                'inv': round(o.invulnT, 2),
                # ★★ 第 57 轮：他倒下了没有 ★★
                #   以前只同步 hp，客户端没法知道"该不该躺下" ✗
                #   → 别人看被围死的队友，永远是站着的 ✗（用户报的）
                'd': 1 if int(o.hp) <= 0 else 0,
            })
        return out

    # ============================================================ 存档线程

    def _save_player(self, p):
        """只入队，不写盘 —— 写盘交给存档线程"""
        import db as dbmod
        self._flush_dur(p)                       # ★ 下线时把耐久落一次 ✓
        # round302: gold has to be saved too. Memory is authoritative (docs v3 s1),
        # so this is a FULL OVERWRITE - idempotent, and it cannot fight the periodic
        # save. Without it every logout/restart threw the whole balance away.
        self.post_save(
            'UPDATE roles SET x=?, z=?, yaw=?, hp=?, qi=?, updated_at=? WHERE id=?',
            (p.x, p.z, p.yaw, p.hp, p.qi, dbmod.now_ms(), p.role_id))
        # ★ round305：余额【单独】写 ✗ 而且带代号 ✓
        #   ★ 为什么不能跟上面那条 SQL 一起写：
        #     那条里的 gold 是【排队那一刻】的值 ✗ 半秒后可能已经过期 ✓
        #     （登录时排 0 ✗ 同一拍入账 535 ✗ 存档把 0 写下去 → 钱没了 ✓）
        _rid2 = int(getattr(p, 'role_id', 0) or 0)
        if _rid2 and isinstance(getattr(p, 'role', None), dict):
            p.role['gold'] = int(getattr(p, 'gold', 0) or 0)
        self.post_save(*gold_sql(self._gold_seq.get(_rid2, 0), _rid2,
                                  getattr(p, 'gold', 0) or 0))

    def gold_write_ok(self, seq, role_id):
        """这一笔余额写入【还有效吗】（★ 存档线程和离线测试共用同一条判据 ✓）

        ★ round305：gold 是内存权威 ✗ 而存档半秒攒一批 ✗ 排队快照会过期 ✓
          判据：这一笔带的序号 == 该角色当前的序号 ✓
          对不上 = 排队之后钱又被改过 ✗ 这一笔作废（新的那笔马上就来 ✓）
        """
        return int(self._gold_seq.get(int(role_id), 0)) == int(seq)

    def _run_saver(self):
        import db as dbmod
        while self.running:
            batch = []
            try:
                # 攒一小会儿再一起写，减少磁盘次数
                end = time.time() + 0.5
                while time.time() < end and len(batch) < 200:
                    try:
                        batch.append(self.saves.get(timeout=0.1))
                    except queue.Empty:
                        if batch:
                            break
            except Exception:
                pass
            if not batch:
                continue
            # ★ round304b：本批里有哪些交易所事务做成功了（★ commit 之后才通知 tick ✓）
            mkt_ok = []
            mkt_wrote = False
            try:
                with dbmod.db(self.cfg) as db:
                    for sql, params in batch:
                        _gseq = gold_sql_split(sql)
                        if _gseq is not None:
                            # ★★ round305：带"代号"的余额写入 ★★
                            #   sql = 'GOLD:<seq>' ✗ params = (role_id, gold) ✓
                            #   ★ 只有当【这一笔不是在它排队之后又被改过】才写 ✓
                            #     排队时是 0 ✗ 之后入账成 535 ✓ → 这一笔作废 ✓
                            #     （入账自己会排一笔新的 ✗ 值一定是新的 ✓）
                            #   ★ 为什么要这么绕：gold 是全项目唯一"内存权威"的字段 ✗
                            #     而存档是【半秒攒一批】的 ✗ 排队快照随时可能过期 ✓
                            if not self.gold_write_ok(_gseq, params[0]):
                                continue
                            db.execute('UPDATE roles SET gold=?, updated_at=? WHERE id=?',
                                       (int(params[1]), dbmod.now_ms(), int(params[0])))
                            continue
                        if isinstance(sql, tuple):
                            # ★★ round304b：交易所事务在队列里是 (('MKT', kind, {...})) ★★
                            #   ★ 是【元组】不是字符串 ✗（自测当场抓到：
                            #     写成 sql == 'MKT' 的话元组会掉到最后那条 db.execute ✗
                            #     报 TypeError: execute() argument 1 must be str ✓）
                            mkt_wrote = True
                            self._save_mkt(db, sql)
                            if sql[2].pop('_mkt_ok', 0):
                                mkt_ok.append(sql[2])
                            continue
                        if sql == 'PICK':
                            # ★★ 材料堆叠（第 54 轮）★★
                            #   武器/装备：永远新建一行（不堆叠 ✓）
                            #   材料：同名同阶就 +1（只在【背包里】合并 ✓ 仓库不混 ✗）
                            self._save_pick(db, params)
                            continue
                        db.execute(sql, params)
            except Exception as e:
                # ★ 整批回滚了（含已经写好的交易所事务 ✗）
                #   → 这一批里所有"标记成功"的都要改口说失败 ✗ 让 tick 把钱退回去 ✓
                for row in mkt_ok:
                    self._mkt_mem(False, str(row.pop('_mkt_kind', '') or ''), row,
                                  reason=repr(e))
                mkt_ok = []
                if mkt_wrote:
                    print('  [save] 交易落盘失败（整批回滚）：%r' % e)
                else:
                    print('  [save] 落盘失败：%r' % e)
            # ★ commit 真的过了 ✗ 现在才敢通知 tick"成了"（方案 §9 ✓）
            for row in mkt_ok:
                self._mkt_mem(True, str(row.pop('_mkt_kind', '') or ''), row)

    def _save_mkt(self, db, params):
        """交易所的一条事务（★ 只有存档线程会进来 ✓ 方案 §9 ✓）

        四种动作：
          list   上架：INSERT listings → DELETE items
          buy    成交：UPDATE listings@sold → 保证买家身份 → INSERT trade_log(sid 主键)
                       → 把物品塞给买家 / 把卖家的钱记进 pending_gold
          unlist 下架：UPDATE listings@cancelled/expired → 把东西放回卖家背包
          exp    过期：同上（原样退回 ✓）

        ★★ 为什么整段都在这一个 with 里：
           方案 v3 §9 要的是"成交 = 一条事务"✗ 中途抛异常整笔回滚 ✓
           → 不会出现"上架单变已售但东西没给买家"这种半截状态 ✓
        ★★ trade_log.sid 是主键：同一个 sid 再来一次会撞 UNIQUE ✗ 整笔回滚 ✓
           这就是幂等的最后一层（方案 v3 §5 ✓）
        ★★ 失败要回滚【内存里的钱】✗ 而内存只有 tick 线程能碰 ✓
           → 所以这里只把失败丢进 mkt_failq ✗ tick 下一次就把钱退回去 ✓
        """
        # ★★ 自测当场抓到的两个坑（都改在这里 ✗ 别再写回去）★★
        #   ① 我原来写的是 json_dumps ✗ 而这个函数【根本不存在】✗
        #      （凭印象写名字 ✗ 和 auth.py 那次 _equipped 一个毛病 ✓）
        #      → 4 处调用全会 NameError ✗ 被 run_saver 的 except 吞掉 ✓
        #   ② 参数解错了：队列里那一条【整条就是元组】
        #        语句 = ('MKT', 'list'|'buy'|'unlist'|'exp', {...})
        #      → params[0] 是 'MKT' ✗ params[1] 才是动作名 ✓
        #      我原来写 params[1] 当 row ✗ 于是 isinstance(row, dict) 永远 False
        #      → 【静默 return】✗ 库里什么都没发生 ✗ 而且一点都不报错 ✓✓
        #      ★ 教训：静默 return 比抛异常难查一百倍 ✗ 该抛就抛 ✓
        #   ③ 还有第三个：_mkt_save_list 里的 json.dumps 在【模块级】就没导入过
        #      → 局部 import 救不了别的函数 ✗ 只能提到文件头 ✓
        kind = ''
        row = None
        if isinstance(params, (tuple, list)):
            if len(params) >= 3 and str(params[0]) == 'MKT':
                kind = str(params[1] or '')
                row = params[2]
            elif len(params) == 2:
                kind, row = str(params[0] or ''), params[1]
        if not isinstance(row, dict):
            print('[mkt] save_mkt got a bad payload: %r' % (params,))
            return
        # ★ 动作名钉在 row 上：后面所有回执都用它 ✗ 不再从别处猜 ✓
        row['_mkt_kind'] = kind
        try:
            if kind == 'list':
                self._mkt_save_list(db, row)
                row['lid_tmp'] = int(row.get('lid_tmp') or 0)
            elif kind == 'buy':
                self._mkt_save_buy(db, row)
            elif kind in ('unlist', 'exp'):
                self._mkt_save_back(db, row, kind)
                # ★ 幂等：已经不是 'on' 了也算成功（重复点不该报错 ✗ 但钱/货都没动 ✓）
                row['noop'] = 1 if not row.pop('_did', 0) else 0
        except _MktRollback as e:
            # 业务性回滚（东西被买走了 / 物品不在背包 ✗）→ 报给 tick 去退钱 ✓
            self._mkt_mem(False, kind, row, reason=str(e))
            return
        except Exception as e:
            self._mkt_mem(False, kind, row, reason=repr(e))
            raise
        # ★ 走到这里 = with 块会正常 commit ✗ 但 commit 本身还可能失败 ✓
        #   所以真正的"成功"由 _run_saver 在 commit 之后再说（见那里的 done 通知 ✓）
        row['_mkt_ok'] = 1

    def _mkt_save_list(self, db, row):
        seller = int(row.get('seller') or 0)
        iid = int(row.get('iid') or 0)
        price = int(row.get('price') or 0)
        it = row.get('it') or {}
        try:
            qty = max(1, int(row.get('qty') or 1))
        except Exception:
            qty = 1
        if not mkmod.is_stack(it):
            qty = 1        # ★ 装备永远 1 件（防有人乱传 qty ✓）
        # ① 先把上架单开出来（lid 是自增的 ✗ 要拿到手才能进内存 ✓）
        #   ★ round304l：qty 一起写 ✗ 这就是"还剩几个"的权威值 ✓
        # ★ round304q：把"原物品 id"也写进上架单的 item_json（__iid ✓）
        #   ★ 为什么要写进去："我挂的是哪一件"只能靠 id 认（同名多件 ✗）
        #     而货架重启/重载时是从库里的 item_json 重建的 ✗
        #     不写进去 → 重载后 iid 全变 0 ✗（自测正好抓到这个 ✓）
        _it_saved = dict(it)
        _it_saved['__iid'] = int(iid)
        cur = db.execute(
            'INSERT INTO listings(seller, item_json, price, ts, expire, state, qty)'
            ' VALUES(?,?,?,?,?,?,?)',
            (seller, json.dumps(_it_saved, ensure_ascii=False), price, dbmod.now_ms(),
             dbmod.now_ms() + int(valuemod.MKT_DAYS) * 86400000, 'on', qty))
        lid = int(cur.lastrowid or 0)
        # ★★ 自测抓到的第 5 个坑：到期时刻必须【回灌】到内存行 ✓
        #   内存那一行是上架时乐观加进去的 ✗ 那时还没有 ts/expire ✓
        #   不回灌的话 exp=0 ✗ → 刚上架的东西当场算"已过期"✓✓
        #     表现：买家一点就说"已过期"✗ 5 秒后清扫还会把它退回来 ✓
        #   ★ 单位：内存行里的 ts/exp 一律【秒】✗ 详见 value.now_s() 的注释 ✓
        #     这里原来写的是 now_ms()/1000.0（毫秒换算过来 ✓ 数值对得上）
        #     但和 _mkt_list 里乐观写进去的 now_s() 是【两个来源】✓ → 迟早错 ✓
        _now = valuemod.now_s()
        row['lid'] = lid
        row['ts'] = _now
        row['exp'] = _now + int(valuemod.MKT_DAYS) * 86400
        # ② 从背包里把它拿走（★ 这是"东西还在不在"的唯一判据 ✓）
        #   ★★ round304l：能堆叠的要【按数量拆】✗ 不能把整堆都拿走 ✓
        #      · qty == 整堆  → 直接删那一行（最省事 ✓）
        #      · qty <  整堆  → 行里的 stack 减 qty（★ 只减不删 ✓）
        #      · 装备（不堆叠）→ 只能 qty=1 ✗ 走删除 ✓
        #    ★ 为什么不用"删了再插回去"：那样会换 id ✗
        #      客户端手里的背包快照立刻就过期了 ✓（能少动就少动 ✓）
        cur2 = db.execute(
            'UPDATE items SET stack = stack - ?'
            ' WHERE id=? AND role_id=? AND in_storage=0 AND stack >= ?',
            (qty, iid, seller, qty))
        try:
            took = int(cur2.rowcount or 0)
        except Exception:
            took = 0
        if took == 1:
            # 减完了是 0 就把那一行删掉（不留 stack=0 的空行 ✓）
            db.execute('DELETE FROM items WHERE id=? AND role_id=? AND in_storage=0'
                       ' AND stack <= 0', (iid, seller))
        else:
            # 减不动：要么东西不在了 ✗ 要么那一堆不够 qty ✓
            left = None
            try:
                r2 = db.execute('SELECT stack FROM items WHERE id=? AND role_id=?'
                                ' AND in_storage=0', (iid, seller)).fetchone()
                left = int(r2[0]) if r2 else None
            except Exception:
                left = None
            raise _MktRollback('背包里这件东西不够了（要 %d ✗ 剩 %s）' % (qty, left))
        row['lid'] = lid

    def _mkt_save_buy(self, db, row):
        """买家买走 N 个（★ round304l：可以只买一部分 ✓）

        ★ 一笔成交 = 【一行 trade_log】+ 【上架单 qty 递减】✓
          · 买完（qty 到 0）→ state 变 sold ✗ 从货架上消失 ✓
          · 只买一部分 → state 还是 on ✗ qty 变小 ✓ 别人还能接着买 ✓
        ★ 幂等仍然靠 trade_log.sid（主键 ✓ 重复撞了整笔回滚 ✓）
        """
        sid = str(row.get('sid') or '')
        lid = int(row.get('lid') or 0)
        price = int(row.get('price') or 0)      # ★ 这一笔的【总价】
        qty = max(1, int(row.get('qty') or 1))  # ★ 这一笔买几个
        tax = int(row.get('tax') or 0)
        buyer = int(row.get('buyer') or 0)
        seller = int(row.get('seller') or 0)
        it = row.get('it') or {}
        stack = max(1, int(row.get('stack') or 1))
        # ① 扣数量：条件里带 qty >= 本笔数量 ✗ rowcount=0 = 被别人买光/买超了 ✓
        #   ★ 这是并发下唯一的真相来源（内存只是"大概"✗ 库才是准的 ✓）
        cur = db.execute(
            "UPDATE listings SET qty = qty - ? WHERE lid=? AND seller=?"
            " AND state='on' AND qty >= ?",
            (qty, lid, seller, qty))
        try:
            n = int(cur.rowcount or 0)
        except Exception:
            n = 0
        if n != 1:
            raise _MktRollback('上架单已被买走或数量不够（lid=%d ✗ 要 %d）' % (lid, qty))
        # ② 卖完了才下架（★ 只买一部分就继续挂着 ✓）
        db.execute("UPDATE listings SET state='sold' WHERE lid=? AND state='on' AND qty<=0",
                   (lid,))
        #   ★★ 把库里剩下的数量回给 tick ✗ 不然内存那份会停在旧值 ✓
        #     自测抓到的：内存里还剩 4 ✗ 回执重建那一行时 qty 丢了 → 默认 1
        #       → 下一个人"买 1"就把它买空了 ✗ 整单直接下架 ✓✓
        try:
            _r = db.execute('SELECT qty, state FROM listings WHERE lid=?', (lid,)).fetchone()
            if _r is not None:
                row['qty_left'] = int(_r[0] or 0)
                row['state_left'] = str(_r[1] or '')
        except Exception:
            pass
        # ③ 保证这个买家真的存在（roles 里没有就是脏数据 ✗ 回滚 ✓）
        if not db.execute('SELECT 1 FROM roles WHERE id=?', (buyer,)).fetchone():
            raise _MktRollback('买家角色不存在（%d）' % buyer)
        # ④ 流水（sid 主键 ✗ 撞了就整笔回滚 ✓）
        #   ★ qty 一起记 ✗ 以后看成交记录才知道"这一笔买的是几个"✓
        db.execute(
            'INSERT INTO trade_log(sid, lid, seller, buyer, price, tax, item_json, ts, qty)'
            ' VALUES(?,?,?,?,?,?,?,?,?)',
            (sid or ('t%d.%d' % (dbmod.now_ms(), lid)), lid, seller, buyer, price, tax,
             json.dumps(it, ensure_ascii=False), dbmod.now_ms(), qty))
        # ⑤ 东西给买家（★ 买几个给几个 ✗ 可堆叠的在买家背包里合堆 ✓）
        self._add_item(db, buyer, it, qty, ('sid', sid, 'buyer', buyer))
        # ⑥ 卖家的钱：在线的话 tick 已经加进内存了 ✗ 这里只补【离线】的 ✓
        if not int(row.get('seller_online') or 0):
            #   走 pending_gold ✗ 上线时自动入账 ✓（不绕过上限/黄金转换 ✓ 方案 §3 ✓）
            db.execute(
                'INSERT INTO pending_gold(role, amount, why, ts, done)'
                ' VALUES(?,?,?,?,0)',
                (seller, mkmod.net_of(price), 'trade_sell', dbmod.now_ms()))

    def _mkt_save_back(self, db, row, kind):
        """把货架上的东西退回背包（下架 / 过期 / 领取 ✗ 三处共用 ✓）"""
        lid = int(row.get('lid') or 0)
        seller = int(row.get('seller') or 0)
        it = row.get('it') or {}
        stack = max(1, int(row.get('stack') or 1))
        state = 'expired' if (kind == 'exp' or int(row.get('expired') or 0)) else 'cancelled'
        cur = db.execute("UPDATE listings SET state=? WHERE lid=? AND state='on'",
                         (state, lid))
        try:
            n = int(cur.rowcount or 0)
        except Exception:
            n = 0
        if n != 1:
            # ★ 已经不是 'on' 了（重复下架 / 已经被买走 ✗）
            #   幂等：什么都不做 ✗ 也不报错 ✓（重复点不该把东西变出两份 ✓）
            return
        row['_did'] = 1
        self._add_item(db, seller, it, stack, ('lid', lid, 'back', seller))

    def _add_item(self, db, role_id, it, stack, tag):
        """把一件东西放进某个角色的背包（★ 材料合堆 ✗ 装备单开 ✓ 和 _save_pick 同一口径 ✓）

        ★ 为什么要看 slot 而不是 kind：
          背包里"能堆叠"的只有 slot 为空的东西（材料 / 黄金 ✓）
          装备（slot=weapon/armor）永远一件一行 ✓（和第 54 轮的堆叠规则一致 ✓）
        """
        if not isinstance(it, dict) or not it.get('name'):
            raise _MktRollback('物品数据坏了（%r）' % (tag,))
        n = max(1, int(stack or 1))
        if not it.get('slot'):
            cur = db.execute(
                'UPDATE items SET stack = stack + ?'
                ' WHERE role_id=? AND in_storage=0'
                "   AND json_extract(item_json,'$.name')=?"
                "   AND json_extract(item_json,'$.tier')=?"
                "   AND json_extract(item_json,'$.slot') IS NULL",
                (n, role_id, it.get('name'), int(it.get('tier') or 0)))
            try:
                hit = int(cur.rowcount or 0)
            except Exception:
                hit = 0
            if hit:
                return
        db.execute(
            'INSERT INTO items(role_id, in_storage, slot_index, stack, item_json, created_at)'
            ' VALUES(?,0,-1,?,?,?)',
            (role_id, n, json.dumps(it, ensure_ascii=False), dbmod.now_ms()))

    def _mkt_mem(self, ok, kind, row, reason=''):
        """把落库结果告诉 tick 线程（★ 内存只有 tick 能改 ✗ 走队列 ✓）

        ★ 为什么成功和失败走【同一个队列】：
          它们必须在 tick 里按【落库的先后顺序】处理 ✗
          分成两个队列的话顺序就乱了 ✓（比如先成功后失败，钱会算错 ✓）
        ★ 里面装的是那个 row（原地加工过的）✗ 不重新拼一份 ✓
          因为 tick 需要 lid / it / price / fee 这些原样的字段 ✓
        """
        try:
            d = dict(row)
            d['done'] = 1 if ok else 0
            # ★★ 自测抓到的连环坑（第 4 个 ✗ 都长一个样）★★
            #   原来是 d['kind'] = str(kind) ✗ 而调用处写的是 row.get('kind') ✓
            #   那个 key 本来【不存在】→ None → str 成 'None' ✗
            #   → 回执的 kind 变成字符串 'None' ✗ drain 认不出 ✓
            #   → 走了"未知动作"分支 ✗ 界面显示"操作完成" ✗ 而货架那一行还是负数占位 ✓✓
            #   ★ 教训：kind 必须【显式传进来】✗ 绝不从 row 里猜 ✓
            d['kind'] = str(kind)
            # ★ 回执要用的名字：从 item_json 里补一份 ✗ 别指望调用方都传 ✓
            #   （自测抓到的第 7 个坑：成交回执给买家发的通知是"买到【None】"✓
            #    因为 buy 那条 post_save 里根本没带 name ✓）
            if not d.get('name') and isinstance(d.get('it'), dict):
                d['name'] = str(d['it'].get('name') or '物品')
            # ★ 回执发给谁：默认是卖家（上架/下架/过期都是他 ✓）
            #   买入那条由 _mkt_buy 显式写 'reply'（买家 ✗ 卖家优先会取错人 ✓）
            d['role'] = int(d.get('reply') or d.get('seller') or d.get('buyer') or 0)
            if not ok:
                d['msg'] = '操作失败：%s' % (reason or '数据库出错')
            self.mkt_failq.put(d)
        except Exception as e:
            print('[mkt] mem report failed: %r' % (e,))


    def _save_pick(self, db, params):
        """把捡到的一件东西落库：材料堆叠、装备单开（★ 只有存档线程会进来 ✓）"""
        role_id, js, now = params[0], params[1], params[2]
        import json
        try:
            it = json.loads(js)
        except Exception:
            return
        is_equip = bool(it.get('slot'))          # 武器/防具 → 不堆叠 ✓
        if not is_equip:
            # 同名同阶的材料（且必须是【材料】：slot 为空 ✓）→ stack + 1
            cur = db.execute(
                "UPDATE items SET stack = stack + 1"
                " WHERE role_id=? AND in_storage=0"
                "   AND json_extract(item_json,'$.name')=?"
                "   AND json_extract(item_json,'$.tier')=?"
                "   AND json_extract(item_json,'$.slot') IS NULL",
                (role_id, it.get('name'), it.get('tier') or 0))
            try:
                n = cur.rowcount
            except Exception:
                n = 0
            if n:
                return
        db.execute(
            'INSERT INTO items(role_id, in_storage, slot_index, stack, item_json, created_at)'
            ' VALUES(?,0,-1,1,?,?)',
            (role_id, js, now))

    # ============================================================ 状态（自检用）

    def stats(self):
        return {
            'online': len(self.players),
            'mobs': len(self.mobs),          # ★ P2：现在世界上有多少只僵尸（排查用 ✓）
            'tick': self.tick_count,
            'tickMs': round(self.tick_ms, 3),
            'tickMaxMs': round(self.tick_max_ms, 3),
            'dropped': self.dropped_intents,
            'pendingSave': self.saves.qsize(),
            'inbox': self.inbox.qsize(),
        }


def _f(v, dflt=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return dflt
