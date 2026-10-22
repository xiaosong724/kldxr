# -*- coding: utf-8 -*-
"""座位朝向 / 沙发双座测试（2026-10-22）

  ① 坐在放置的椅子上：yaw 应等于椅子的 rot（以前是 rot+π，方向是反的）
  ② 沙发有两个座位（obj<id>#0 / #1），坐标一左一右
  ③ 同一格不能坐两个人，另一格可以

跑法：python tools/test_seat_slots_e2e.py
"""
import asyncio
import json
import math
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


async def wait(ws, pred, n=400):
    for _ in range(n):
        m = json.loads(await asyncio.wait_for(ws.recv(), 10))
        if pred(m):
            return m
    return None


async def sess(tok, fn):
    async with websockets.connect(WS, max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({'t': 'hello', 'd': {'token': tok}}))
        await wait(ws, lambda m: m['t'] == 'world')
        await asyncio.sleep(0.4)
        return await fn(ws)


def cleanup(names):
    with sqlite3.connect(DB, timeout=10) as c:
        for name in names:
            acc = c.execute('SELECT id FROM accounts WHERE name=?', (name,)).fetchone()
            if not acc:
                continue
            rid = c.execute('SELECT id FROM roles WHERE account_id=?', (acc[0],)).fetchone()
            rid = rid[0] if rid else -1
            if rid > 0:
                for t in [r[0] for r in c.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'")]:
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
        chair = c.execute("SELECT id,x,z,rot FROM town_objects WHERE catalog_id='chair_wood'"
                          " AND state='active' LIMIT 1").fetchone()
        sofa = c.execute("SELECT id,x,z,rot FROM town_objects WHERE catalog_id='sofa_modern_2'"
                         " AND state='active' LIMIT 1").fetchone()
    assert chair and sofa, 'need a chair and a sofa'

    names = ['SEA%05d' % random.randint(0, 99999), 'SEB%05d' % random.randint(0, 99999)]
    toks = [http_json('/api/register', {'name': n, 'password': 'e2e-pass-123'})['token']
            for n in names]
    with sqlite3.connect(DB, timeout=10) as c:
        c.execute('UPDATE roles SET x=?, z=? WHERE name=?', (chair['x'], chair['z'], names[0]))
        c.execute('UPDATE roles SET x=?, z=? WHERE name=?', (sofa['x'], sofa['z'], names[1]))
        c.commit()
    ok = False
    try:
        async def sit_chair(ws):
            sid = 'obj%d' % chair['id']
            await ws.send(json.dumps({'t': 'sit', 'd': {'id': sid}}))
            r = await wait(ws, lambda m: m['t'] in ('seated', 'seaterr'))
            return sid, r
        sid, r = asyncio.run(sess(toks[0], sit_chair))
        print('  chair sit:', sid, r['t'], r['d'] if r['t'] == 'seaterr' else '')
        assert r['t'] == 'seated', 'sit failed: %r' % (r,)
        yaw = float(r['d']['yaw'])
        want = float(chair['rot'] or 0)
        print('  yaw=%.3f  chair rot=%.3f' % (yaw, want))
        assert abs(((yaw - want + math.pi) % (2 * math.pi)) - math.pi) < 0.02, \
            'seat facing is reversed: yaw=%.3f rot=%.3f' % (yaw, want)

        async def sofa_slots(ws):
            out = []
            for slot in (0, 1, 2):
                await ws.send(json.dumps({'t': 'sit', 'd': {'id': 'obj%d#%d' % (sofa['id'], slot)}}))
                r = await wait(ws, lambda m: m['t'] in ('seated', 'seaterr'))
                out.append(r)
                await ws.send(json.dumps({'t': 'stand', 'd': {}}))
                await wait(ws, lambda m: m['t'] == 'stood')
                await asyncio.sleep(0.2)
            return out
        res = asyncio.run(sess(toks[1], sofa_slots))
        seats = [r['d'] for r in res if r['t'] == 'seated']
        print('  sofa seats:', [(round(s['x'], 2), round(s['z'], 2)) for s in seats])
        assert len(seats) == 2, 'sofa should offer exactly 2 seats, got %d' % len(seats)
        gap = abs(math.dist((seats[0]['x'], seats[0]['z']), (seats[1]['x'], seats[1]['z'])))
        print('  seat gap: %.2f m' % gap)
        assert 0.8 < gap < 1.2, 'two sofa seats not left/right'
        ok = True
    finally:
        time.sleep(1.0)
        cleanup(names)
        print('cleanup done')
    print('seat slots: OK' if ok else 'seat slots: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
