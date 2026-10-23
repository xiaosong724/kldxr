# -*- coding: utf-8 -*-
"""僵尸（妖兽）—— P2 第一刀的模型层

★★ 线程纪律：本文件的 Mob 对象【只允许 tick 线程碰】★★（和 Player 一样，见 world.py 顶部）
   网络线程一个字都不读、不写 → 这里一把锁都不用加 ✓
   AI 不放这里（AI 要同时看玩家列表，那是 world 的事）✓ 这里只管"一只僵尸是什么" + 数值 ✓

数值全部照方案抄，不自己编：
    §3.2  血量 = 75 + 22Z + 0.62Z²     攻击 = 8 + 2.5Z + 0.06Z²
          经验 = 10 + 4Z + 0.12Z²      移速 = min(1.2 + 0.004Z, 2.6)
    §3.1  等级抽样：50% 就近 ±1，50% 按 0.72^|Z−L| 衰减，硬下限 Z ≥ 1，安全上限 Z ≤ L+40
    §5    暴击 = 20%，爆伤 = 150%
    §9.1  升级所需经验 = (6 + 1.3L) × (10 + 4L + 0.12L²)
    §3.2  上限：服务器每区域 60 只 / 客户端同屏渲染 40 只

★ 方案 §3.2 自己写了"这只是起点，具体数值在 P2 统一校准" —— 所以这些都放在文件顶部，
  要调就调这几行 ✓
"""

import random
import math
import mob_affixes
import mob_ranks

# ------------------------------------------------------------------ 上限 / 范围
MOB_CAP = 60              # 服务器同时存在的僵尸天花板（§3.2：每区域 60）
MOB_PER_PLAYER = 8        # ★ 每个玩家周围最多同时几只（用户要求：8）
MOB_NEAR_R = 100.0       # round 244: 跟玩家 VIEW 一起改成 100
MOB_RENDER_CAP = 40       # 单个客户端最多收到多少只（§3.2：客户端同屏 40）
MOB_VIEW = 100.0         # round 244: 跟玩家 VIEW 一起改成 100

# ★ 2026-10-23（用户："把怪生成时的距离调近 5 米"）20~34 → 15~29
#   ★ 约束：AGGRO(28) 必须 >= SPAWN_MIN(15) ✓ 刷出来的怪走得到警戒圈 ✓
SPAWN_MIN = 15.0          # 离玩家至少这么远才刷（别在脸上弹出来 ✗）
SPAWN_MAX = 29.0          # 最远刷到这么远
SPAWN_INTERVAL = 2.0      # ★ 多久尝试刷一次
                          #   第 132 轮（用户："补下一只的速度快一点"）：4.0 → 2.0 ✓
                          #   ★ 历史：最初更快 → 第 35 轮用户说"慢一点"调到 4.0 ✗
                          #     现在回到 2.0 ✓（因为现在有硬配额了 ✓
                          #     不会像以前那样刷出一堆）
SPAWN_PER_TRY = 1         # 一次最多补几只
SPAWN_TEAM_R = 35.0       # 组队时以刷新点这个范围内的随机队员等级为准（§3.1）

# ★ 消失规则（用户要求）：被拉开超过 AWAY_DIST，而且这个距离内没有别的玩家，
#   连续 AWAY_GRACE 秒 → 自然消失（玩家跑掉了，身后的僵尸不必永远留着 ✓）
AWAY_DIST = 20.0
AWAY_GRACE = 60.0
MOB_KEEP_DEAD = 4.0       # 尸体留多久再回收（客户端要播完倒地+淡出 ✓）

# ★ 僵尸之间不要重叠（用户要求"不要堆叠在一起"）
#   ★ 这两个值很讲究（第 36 轮踩过）：
#     · SEP_DIST 取 0.95 —— 僵尸本体才 0.5~0.6 宽，0.95 已经不重叠 ✓
#       而且 8 只围着玩家时的圈半径 = SEP_DIST/(2·sin(π/8)) ≈ 1.24，
#       正好在咬人距离 CONTACT(1.15) 附近 → 围上来的僵尸真的咬得到人 ✓
#       （SEP_DIST 给太大 → 圈半径超过 CONTACT → 围一圈却咬不到 ✗）
#     · SEP_SPEED 原来是 3.0，比僵尸追击步长（1.2 m/s）还大 →
#       后面的僵尸被同伴顶住、永远走不到玩家身边 ✗（实测卡在 11 米）
#       改成 2.0：还是能很快解开重叠，但压不过追击 ✓
SEP_DIST = 0.95           # 两只僵尸至少隔这么远才相斥
SEP_SPEED = 2.0           # 推开速度（米/秒）—— 渐进推开，瞬移看着很假 ✗

