# -*- coding: utf-8 -*-
"""打工：岗位占用、离线 72h 累计、每小时结算。

★ 落库走 post_save（存档线程），tick 线程只算内存 ✓
★ 岗位占用用 work_state 表（shop_id, slot_id 唯一），重启后可恢复 ✓
"""
import time

OFFLINE_CAP_H = 72          # 离线最多累计 72 小时（用户确认 ✓）
PAY_PER_HOUR = 500000       # ★ 2026-10-22（用户）：每小时 50 万金币
EXP_PCT_PER_HOUR = 0.10     # ★ 2026-10-22（用户）：每小时 10% 升级所需经验
MIN_SETTLE_SEC = 30         # 不足 30 秒不给（防"点了就结算"刷零头）


def now_s():
    return int(time.time())


def need_of(level):
    """当前等级升下一级所需经验（和服务端 mobs.level_up_need 同一套）"""
    try:
        import mobs
        return int(mobs.level_up_need(int(level or 1)))
    except Exception:
        L = max(1, int(level or 1))
        return int((6 + 1.3 * L) * (10 + 4 * L + 0.12 * L * L))


def hourly_exp(level):
    return max(1, int(need_of(level) * EXP_PCT_PER_HOUR))


def hourly_pay():
    return PAY_PER_HOUR


def load_workers(cfg):
    """启动时读出所有在岗记录 → {role_id: row}"""
    import db as dbmod
    out = {}
    try:
        with dbmod.db(cfg) as c:
            rows = c.execute('SELECT w.role_id, w.shop_id, w.slot_id, w.started_at,'
                             ' w.last_settle, w.carry_sec, r.name AS rname'
                             ' FROM work_state w LEFT JOIN roles r ON r.id=w.role_id'
                             ' WHERE w.active=1').fetchall()
            for r in rows:
                # ★ 2026-10-22：角色已经被删了 → 这条在岗记录是孤儿，不能占着岗位
                if not r['rname']:
                    continue
                out[int(r['role_id'])] = {
                    'shop': str(r['shop_id']), 'slot': str(r['slot_id']),
                    'started': int(r['started_at'] or 0),
                    'last': int(r['last_settle'] or 0),
                    'carry': int(r['carry_sec'] or 0),
                    'name': str(r['rname'] or ''),     # ★ 2026-10-22：离线也能显示是谁
                }
    except Exception as e:
        print('[work] load failed: %r' % (e,))
    return out


def slot_taken(cfg, shop_id, slot_id, exclude_role=0):
    import db as dbmod
    try:
        with dbmod.db(cfg) as c:
            r = c.execute('SELECT role_id FROM work_state WHERE shop_id=? AND slot_id=? AND active=1',
                          (shop_id, slot_id)).fetchone()
            if not r:
                return 0
            rid = int(r[0])
            return 0 if rid == int(exclude_role or 0) else rid
    except Exception:
        return 0


def start(cfg, role_id, shop_id, slot_id):
    """占用岗位（写库）→ 返回 (ok, msg)"""
    import db as dbmod
    if slot_taken(cfg, shop_id, slot_id, role_id):
        return False, '这个岗位已经有人了'
    try:
        with dbmod.db(cfg) as c:
            c.execute('UPDATE work_state SET active=0 WHERE role_id=?', (int(role_id),))
            c.execute('INSERT OR REPLACE INTO work_state'
                      '(role_id, shop_id, slot_id, started_at, last_settle, carry_sec, active)'
                      ' VALUES(?,?,?,?,?,0,1)',
                      (int(role_id), shop_id, slot_id, now_s(), now_s()))
    except Exception as e:
        return False, '打工登记失败：%s' % e
    return True, ''


def stop(cfg, role_id):
    import db as dbmod
    try:
        with dbmod.db(cfg) as c:
            c.execute('UPDATE work_state SET active=0 WHERE role_id=?', (int(role_id),))
    except Exception as e:
        print('[work] stop failed: %r' % (e,))


def settle(cfg, role_id, shop_id, slot_id, level, hours, pay, exp):
    """结算后落库：更新 last_settle / carry_sec，经验金币由调用方给"""
    import db as dbmod
    try:
        with dbmod.db(cfg) as c:
            c.execute('UPDATE work_state SET last_settle=?, carry_sec=0'
                      ' WHERE role_id=? AND shop_id=? AND slot_id=? AND active=1',
                      (now_s(), int(role_id), shop_id, slot_id))
    except Exception as e:
        print('[work] settle failed: %r' % (e,))


def offline_hours(last_settle, now=None):
    now = now_s() if now is None else now
    h = (now - int(last_settle or now)) / 3600.0
    return max(0.0, min(float(OFFLINE_CAP_H), h))


def all_slots(cfg, shop_id):
    """某店所有岗位的占用情况 → {slot: role_id}"""
    import db as dbmod
    out = {}
    try:
        with dbmod.db(cfg) as c:
            for r in c.execute('SELECT slot_id, role_id FROM work_state'
                               ' WHERE shop_id=? AND active=1', (shop_id,)).fetchall():
                out[str(r[0])] = int(r[1])
    except Exception:
        pass
    return out


def prorate(level, seconds):
    """★ 2026-10-22（用户："按小时算，不足一小时按百分比给"）
    返回 (exp, pay, sec)：sec 是实际计入的秒数（已夹到 72 小时上限）"""
    try:
        sec = float(seconds or 0)
    except Exception:
        sec = 0.0
    sec = max(0.0, min(float(OFFLINE_CAP_H) * 3600.0, sec))
    if sec < MIN_SETTLE_SEC:
        return 0, 0, sec
    exp = int(round(hourly_exp(level) * sec / 3600.0))
    pay = int(round(hourly_pay() * sec / 3600.0))
    return max(1, exp), max(0, pay), sec


def load_worker(cfg, role_id):
    """登录时读这个人的在岗记录（网络线程读 ✓）；没有就 None"""
    import db as dbmod
    try:
        with dbmod.db(cfg) as c:
            r = c.execute('SELECT role_id, shop_id, slot_id, started_at, last_settle, carry_sec'
                          ' FROM work_state WHERE role_id=? AND active=1',
                          (int(role_id),)).fetchone()
        if not r:
            return None
        return {'shop': str(r['shop_id']), 'slot': str(r['slot_id']),
                'started': int(r['started_at'] or 0),
                'last': int(r['last_settle'] or 0),
                'carry': int(r['carry_sec'] or 0)}
    except Exception:
        return None


def worked_seconds(last_settle, now=None):
    """从上次结算到现在累计的秒数（含离线 ✗ 夹在 72 小时内 ✓）"""
    now = now_s() if now is None else int(now)
    sec = max(0.0, float(now - int(last_settle or now)))
    return min(float(OFFLINE_CAP_H) * 3600.0, sec)
