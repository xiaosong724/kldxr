# -*- coding: utf-8 -*-
"""一次性迁移：把主城（town_id=1）的放置物整体平移 (-130, +130)。

原因：对象化时用的是旧坐标原点 (0,0)，而实际渲染的小镇在 (-130,130)。
23 栋建筑里 21 栋的坐标差正好是 (-130,+130)，平移到旧路面上就能严丝合缝。

- 先自动备份 server/game.db（SQLite backup API，WAL 下也安全）；
- 平移 x/z 和 collision_json 里的世界 AABB；
- 写 meta.town_rebase_v1=1，重复执行会跳过。

跑法：
    python tools/migrate_town_rebase.py            # 只预览，不写库
    python tools/migrate_town_rebase.py --apply    # 真迁移（会先备份）
"""
import json
import os
import shutil
import sqlite3
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, 'server', 'game.db')
BACKUP_DIR = os.path.join(ROOT, 'server', 'backups')
DX, DZ = -130.0, 130.0
FLAG = 'town_rebase_v1'


def backup(src):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    dst = os.path.join(BACKUP_DIR, 'game-before-rebase-%s.db' % time.strftime('%Y%m%d-%H%M%S'))
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
    done = c.execute("SELECT v FROM meta WHERE k=?", (FLAG,)).fetchone()
    if done and str(done['v']) == '1':
        print('already migrated (meta.%s=1), nothing to do' % FLAG)
        return 0
    rows = c.execute("SELECT id, catalog_id, x, z, collision_json FROM town_objects"
                     " WHERE town_id=1").fetchall()
    print('objects to move:', len(rows))
    for r in rows[:3]:
        print('  sample', r['id'], r['catalog_id'], r['x'], r['z'])
    if not apply:
        print('dry run —— 加 --apply 才会写库')
        return 0

    dst = backup(DB)
    print('backup:', dst)
    try:
        with c:
            for r in rows:
                boxes = []
                try:
                    raw = json.loads(r['collision_json'] or '[]')
                    for b in raw:
                        if isinstance(b, list) and len(b) == 6:
                            boxes.append([b[0] + DX, b[1], b[2] + DZ,
                                          b[3] + DX, b[4], b[5] + DZ])
                except Exception:
                    boxes = []
                c.execute('UPDATE town_objects SET x=?, z=?, collision_json=? WHERE id=?',
                          (float(r['x']) + DX, float(r['z']) + DZ,
                           json.dumps(boxes), int(r['id'])))
            c.execute("INSERT INTO meta(k,v) VALUES(?,?)"
                      " ON CONFLICT(k) DO UPDATE SET v=excluded.v", (FLAG, '1'))
        print('migrated %d objects by (%+.0f, %+.0f)' % (len(rows), DX, DZ))
    except Exception as e:
        print('MIGRATION FAILED:', repr(e))
        print('backup kept at', dst)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
