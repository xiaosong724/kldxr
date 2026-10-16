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

import math
import queue
import random
import threading
import time

import affixes
import armor as armormod
import drops
import mobs
import mq as mqmod      # ★ 第 149 轮：魔气规则中心 ✓
import weapons
import worldgen
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
PARTY_INVITE_DIST = 20.0      # 邀请的距离（防全图骚扰 ✗）
PARTY_INVITE_TTL = 60.0       # ★ 第 82 轮用户改：10 秒 → 1 分钟 ✓
                              #   （原因：弹窗没看到就没了 ✗
                              #    现在界面里也有待处理列表 ✓ 给一分钟才够用 ✓）
PARTY_INVITE_RATE = 3         # 10 秒最多发 3 次邀请 ✓
AUTO_SAVE_INTERVAL = 15.0   # ★ 第 109 轮：定时存盘（防崩溃/重启丢状态 ✗）
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
                 'moveT', 'moveBad', 'suspect')   # 第 173 轮：传送读条结束时刻（0 = 没在读条）      # ★ 第 168 轮（用户 #5）：离线宽限的时刻 ✓

    def __init__(self, cid, role):
        self.cid = cid
        self.role = role
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
            _np = Player(conn.cid, role)
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
                if pend:
                    if pend.get('hurts'):
                        d['hurts'] = pend['hurts']
                    if pend.get('mhits'):
                        d['mhits'] = pend['mhits']
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
            if _dist > _allow:
                # 不采纳这次位置（保留服务器认可的旧位置 ✓）
                p.moveT = _now                # ★ 时间戳还是要更新 ✗
                #   不然下一包的 dt 会越攒越大 → 允许距离跟着变大 → 反而被放过 ✓
                p.moveBad = int(getattr(p, 'moveBad', 0)) + 1
                p.suspect = int(getattr(p, 'suspect', 0)) + 1
                if p.moveBad == 1 or p.moveBad % 20 == 0:
                    print('[ac] 位移超限：%s 报了 %.1f 米 / 上限 %.1f 米'
                          '（连续第 %d 次）' % (p.name, _dist, _allow, p.moveBad))
                # 超得离谱 → 回推一个纠正位置（客户端会跟过来 ✓）
                if _dist > _allow * MOVE_CORRECT_AT:
                    self._send_cid(p.cid, P.pack('tp', x=round(p.x, 2), z=round(p.z, 2)))
            else:
                p.x = _nx
                p.z = _nz
                p.moveT = _now
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
        elif t == 'equipset':
            # ★ 第 47 轮：网络线程已经查库 + 校验完了，这里只换内存里的引用 ✓
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
        hw = mobs.MOB_BODY / 2.0
        nx = m.x + dx
        if not worldgen.blocked(nx, m.z, hw, hw):
            m.x = nx
        nz = m.z + dz
        if not worldgen.blocked(m.x, nz, hw, hw):
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
            if sig != self._tune_sig:
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
                        1 if q.role_id == pt['leader'] else 0])
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
                                            'x': round(m.x, 2), 'z': round(m.z, 2)})

            # ★★ 第 60 轮：吸血词条 —— 按造成的伤害回血 ✓
            _ls = _T.get('lifesteal', 0.0)
            if _ls > 0:
                hpm = self._hp_max(p)     # ★ 第 67 轮：含防具加成 ✓
                p.hp = min(hpm, int(p.hp) + max(1, int(round(dv * _ls / 100.0))))

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
        self.post_save(
            'UPDATE roles SET x=?, z=?, yaw=?, hp=?, qi=?, updated_at=? WHERE id=?',
            (p.x, p.z, p.yaw, p.hp, p.qi, dbmod.now_ms(), p.role_id))

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
            try:
                with dbmod.db(self.cfg) as db:
                    for sql, params in batch:
                        if sql == 'PICK':
                            # ★★ 材料堆叠（第 54 轮）★★
                            #   武器/装备：永远新建一行（不堆叠 ✓）
                            #   材料：同名同阶就 +1（只在【背包里】合并 ✓ 仓库不混 ✗）
                            self._save_pick(db, params)
                            continue
                        db.execute(sql, params)
            except Exception as e:
                print('  [save] 落盘失败：%r' % e)

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
