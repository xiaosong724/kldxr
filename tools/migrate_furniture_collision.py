# -*- coding: utf-8 -*-
"""一次性迁移：按缩小后的目录碰撞重算所有已放置【家具/装饰】的 collision_json。

家具目录碰撞已统一缩到 85%（室内更好走），已放置的对象还存着旧盒子。

跑法：
    python tools/migrate_furniture_collision.py            # 只统计
    python tools/migrate_furniture_collision.py --apply    # 写库（先备份）
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
    dst = os.path.join(BACKUP_DIR, 'game-before-furnish-%s.db' % time.strftime('%Y%m%d-%H%M%S'))
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
        "SELECT o.id,o.x,o.z,o.rot,o.collision_json,cat.collision_json AS cat_col"
        "  FROM town_objects o JOIN town_catalog cat ON cat.id=o.catalog_id"
        " WHERE o.state='active' AND cat.category IN ('furniture','decor')").fetchall()
    print('furniture/decor objects:', len(rows))
    todo = []
    for r in rows:
        boxes = objreg.world_boxes({'collision_json': r['cat_col']},
                                   float(r['x']), float(r['z']), float(r['rot'] or 0), 0.0)
        old = json.loads(r['collision_json'] or '[]')
        if json.dumps(old) != json.dumps(boxes):
            todo.append((int(r['id']), boxes))
    print('need update:', len(todo))
    if not apply:
        print('dry run —— 加 --apply 才会写库')
        return 0
    if not todo:
        return 0
    dst = backup(DB)
    print('backup:', dst)
    try:
        with c:
            for oid, boxes in todo:
                c.execute('UPDATE town_objects SET collision_json=?, updated_at=? WHERE id=?',
                          (json.dumps(boxes), int(time.time() * 1000), oid))
        print('updated', len(todo), 'objects')
    except Exception as e:
        print('MIGRATION FAILED:', repr(e), '\nbackup kept at', dst)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
