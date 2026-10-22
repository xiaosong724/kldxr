# -*- coding: utf-8 -*-
"""住宅规则：价格、买断、退款、续期。

★ 真正的金币/所有者状态在 World 内存里（tick 线程唯一写）✓
  这里只提供纯计算 + 启动读库/建种子 ✓ 不直接改玩家金币 ✓
"""
import math
import time

import town

DAY_MS = 86400000
MAX_DAYS = 7


def now_ms():
    return int(time.time() * 1000)


def remaining_days(expires_at, now=None):
    now = now_ms() if now is None else now
    left = int(expires_at or 0) - int(now)
    if left <= 0:
        return 0
    return int(math.ceil(left / float(DAY_MS)))


def public(row, now=None):
    now = now_ms() if now is None else now
    rem = remaining_days(row.get('expires_at'), now)
    return {
        'id': row.get('id'),
        'tier': row.get('tier'),
        'name': row.get('name'),
        'price_day': int(row.get('price_day') or 0),
        'owner_id': int(row.get('owner_id') or 0),
        'owner_name': row.get('owner_name') or '',
        'paid_day': int(row.get('paid_day') or 0),
        'expires_at': int(row.get('expires_at') or 0),
        'remaining_days': rem,
        'max_days': MAX_DAYS,
    }


def quote(row, buyer_id, want_days, now=None):
    """返回 (ok, msg, cost, total_days, rem, premium, refund, paid_day)
    want_days = 买家想要的“从今天起总天数” 1..7
    """
    now = now_ms() if now is None else now
    want_days = max(1, min(MAX_DAYS, int(want_days or 1)))
    price = int(row.get('price_day') or 0)
    owner = int(row.get('owner_id') or 0)
    rem = remaining_days(row.get('expires_at'), now)
    if owner and owner == int(buyer_id):
        # 续期：总天数必须比剩余多
        if want_days <= rem:
            return False, '续期天数要大于剩余 %d 天' % rem, 0, rem, rem, 0, 0, 0
        if want_days > MAX_DAYS:
            return False, '最多只能持有 7 天', 0, rem, rem, 0, 0, 0
        add = want_days - rem
        return True, '', add * price, want_days, rem, 0, 0, price
    if owner and rem > 0:
        # 买断：至少接手剩余天数
        if want_days < rem:
            return False, '买断至少要接手剩余 %d 天' % rem, 0, rem, rem, 0, 0, price
        total = want_days
        extra = total - rem
        takeover = int(math.ceil(rem * price * 1.5))
        premium = takeover - rem * price
        cost = takeover + extra * price
        refund = rem * int(row.get('paid_day') or price) + int(math.floor(premium * 0.10))
        return True, '', cost, total, rem, premium, refund, price
    # 无主 / 已过期：正常购买
    return True, '', want_days * price, want_days, rem, 0, 0, price


def ensure_seed(cfg):
    """把 town.HOUSES 写进库（INSERT OR IGNORE，不覆盖已有房主）"""
    import db as dbmod
    with dbmod.db(cfg) as c:
        for h in town.HOUSES:
            c.execute(
                'INSERT OR IGNORE INTO houses'
                '(id, tier, name, price_day, owner_id, owner_name, paid_day, started_at, expires_at, updated_at)'
                ' VALUES(?,?,?,?,NULL,\'\',0,0,0,?)',
                (h['id'], h['tier'], h['name'], int(h['price_day']), now_ms()))


def load_all(cfg):
    import db as dbmod
    out = {}
    with dbmod.db(cfg) as c:
        rows = c.execute('SELECT * FROM houses').fetchall()
        for r in rows:
            out[str(r['id'])] = {
                'id': r['id'], 'tier': r['tier'], 'name': r['name'],
                'price_day': int(r['price_day'] or 0),
                'owner_id': int(r['owner_id'] or 0),
                'owner_name': r['owner_name'] or '',
                'paid_day': int(r['paid_day'] or 0),
                'started_at': int(r['started_at'] or 0),
                'expires_at': int(r['expires_at'] or 0),
                'updated_at': int(r['updated_at'] or 0),
            }
    return out
