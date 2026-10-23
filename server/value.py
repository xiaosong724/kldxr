# -*- coding: utf-8 -*-
"""物品价值表 + 金币常量（第 291 轮 · 金币系统第 1 步）

★ 为什么是【纯 Python 字典】而不是数据库表：
   tick 线程绝对不许做磁盘 IO（架构铁律 ✓）
   而"卖东西给系统"要在 tick 线程里立刻算出价格 ✓
   价格是【不变的规则】✗ 写死在代码里最安全 ✓
   改价要重启服务器 ✗ 可接受 ✓（比 tick 线程读库安全得多 ✓）

★ 价格水平（用户定稿 ✓ 保持低价 ✗ 不追求几个月到上限 ✓）：
   装备：1阶10 → 9阶80000（约 ×2.8/阶）
   材料：常见2 → 传说1500
   交易所里玩家自己定价 ✗ 系统价 ≈ 玩家成交价的 30% ✓
   —— 这样"卖给系统"永远不如"挂交易所"✓ 交易所才有生意 ✓

★ 字段口径（已在真库 1562 件上核对过 ✓）：
   装备：slot=='weapon'/'armor' · tier · itemLv · base · affixes · dur/durMax · ext
   材料：kind=='material' · tier（通常是 0）· 靠 stack 叠数量
   ★ 等级一律用 itemLv ✗ 不用 reqLevel（那是"装备需求等级"✓）
"""

# ---------------------------------------------------------------- 常量
# ★ 2026-10-23（用户："金币上限改成无限"）
#   GOLD_CAP 现在只用来兜"交易行最高价"✗ 不再是持有上限 ✓
#   （持有上限在 world.GOLD_CAP = None ✓ 那边才是真正生效的）
GOLD_CAP = 1000000000000        # 12 位：给交易所价格留个天花板，实际等于"无限"
GOLD_PER_BULLION = 100000000  # 1 黄金 = 1 亿金币
BULLION_NAME = '黄金'

# ---------------------------------------------------------------- 交易所（round304）
#   ★ 全部写在这里（方案 §11 第 3 条：价格可随时改 ✗ 别散在业务代码里 ✓）
MKT_PRICE_MIN = 10             # ★ 最低上架价（方案 v2:155 ✓ 低于这个直接拒 ✓）
MKT_PRICE_MAX = GOLD_CAP       # ★ 最高上架价（方案没说 ✗ 按金币上限兜底 ✓）
MKT_TAX_PCT = 5                # ★ 成交税 5% ✗ 从卖家所得里扣 ✓
MKT_FEE_PCT = 1                # ★ 上架费 1% ✗ 不成交不退 ✓
MKT_FEE_MIN = 1                # ★ 上架费下限（10 块钱的东西也要收 1 ✓）
MKT_FEE_MAX = 100              # ★ 上架费上限（卖再贵也只收 100 ✓）
MKT_FEE_FREE_BELOW = 1000      # ★ 余额低于这个数【免上架费】✓（防穷玩家被吸血 ✓）
MKT_MAX_PER_PLAYER = 10        # ★ 每人最多同时上架 10 件 ✓
MKT_DAYS = 7                   # ★ 上架 7 天后过期 ✗ 东西退回背包 ✓
# round304b：浏览分页 + 分类顺序（内存货架用 ✗ 和协议里的取值一一对应 ✓）
MKT_PAGE = 20                  # ★ 一页 20 行（方案 §8b：一页最多 20 个图标 ✓）
MKT_CAT_MAX = 2000             # ★ 单分类超过这么多件就只留最新的（方案 §8b 上限保护 ✓）
MKT_SHELF_MAX = 4000           # ★ 一次能装进内存的在售上限（round304c ✗ 防极端情况 ✓）
#   ★ 为什么要有它：内存货架是"全服在售"✗ 万一某天有人刷出十万条 ✗
#     一次全表读 + 全塞内存会把登录/开面板那一下拖住 ✓
#   → 按 lid 升序取前 N 条（★ 老单优先 ✓ 新单进不来的极端情况不会发生 ✓
#     因为过期回收每 5 秒在跑 ✗ 而且每人最多 10 件 ✓）
CAT_ORDER = ('weapon', 'armor', 'material', 'other')

# 系统回收价：装备基础价（按阶数 ✗ 约 ×2.8/阶）
EQUIP_BASE = {1: 10, 2: 30, 3: 100, 4: 300, 5: 800,
              6: 2500, 7: 8000, 8: 25000, 9: 80000}

# 类型系数（武器最贵 ✓ 防具最便宜 ✓）
TYPE_MUL = {'weapon': 1.2, 'armor': 1.0, 'other': 1.1}

# 状态系数
BROKEN_MUL = 0.3               # 破损装备只值三成
# ★ round409（用户："坏掉的武器只能出售给系统，并且只值 10 金币"）
#   ★ 不分品阶 ✗ 12 阶的坏斧头也只值 10 ✓（它已经是一块废铁 ✓）
# ★ round410（用户："防具也和武器一样"）→ 武器和防具都是 10 ✓
BROKEN_SCRAP = 10
AFFIX_BONUS = 0.15             # 每条附加属性 +15%

# 材料基础价（按稀有度 ✗ 从 drops.py 的稀有度定义读 ✓ 这里给兜底）
MAT_RARITY_BASE = {'common': 2, 'uncommon': 10, 'rare': 60,
                   'epic': 300, 'legend': 1500}
MAT_DEFAULT_BASE = 5           # 认不出稀有度的材料给个底价 ✓