# ★ 没目标时"漫无目的地散开"（用户要求）
WANDER_EVERY = 3.2        # 多久换一次方向（秒）
WANDER_SPEED = 0.45       # 漫游速度 = 自身移速 × 这个比例（比追人慢 ✓）

# ★ 注意：AGGRO 必须【不小于】SPAWN_MIN —— 否则自动刷出来的僵尸永远走不到警戒圈里，
#   世界就变成"一堆僵尸杵着不动"，得玩家自己凑上去才打得到 ✗（第 35 轮踩过）
AGGRO = 28.0              # 发现玩家的距离（§3.3 的"行为特性"以后按职业微调）
CONTACT = 1.15            # 咬到玩家的距离
MOB_ATK_CD = 1.2          # （旧的固定冷却；第 41 轮改成 起手 + 收招，见下）
ATK_ANIM = 0.75           # ★ 挥爪动画时长（秒）—— 客户端拿它播攻击姿势 ✓

# ------------------------------------------------------------------ 僵尸起手（第 41 轮）
# 用户反馈："贴近了就算直接打，应该要慢一点点" ✓
# 方案 §5.1：僵尸没有连击，只有「蓄力 → 咬 → 收招」
RECOVER = 0.35            # 咬完的收招时间；下一次最短间隔 = WINDUP + RECOVER
CLASS_WINDUP = {
    '学生': 0.30, '外卖': 0.30,                  # 弱/快，一涌而上
    '白领': 0.45, '医生': 0.45, '程序员': 0.45,   # 普通杂兵
    '保安': 0.55,                                # 端着架子，慢半拍
    '工人': 0.70, '健身教练': 0.70,               # 高血高攻就得慢
}


def windup_of(kind):
    return CLASS_WINDUP.get(kind, 0.45)


# ★ 僵尸的碰撞箱边长（米）—— 第 41 轮用来判"撞不撞建筑" ✓
#   （和客户端 G.MOB_W / G.MOB_D 一个量级；只影响贴墙时的间隙，不影响观感 ✓）
MOB_BODY = 0.5

# ------------------------------------------------------------------ 战斗常量
# ★★ 这三个必须和客户端 web/core/game.js 里的 ATK_CD / G.ATK_RANGE / G.ATK_ARC 【完全一致】★★
#    客户端那份只是"立刻给反馈"的本地预测，服务器这份才是权威 ——
#    两边不一致 = 玩家看到打中了但服务器说没中（或者反过来）✗
ATK_CD = 0.62             # 玩家挥刀冷却
ATK_RANGE = 2.4           # 够得着的距离
ATK_ARC = 1.05            # 正前方扇形半角（弧度）≈ 60°，也就是正前方 120°
CRIT_CHANCE = 0.2         # 暴击率（§5）
CRIT_MUL = 1.5            # 爆伤 150%（上限 500%，2026-10-23）

# §3.3 职业表（P2 第 39 轮：这 8 个已经各自有【外观】了 —— 见方案 §3.3.1）
#   ★★ 这 8 个名字必须和客户端 web/core/game.js 的 MOB_CLASSES 键【对得上】★★
#      对不上不会崩（客户端查不到就用默认绿僵尸外观），但那就白做了 ✗
#      （test_browser.js 里有一条断言专门盯着这件事 ✓）
#   其余 16 个职业（护士/教师/厨师/农民…）是补内容时再加，加的时候两边一起加 ✓
KINDS = ('白领', '医生', '工人', '学生', '外卖', '保安', '程序员', '健身教练')

