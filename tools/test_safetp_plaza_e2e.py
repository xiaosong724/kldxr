# -*- coding: utf-8 -*-
"""回安全区落点测试（2026-10-22）

用户：「回到安全区的按钮把坐标改成中央广场」。

主城整体平移到对象镇坐标后，原来的落点还写死在 (-3..3)，已经落在广场外面了。

  ① 把玩家丢到远处
  ② 发 safetp，读条 6 秒
  ③ 落点应落在中央广场（中心 -130,130）外圈 3.5~4.5m —— 在广场内、避开中间喷泉

跑法：python tools/test_safetp_plaza_e2e.py
"""
import asyncio
import json
import math
import os
import random
import sqlite3
import sys
import urllib.request

import websockets

sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, 'server', 'game.db')
ORIGIN = 'http://127.0.0.1:8899'
WS = 'ws://127.0.0.1:8900/ws'
PLAZA_CX, PLAZA_CZ = -130.0, 130.0


def http_json(path, data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(ORIGIN + path, data=body)
    req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


async def wait(ws, pred, n=2000):
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


async def flow(tok):
    async with websockets.connect(WS, max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({'t': 'hello', 'd': {'token': tok}}))
        await wait(ws, lambda m: m['t'] == 'world')
        await asyncio.sleep(0.5)
        await ws.send(json.dumps({'t': 'safetp', 'd': {}}))
        cast = await wait(ws, lambda m: m['t'] == 'tpcast')
        print('  cast:', cast['d']['t'], 's')
        tp = await wait(ws, lambda m: m['t'] == 'tp')
        d = tp['d']
        dist = math.hypot(float(d['x']) - PLAZA_CX, float(d['z']) - PLAZA_CZ)
        print('  landed at (%.2f, %.2f)  distance to plaza centre: %.2f m'
              % (d['x'], d['z'], dist))
        assert 3.0 < dist < 5.0, 'not landing on the plaza ring: %.2f m' % dist
        return True


def main():
    name = 'STP%05d' % random.randint(0, 99999)
    tok = http_json('/api/register', {'name': name, 'password': 'e2e-pass-123'})['token']
    with sqlite3.connect(DB, timeout=10) as c:
        c.execute('UPDATE roles SET x=?, z=? WHERE name=?', (-400.0, 400.0, name))
        c.commit()
    ok = False
    try:
        ok = asyncio.run(flow(tok))
    finally:
        cleanup(name)
        print('cleanup done')
    print('safetp plaza: OK' if ok else 'safetp plaza: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
