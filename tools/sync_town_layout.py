# -*- coding: utf-8 -*-
"""小镇布局同步：把本地的「摆放数据」搬到另一个库（云端/测试服）。

    ★ 为什么需要这个工具
      · 建筑「种类/价格/尺寸」在代码里（towns.CATALOG_SEED）→ 同步代码就过去了 ✓
      · 但建筑「摆在哪/朝哪/归谁」在 game.db 的 town_objects 表里 ✗ 不进版本库
      · 云端库没有小镇 → 同步代码后会自动建出【空的新手镇】（0 栋建筑）
      → 想让云端和本地一模一样，就得把这 4 张表搬过去 ✓

    ★ 只碰这 4 张表，绝不碰玩家数据
      towns / town_objects / town_perms / houses

    ★ 归属按【角色名】重新映射
      本地 owner_id=86 是"半个六道"，云端 id 不一定是 86 ✗
      → 导出记名字，导入时按名字查 id，查不到就置 0（系统所有）✓

用法：
    python tools/sync_town_layout.py --export layout.json
    python tools/sync_town_layout.py --import layout.json --db /opt/xiuxian2d/server/game.db --dry-run
    python tools/sync_town_layout.py --import layout.json --db /opt/xiuxian2d/server/game.db
"""
import argparse
import json
import os
import shutil
import sqlite3
import sys
import time

TABLES = ('towns', 'town_objects', 'town_perms', 'houses')


def _connect(path):
    if not os.path.exists(path):
        raise SystemExit('数据库不存在：%s' % path)
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    return c


def _cols(c, table):
    return [r[1] for r in c.execute('PRAGMA table_info(%s)' % table)]


def _has(c, table):
    return bool(c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                          (table,)).fetchone())


# ---------------------------------------------------------------- 导出
def do_export(db_path, out_path):
    c = _connect(db_path)
    data = {'at': int(time.time()), 'from_db': os.path.abspath(db_path), 'tables': {}}
    for t in TABLES:
        if not _has(c, t):
            data['tables'][t] = []
            continue
        rows = [dict(r) for r in c.execute('SELECT * FROM %s' % t)]
        data['tables'][t] = rows
    # 物件/权限的归属 → 记名字（导入时按名字映射）
    owners = {}
    for t, col in (('town_objects', 'owner_id'), ('town_perms', 'player_id'),
                   ('houses', 'owner_id')):
        for r in data['tables'].get(t) or []:
            rid = r.get(col)
            if not rid:
                continue
            if rid not in owners:
                nm = c.execute('SELECT name FROM roles WHERE id=?', (rid,)).fetchone()
                owners[rid] = nm['name'] if nm else ''
            r[col + '_name'] = owners[rid]
    c.close()
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    print('导出完成：%s' % out_path)
    for t in TABLES:
        print('  %-14s %d 行' % (t, len(data['tables'].get(t) or [])))
    act = [r for r in data['tables'].get('town_objects') or []
           if str(r.get('state') or 'active') == 'active']
    print('  其中生效物件  : %d 个（%d 家店）' % (
        len(act), len([r for r in act if str(r.get('catalog_id') or '').startswith('shop_')])))
    return data