# ------------------------------------------------------------------ 职业行为（第 40 轮）
# 方案 §3.3 那张表有"行为特性"一列，这里把它落到数字上 ✓
#   血量×/攻击×/移速×  —— 1.0 就是普通杂兵
#   ★ 数值只是起点（方案 §3.2 说了 P2 会统一校准），要调就调这几行 ✓
CLASS_STATS = {
    '白领':     (1.00, 1.00, 1.00),   # 均衡杂兵，最常见
    '医生':     (0.95, 1.00, 1.00),   # 会给周围僵尸回血 ↓
    '工人':     (1.60, 1.15, 0.75),   # 高血、很慢
    '学生':     (0.70, 0.85, 1.30),   # 弱、快
    '外卖':     (0.85, 0.95, 1.70),   # 移速最快，残血会逃 ↓
    '保安':     (1.35, 1.05, 0.90),   # 高血、会格挡 ↓
    '程序员':   (0.75, 1.20, 1.00),   # 血薄、伤害高（远程"键盘攻击"是下一刀）
    '健身教练': (1.50, 1.45, 0.80),   # 高血高攻、慢
}
# 医生：定期给周围僵尸回血（方案 §3.3"给周围僵尸回血"）
HEAL_R = 12.0             # 治疗半径
# ★★ 第 46 轮改过（用户反馈"医生一多就打不动僵尸"）★★
#   原来：每个医生各自每 2 秒奶 3 只 × 12% 上限血
#     → 一只僵尸每秒被回 18% 血 ✗ 医生一多就是【线性叠加】✗ 直接变成不死 ✗
#   现在：一只僵尸【同一个周期内只会被治疗一次】（Mob.healCd ✓）——
#     医生多只意味着"能同时救更多不同的僵尸"，而不是"同一只被奶更多次" ✓
#   数值也收了一档：3.5 秒回 10% ≈ 每秒 2.9%（约等于给僵尸减伤 25% ✓ 有压力但打得动 ✓）
HEAL_PERIOD = 3.5         # 每 3.5 秒回一次（同一只僵尸的"被治疗"冷却也是它 ✓）
HEAL_PCT = 0.10           # 每次回 10% 上限血
HEAL_MAX_TARGETS = 2      # 一个医生一次最多奶 2 只
HEAL_MAX_HP = 0.85        # 血超过上限 85% 的就不奶了（别浪费 + 让玩家看得出"它在回血" ✓）
# 外卖骑手：残血就逃（方案 §3.3"移速最快，会逃跑"）
FLEE_HP = 0.30            # 掉到 30% 以下开始逃
FLEE_TIME = 2.5           # 逃这么久（秒）
# 保安：格挡（方案 §3.3"高防、会格挡"）—— ★ 防御属性被砍了（§4.5），
# 所以这里用"减伤"实现，和方案 §5"减伤是唯一的减伤属性"一致 ✓
BLOCK_CHANCE = 0.25
BLOCK_MUL = 0.4           # 格挡成功只吃 40% 伤害


# ------------------------------------------------------------------ 数值公式
def mob_hp(z):
    return 75.0 + 22.0 * z + 0.62 * z * z


def mob_atk(z):
    return 8.0 + 2.5 * z + 0.06 * z * z


def mob_exp(z):
    return 10.0 + 4.0 * z + 0.12 * z * z


def mob_spd(z):
    return min(1.2 + 0.004 * z, 2.6)


def level_up_need(lv):
    """升到下一级需要多少经验（§9.1：K(L) = 6 + 1.3L，E(L) = K(L) × 同级怪经验）"""
    L = max(1, int(lv))
    return int(round((6 + 1.3 * L) * mob_exp(L)))


def player_atk(lv):
    """玩家固有攻击力（§4.5：10 + 3L + 0.08L²）

    ★★ 这个函数是"服务器权威"这条线的关键一块（第 39 轮）★★
      以前服务器的 `p.atk` 直接取【客户端上报】的 atk 字段 ——
      改个包把它改成 999999，一刀就能秒天秒地 ✗
      现在攻击力由服务器按【角色等级】自己算，客户端报什么都不看 ✓
      （装备/天赋加成的部分等 P3 上 §4/§7 再接，这里给的是"裸装固有值"✓）
    """
    L = max(1, int(lv))
    return 10.0 + 3.0 * L + 0.08 * L * L


def level_hp(lv):
    """玩家固有生命（方案 §4.5：血量 = 100 + 22L + 0.6L²）

    ★★ 第 225 轮补上的（用户："玩家成长生命值是不是忘记做了"）★★
      方案 §4.5 里四条固有属性：
          血量 = 100 + 22L + 0.6L²      ← ★ 这条一直没做 ✗
          攻击 = 10 + 3L + 0.08L²       ← 这条做了 ✓（就是上面的 level_atk）
      后果（实测）：
          63 级的角色血量只有 249（写死的 200 + 防具）
          而方案要求 100 + 22×63 + 0.6×63² = 3867（差 15 倍）
          同等级僵尸一下打 403 → 一口就死 ✓
          → 用户一直说"站撸容易死"✓ 根子在这儿 ✓
    """
    L = max(1, int(lv))
    return int(round(100 + 22 * L + 0.6 * L * L))


