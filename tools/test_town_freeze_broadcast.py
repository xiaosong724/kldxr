# -*- coding: utf-8 -*-
"""C5：小镇被冻结时，附近客户端会收到 towncleared（撤掉已渲染的放置物）

流程：临时号站在空地上 → 建镇 → 管理员冻结 → 这条 WS 连接应收到
      towncleared {town, x, z, r}，且坐标就是这座镇。

跑法：python tools/test_town_freeze_broadcast.py
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


async def wait_for(ws, pred, limit=400, timeout=12.0):
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


def cleanup(name, tid):
    with db() as c:
        if tid:
            c.execute('DELETE FROM town_objects WHERE town_id=?', (tid,))
            c.execute('DELETE FROM town_perms WHERE town_id=?', (tid,))
            c.execute('DELETE FROM town_payments WHERE town_id=?', (tid,))
            c.execute('DELETE FROM town_ledger WHERE town_id=?', (tid,))
            c.execute('DELETE FROM towns WHERE id=?', (tid,))
        acc = c.execute('SELECT id FROM accounts WHERE name=?', (name,)).fetchone()
        if acc:
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
    name = 'FZB%05d' % random.randint(0, 99999)
    reg = http_json('/api/register', {'name': name, 'password': PASSWORD})
    tok = reg['token']
    x = 900.0 + random.randint(0, 500)
    z = -900.0 - random.randint(0, 500)
    with db() as c:
        c.execute('UPDATE roles SET gold=20000000, x=?, z=? WHERE name=?', (x, z, name))
        c.commit()
    print('test role:', name, 'at', (x, z))
    tid = 0
    ok = False
    try:
        async def flow(ws):
            await ws.send(json.dumps({'t': 'hello', 'd': {'token': tok}}))
            assert await wait_for(ws, lambda m: m['t'] == 'world'), 'no world'
            await asyncio.sleep(0.2)
            await ws.send(json.dumps({'t': 'town_create', 'd': {
                'name': '冻结测试' + name[-3:], 'tier': 30, 'x': x, 'z': z}}))
            r = await wait_for(ws, lambda m: m['t'] == 'townresult')
            assert r and r['d'].get('ok') == 1, 'create: %r' % (r,)
            town_id = int(r['d']['town']['id'])
            # 等建镇落库（post_save 是异步的），再让管理员冻结
            for _ in range(30):
                with db() as c:
                    row = c.execute('SELECT id FROM towns WHERE id=?', (town_id,)).fetchone()
                if row:
                    break
                time.sleep(0.1)
            assert row, 'town never landed in db'
            http_json('/api/admin/town', {'act': 'freeze', 'id': town_id},
                      {'X-Admin': admin})
            got = await wait_for(ws, lambda m: m['t'] == 'towncleared')
            return town_id, got
        tid, got = asyncio.run(flow_driver(tok, flow))
        assert got, 'no towncleared message'
        d = got['d']
        print('  towncleared: town=%s r=%.1f at (%.1f, %.1f)' % (
            d.get('town'), +d.get('r', 0), +d.get('x', 0), +d.get('z', 0)))
        assert int(d.get('town') or 0) == tid
        assert abs(+d['x'] - x) < 0.01 and abs(+d['z'] - z) < 0.01, 'coords mismatch'
        assert +d.get('r', 0) >= 10, 'radius too small'
        ok = True
    finally:
        time.sleep(1.0)
        try:
            cleanup(name, tid)
            print('cleanup: town', tid, 'role', name)
        except Exception as e:
            print('cleanup FAIL:', repr(e))
    print('freeze broadcast: OK' if ok else 'freeze broadcast: FAIL')
    return 0 if ok else 1


async def flow_driver(tok, fn):
    async with websockets.connect(WS, max_size=32 * 1024 * 1024) as ws:
        return await fn(ws)


if __name__ == '__main__':
    raise SystemExit(main())
