# -*- coding: utf-8 -*-
"""交易所（第 304b 轮 · tick 侧内存市场）

★ 为什么有这么一个文件（和 value.py 同一个理由）：
    所有"规则"和"纯计算"集中在这里 ✗ 业务（world.py）只负责调它 ✓
    → 规则可以【离线全量测】（tools/check_mkt_rules.py ✗ 不用起服务器 ✓）
    → 价格/上限/分页只有一份定义 ✗ 不存在"两套公式对不上"✓

★ 线程纪律（方案 v3 §9 明写）：
    交易所列表【绝不查库】✗ tick 线程不许 IO ✓
    → 货架在【玩家上线时】读进内存（网络线程读 ✓ 投 'mktload' ✓）
    → 上架 / 成交 / 下架 时同步增删内存 ✓
    → 浏览 = 在内存 list 上过滤 + 排序 + 切页 ✓（几百~几千件毫无压力 ✓）

★ 内存行的字段（短线名 ✗ 每条省字节 ✗ 也省得和协议字段重名 ✓）：
    lid    上架单号（listings.lid ✓ 客户端买/下架都用它）
    seller 卖家角色 id
    price  上架价（金币 ✓）
    cat    分类（weapon/armor/material/other ✗ 上架时算一次 ✓）
    tier   品阶（材料是 0 ✓）
    lv     物品等级 itemLv（材料没有 → 0 ✓）
    name   名字（搜索/显示用 ✓）
    ts     上架时刻（秒 ✓ "最新"排序用 ✓）
    exp    到期时刻（秒 ✓ 到点就不显示了 ✓）
    stack  数量（材料可堆叠 ✗ 装备永远是 1 ✓）
    it     完整 item_json（只给买家/自己的那一页用 ✓ 不含在浏览列表里 ✓）

★★ 一条硬规矩：上架中的东西 = items 表里【没有这一行】✗
   （方案 v3 §6 的单 SQL 方案 ✓）所以不存在"背包里还留着一份"的可能 ✓
   item_json 在 listings 里存一份 ✗ 成交/退回时用它重建物品 ✓
"""

import value as V

# ---------------------------------------------------------------- 内存市场

def new_mkt():
    """新建一个空货架（World.__init__ 调一次 ✓）"""
    return {'by_lid': {}, 'cats': {c: [] for c in V.CAT_ORDER}}


# ---------------------------------------------------------------- 纯计算

def fee_of(balance, price):
    """上架费（金币 ✗ int ✓）

    ★ 方案 §7c 的穷玩家保护：
        1% ✗ 最低 1 ✗ 最高 100 ✗ 余额 < 1000 全免 ✓
    ★ 为什么余额要传进来：免收是按【发布时的余额】判的 ✗
      不是按"够不够付"判的 ✓（余额 999 的人上架免费 ✓ 余额 1000 的人付 1 ✓）
    """
    try:
        bal = int(balance or 0)
        p = int(price or 0)
    except Exception:
        return 0
    if bal < V.MKT_FEE_FREE_BELOW:
        return 0
    if p <= 0:
        return 0
    f = (p * V.MKT_FEE_PCT + 99) // 100        # ★ 向上取整：1% 的 10 块 = 1（不是 0 ✓）
    if f < V.MKT_FEE_MIN:
        f = V.MKT_FEE_MIN
    if f > V.MKT_FEE_MAX:
        f = V.MKT_FEE_MAX
    return int(f)