def roll_level(base_lv, safety=60, decay=0.35, same=0.40, high_bias=0.62):
    """按 §3.1 抽一只怪的等级（第 131 轮：按用户要求把浮动拉大 ✓）

    ★ 用户原话："等级上下浮动太小了，没有越级挑战的刺激"
      "低概率撞到高等级的怪也可以" ✓

    ① same 概率（默认 40%）：Z = L ± 1             ← 原来 50% ✓ 降一点 ✓
    ② 其余概率：按 decay 抽"离你几级"
       ★★★ decay 的方向（我前后写反过两次 ✗ 这次用实测钉死 ✓）★★★
         循环是：while d < safety and random() > decay: d += 1
         → 【继续往远的概率 = 1 − decay】✓
         → 所以 decay 越【小】→ 尾巴越长 ✓（想多遇高级怪就调小 ✓）
         实测（30 级玩家 20 万次）：
             decay = 0.72（原版）→ 高 5 级以上  0.02%
             decay = 0.85        → 更窄 ✗（我第一版写反了 ✓）
             decay = 0.35（本轮）→ 高 5 级 4.3% · 高 10 级 0.5% · 高 20 级 0.007% ✓
       "离你 5 级以上"从约 15% 提到约 10%… hmm 见实测表 ✓（反正更宽了 ✓）
    ③ ★ 抽到"远"时 high_bias（默认 62%）概率【往高】✓
       "越级挑战"要的是高的怪 ✗ 不是一味往下 ✓
    硬下限 Z ≥ 1 ✓ 安全上限 Z ≤ L + safety（60 ✓ 原来 40 ✓）

    ★ 参数都有默认值 ✗ 想再调改这几个数就行 ✓ 不用动调用方 ✓
    """
    L = max(1, int(base_lv))
    if random.random() < same:
        z = L + random.randint(-1, 1)
    else:
        d = 0
        while d < safety and random.random() > decay:
            d += 1
        z = L + d if random.random() < high_bias else L - d
    if z < 1:
        z = 1
    if z > L + safety:
        z = L + safety
    return z

