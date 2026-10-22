# -*- coding: utf-8 -*-
"""v4 物件放置：建筑外壳 + 家具，含碰撞、边界、父子关系。

坐标：全部是世界坐标（米）。建筑自身中心为原点摆放。
家具在库里存建筑局部坐标 + parent_id + floor，读取时转换。
"""
import json
import time

import db as dbmod
import towns as townreg

GRID = townreg.GRID


def now_ms():
    return int(time.time() * 1000)


def _row(r):
    return dict(zip(r.keys(), tuple(r))) if r is not None else None


def _catalog(cfg, cid):
    with dbmod.db(cfg) as c:
        return _row(c.execute('SELECT * FROM town_catalog WHERE id=? AND enabled=1',
                              (str(cid),)).fetchone())


def collision_of(cat):
    try:
        boxes = json.loads(cat.get('collision_json') or '[]')
    except Exception:
        boxes = []
    out = []
    for b in boxes:
        if isinstance(b, (list, tuple)) and len(b) == 6:
            out.append([float(v) for v in b])
    return out


def _rot_box(box, rot):
    """rotate an AABB (x1,y1,z1,x2,y2,z2) around Y; return new AABB."""
    import math
    x1, y1, z1, x2, y2, z2 = box
    ca, sa = math.cos(rot), math.sin(rot)
    pts = []
    for x in (x1, x2):
        for z in (z1, z2):
            pts.append((x * ca + z * sa, -x * sa + z * ca))
    xs = [p[0] for p in pts]
    zs = [p[1] for p in pts]
    return [min(xs), y1, min(zs), max(xs), y2, max(zs)]


def world_boxes(cat, x, z, rot, floor_y=0.0):
    """catalog collision -> world AABB list"""
    out = []
    for b in collision_of(cat):
        rb = _rot_box(b, rot)
        out.append([rb[0] + x, rb[1] + floor_y, rb[2] + z,
                    rb[3] + x, rb[4] + floor_y, rb[5] + z])
    return out


def aabb_hit(a, b):
    return not (a[3] <= b[0] or b[3] <= a[0] or
                a[5] <= b[2] or b[5] <= a[2])


def aabb_hit_2d(a, b, pad=0.0):
    return not (a[3] + pad <= b[0] or b[3] + pad <= a[0] or
                a[5] + pad <= b[2] or b[5] + pad <= a[2])


def inside_town(town_row, boxes, margin=0.0):
    """every box must sit inside the town square"""
    size = float(town_row.get('size_m') or 500.0)
    cx = float(town_row.get('x') or 0.0)
    cz = float(town_row.get('z') or 0.0)
    half = size / 2.0 - margin
    for b in boxes:
        if b[0] < cx - half or b[3] > cx + half:
            return False
        if b[2] < cz - half or b[5] > cz + half:
            return False
    return True


def overlaps_existing(cfg, town_id, boxes, ignore_id=0):
    with dbmod.db(cfg) as c:
        rows = c.execute(
            "SELECT id,catalog_id,x,z,rot,collision_json,floor,parent_id"
            " FROM town_objects WHERE town_id=? AND state='active' AND id<>?",
            (int(town_id), int(ignore_id or 0))).fetchall()
    for r in rows:
        d = _row(r)
        try:
            ob = json.loads(d['collision_json'] or '[]')
        except Exception:
            ob = []
        for b in ob:
            if len(b) != 6:
                continue
            if aabb_hit_2d(boxes[0], b, pad=0.02):
                return d
    return None


def place_object(cfg, town_row, catalog_id, x, z, rot=0.0,
                 owner_id=0, parent_id=0, floor=0, price_paid=0,
                 floor_y=0.0, check=True, state='active'):
    """Insert one object. Returns (ok, error, row)."""
    cat = _catalog(cfg, catalog_id)
    if not cat:
        return False, '目录里没有这个物件', None
    boxes = world_boxes(cat, x, z, rot, floor_y)
    if check:
        if not inside_town(town_row, boxes):
            return False, '超出小镇边界', None
        if boxes:
            hit = overlaps_existing(cfg, town_row['id'], boxes)
            if hit:
                return False, '和已有物件重叠', None
    now = now_ms()
    with dbmod.db(cfg) as c:
        cur = c.execute(
            'INSERT INTO town_objects(town_id,catalog_id,owner_id,x,z,rot,'
            'place_mode,price_paid,state,collision_json,function_json,'
            'created_at,updated_at,model_id,model_version,parent_id,floor,meta_json)'
            ' VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (int(town_row['id']), str(catalog_id), int(owner_id),
             float(x), float(z), float(rot),
             str(cat.get('place_mode') or 'grid'), int(price_paid), str(state),
             json.dumps(boxes), cat.get('function_json') or '{}',
             now, now, cat.get('model_id') or '', cat.get('model_version') or 'v1',
             int(parent_id or 0), int(floor or 0), '{}'))
        c.commit()
        oid = int(cur.lastrowid)
        return True, '', _row(c.execute('SELECT * FROM town_objects WHERE id=?', (oid,)).fetchone())


