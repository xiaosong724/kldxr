# -*- coding: utf-8 -*-
"""C2：别墅内饰布局的端到端校验（临时库副本，不碰正式服）

检查：
  ① 目录里的 house_villa_v1.layout_json 和 server/town_layouts.py 一致（种子会覆盖旧行）
  ② 放一栋别墅 → 家具全部生成（数量 = 布局条目数）
  ③ 每件家具都挂在别墅下面，楼层 0/1 分得对
  ④ 家具都在别墅 14×11 的占地范围内

跑法：python tools/test_villa_layout_e2e.py
"""
import json
import os
import shutil
import sqlite3
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'server'))
sys.stdout.reconfigure(encoding='utf-8')

import db as dbmod       # noqa: E402
import town_layouts      # noqa: E402
import town_objects      # noqa: E402
import towns as townreg  # noqa: E402


def main():
    src = os.path.join(ROOT, 'server', 'game.db')
    tmp = tempfile.mktemp(suffix='.db', prefix='villa-')
    shutil.copyfile(src, tmp)
    cfg = {'db': tmp}
    ok_all = True
    try:
        townreg.seed_catalog(cfg)
        layout = town_layouts.LAYOUTS['house_villa_v1']
        want = sum(len(f['items']) for f in layout['floors'])
        with dbmod.db(cfg) as c:
            row = c.execute("SELECT layout_json FROM town_catalog WHERE id='house_villa_v1'").fetchone()
        got = sum(len(f['items']) for f in json.loads(row['layout_json'])['floors'])
        print('  layout: catalog=%d source=%d' % (got, want))
        assert got == want, 'layout_json not reseeded'

        ok, err, r = townreg.create_town(cfg, 999999, '别墅测试', 30, 900, 900)
        assert ok, err
        t = townreg.get_town(cfg, r['id'])
        ok, err, res = town_objects.place_building(
            cfg, t, 'house_villa_v1', 900.0, 900.0)
        assert ok, 'place_building failed: %s' % err
        print('  placed: building=%s furniture=%d (want %d)' % (
            res['building']['id'], res['furniture_count'], want))
        assert res['furniture_count'] == want, 'furniture count mismatch'

        with dbmod.db(cfg) as c:
            rows = c.execute(
                "SELECT id,catalog_id,x,z,floor,parent_id,state FROM town_objects"
                " WHERE parent_id=? AND state='active'", (res['building']['id'],)).fetchall()
        assert len(rows) == want, 'db furniture rows %d' % len(rows)
        floors = {}
        bad = []
        for r in rows:
            fi = int(r['floor'] or 0)
            floors[fi] = floors.get(fi, 0) + 1
            if not (900 - 7.2 <= r['x'] <= 900 + 7.2 and 900 - 5.7 <= r['z'] <= 900 + 5.7):
                bad.append((r['catalog_id'], r['x'], r['z']))
        print('  floors:', floors)
        assert floors.get(0) and floors.get(1), 'both floors should have furniture'
        assert not bad, 'outside footprint: %r' % (bad[:3],)

        # 家具目录一个都不能缺
        with dbmod.db(cfg) as c:
            miss = [it['catalog'] for fl in layout['floors'] for it in fl['items']
                    if not c.execute('SELECT 1 FROM town_catalog WHERE id=?',
                                     (it['catalog'],)).fetchone()]
        assert not miss, 'missing catalog: %r' % (miss,)
        print('  catalog: all furniture ids exist')
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    print('villa layout e2e: OK' if ok_all else 'villa layout e2e: FAIL')
    return 0 if ok_all else 1


if __name__ == '__main__':
    raise SystemExit(main())
