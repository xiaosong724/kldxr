# -*- coding: utf-8 -*-
"""仓库：复用 items.in_storage（0=背包 / 1=仓库），不新增表。

所有写操作在一个数据库事务里完成，避免半存半取。
"""
import json

import db as dbmod
import weapons

CAPACITY = 90


def _load_rows(rows):
    out = []
    for rid, js, stack in rows:
        try:
            it = json.loads(js)
        except Exception:
            continue
        if not isinstance(it, dict):
            continue
        weapons.ensure_dur(it)
        out.append({'id': rid, 'item': it, 'stack': int(stack or 1)})
    return out


def _rows_of(c, role_id, storage):
    return c.execute(
        'SELECT id, item_json, stack FROM items WHERE role_id=? AND in_storage=?'
        ' ORDER BY (slot_index IS NULL), slot_index, id DESC',
        (role_id, int(storage))).fetchall()


def list_all(cfg, role_id):
    with dbmod.db(cfg) as c:
        bag = _load_rows(_rows_of(c, role_id, 0))
        store = _load_rows(_rows_of(c, role_id, 1))
        return {'bag': bag, 'store': store, 'capacity': CAPACITY, 'used': len(store)}


def _merge_target(c, role_id, storage, js, item):
    """可堆叠材料：找同 role + 同物品 JSON 的目标行。装备不合并。"""
    if item.get('slot') in ('weapon', 'armor') or item.get('base'):
        return None
    return c.execute(
        'SELECT id, stack FROM items WHERE role_id=? AND in_storage=? AND item_json=?'
        ' ORDER BY id LIMIT 1', (role_id, int(storage), js)).fetchone()


def move(cfg, role_id, item_id, to):
    """把一件/一组物品从背包移到仓库，或从仓库取回。返回 (ok, msg, data)."""
    if to not in ('store', 'bag'):
        return False, '未知方向', None
    storage = 1 if to == 'store' else 0
    src = 0 if to == 'store' else 1
    try:
        with dbmod.db(cfg) as c:
            row = c.execute(
                'SELECT id, item_json, stack, in_storage FROM items WHERE id=? AND role_id=?',
                (int(item_id), int(role_id))).fetchone()
            if not row:
                return False, '物品不存在', None
            rid, js, stack, cur = row[0], row[1], int(row[2] or 1), int(row[3] or 0)
            if cur != src:
                return False, '物品已经不在原来的位置', None
            # 已装备的武器/防具不允许直接存
            eq = c.execute('SELECT 1 FROM equipment WHERE role_id=? AND item_id=?',
                           (int(role_id), int(rid))).fetchone()
            if eq:
                return False, '请先卸下装备再存取', None
            try:
                item = json.loads(js)
            except Exception:
                return False, '物品数据损坏', None

            used = c.execute('SELECT COUNT(*) FROM items WHERE role_id=? AND in_storage=1',
                             (int(role_id),)).fetchone()[0]
            target = _merge_target(c, role_id, storage, js, item)
            if to == 'store' and not target and used >= CAPACITY:
                return False, '仓库已满', None

            if target:
                c.execute('UPDATE items SET stack=stack+? WHERE id=?', (stack, target[0]))
                c.execute('DELETE FROM items WHERE id=?', (int(rid),))
            else:
                c.execute('UPDATE items SET in_storage=? WHERE id=?', (int(storage), int(rid)))
            c.commit()
            return True, ('已存入仓库' if to == 'store' else '已取回背包'), {
                'bag': _load_rows(_rows_of(c, role_id, 0)),
                'store': _load_rows(_rows_of(c, role_id, 1)),
                'capacity': CAPACITY,
                'used': c.execute('SELECT COUNT(*) FROM items WHERE role_id=? AND in_storage=1',
                                  (int(role_id),)).fetchone()[0]
            }
    except Exception as e:
        return False, '存取失败：%r' % (e,), None


def move_many(cfg, role_id, ids, to):
    """批量存取（逐个事务执行，返回最后一份列表）。ids 最多 200。"""
    out = []
    last = None
    n = 0
    for x in (ids or [])[:200]:
        try:
            iid = int(x)
        except Exception:
            continue
        ok, msg, data = move(cfg, role_id, iid, to)
        if ok:
            out.append(iid)
            n += 1
            last = data
    return n, last