# ------------------------------------------------------------------ 一只僵尸
class Mob(object):
    """★ 只允许 tick 线程碰"""

    __slots__ = ('mid', 'kind', 'lv', 'x', 'z', 'yaw', 'hp', 'mhp', 'atk', 'exp',
                 'spd', 'atkT', 'atkAnim', 'windT', 'tgt', 'awayT', 'deadT', 'wx', 'wz', 'wT',
                 'healT', 'healCd', 'fleeT',
                 # ★ 第 59 轮：武器机制造成的状态
                 'stunT', 'stunImmune', 'knockImmune', 'bleedT', 'bleedDmg', 'bleedFrom', 'owner',
                  # 第 217 轮：这只怪是不是已经结算过了（经验/掉落只算一次）
                  'awarded',
                  # ★ round322：地火烫伤的计时（★ 忘了加这一条会让整个 tick 崩掉 ✓
                  #   自测踩到：用户报"服务器卡了、怪也没有"✗
                  #   根因就是这里 ✗ __slots__ 里没有 lavaT → 赋值直接抛异常 ✓
                  #   → tick 每帧在同一个地方崩 ✗ 僵尸逻辑整段不执行 ✓
                  #   ★ 教训：给 __slots__ 的类加属性 ✗ 必须两边一起改 ✓
                  'lavaT',
                  # ★ round350：逃跑音效只播一次的标记
                  'fleeSnd',
                  # ★ round404：长枪挑飞（flyT = 还要飞多久 · flyH = 多高）
                  'flyT', 'flyH', 'latDmg',
                  # ★ round581：冰封/时间凝滞
                  'freezeT', 'slowT', 'slowMul',
                  # ★ round600：精英 / Boss
                  'rank', 'skin', 'name', 'hitR', 'dmgBy', 'dmgTotal', 'aff',
                  'hit_pt', 'pen_pt', 'dodge_pt', 'dr_flat', 'dr_pct',
                  'anticrit', 'anticritdmg', 'crit_pt', 'crit_dmg',
                  'lifesteal', 'thorns', 'regen', 'control_res',
                  'speed_pct', 'aspd_pct',
                  'castKey', 'castName', 'castPhase', 'castT', 'castX', 'castZ',
                'castFromX', 'castFromZ',
                  'castYaw', 'castTarget', 'skillCd', 'animState', 'animT',
                  'jumpT', 'bossPhase', 'homeX', 'homeZ', 'markT',
                  'summoner', 'hp_pct', 'atk_pct' )

    def __init__(self, mid, lv, x, z, kind=None, rank=0, skin='', name=None):
        # ★ 第 132 轮：硬配额 —— 这只僵尸是【替谁刷的】✓
        #   用 role_id 标记 ✗ 不进协议 ✗（客户端不需要知道 ✓）
        self.owner = None
        self.awarded = False    # 第 217 轮：结算标记（只给一次经验）
        self.lavaT = 0.0        # ★ round322：地火烫伤的计时
        self.fleeSnd = False    # ★ round350：逃跑音效播过没有
        self.flyT = 0.0         # ★ round404：还要飞多久（秒）
        self.flyH = 0.0         # 飞多高（格）
        self.latDmg = 0         # ★ 落地时砸多少伤害
        self.freezeT = 0.0      # ★ round581：冻结剩余秒
        self.slowT = 0.0        # ★ round581：减速剩余秒
        self.slowMul = 1.0      # ★ round581：减速倍率
        self.mid = str(mid)
        self.kind = kind or random.choice(KINDS)
        self.lv = int(lv)
        self.x = float(x)
        self.z = float(z)
        self.homeX = float(x)
        self.homeZ = float(z)
        self.yaw = 0.0
        self.rank = int(rank or 0)
        self.skin = str(skin or '')
        self.name = str(name or (mob_ranks.name_of(skin, self.rank) if self.rank else self.kind))
        self.hitR = float(mob_ranks.cfg(self.rank).get('hit_r', 0.0))
        self.dmgBy = {}
        self.dmgTotal = 0
        self.aff = {}
        self.hp_pct = 0.0
        self.atk_pct = 0.0
        self.hit_pt = 0.0
        self.pen_pt = 0.0
        self.dodge_pt = 0.0
        self.dr_flat = 0.0
        self.dr_pct = 0.0
        self.anticrit = 0.0
        self.anticritdmg = 0.0
        self.crit_pt = 0.0
        self.crit_dmg = 0.0
        self.lifesteal = 0.0
        self.thorns = 0.0
        self.regen = 0.0
        self.control_res = 0.0
        self.speed_pct = 0.0
        self.aspd_pct = 0.0
        self.castKey = ''
        self.castName = ''
        self.castPhase = ''
        self.castT = 0.0
        self.castX = 0.0
        self.castZ = 0.0
        self.castFromX = 0.0
        self.castFromZ = 0.0
        self.castYaw = 0.0
        self.castTarget = None
        self.skillCd = {}
        self.animState = 'idle'
        self.animT = 0.0
        self.jumpT = 0.0
        self.bossPhase = 1
        self.markT = 0.0
        self.summoner = None
        # ★ 职业倾向：普通怪才有；精英/Boss 不套普通职业系数
        hm, am, sm = CLASS_STATS.get(self.kind, (1.0, 1.0, 1.0))
        if self.rank:
            self.mhp = max(1, int(round(mob_hp(self.lv) * mob_ranks.cfg(self.rank).get('hp_mul', 1.0))))
            self.atk = mob_atk(self.lv) * mob_ranks.cfg(self.rank).get('atk_mul', 1.0)
            self.exp = int(round(mob_exp(self.lv) * mob_ranks.cfg(self.rank).get('exp_mul', 1.0)))
            self.spd = mob_spd(self.lv)
            self.aff = mob_affixes.roll(self.rank, self.lv)
            mob_affixes.apply(self, self.aff)
        else:
            self.mhp = max(1, int(round(mob_hp(self.lv) * hm)))
            self.atk = mob_atk(self.lv) * am
            self.exp = int(round(mob_exp(self.lv)))
            self.spd = mob_spd(self.lv) * sm
        self.hp = self.mhp
        self.atkT = 0.0          # 攻击冷却（秒；到 0 就能再咬）
        self.atkAnim = -1.0      # ★ 挥爪动画计时：没在攻击时必须是【-1】（见 wire 的注释）
        self.windT = 0.0         # ★ 起手蓄力倒计时（>0 = 正在蓄力，蓄完才咬出去）
        self.tgt = None          # 正在追的玩家 cid
        self.awayT = 0.0         # 离所有玩家都超过 AWAY_DIST 的累计时长（消失用）
        self.deadT = 0.0         # 死了多久（留一会儿让客户端播完动画）
        self.healT = 0.0         # 医生：下次回血的倒计时
        self.healCd = 0.0        # ★ 被治疗冷却（第 46 轮）：>0 时任何医生都不能再奶它 ✓
        self.fleeT = 0.0         # 外卖：还要逃多久
        # ★ 第 59 轮：武器机制的状态（只在 tick 线程动 ✓）
        self.stunT = 0.0        # 被锤砸晕的剩余时间（秒）—— 晕着不能动、不能咬
        self.stunImmune = 0.0   # 眩晕免疫窗口（防无限锁死 ✓）
        self.knockImmune = 0.0  # 击退免疫窗口（防永久风筝 ✓）
        self.bleedT = 0.0       # 流血剩余时间
        self.bleedDmg = 0.0     # 流血每秒伤害
        self.bleedFrom = None   # 谁放的（死了要给他记功 ✓）
        # ★ 漫游方向（没目标时用）：wx/wz 是单位方向，wT 是"还有多久换方向" ✓
        self.wT = 0.0
        self.wx = 0.0
        self.wz = 0.0

    def alive(self):
        return self.hp > 0

    def wire(self):
        """打包成客户端要的紧凑数组（★ 字段顺序不能动，见 core/game.js addWorldMob）
           [mid, x, z, yaw, hp, hpMax, alive, atkAnim, lv, kind]
           ★ 末尾的 lv / kind 是第 36/39 轮加的（职业外观用）——
             客户端是按下标取的，所以【只能往后加，不能插中间】✗

           ★★ 第 41 轮修的一个真 bug：第 8 个字段（下标 7）必须是【挥爪动画计时】，
              没在攻击时要发 -1 ✗
              原来发的是"攻击冷却"（atkT），它【永远是 ≥ 0】（就绪时是 0）——
              而客户端那边的判断是 `if (rm.atkT >= 0) { 播攻击姿势 }`，
              攻击姿势里有一行会把腿写死 → **腿永远不动** ✗✗（玩家反馈"腿怎么都不动了"）
              现在拆成两个值：atkT 管冷却（不下发），atkAnim 管动画（下发，没攻击 = -1）✓"""
        return [self.mid, round(self.x, 2), round(self.z, 2), round(self.yaw, 2),
                max(0, int(self.hp)), self.mhp, 1 if self.alive() else 0,
                round(self.atkAnim, 2), self.lv, self.kind,
                1 if float(getattr(self, 'freezeT', 0) or 0) > 0 else 0,
                int(self.rank), self.skin, self.name]


