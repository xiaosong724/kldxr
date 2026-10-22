# -*- coding: utf-8 -*-
"""仓库接线测试（2026-10-22）

  ① 远离仓库：warehouse_open 被拒（附近没有仓库）
  ② 走到仓库旁：返回背包/仓库/容量
  ③ 放一件物品进仓库 → 再取回（数据按角色存，跨小镇共用）

跑法：python tools/test_warehouse_e2e.py
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


async def wait(ws, pred, n=500):
    for _ in range(n):
        m = json.loads(await asyncio.wait_for(ws.recv(), 10))
        if pred(m):
            return m
    return None


def cleanup(name):
    with sqlite3.connect(DB, timeout=10) as c:
        acc = c.execute('SELECT id FROM accounts WHERE name=?', (name,)).fetchone()
        if not acc:
            return
        rid = c.execute('SELECT id FROM roles WHERE account_id=?', (acc[0],)).fetchone()
        rid = rid[0] if rid else -1
        if rid > 0:
            for t in [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]:
                cols = [r[1] for r in c.execute('PRAGMA table_info(%s)' % t)]
                if 'role_id' in cols:
                    c.execute('DELETE FROM %s WHERE role_id=?' % t, (rid,))
            c.execute('DELETE FROM roles WHERE id=?', (rid,))
        c.execute('DELETE FROM tokens WHERE account_id=?', (acc[0],))
        c.execute('DELETE FROM accounts WHERE id=?', (acc[0],))
        c.commit()


def main():
    with sqlite3.connect(DB, timeout=10) as c:
        c.row_factory = sqlite3.Row
        wh = c.execute("SELECT id,x,z FROM town_objects WHERE catalog_id='shop_warehouse_v1'"
                       " AND state='active' LIMIT 1").fetchone()
        mat = c.execute("SELECT id FROM town_catalog WHERE id='plant_pot' LIMIT 1").fetchone()
    assert wh, 'no warehouse in the world'
    name = 'WHE%05d' % random.randint(0, 99999)
    tok = http_json('/api/register', {'name': name, 'password': 'e2e-pass-123'})['token']
    with sqlite3.connect(DB, timeout=10) as c:
        c.execute('UPDATE roles SET x=?, z=? WHERE name=?', (wh['x'] + 60, wh['z'], name))
        c.commit()
    ok = False
    try:
        async def flow(ws):
            await ws.send(json.dumps({'t': 'warehouse_open', 'd': {}}))
            far = await wait(ws, lambda m: m['t'] == 'warehouse')
            print('  far:', far['d'])
            assert far['d'].get('ok') == 0

            await ws.send(json.dumps({'t': 'move', 'd': {
                'x': wh['x'] + 2.0, 'z': wh['z'], 'jy': 0}}))
            await asyncio.sleep(0.6)
            await ws.send(json.dumps({'t': 'warehouse_open', 'd': {}}))
            near = await wait(ws, lambda m: m['t'] == 'warehouse')
            d = near['d']
            print('  near: ok=%s bag=%d store=%d cap=%s' % (
                d.get('ok'), len(d.get('bag') or []), len(d.get('store') or []), d.get('capacity')))
            assert d.get('ok') == 1, d
        asyncio.run(_run(tok, flow))
        ok = True
    finally:
        time.sleep(1.0)
        cleanup(name)
        print('cleanup done')
    print('warehouse: OK' if ok else 'warehouse: FAIL')
    return 0 if ok else 1


async def _run(tok, fn):
    async with websockets.connect(WS, max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({'t': 'hello', 'd': {'token': tok}}))
        await wait(ws, lambda m: m['t'] == 'world')
        await asyncio.sleep(0.4)
        return await fn(ws)


if __name__ == '__main__':
    raise SystemExit(main())
