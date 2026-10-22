# -*- coding: utf-8 -*-
"""C5：小镇范围广播（townzones）测试

A 建镇 → 旁观的 B 收到 townzones，里面有这座镇（system=0）；
管理员冻结 → B 再收到 townzones，同一座镇状态变 frozen。
客户端地图选点用这份列表判断 50 格间距。

跑法：python tools/test_town_zones.py
"""
import asyncio
import json
import os
import random
import sqlite3
import sys
import time
import urllib.request

import websockets

sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, 'server', 'game.db')
ORIGIN = 'http://127.0.0.1:8899'
WS = 'ws://127.0.0.1:8900/ws'
ADMIN_PW = 'xiuxian-admin'
PASSWORD = 'e2e-pass-123'


def http_json(path, data=None, headers=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(ORIGIN + path, data=body)
    req.add_header('Content-Type', 'application/json')
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


def db():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    return c


async def wait_for(ws, pred, limit=500, timeout=12.0):
    end = time.time() + timeout
    for _ in range(limit):
        left = end - time.time()
        if left <= 0:
            break
        try:
            m = json.loads(await asyncio.wait_for(ws.recv(), timeout=left))
        except asyncio.TimeoutError:
            break
        if pred(m):
            return m
    return None


def cleanup(names, tid):
    with db() as c:
        if tid:
            for t in ('town_objects', 'town_perms', 'town_payments', 'town_ledger'):
                c.execute('DELETE FROM %s WHERE town_id=?' % t, (tid,))
            c.execute('DELETE FROM towns WHERE id=?', (tid,))
        for name in names:
            acc = c.execute('SELECT id FROM accounts WHERE name=?', (name,)).fetchone()
            if not acc:
                continue
            rid = c.execute('SELECT id FROM roles WHERE account_id=?', (acc['id'],)).fetchone()
            rid = int(rid['id']) if rid else -1
            if rid > 0:
                for t in [r[0] for r in c.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'")]:
                    cols = [r[1] for r in c.execute('PRAGMA table_info(%s)' % t)]
                    if 'role_id' in cols:
                        c.execute('DELETE FROM %s WHERE role_id=?' % t, (rid,))
                c.execute('DELETE FROM roles WHERE id=?', (rid,))
            c.execute('DELETE FROM tokens WHERE account_id=?', (acc['id'],))
            c.execute('DELETE FROM accounts WHERE id=?', (acc['id'],))
        c.commit()


def main():
    admin = http_json('/api/admin/login', {'password': ADMIN_PW})['token']
    nm_a = 'ZA%05d' % random.randint(0, 99999)
    nm_b = 'ZB%05d' % random.randint(0, 99999)
    a = http_json('/api/register', {'name': nm_a, 'password': PASSWORD})
    b = http_json('/api/register', {'name': nm_b, 'password': PASSWORD})
    x = 1500.0 + random.randint(0, 400)
    z = 1500.0 + random.randint(0, 400)
    with db() as c:
        c.execute('UPDATE roles SET gold=20000000, x=?, z=? WHERE name=?', (x, z, nm_a))
        c.execute('UPDATE roles SET x=?, z=? WHERE name=?', (x + 45, z, nm_b))
        c.commit()
    print('roles:', nm_a, '/', nm_b, 'at', (x, z))
    tid = 0
    ok = False
    try:
        async def runner():
            async with websockets.connect(WS, max_size=32 * 1024 * 1024) as wa, \
                       websockets.connect(WS, max_size=32 * 1024 * 1024) as wb:
                init = None
                for w, tok in ((wa, a['token']), (wb, b['token'])):
                    await w.send(json.dumps({'t': 'hello', 'd': {'token': tok}}))
                    # 入世时先推一次 townzones（在第一条 world 快照之前）
                    zmsg = await wait_for(w, lambda m: m['t'] == 'townzones')
                    assert zmsg, 'no initial zones'
                    if w is wb:
                        init = zmsg
                await asyncio.sleep(0.2)
                assert any(int(z0.get('system') or 0) for z0 in init['d']['list']), \
                    'system town missing from zones'
                await wa.send(json.dumps({'t': 'town_create', 'd': {
                    'name': '范围测试' + nm_a[-3:], 'tier': 30, 'x': x, 'z': z}}))
                cr = await wait_for(wa, lambda m: m['t'] == 'townresult')
                assert cr and cr['d'].get('ok') == 1, 'create failed: %r' % (cr,)
                town_id = int(cr['d']['town']['id'])
                got = await wait_for(
                    wb, lambda m: m['t'] == 'townzones' and any(
                        int(z1.get('id') or 0) == town_id for z1 in m['d']['list']))
                assert got, 'bystander never saw the new town'
                rec = next(z1 for z1 in got['d']['list'] if int(z1['id']) == town_id)
                assert rec['status'] == 'active' and not rec['system'], rec
                print('  zones(create): town=%s size=%.1f status=%s' % (
                    rec['id'], rec['size'], rec['status']))

                # 等落库再冻结
                for _ in range(30):
                    with db() as c:
                        row = c.execute('SELECT id FROM towns WHERE id=?', (town_id,)).fetchone()
                    if row:
                        break
                    await asyncio.sleep(0.1)
                http_json('/api/admin/town', {'act': 'freeze', 'id': town_id},
                          {'X-Admin': admin})
                got2 = await wait_for(
                    wb, lambda m: m['t'] == 'townzones' and any(
                        int(z2.get('id') or 0) == town_id and z2.get('status') == 'frozen'
                        for z2 in m['d']['list']))
                assert got2, 'freeze not broadcast'
                print('  zones(freeze): town=%s -> frozen' % town_id)
                return town_id
        tid = asyncio.run(runner())
        ok = True
    finally:
        time.sleep(1.0)
        try:
            cleanup([nm_a, nm_b], tid)
            print('cleanup: town', tid, 'roles', nm_a, nm_b)
        except Exception as e:
            print('cleanup FAIL:', repr(e))
    print('town zones: OK' if ok else 'town zones: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