def in_front(px, pz, yaw, tx, tz, rng=ATK_RANGE, arc=ATK_ARC):
    """目标在不在"攻击者正前方的扇形"里 —— ★ 和第 34 轮客户端 G.ATK_ARC 那条规则同一套

    用户当时反馈的就是这个：以前"离得近就打"，背对着僵尸也能打 ✗
    现在必须 距离 ≤ rng【且】和朝向的夹角 ≤ arc ✓
    """
    dx = tx - px
    dz = tz - pz
    d2 = dx * dx + dz * dz
    if d2 > rng * rng:
        return False
    if d2 < 0.0001:
        return True                       # 贴脸 → 不算角度 ✓（和客户端一致）
    import math
    a = math.atan2(dx, dz) - yaw
    while a > math.pi:
        a -= math.pi * 2
    while a < -math.pi:
        a += math.pi * 2
    return abs(a) <= arc


def roll_damage(atk_power, rng=None, crit_pt=0.0, crit_dmg=0.0):
    """一次普攻的伤害（§5 的简化版：减伤/闪避等 P3 上装备后再接）

    基础伤害 = 攻击力 × 武器倍率（现在只有普攻，倍率 = 1.0）
    最终伤害 = 基础伤害 × (暴击 ? 爆伤 : 1)，最低不少于基础伤害的 5%
    返回 (伤害, 是否暴击)
    """
    r = rng or random
    base = max(1.0, float(atk_power))
    # ★ 第 60 轮：暴击率/爆伤可以被【词条】改 ✓
    #   爆伤上限 500%（2026-10-23 由 250% 上调）
    crit = r.random() < (CRIT_CHANCE + float(crit_pt or 0.0) / 100.0)
    mul = min(5.0, CRIT_MUL + float(crit_dmg or 0.0) / 100.0)   # 2026-10-23: cap 250% -> 500%
    dv = base * (mul if crit else 1.0)
    floor = base * 0.05
    if dv < floor:
        dv = floor
    return max(1, int(round(dv))), crit