def tax_of(price):
    """成交税（从卖家所得里扣 ✗ 不扣买家本金 ✓ 方案 §7c 风险 2 ✓）"""
    try:
        p = int(price or 0)
    except Exception:
        return 0
    if p <= 0:
        return 0
    return max(0, int(p * V.MKT_TAX_PCT // 100))


def net_of(price):
    """卖家实际到手（= 上架价 - 税 ✓）"""
    p = int(price or 0)
    return max(0, p - tax_of(p))


def price_ok(price):
    """上架价合法性 → (True, 整数价) / (False, 原因)"""
    try:
        p = int(price)
    except Exception:
        return False, '价格必须是整数'
    if p < V.MKT_PRICE_MIN:
        return False, '最低上架价 %d 金币' % V.MKT_PRICE_MIN
    if p > V.MKT_PRICE_MAX:
        return False, '价格超出上限'
    return True, p


# ---------------------------------------------------------------- 内存行

def row_of(lid, seller, price, it, ts, expire, stack=1):
    """item_json → 内存行（上架 / 载入时算一次 ✓ 浏览时零成本 ✓）"""
    it = it if isinstance(it, dict) else {}
    try:
        lv = int(it.get('itemLv') or 0)
    except Exception:
        lv = 0
    try:
        tier = int(it.get('tier') or 0)
    except Exception:
        tier = 0
    try:
        st = max(1, int(stack or 1))
    except Exception:
        st = 1
    return {
        'lid': int(lid), 'seller': int(seller), 'price': int(price),
        'cat': V.cat_of(it), 'tier': tier, 'lv': lv,
        'name': str(it.get('name') or '物品'), 'ts': float(ts), 'exp': float(expire),
        'stack': st, 'it': it,
    }


def add(mkt, row):
    """把一行放进货架（重复 lid 就替换 ✗ 幂等 ✓）"""
    lid = row['lid']
    old = mkt['by_lid'].get(lid)
    if old is not None:
        drop(mkt, lid)
    mkt['by_lid'][lid] = row
    mkt['cats'].setdefault(row['cat'], []).append(lid)


def drop(mkt, lid):
    """从货架拿走一行 → 那一行 / None"""
    row = mkt['by_lid'].pop(lid, None)
    if row is None:
        return None
    lst = mkt['cats'].get(row['cat']) or []
    try:
        lst.remove(lid)
    except ValueError:
        pass
    return row


def get(mkt, lid):
    return mkt['by_lid'].get(int(lid)) if _is_int(lid) else mkt['by_lid'].get(lid)


def count_of(mkt, seller):
    """这个卖家【在售】几件（不含过期的 ✓ 和库里的 COUNT(*) 口径一致 ✓）"""
    n = 0
    for row in mkt['by_lid'].values():
        if row['seller'] == int(seller):
            n += 1
    return n


def _is_int(v):
    try:
        int(v)
        return True
    except Exception:
        return False


# ---------------------------------------------------------------- 浏览

def _match(row, cat, q, tier_lo, tier_hi, afford, now):
    if row['exp'] <= now:
        return False
    if cat and cat != 'all' and row['cat'] != cat:
        return False
    if tier_lo is not None and row['tier'] < tier_lo:
        return False
    if tier_hi is not None and row['tier'] > tier_hi:
        return False
    if afford is not None and row['price'] > afford:
        return False
    if q and q not in row['name']:
        return False
    return True


def _sort_key(sort):
    """排序键（★ 一律带 (ts, lid) 兜底 ✗ 保证结果稳定 ✓

    为什么稳定重要：分页是按【同一个列表】切片 ✗
      排序不稳定的话 ✗ 第 1 页和第 2 页可能重复/漏掉同一件 ✓✓
    """
    if sort == 'price_desc':
        return lambda r: (-r['price'], -r['ts'], -r['lid'])
    if sort == 'new':
        return lambda r: (-r['ts'], -r['lid'])
    if sort == 'tier':
        return lambda r: (r['tier'], r['price'], -r['ts'], -r['lid'])
    if sort == 'tier_desc':
        return lambda r: (-r['tier'], r['price'], -r['ts'], -r['lid'])
    return lambda r: (r['price'], r['ts'], r['lid'])


def browse(mkt, cat='all', q='', tier_lo=None, tier_hi=None, afford=None,
           sort='price', page=1, per=None):
    """浏览货架 → {'rows': [...], 'total': n, 'page': p, 'pages': k}

    ★ 只返回当前页 ✗ 几千件不会一次发给客户端 ✓（方案 §8b 性能注意 ✓）
    ★ 这一步【绝不查库】✗ 纯内存 ✓（tick 线程铁律 ✓）
    """
    if per is None:
        per = V.MKT_PAGE
    try:
        per = max(1, min(100, int(per)))
    except Exception:
        per = V.MKT_PAGE
    now = _now()
    q = str(q or '').strip()
    out = []
    for row in mkt['by_lid'].values():
        if _match(row, cat, q, tier_lo, tier_hi, afford, now):
            out.append(row)
    out.sort(key=_sort_key(sort))
    total = len(out)
    pages = max(1, (total + per - 1) // per)
    try:
        page = int(page)
    except Exception:
        page = 1
    if page < 1:
        page = 1
    if page > pages:
        page = pages
    lo = (page - 1) * per
    return {'rows': out[lo:lo + per], 'total': total, 'page': page, 'pages': pages}


def _now():
    import time
    return time.time()


# ---------------------------------------------------------------- 网络行

def pub_row(row):
    """内存行 → 发客户端的紧凑行（★ 不带完整 item_json ✗ 那是买家点开才要的 ✓）

    [lid, price, cat, tier, lv, name, seller, 剩余秒, stack, 图标字段]
    ★ 图标要用的字段放最后一格（slot/look/kind/rarity ✗ 客户端 iconOfItem 认这个 ✓）
    """
    it = row.get('it') or {}
    icon = {'slot': it.get('slot'), 'look': it.get('look'),
            'kind': it.get('kind'), 'rarity': it.get('rarity'),
            'broken': 1 if it.get('broken') else 0}
    left = int(max(0, row.get('exp', 0) - _now()))
    return [row['lid'], row['price'], row['cat'], row['tier'], row['lv'],
            row['name'], row['seller'], left, row.get('stack') or 1, icon]


def pub_rows(rows):
    return [pub_row(r) for r in rows]


# ---------------------------------------------------------------- 载入 / 落库

def load_rows(rows):
    """数据库行 → 内存行列表（★ 只在网络线程调 ✗ 它读的是已经查出来的数据 ✓）

    rows: [(lid, seller, price, item_json, ts, expire, stack), ...]
    """
    import json
    out = []
    for rec in rows or ():
        try:
            lid, seller, price, js, ts, expire = (rec[0], rec[1], rec[2],
                                                   rec[3], rec[4], rec[5])
            stack = rec[6] if len(rec) > 6 else 1
        except Exception:
            continue
        try:
            it = json.loads(js)
        except Exception:
            continue
        if not isinstance(it, dict):
            continue
        try:
            out.append(row_of(lid, seller, price, it, ts, expire, stack))
        except Exception:
            continue
    return out