# ---------------------------------------------------------------- 导入
def do_import(db_path, in_path, dry_run=False, backup=True):
    with open(in_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    c = _connect(db_path)
    for t in TABLES:
        if not _has(c, t):
            raise SystemExit('目标库缺表 %s —— 先在云端启动一次新代码（会自动建表）' % t)

    # ① 目标库的系统主城（没有就建一个，和启动时同一套逻辑）
    r = c.execute('SELECT * FROM towns WHERE is_system=1 ORDER BY id LIMIT 1').fetchone()
    if r:
        sys_town = dict(r)
        print('目标主城：#%s（%s，%sm）' % (sys_town['id'], sys_town['name'], sys_town['size_m']))
    else:
        if dry_run:
            sys_town = {'id': 1, 'name': '(将新建)新手镇'}
        else:
            # 和启动时同一套逻辑：ensure_system_town 只认 cfg['db']
            _srv = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server')
            sys.path.insert(0, os.path.abspath(_srv))
            import towns as townsmod  # noqa
            sys_town = dict(townsmod.ensure_system_town({'db': os.path.abspath(db_path)}))
            print('目标库原本没有主城 → 已新建 #%s' % sys_town['id'])

    tid = int(sys_town.get('id') or 1)

    # ② 角色名 → 目标库 id（查不到就 0）
    names = set()
    for t, col in (('town_objects', 'owner_id'), ('town_perms', 'player_id')):
        for row in data['tables'].get(t) or []:
            nm = row.get(col + '_name')
            if nm:
                names.add(nm)
    name_to_id = {}
    for nm in names:
        rr = c.execute('SELECT id FROM roles WHERE name=?', (nm,)).fetchone()
        name_to_id[nm] = int(rr['id']) if rr else 0
        print('  归属映射：%-12s → %s' % (nm, name_to_id[nm] or '（云端没这人，置 0=系统）'))

    # ③ 统计将要发生什么
    src_obj = [r for r in data['tables'].get('town_objects') or []]
    tgt_obj_ids = set(r['id'] for r in c.execute('SELECT id FROM town_objects'))
    new_n = len([r for r in src_obj if int(r['id']) not in tgt_obj_ids])
    upd_n = len(src_obj) - new_n
    extra = sorted(tgt_obj_ids - set(int(r['id']) for r in src_obj))
    print('目标库现有物件：%d 个' % len(tgt_obj_ids))
    print('将新增 %d 个物件，覆盖 %d 个，目标库多出来的 %d 个（不删）' % (new_n, upd_n, len(extra)))
    if dry_run:
        print('\n--dry-run：没有写任何东西 ✓')
        return

    if backup:
        bak = db_path + '.bak_layout_' + time.strftime('%Y%m%d_%H%M%S')
        shutil.copy2(db_path, bak)
        print('已备份目标库 → %s' % bak)

    # ④ 写库（一个事务）
    try:
        c.execute('BEGIN')
        for t in ('town_objects', 'town_perms'):
            rows = data['tables'].get(t) or []
            if not rows:
                continue
            cols = [x for x in _cols(c, t)]
            for row in rows:
                vals = []
                for col in cols:
                    v = row.get(col)
                    if col == 'town_id':
                        v = tid
                    elif col in ('owner_id', 'player_id'):
                        nm = row.get(col + '_name')
                        v = name_to_id.get(nm, 0) if nm else (v or 0)
                    vals.append(v)
                ph = ','.join('?' * len(cols))
                c.execute('INSERT OR REPLACE INTO %s(%s) VALUES(%s)'
                          % (t, ','.join(cols), ph), vals)
        # 住宅：INSERT OR IGNORE（不覆盖云端已有房主）
        for row in data['tables'].get('houses') or []:
            cols = [x for x in _cols(c, 'houses')]
            vals = [row.get(x) for x in cols]
            ph = ','.join('?' * len(cols))
            c.execute('INSERT OR IGNORE INTO houses(%s) VALUES(%s)'
                      % (','.join(cols), ph), vals)
        # 主城的名字/大小也按本地覆盖（保持一模一样），但状态不动
        for row in data['tables'].get('towns') or []:
            if not row.get('is_system'):
                continue
            c.execute('UPDATE towns SET name=?, size_m=?, x=?, z=? WHERE id=?',
                      (row.get('name'), row.get('size_m'), row.get('x'), row.get('z'), tid))
        c.commit()
    except Exception as e:
        c.rollback()
        raise SystemExit('导入失败（已回滚）：%r' % (e,))

    n = c.execute("SELECT COUNT(*) FROM town_objects WHERE state='active'").fetchone()[0]
    shops = c.execute("SELECT COUNT(*) FROM town_objects WHERE state='active'"
                      " AND catalog_id LIKE 'shop_%'").fetchone()[0]
    print('导入完成：目标库生效物件 %d 个（%d 家店）' % (n, shops))
    print('★ 云端重启一次服务（或等 _rebuild_dyn_shops）才会看到新布局 ✓')


def main():
    ap = argparse.ArgumentParser(description='小镇布局同步（towns/town_objects/town_perms/houses）')
    ap.add_argument('--export', metavar='JSON', help='从本地库导出布局')
    ap.add_argument('--import', dest='imp', metavar='JSON', help='把布局导入目标库')
    ap.add_argument('--db', default=os.path.join('server', 'game.db'), help='目标/来源库（默认 server/game.db）')
    ap.add_argument('--src-db', default=os.path.join('server', 'game.db'), help='导出时的来源库')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--no-backup', action='store_true')
    a = ap.parse_args()
    if a.export:
        do_export(a.src_db, a.export)
    elif a.imp:
        do_import(a.db, a.imp, dry_run=a.dry_run, backup=not a.no_backup)
    else:
        ap.print_help()


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    main()
