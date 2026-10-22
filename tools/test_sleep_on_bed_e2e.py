# -*- coding: utf-8 -*-
"""睡觉要睡在床上（2026-10-22）

  ① 玩家建镇 → 放一栋小平房（自带床）
  ② 发 house_sleep
  ③ 睡下后玩家坐标 == 床家具的坐标（不再睡在床边地上）

跑法：python tools/test_sleep_on_bed_e2e.py
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


def http_json(path, data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(ORIGIN + path, data=body)
    req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


def db():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    return c


async def ws_wait(ws, pred, n=600, timeout=15.0):
    end = time.time() + timeout
    for _ in range(n):
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
            for t in ('town_objects', 'town_perms', 'town_payments', 'town_ledger'):
                c.execute('DELETE FROM %s WHERE town_id=?' % t, (tid,))
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
    name = 'SLP%05d' % random.randint(0, 99999)
    reg = http_json('/api/register', {'name': name, 'password': 'e2e-pass-123'})
    x = 2900.0 + random.randint(0, 300)
    z = 2900.0 + random.randint(0, 300)
    with db() as c:
        c.execute('UPDATE roles SET gold=20000000, x=?, z=? WHERE name=?', (x, z, name))
        c.commit()
    tid = 0
    ok = False
    try:
        async def flow(ws):
            nonlocal tid
            await ws.send(json.dumps({'t': 'town_create', 'd': {
                'name': '睡床测试' + name[-3:], 'tier': 30, 'x': x, 'z': z}}))
            r = await ws_wait(ws, lambda m: m['t'] == 'townresult')
            assert r and r['d'].get('ok') == 1, 'create: %r' % (r,)
            tid = int(r['d']['town']['id'])
            await ws.send(json.dumps({'t': 'place_building', 'd': {
                'catalog': 'house_flat_v1', 'x': x, 'z': z}}))
            p = await ws_wait(ws, lambda m: m['t'] in ('placed', 'townresult'))
            assert p and p['t'] == 'placed', 'place: %r' % (p,)
            hid = 'obj' + str(p['d']['object']['id'])
            await asyncio.sleep(1.0)
            with db() as c:
                bed = c.execute(
                    "SELECT id,x,z FROM town_objects WHERE parent_id=? AND state='active'"
                    " AND catalog_id LIKE 'bed%' LIMIT 1",
                    (p['d']['object']['id'],)).fetchone()
            assert bed, 'house placed without a bed'
            print('  bed object: id=%d at (%.2f, %.2f)' % (bed['id'], bed['x'], bed['z']))
            await ws.send(json.dumps({'t': 'house_sleep', 'd': {'id': hid}}))
            s = await ws_wait(ws, lambda m: m['t'] in ('sleep_state', 'house'))
            assert s and s['t'] == 'sleep_state' and s['d'].get('on') == 1, 'sleep failed: %r' % (s,)
            sx, sz = float(s['d']['x']), float(s['d']['z'])
            print('  slept at (%.2f, %.2f)' % (sx, sz))
            dbed = ((sx - bed['x']) ** 2 + (sz - bed['z']) ** 2) ** 0.5
            print('  distance to bed: %.3f m' % dbed)
            assert dbed < 0.35, 'not sleeping on the bed (%.2f m away)' % dbed
            await ws.send(json.dumps({'t': 'stand', 'd': {}}))
            await asyncio.sleep(0.3)
        asyncio.run((lambda: _run(reg['token'], flow))())
        ok = True
    finally:
        time.sleep(1.0)
        cleanup(name, tid)
        print('cleanup: town', tid)
    print('sleep on bed: OK' if ok else 'sleep on bed: FAIL')
    return 0 if ok else 1


async def _run(tok, fn):
    async with websockets.connect(WS, max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({'t': 'hello', 'd': {'token': tok}}))
        await ws_wait(ws, lambda m: m['t'] == 'world')
        await asyncio.sleep(0.4)
        return await fn(ws)


if __name__ == '__main__':
    raise SystemExit(main())
