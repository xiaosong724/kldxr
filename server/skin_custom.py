# -*- coding: utf-8 -*-
"""皮肤自定义（round510）：五官 / 瞳色 / 头发色 / 衣服色

★ 规则（用户定）：
   ① 改哪个皮肤，就必须用【这个皮肤】的重复卡 ✗ 不能用别的皮肤的卡 ✓
   ② 一个部位一张卡 ✓
   ③ 必须【已经解锁】这个皮肤（不然会把还没解锁的卡烧掉 ✓）
   ④ 先预览 ✗ 确认才扣卡落地 ✓
★ 存的是**语义 key** 不是数字下标 ✗ 以后美术重做能映射 ✓
"""
import io
import json

import db as dbmod

# ---------------------------------------------------------------- 可选值
# 眼型：和 core/game.js 里 EYE_F / EYE_M 的**顺序一一对应**（10 个）
EYE_KEYS_F = ['big', 'round', 'thin', 'cat', 'droop', 'half', 'star', 'slit', 'cold', 'dot']
EYE_KEYS_M = ['narrow', 'square', 'fierce', 'small', 'squint', 'slit', 'tri', 'puffy', 'mono', 'scar']
# 嘴型：和 MOUTH 一一对应（10 个）
MOUTH_KEYS = ['calm', 'smile', 'tight', 'open', 'grin', 'smirk', 'sad', 'pout', 'laugh', 'stitch']

FIELDS = ('ey', 'mo', 'iris', 'hair', 'shirt', 'skirt', 'pants')
COLOR_FIELDS = ('iris', 'hair', 'shirt', 'skirt', 'pants')
MIN_COLOR, MAX_COLOR = 0x000000, 0xffffff


def eye_keys(gender):
    return EYE_KEYS_M if str(gender).lower().startswith('m') else EYE_KEYS_F


def valid_value(gender, field, val):
    """合法就返回 (True, 规范化后的值)，否则 (False, 原因)"""
    if field not in FIELDS:
        return False, '不认识的部位'
    if field == 'ey':
        ks = eye_keys(gender)
        if val not in ks:
            return False, '没有这个眼型'
        return True, val
    if field == 'mo':
        if val not in MOUTH_KEYS:
            return False, '没有这个嘴型'
        return True, val
    # 颜色
    try:
        n = int(val)
    except Exception:
        return False, '颜色不对'
    if n < MIN_COLOR or n > MAX_COLOR:
        return False, '颜色超出范围'
    return True, n


def default_data():
    return {'v': 1}


# ---------------------------------------------------------------- 读写
def get(cfg, role_id, skin_key):
    try:
        with dbmod.db(cfg) as c:
            row = c.execute('SELECT data FROM skin_custom WHERE role_id=? AND skin_key=?',
                            (int(role_id), str(skin_key))).fetchone()
    except Exception:
        return None
    if not row:
        return None
    try:
        d = json.loads(row[0] if not hasattr(row, 'keys') else row['data'])
    except Exception:
        return None
    return d if isinstance(d, dict) else None


def all_of(cfg, role_id):
    """这个人的所有皮肤自定义 → {skin_key: data}"""
    out = {}
    try:
        with dbmod.db(cfg) as c:
            rows = c.execute('SELECT skin_key, data FROM skin_custom WHERE role_id=?',
                             (int(role_id),)).fetchall()
    except Exception:
        return out
    for r in rows:
        try:
            k = r[0] if not hasattr(r, 'keys') else r['skin_key']
            js = r[1] if not hasattr(r, 'keys') else r['data']
            d = json.loads(js)
            if isinstance(d, dict):
                out[str(k)] = d
        except Exception:
            continue
    return out


def _dup_card_rows(c, role_id, skin_key):
    """这张皮肤的所有卡行 [(id, stack)]，按 id 升序"""
    rows = c.execute("SELECT id, item_json, stack FROM items WHERE role_id=? AND in_storage=0",
                     (int(role_id),)).fetchall()
    same = []
    for r in rows:
        iid = r[0] if not hasattr(r, 'keys') else r['id']
        js = r[1] if not hasattr(r, 'keys') else r['item_json']
        try:
            it = json.loads(js)
        except Exception:
            continue
        if it.get('kind') == 'skin' and str(it.get('key') or '') == str(skin_key):
            try:
                st = int((r[2] if not hasattr(r, 'keys') else r['stack']) or 1)
            except Exception:
                st = 1
            same.append((int(iid), max(1, st)))
    same.sort()
    return same


