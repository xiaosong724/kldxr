# -*- coding: utf-8 -*-
"""排行榜 · 数据层（round424）

★ 为什么要单独一个模块：
  · 榜单定义（哪些榜、怎么排、怎么显示）只写这一处 ✓
  · 服务端算榜（`refresh`）和"头顶称号"（`world` 只读 rank_map）共用同一份定义 ✓
  · 这个模块【只读库】✗ 不写任何东西 ✓

★ 线程：
  · `refresh()` 只能在【非 tick 线程】调用（要查库 ✓）
    实际调用者：app.py 里的榜单刷新线程 + /api/rank 兜底刷新
  · tick 线程只读 `world.rank_map`（普通 dict，一次性赋值 ✓ 见 world._title_of）

★ 榜的定义（用户 2026-10-18 定稿）：
    境界 level  → level DESC, exp DESC
    财富 gold   → gold DESC, level DESC
    屠戮 kills  → 击杀僵尸数 DESC, level DESC
    魔气 mq     → 击杀玩家数 DESC, 魔气 DESC      ← 两个数都显示（用户要求）
    在线 time   → 在线秒数 DESC, level DESC
    神兵榜 → 用户明确不做 ✗
"""
import db as dbmod

# (key, 中文名) —— 顺序就是界面上的 chip 顺序
BOARDS = [
    ('level', '境界'),
    ('gold', '财富'),
    ('kills', '屠戮'),
    ('mq', '魔气'),
    ('time', '在线'),
    # ★ round489（用户："在排行榜那边增加一个魅力榜单"）
    ('charm', '魅力'),
]
KEYS = tuple(k for k, _ in BOARDS)
NAME = dict(BOARDS)
TOP_N = 100          # 每个榜只排前 100 名（用户定）
PAGE_SIZE = 10       # 每页 10 个（用户定）


def short_num(n):
    """1.2 万 / 3.4 亿 —— 和客户端金币那套口径一致（只用于显示 ✓）"""
    try:
        n = int(n or 0)
    except Exception:
        return '0'
    neg = n < 0
    n = abs(n)
    if n >= 100000000:
        s = '%.2f 亿' % (n / 100000000.0)
    elif n >= 10000:
        s = '%.1f 万' % (n / 10000.0)
    elif n >= 1000:
        s = '%d' % n
    else:
        s = '%d' % n
    s = s.replace('.0 万', ' 万').replace('.00 亿', ' 亿')
    return ('-' + s) if neg else s