# 材料稀有度表（名字 → 稀有度 ✗ 和 drops.py 保持一致 ✓）
# ★ 这里只映射【已知材料】✗ 认不出的走 MAT_DEFAULT_BASE ✓
MAT_RARITY = {
    '碎玻璃': 'common', '破布': 'common', '生锈铁片': 'common',
    '废纸箱': 'common', '塑料瓶': 'common', '旧电池': 'common',
    '医用酒精': 'uncommon', '绷带': 'uncommon', '螺丝刀': 'uncommon',
    '铜线': 'uncommon', '弹簧': 'uncommon',
    '抗生素': 'rare', '芯片': 'rare', '合金板': 'rare', '瞄准镜': 'rare',
    '军用电池': 'epic', '纳米材料': 'epic', '能量核心': 'epic',
    '陨铁': 'legend', '龙鳞': 'legend', '源质结晶': 'legend',
}


def _f(v, d=0.0):
    try:
        return float(v)
    except Exception:
        return d


def _i(v, d=0):
    try:
        return int(v)
    except Exception:
        return d


def now_s():
    """现在（秒 ✗ 带毫秒小数 ✓）

    ★★ round304c：交易所的内存行【一律用秒】✗ 这条口径必须只有一个来源 ✓
      自测抓到的：接口显示"剩 20729076 天后过期"✓
      根因：上架时写进内存的是【毫秒】（dbmod.now_ms()/1000.0 ✓）
        而别处（_mkt_load / _mkt_sweep / _mkt_mine）都按【秒】读它 ✓
        → 过期时刻比"现在"大一千倍 ✗ 算出来就是两千万天 ✓✓
      ★ 教训：凡是"时刻"这种东西 ✗ 全项目【一个单位、一个函数】✓
        谁要毫秒谁自己乘 1000 ✗ 绝不在这里混着来 ✓
    """
    import time
    return time.time()


def is_material(it):
    return isinstance(it, dict) and it.get('kind') == 'material'


def cat_of(it):
    """交易所分类（★ 按真实字段 ✗ 已核对 1562 件真数据 ✓）"""
    if not isinstance(it, dict):
        return 'other'
    if it.get('slot') == 'weapon':
        return 'weapon'
    if it.get('slot') == 'armor':
        return 'armor'
    if it.get('kind') == 'material':
        return 'material'
    return 'other'


def value_of(it, n=1):
    """物品价值（卖给系统的价格 ✗ 整数 ✓ 永不返回负数 ✓）

    it: item_json 解出来的 dict
    n : 数量（材料可堆叠 ✗ 装备通常 1 ✓）
    返回：金币数（int ✓）
    """
    if not isinstance(it, dict):
        return 0
    # ---------- 材料 ----------
    if is_material(it):
        rar = it.get('rarity') or MAT_RARITY.get(it.get('name') or '', '')
        base = MAT_RARITY_BASE.get(rar, MAT_DEFAULT_BASE)
        cnt = max(1, _i(n, 1))
        return max(0, int(base * cnt))
    # ---------- 皮肤卡（★ round487：用户要"可以出售"）----------
    #   ★ 定价：5000 金币（起拍价 20000 的 1/4 → 卖系统不划算，但能出手 ✓）
    if it.get('kind') == 'skin':
        return max(0, int(5000 * max(1, _i(n, 1))))
    # ---------- 黄金（可堆叠 ✗ 1 个 = 1 亿 ✓）----------
    if it.get('name') == BULLION_NAME:
        cnt = max(1, _i(n, 1))
        return max(0, int(GOLD_PER_BULLION * cnt))
    # ---------- 装备 ----------
    # ★ round409：坏掉的【武器】一律 10 金币（用户定的 ✓）
    # ★ round410（用户："防具也和武器一样，坏了就只能卖 10 金币"）→ 防具一起 ✓
    if it.get('broken'):
        return max(0, int(BROKEN_SCRAP * max(1, _i(n, 1))))
    tier = _i(it.get('tier'), 0)
    if tier <= 0:
        # 既不是材料也不是装备（认不出的东西）→ 给个底价，别报错 ✓
        return max(0, int(MAT_DEFAULT_BASE * max(1, _i(n, 1))))
    base = EQUIP_BASE.get(tier)
    if base is None:
        base = EQUIP_BASE[9] * (2 ** (tier - 9)) if tier > 9 else EQUIP_BASE[1]
    lv = _i(it.get('itemLv'), 0)          # ★ 一律用 itemLv ✗ 不用 reqLevel ✓
    lv_mul = 1.0 + max(0, lv) / 40.0
    slot = it.get('slot') or 'other'
    type_mul = TYPE_MUL.get(slot, TYPE_MUL['other'])
    broken = 1.0
    if it.get('broken'):
        broken = BROKEN_MUL
    else:
        dmax = _f(it.get('durMax'), 0)
        dur = _f(it.get('dur'), 0)
        # ★ 耐久不满也略打折（最低到 0.5 ✗ 不会归零 ✓）
        if dmax > 0 and dur >= 0:
            r = dur / dmax
            if r < 1.0:
                broken = max(0.5, 0.5 + 0.5 * r)
    aff = it.get('affixes')
    n_aff = len(aff) if isinstance(aff, (list, tuple)) else 0
    aff_mul = 1.0 + AFFIX_BONUS * n_aff
    v = base * lv_mul * type_mul * broken * aff_mul
    return max(0, int(v))


def equip_base(tier):
    """给界面/测试用的基础价查询 ✓"""
    return EQUIP_BASE.get(_i(tier, 0), 0)
