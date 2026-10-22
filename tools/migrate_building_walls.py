# -*- coding: utf-8 -*-
"""一次性迁移：按新的「墙 + 门洞」碰撞盒重算所有已放置建筑的 collision_json。

目录里的 collision_json 已经改成 5 个盒子（四面墙 + 南墙门洞），
但已放置的对象还存着老的「一整块实心盒」，要按 目录 + 位置/朝向 重算。

跑法：
    python tools/migrate_building_walls.py          # 只统计
    python tools/migrate_building_walls.py --apply   # 写库（先自动备份）
"""
import json
import os
import sqlite3
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, 'server', 'game.db')
BACKUP_DIR = os.path.join(ROOT, 'server', 'backups')
sys.path.insert(0, os.path.join(ROOT, 'server'))
import town_objects as objreg  # noqa: E402


def backup(src):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    dst = os.path.join(BACKUP_DIR, 'game-before-walls-%s.db' % time.strftime('%Y%m%d-%H%M%S'))
    s = sqlite3.connect(src, timeout=15)
    d = sqlite3.connect(dst)
    with d:
        s.backup(d)
    d.close()
    s.close()
    return dst


def main():
    apply = '--apply' in sys.argv
    c = sqlite3.connect(DB, timeout=15)
    c.row_factory = sqlite3.Row
    rows = c.execute(
        "SELECT o.id,o.catalog_id,o.x,o.z,o.rot,o.town_id,o.collision_json,"
        "       cat.collision_json AS cat_col"
        "  FROM town_objects o JOIN town_catalog cat ON cat.id=o.catalog_id"
        " WHERE o.state='active' AND cat.category='building'").fetchall()
    print('building objects:', len(rows))
    todo = []
    for r in rows:
        cat = {'collision_json': r['cat_col']}
        boxes = objreg.world_boxes(cat, float(r['x']), float(r['z']), float(r['rot'] or 0), 0.0)
        old = json.loads(r['collision_json'] or '[]')
        if len(old) != len(boxes):
            todo.append((int(r['id']), r['catalog_id'], len(old), len(boxes), boxes))
    print('need update:', len(todo))
    for t in todo[:10]:
        print('  #%d %s  %d -> %d boxes' % (t[0], t[1], t[2], t[3]))
    if not apply:
        print('dry run —— 加 --apply 才会写库')
        return 0
    if not todo:
        print('nothing to do')
        return 0
    dst = backup(DB)
    print('backup:', dst)
    try:
        with c:
            for oid, cid, _a, _b, boxes in todo:
                c.execute('UPDATE town_objects SET collision_json=?, updated_at=? WHERE id=?',
                          (json.dumps(boxes), int(time.time() * 1000), oid))
        print('updated', len(todo), 'objects')
    except Exception as e:
        print('MIGRATION FAILED:', repr(e), '\nbackup kept at', dst)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
