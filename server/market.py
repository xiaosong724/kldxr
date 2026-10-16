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

def _int(v, d=0):
    try:
        return int(v)
    except Exception:
        return d


def is_stack(it):
    """这件东西【能不能按数量卖】（★ 和背包的堆叠规则【同一个判据】✓）

    ★ 判据就是"有没有 slot"（材料/黄金没有 slot ✗ 装备一定有 ✓）
      —— 这正是 _save_pick / _add_item 用的那一条 ✓
        三处必须一致 ✗ 不然会出现"背包里堆着、交易所里按件卖"✓
    """
    return not (isinstance(it, dict) and it.get('slot'))


def row_of(lid, seller, price, it, ts, expire, stack=1, qty=1, iid=0):
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
    # ★ 内部标记不进内存里的物品（★ 公开行会把它整份发出去 ✓ 别漏脏字段 ✓）
    _iid = _int(iid, 0) or _int(it.get('__iid'), 0)
    _it2 = dict(it)
    _it2.pop('__iid', None)
    it = _it2
    return {
        'lid': int(lid), 'seller': int(seller), 'price': int(price),
        'cat': V.cat_of(it), 'tier': tier, 'lv': lv,
        'name': str(it.get('name') or '物品'), 'ts': float(ts), 'exp': float(expire),
        'stack': st, 'it': it,
        # ★ round304l：还能买几个（★ 卖完就下架 ✓ 买一半还剩一半 ✓）
        'qty': max(1, _int(qty, 1)),
        # ★★ round304q：这件东西【原来在背包里的 id】（iid ✓）★★
        #   为什么必须存下来：一件东西可能挂了好几单 ✗ 名字一模一样 ✓
        #     "我挂的是哪一件"只能靠 id 认 ✗（自测在"按名字找"上栽了四次 ✓）
        #   ★ 从哪来：① 上架时直接给 ② 从库重载时从 item_json 里的 __iid 取 ✓
        #     自测踩到的：服务端发出去是 3786 ✗ 客户端收到 0 ✓
        #       根因就是"重启/重载那一份没有 iid"→ 覆盖掉了内存里那份 ✓
        'iid': _iid,
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


def exp_s(row):
    """内存行里的到期时刻 → 【秒】（★ 全项目唯一的换算口 ✗ 详见 value.now_s() 注释 ✓）

    ★★ 为什么必须有它（这个单位坑了自测三次 ✗ 记下来）★★
      内存行的 exp 有【两个量级】并存：
        · 乐观入货架 / 落库回灌后 → 秒（~1.79e9）
        · 老数据 / 别处漏进来的毫秒（~1.79e12）
      → 每个调用点各算各的 = 迟早有一处按越大一千倍算 ✓
        表现：界面上写"剩 20729080 天后过期"✓（真机上截图看到的 ✓）
      ★ 判据为什么安全：1e11 秒 = 公元 5138 年 ✗ 不会有那种上架 ✓
    """
    try:
        v = float(row.get('exp') or 0)
    except Exception:
        return 0.0
    if v > 1e11:
        v /= 1000.0
    return v


def _now():
    import time
    return time.time()


def pub_row(row):
    """内存行 → 发客户端的行（★ 第 11 格是【完整 item_json】✗ 用户要看词条/耐久 ✓）

    [lid, price, cat, tier, lv, name, seller, 剩余秒, stack, 图标字段, 完整物品]
    ★★ round304g（用户："交易所里物品的图标为什么没有采用原来的"）★★
      根因就在这一格：第一版【只发了图标三要素】（slot/look/kind/rarity ✓）
        → 武器图标是按 look + tier 画的 ✗ 少了 base/affixes/dur 那些字段 ✓
        → 画出来和背包里那把【不是同一个东西】✗ 一眼就能看出不一样 ✓
      而且没有完整物品 ✗ 玩家在交易所里就【看不到词条 / 耐久 / 数值】✓
        （用户原话："不然玩家怎么看装备的属性怎么样词条是什么，耐久还有多少"✓）
      ★ 修法：该发就发 ✗ 一页只有 20 件 ✗ 一件多几百字节完全不算什么 ✓
        （当初"紧凑"是为了省流量 ✗ 省错了地方 —— 省掉了玩家真正要看的东西 ✓）
      ★ 图标字段那一格【留着】✗ 列表可能不展开详情也要画图标 ✓
        真正的画法改成用第 11 格（完整物品）✗ 和背包里【同一个函数同一个输入】✓
    """
    it = row.get('it') or {}
    is_mat = not it.get('slot')
    icon = {'slot': it.get('slot'),
            'look': (it.get('name') if is_mat else it.get('look')),
            'kind': it.get('kind'), 'rarity': it.get('rarity'),
            'broken': 1 if it.get('broken') else 0}
    left = int(max(0, exp_s(row) - _now()))     # ★ 归一化 ✗ 别直接减 ✓
    # ★ round304l：第 12 格 = 还能买几个（★ 客户端拿它做数量滑条的最大值 ✓）
    # ★ round304q：第 13 格 = 【原来那件物品的 id】（iid ✓）
    #   ★ 为什么要它：一件东西可能在交易所挂了好几单 ✗ 名字一模一样 ✓
    #     "我挂的是哪一单 / 哪一件"只能靠 id 认 ✗（自测在"按名字找"上栽了四次 ✓）
    #   ★ 老服务端没有这一格 ✗ 客户端要能容忍 undefined ✓
    #   ★ 这一格必须【真的等于货架上剩的个数】✗ 它是买家数量滑条的最大值 ✓
    #     （离线测试里有一条专门盯它：货架上剩 4 就一定得是 4 ✓
    #       理由：这种"看着像取字段、其实写成常量"的错最难看出来 ✓）
    return [row['lid'], row['price'], row['cat'], row['tier'], row['lv'],
            row['name'], row['seller'], left, row.get('stack') or 1, icon, it,
            max(1, _int(row.get('qty'), 1)), _int(row.get('iid'), 0)]


def pub_rows(rows):
    return [pub_row(r) for r in rows]


# ---------------------------------------------------------------- 载入 / 落库

def load_rows(rows):
    """数据库行 → 内存行列表（★ 只在网络线程调 ✗ 它读的是已经查出来的数据 ✓）

    rows: [(lid, seller, price, item_json, ts, expire, stack, qty), ...]
    """
    import json
    out = []
    for rec in rows or ():
        try:
            lid, seller, price, js, ts, expire = (rec[0], rec[1], rec[2],
                                                   rec[3], rec[4], rec[5])
            # ★★ round304r：这里的列顺序 = auth.market_rows_of 的 SELECT ★★
            #   自测抓到的真 bug（用户先看出来的）：那边 SELECT 写成
            #     lid, seller, price, item_json, ts, expire, qty   ✗
            #   而这里按 ...ts, expire, stack, qty 解包 ✓
            #   → expire 被当成 stack、qty 被当成 expire ✗
            #   → 买家看到的所有上架单 qty 永远是 1 ✗（数量滑条因此不出现 ✓）
            #   ★ 7 列 = 表里的列（listings 没有 stack 列 ✗ 物品是整份 JSON ✓）
            #     stack 只是"这一单是几个"的旧说法 ✗ 现在一律按 1 ✓
            #     （真正的"还剩几个"看 qty ✓）
            stack = 1
            qty = rec[6] if len(rec) > 6 else 1
        except Exception:
            continue
        try:
            it = json.loads(js)
        except Exception:
            continue
        if not isinstance(it, dict):
            continue
        try:
            out.append(row_of(lid, seller, price, it, ts, expire, stack, qty))
        except Exception:
            continue
    return out