def place_building(cfg, town_row, catalog_id, x, z, rot=0.0, owner_id=0):
    """Place a building plus its layout furniture.

    Returns (ok, error, {building, furniture_count}).
    """
    cat = _catalog(cfg, catalog_id)
    if not cat:
        return False, '目录里没有这个建筑', None
    ok, err, brow = place_object(cfg, town_row, catalog_id, x, z, rot,
                                 owner_id=owner_id)
    if not ok:
        return False, err, None

    import math
    try:
        layout = json.loads(cat.get('layout_json') or '{}')
    except Exception:
        layout = {}
    placed = []
    for fl in layout.get('floors', []):
        fy = float(fl.get('y') or 0.0)
        for it in fl.get('items', []):
            lx = float(it.get('x') or 0.0)
            lz = float(it.get('z') or 0.0)
            lr = float(it.get('rot') or 0.0)
            # rotate local offset into world space
            ca, sa = math.cos(rot), math.sin(rot)
            wx = x + (lx * ca + lz * sa)
            wz = z + (-lx * sa + lz * ca)
            wr = rot + lr
            ok2, err2, frow = place_object(
                cfg, town_row, it['catalog'], wx, wz, wr,
                owner_id=owner_id, parent_id=brow['id'],
                floor=int(fy > 0.5), floor_y=fy, check=False)
            if ok2:
                placed.append(frow)
    return True, '', {'building': brow, 'furniture': placed,
                      'furniture_count': len(placed)}


def list_objects(cfg, town_id):
    with dbmod.db(cfg) as c:
        rows = c.execute(
            "SELECT * FROM town_objects WHERE town_id=? AND state='active'"
            " ORDER BY parent_id, id", (int(town_id),)).fetchall()
    return [_row(r) for r in rows]


def move_object(cfg, town_row, obj_id, x, z, rot=None):
    with dbmod.db(cfg) as c:
        row = _row(c.execute('SELECT * FROM town_objects WHERE id=?', (int(obj_id),)).fetchone())
    if not row:
        return False, '物件不存在', None
    cat = _catalog(cfg, row['catalog_id'])
    if not cat:
        return False, '目录缺失', None
    r = float(row['rot'] if rot is None else rot)
    boxes = world_boxes(cat, x, z, r, 0.0)
    if not inside_town(town_row, boxes):
        return False, '超出小镇边界', None
    hit = overlaps_existing(cfg, town_row['id'], boxes, ignore_id=obj_id)
    if hit:
        return False, '和已有物件重叠', None
    dx = float(x) - float(row['x'])
    dz = float(z) - float(row['z'])
    dr = r - float(row['rot'] or 0.0)
    with dbmod.db(cfg) as c:
        c.execute('UPDATE town_objects SET x=?,z=?,rot=?,collision_json=?,updated_at=? WHERE id=?',
                  (float(x), float(z), r, json.dumps(boxes), now_ms(), int(obj_id)))
        # ★ 2026-10-22：建筑移动 → 它的家具一起走（同位移；旋转时绕建筑中心转）
        kids = c.execute('SELECT id,catalog_id,x,z,rot,collision_json,floor'
                         ' FROM town_objects WHERE parent_id=? AND state="active"',
                         (int(obj_id),)).fetchall()
        import math as _m
        for k in kids:
            kx, kz = float(k['x']) + dx, float(k['z']) + dz
            kr = float(k['rot'] or 0.0) + dr
            if abs(dr) > 1e-6:
                lx = float(k['x']) - float(row['x'])
                lz = float(k['z']) - float(row['z'])
                ca, sa = _m.cos(dr), _m.sin(dr)
                kx = float(x) + (lx * ca + lz * sa)
                kz = float(z) + (-lx * sa + lz * ca)
            kcat = _catalog(cfg, str(k['catalog_id']))
            kboxes = world_boxes(kcat, kx, kz, kr, 0.0) if kcat else []
            c.execute('UPDATE town_objects SET x=?,z=?,rot=?,collision_json=?,updated_at=?'
                      ' WHERE id=?',
                      (kx, kz, kr, json.dumps(kboxes), now_ms(), int(k['id'])))
        c.commit()
    return True, '', {'id': int(obj_id), 'x': float(x), 'z': float(z), 'rot': r,
                      'children': len(kids)}


