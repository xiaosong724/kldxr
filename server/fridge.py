# -*- coding: utf-8 -*-
"""住宅冰箱：每套住宅一个 12 格冰箱，只存饮料/食品（kind='food'）。

★ 所有写库都在网络线程（net.py）里做；tick 线程只发提示 ✓
"""
import json
import time

FRIDGE_SLOTS = 12


def _now():
    return int(time.time() * 1000)


def load(cfg, house_id):
    """读出冰箱里的东西 → [{slot, item, stack}]"""
    import db as dbmod
    out = []
    with dbmod.db(cfg) as c:
        rows = c.execute(
            'SELECT slot, item_json, stack FROM house_fridge WHERE house_id=? ORDER BY slot',
            (str(house_id),)).fetchall()
        for r in rows:
            try:
                it = json.loads(r['item_json'])
            except Exception:
                it = {}
            out.append({'slot': int(r['slot']), 'item': it, 'stack': int(r['stack'] or 1)})
    return out


def public(cfg, house_id, owner_id, viewer_id):
    ok = bool(owner_id) and int(owner_id) == int(viewer_id or 0)
    return {'house': house_id, 'owner': bool(owner_id), 'mine': ok,
            'cap': FRIDGE_SLOTS, 'items': load(cfg, house_id) if ok else []}


def _free_slot(c, house_id):
    used = set()
    for r in c.execute('SELECT slot FROM house_fridge WHERE house_id=?', (str(house_id),)).fetchall():
        used.add(int(r[0]))
    for i in range(FRIDGE_SLOTS):
        if i not in used:
            return i
    return -1


def put_item(c, house_id, item, stack=1):
    """往冰箱里放一件（网络线程的 DB 连接）。返回 (ok, msg)"""
    st = int(stack or 1)
    item = dict(item)
    item.pop('locked_by', None)
    item.pop('locked', None)
    slot = _free_slot(c, house_id)
    if slot < 0:
        return False, '冰箱满了'
    c.execute('INSERT INTO house_fridge(house_id, slot, item_json, stack, created_at)'
              ' VALUES(?,?,?,?,?)',
              (str(house_id), slot, json.dumps(item, ensure_ascii=False), st, _now()))
    return True, ''


def take_item(c, house_id, slot):
    """从冰箱取出：返回 (item_json, stack) 或 (None, 0)"""
    r = c.execute('SELECT item_json, stack FROM house_fridge WHERE house_id=? AND slot=?',
                  (str(house_id), int(slot))).fetchone()
    if not r:
        return None, 0
    c.execute('DELETE FROM house_fridge WHERE house_id=? AND slot=?',
              (str(house_id), int(slot)))
    try:
        it = json.loads(r['item_json'])
    except Exception:
        it = {}
    return it, int(r['stack'] or 1)


def clear(cfg, house_id):
    import db as dbmod
    try:
        with dbmod.db(cfg) as c:
            c.execute('DELETE FROM house_fridge WHERE house_id=?', (str(house_id),))
    except Exception as e:
        print('[fridge] clear failed: %r' % (e,))