def short_time(sec):
    """在线时长：3 天 4 小时 / 5 小时 12 分 / 8 分"""
    try:
        s = int(sec or 0)
    except Exception:
        return '0 分'
    if s >= 86400:
        return '%d 天 %d 小时' % (s // 86400, (s % 86400) // 3600)
    if s >= 3600:
        return '%d 小时 %d 分' % (s // 3600, (s % 3600) // 60)
    return '%d 分' % (s // 60)


def _skip(name, skip):
    for k in (skip or ()):
        if k and k in name:
            return True
    return False


def refresh(cfg, skip_names=None):
    """算 5 个榜（全量、已排序、已过滤测试号）→ {board: [row, ...]}

    row = {'rid', 'name', 'lv', 'v'(排序主值), 'sub'(榜上第二行文字),
           'k'?, 'mq'?, 'gold'?, 'exp'?, 'sec'?}
    ★ 返回的是【全量】列表 ✗ 不是前 100 ✓（"我的名次"和头顶称号都要用到）
    """
    roles = []
    stats = {}
    with dbmod.db(cfg) as c:
        for r in c.execute('SELECT id, name, level, exp, gold, mq FROM roles'):
            if _skip(str(r['name'] or ''), skip_names):
                continue
            roles.append({'rid': int(r['id']), 'name': str(r['name'] or '?'),
                          'lv': int(r['level'] or 1), 'exp': int(r['exp'] or 0),
                          'gold': int(r['gold'] or 0), 'mq': int(r['mq'] or 0)})
        try:
            for s in c.execute('SELECT role_id, kills, pvp_kills, play_sec FROM role_stats'):
                stats[int(s['role_id'])] = {'kills': int(s['kills'] or 0),
                                            'pvp': int(s['pvp_kills'] or 0),
                                            'sec': int(s['play_sec'] or 0)}
        except Exception:
            stats = {}      # 表还没建（迁移前）→ 空榜，不崩 ✓

    def st(rid):
        return stats.get(rid) or {'kills': 0, 'pvp': 0, 'sec': 0}

    out = {}
    # ---- 境界 ----
    #   ★★ round425（用户："境界榜应该显示的是多少层，层数一样才去比较经验"）★★
    #     · 榜上显示【炼气 N 层】✗ 不是"经验多少" ✓
    #     · 排序本来就是【层数优先、经验只在同层时比较】（下面的 sort key ✓）
    #     · exp 仍然留在数据里（同层排序要用 ✓ 以后做"经验榜"也用得上 ✓）
    rows = sorted(roles, key=lambda x: (-x['lv'], -x['exp'], x['rid']))
    out['level'] = [{'rid': r['rid'], 'name': r['name'], 'lv': r['lv'], 'v': r['lv'],
                     'exp': r['exp'], 'sub': '炼气 %d 层' % r['lv']} for r in rows]
    # ---- 财富 ----
    rows = sorted(roles, key=lambda x: (-x['gold'], -x['lv'], x['rid']))
    out['gold'] = [{'rid': r['rid'], 'name': r['name'], 'lv': r['lv'], 'v': r['gold'],
                    'gold': r['gold'], 'sub': short_num(r['gold']) + ' 金币'} for r in rows]
    # ---- 屠戮（击杀僵尸）----
    rows = sorted(roles, key=lambda x: (-st(x['rid'])['kills'], -x['lv'], x['rid']))
    out['kills'] = [{'rid': r['rid'], 'name': r['name'], 'lv': r['lv'],
                     'v': st(r['rid'])['kills'],
                     'sub': '击杀 ' + short_num(st(r['rid'])['kills'])} for r in rows]
    # ---- 魔气（击杀玩家数优先，同数看魔气）----
    rows = sorted(roles, key=lambda x: (-st(x['rid'])['pvp'], -x['mq'], -x['lv'], x['rid']))
    out['mq'] = [{'rid': r['rid'], 'name': r['name'], 'lv': r['lv'],
                  'v': st(r['rid'])['pvp'], 'mq': r['mq'],
                  'sub': '击杀 %s 人 · 魔气 %s'
                         % (short_num(st(r['rid'])['pvp']), short_num(r['mq']))}
                 for r in rows]
    # ---- 魅力（★ round489：皮肤竞价累计总额 + 独占个数）----
    #   ★ 直白："你在皮肤上砸了多少金币" ✓
    bids = {}
    solo_cnt = {}
    try:
        per_key = {}
        with dbmod.db(cfg) as c:
            for b in c.execute('SELECT role_id, key, total FROM skin_bids'):
                rid2 = int(b['role_id'])
                bids[rid2] = bids.get(rid2, 0) + int(b['total'] or 0)
                per_key.setdefault(str(b['key']), {})[rid2] = int(b['total'] or 0)
        # ★ 独占者统计（round490）：第一 > 第二 × 1.3
        import skins as skinsmod
        for k, m2 in per_key.items():
            rows2 = sorted(m2.items(), key=lambda kv: (-kv[1], kv[0]))
            if len(rows2) >= 2 and rows2[0][1] > rows2[1][1] * skinsmod.EXCLUSIVE_X:
                solo_cnt[rows2[0][0]] = solo_cnt.get(rows2[0][0], 0) + 1
    except Exception:
        bids = {}
    # ---- 在线 ----
    rows = sorted(roles, key=lambda x: (-st(x['rid'])['sec'], -x['lv'], x['rid']))
    out['time'] = [{'rid': r['rid'], 'name': r['name'], 'lv': r['lv'],
                    'v': st(r['rid'])['sec'],
                    'sub': '在线 ' + short_time(st(r['rid'])['sec'])} for r in rows]
    # ---- 魅力（没有竞价记录的人不进榜 ✓）----
    rows = sorted([r for r in roles if bids.get(r['rid'], 0) > 0],
                  key=lambda x: (-bids.get(x['rid'], 0), x['rid']))
    out['charm'] = [{'rid': r['rid'], 'name': r['name'], 'lv': r['lv'],
                     'v': bids.get(r['rid'], 0),
                     'solo': solo_cnt.get(r['rid'], 0),
                     'sub': '魅力 ' + short_num(bids.get(r['rid'], 0)) +
                            (' · 独占 %d 个' % solo_cnt[r['rid']] if solo_cnt.get(r['rid']) else '')}
                    for r in rows]
    return out


def build_map(rows_by_board):
    """{'level': [rows]} → {role_id: {'level': 名次, ...}}（全量 ✓ 只给 tick 读 ✓）"""
    m = {}
    for board, rows in (rows_by_board or {}).items():
        for i, r in enumerate(rows):
            d = m.get(r['rid'])
            if d is None:
                d = m[r['rid']] = {}
            d[board] = i + 1
    return m


def title_text(role_map, board):
    """称号文本（★ 只显示前 100 名 ✓ 用户定）

    返回 (文本, 奖牌名次 1/2/3 或 0)
    ★ 格式：国服在线top1 / 国服财富top37 ✓（用户给的例子）
    """
    if not board or not role_map:
        return '', 0
    rank = int((role_map or {}).get(board) or 0)
    if rank <= 0 or rank > TOP_N:
        return '', 0
    cn = NAME.get(board) or ''
    if not cn:
        return '', 0
    return '国服%stop%d' % (cn, rank), (rank if rank <= 3 else 0)