def remove_object(cfg, obj_id, cascade=True):
    """Soft-delete. Children of a building are removed too.

    ★ 2026-10-22：返回第三项 = 被级联删掉的子对象 id 列表。
      以前只返回 (True,'')，客户端只删了建筑本身的 mesh，
      里面的家具（遮阳伞/桌椅…）还留在场景里 → "删了建筑，里面的东西还在"。
    """
    kids = []
    with dbmod.db(cfg) as c:
        row = _row(c.execute('SELECT * FROM town_objects WHERE id=?', (int(obj_id),)).fetchone())
        if not row:
            return False, '物件不存在', []
        now = now_ms()
        c.execute("UPDATE town_objects SET state='removed',updated_at=? WHERE id=?",
                  (now, int(obj_id)))
        if cascade:
            for r in c.execute('SELECT id FROM town_objects WHERE parent_id=?',
                               (int(obj_id),)).fetchall():
                kids.append(int(r['id']))
            c.execute("UPDATE town_objects SET state='removed',updated_at=? WHERE parent_id=?",
                      (now, int(obj_id)))
        c.commit()
    return True, '', kids


def nearby(cfg, town_id, x, z, radius=60.0):
    """Objects whose centre is within radius (server sends only these)."""
    out = []
    for o in list_objects(cfg, town_id):
        if abs(o['x'] - x) <= radius and abs(o['z'] - z) <= radius:
            out.append(o)
    return out

def replace_with_model(cfg, town_row, obj_id, new_catalog_id):
    """把已有对象原地换成新模型：保留坐标/朝向，重建碰撞盒，并按新布局生成家具。

    返回 (ok, error)。
    """
    import math
    with dbmod.db(cfg) as c:
        row = _row(c.execute('SELECT * FROM town_objects WHERE id=?', (int(obj_id),)).fetchone())
    if not row:
        return False, '对象不存在'
    cat = _catalog(cfg, new_catalog_id)
    if not cat:
        return False, '目录里没有这个模型'

    x, z, rot = float(row['x']), float(row['z']), float(row['rot'] or 0.0)
    boxes = world_boxes(cat, x, z, rot, 0.0)
    if not inside_town(town_row, boxes):
        return False, '超出小镇边界'
    hit = overlaps_existing(cfg, town_row['id'], boxes, ignore_id=obj_id)
    if hit:
        return False, '和 %s 重叠' % hit['catalog_id']

    now = now_ms()
    with dbmod.db(cfg) as c:
        # 先清掉旧建筑名下的家具
        c.execute("UPDATE town_objects SET state='removed', updated_at=? WHERE parent_id=?",
                  (now, int(obj_id)))
        c.execute('UPDATE town_objects SET catalog_id=?, collision_json=?, model_id=?,'
                  ' model_version=?, place_mode=?, function_json=?, updated_at=? WHERE id=?',
                  (str(new_catalog_id), json.dumps(boxes),
                   cat.get('model_id') or '', cat.get('model_version') or 'v1',
                   cat.get('place_mode') or 'grid', cat.get('function_json') or '{}',
                   now, int(obj_id)))
        c.commit()

    try:
        layout = json.loads(cat.get('layout_json') or '{}')
    except Exception:
        layout = {}
    ca, sa = math.cos(rot), math.sin(rot)
    for fl in layout.get('floors', []):
        fy = float(fl.get('y') or 0.0)
        for it in fl.get('items', []):
            lx = float(it.get('x') or 0.0)
            lz = float(it.get('z') or 0.0)
            lr = float(it.get('rot') or 0.0)
            wx = x + (lx * ca + lz * sa)
            wz = z + (-lx * sa + lz * ca)
            place_object(cfg, town_row, it['catalog'], wx, wz, rot + lr,
                         owner_id=int(row['owner_id'] or 0), parent_id=int(obj_id),
                         floor=int(fy > 0.5), floor_y=fy, check=False)
    return True, ''
