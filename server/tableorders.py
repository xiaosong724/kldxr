# -*- coding: utf-8 -*-
"""咖啡店点单的纯计算：桌位、杯位、订单 id。

★ 这里不碰数据库、不碰 World ✓
  桌子本身不落库：由 town_objects 里的 dining_table / outdoor_table 实时算出来，
  家具被移动/删除时桌位跟着变，不会和世界对不上。
"""
import math
import random
import time

# 能当桌子用的目录 id
TABLE_CATALOG = frozenset(('dining_table', 'outdoor_table', 'coffee_table'))
# 能当椅子坐的目录 id（和 world.SEAT_CATALOG 保持一致）
SEAT_CATALOG = frozenset(('chair_wood', 'hall_chair', 'desk_chair',
                          'prop_bench', 'sofa_modern_2'))
# 一张桌子最多几杯（也受实际椅子数限制）
MAX_CUPS = 4
# 椅子离桌心多远算这张桌子的
SEAT_LINK_R = 1.9


def new_id(prefix):
    """订单/杯子的 id：时间戳 + 随机数，够唯一，且不依赖数据库自增"""
    return '%s%d%03d' % (prefix, int(time.time() * 1000), random.randint(0, 999))


def cup_slots(tx, tz, chairs, ring=0.34):
    """按椅子方向把杯子摆到桌沿：每个杯子朝对应椅子偏 0.34m"""
    out = []
    for i, ch in enumerate(chairs):
        dx = float(ch['x']) - float(tx)
        dz = float(ch['z']) - float(tz)
        ln = math.hypot(dx, dz) or 1.0
        out.append({'slot': i,
                    'x': round(float(tx) + dx / ln * ring, 3),
                    'z': round(float(tz) + dz / ln * ring, 3)})
    return out


def static_tables():
    """老主城里已经画出来的咖啡店露台桌（旧渲染器没有家具对象）

    桌子在 server/town.py 的 PROPS 里（k='table'），椅子有 id：
      cafe_w1/cafe_e1 → 5.2 那一桌；cafe_w2/cafe_e2 → 8.1 那一桌
    坐标在这里做 _rebase_town 同样的平移，避免两处各写一份。
    """
    import town as t
    cx, cz = float(t.TOWN_CX), float(t.TOWN_CZ)
    out = []
    rows = ((5.2, 'cafe_w1', 'cafe_e1'), (8.1, 'cafe_w2', 'cafe_e2'))
    for i, (z, a, b) in enumerate(rows):
        chairs = []
        for cid in (a, b):
            s = t.seat_by_id(cid)
            if s:
                chairs.append({'id': cid, 'x': float(s['x']), 'z': float(s['z']),
                               'rot': float(s.get('ry') or 0.0)})
        if not chairs:
            continue
        out.append({'id': 'tblS%d' % (i + 1), 'obj': -(i + 1), 'town': 1,
                    'x': -10.25 + cx, 'z': z + cz, 'rot': 0.0, 'parent': 0,
                    'chairs': chairs, 'max': len(chairs), 'static': True})
    return out


def link_chairs(table, seats):
    """把附近的椅子分给这张桌子（按距离由近到远，最多 MAX_CUPS 把）"""
    tx, tz = float(table['x']), float(table['z'])
    near = []
    for s in seats:
        dx, dz = float(s['x']) - tx, float(s['z']) - tz
        d2 = dx * dx + dz * dz
        if d2 <= SEAT_LINK_R * SEAT_LINK_R:
            near.append((d2, s))
    near.sort(key=lambda t: t[0])
    return [s for _, s in near[:MAX_CUPS]]


def table_public(table, cups):
    """发给客户端的桌位状态（杯子按 slot 排好，带世界坐标）"""
    pos = {}
    try:
        for sp in cup_slots(table['x'], table['z'], table.get('chairs') or []):
            pos[int(sp['slot'])] = (sp['x'], sp['z'])
    except Exception:
        pos = {}
    out_cups = []
    for c in cups:
        if str(c.get('state')) in ('drunk', 'gone'):
            continue
        slot = int(c.get('slot') or 0)
        px, pz = pos.get(slot, (table['x'], table['z']))
        out_cups.append({'slot': slot,
                         'name': c.get('item_name') or '',
                         'model': c.get('model') or 'cup',
                         'state': c.get('state') or 'served',
                         'x': px, 'z': pz})
    return {
        'id': str(table.get('id') or ('tbl%d' % int(table['obj']))),
        'x': round(float(table['x']), 2),
        'z': round(float(table['z']), 2),
        'max': int(table.get('max') or 0),
        'cups': out_cups,
    }