def _dup_card_ids(c, role_id, skin_key):
    """这张皮肤的【重复卡】有几张（★ 2026-10-22：皮肤卡会堆叠 → 按 stack 算）

    同一个 key 的卡总数 >= 2 时，多出来的那些才算重复（第 1 张是解锁用的）
    """
    rows = _dup_card_rows(c, role_id, skin_key)
    total = sum(st for _, st in rows)
    return max(0, total - 1)


def _consume_dup_card(c, role_id, skin_key):
    """扣掉 1 张重复卡（★ 只扣 1 张，不会把整堆吃掉）"""
    rows = _dup_card_rows(c, role_id, skin_key)
    total = sum(st for _, st in rows)
    if total < 2:
        return False
    # 从最后一行扣（第一张留给"解锁"那张）
    iid, st = rows[-1]
    if st > 1:
        c.execute('UPDATE items SET stack = stack - 1 WHERE id=? AND role_id=?',
                  (iid, int(role_id)))
    else:
        c.execute('DELETE FROM items WHERE id=? AND role_id=?', (iid, int(role_id)))
    return True


def apply(cfg, role_id, gender, skin_key, unlocked, field, val):
    """确认更换：验值 → 扣一张【该皮肤的重复卡】→ 写自定义（同一个事务 ✓）

    返回 (ok, 新的 data / 错误说明)
    """
    import skins as skinsmod
    if not skinsmod.valid(skin_key):
        return False, '没有这个皮肤'
    if not unlocked:
        return False, '你还没解锁这个皮肤'
    ok, v = valid_value(gender, field, val)
    if not ok:
        return False, v
    try:
        with dbmod.db(cfg) as c:
            if not _consume_dup_card(c, role_id, skin_key):
                return False, '缺「%s」的重复皮肤卡（要有 2 张以上同款卡）' % \
                    skinsmod.NAME.get(skin_key, skin_key)
            row = c.execute('SELECT data FROM skin_custom WHERE role_id=? AND skin_key=?',
                            (int(role_id), str(skin_key))).fetchone()
            d = {}
            if row:
                try:
                    d = json.loads(row[0] if not hasattr(row, 'keys') else row['data'])
                except Exception:
                    d = {}
            if not isinstance(d, dict):
                d = {}
            d['v'] = 1
            d[field] = v
            c.execute('INSERT INTO skin_custom(role_id, skin_key, data, at) VALUES(?,?,?,?)'
                      ' ON CONFLICT(role_id, skin_key) DO UPDATE SET data=excluded.data, at=excluded.at',
                      (int(role_id), str(skin_key),
                       json.dumps(d, ensure_ascii=False), dbmod.now_ms()))
            return True, d
    except Exception as e:
        return False, '保存失败：%r' % (e,)


def clear(cfg, role_id, skin_key=None):
    """清空自定义（管理页用）"""
    try:
        with dbmod.db(cfg) as c:
            if skin_key:
                c.execute('DELETE FROM skin_custom WHERE role_id=? AND skin_key=?',
                          (int(role_id), str(skin_key)))
            else:
                c.execute('DELETE FROM skin_custom WHERE role_id=?', (int(role_id),))
        return True
    except Exception:
        return False


def to_client(data, gender):
    """存的是 key ✗ 客户端要下标 ✓ 转一下（不认识的 key 就丢掉 ✓ 不会崩）"""
    if not isinstance(data, dict):
        return None
    out = {'v': 1}
    if data.get('ey') in eye_keys(gender):
        out['ey'] = eye_keys(gender).index(data['ey'])
    if data.get('mo') in MOUTH_KEYS:
        out['mo'] = MOUTH_KEYS.index(data['mo'])
    for k in COLOR_FIELDS:
        if isinstance(data.get(k), int):
            out[k] = data[k]
    return out if len(out) > 1 else None
