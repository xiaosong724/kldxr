# -*- coding: utf-8 -*-
"""睡觉不再把别人拉过来（2026-10-22）

用户：「点击睡觉时会把别的玩家也拉过来」。

根因：服务端 `sleep_state` 广播给了所有人，客户端 `sleepApply` 不看是谁的就把自己挪过去。

  ① A 睡觉 → B 的坐标完全不变
  ② A 自己确实躺到了床上

跑法：python tools/test_sleep_no_pull_e2e.py
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


async def wait(ws, pred, n=600):
    for _ in range(n):
        m = json.loads(await asyncio.wait_for(ws.recv(), 10))
        if pred(m):
            return m
    return None


def cleanup(names, tid):
    with sqlite3.connect(DB, timeout=10) as c:
        if tid:
            for t in ('town_objects', 'town_perms', 'town_payments', 'town_ledger'):
                c.execute('DELETE FROM %s WHERE town_id=?' % t, (tid,))
            c.execute('DELETE FROM towns WHERE id=?', (tid,))
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
    name_a = 'SNA%05d' % random.randint(0, 99999)
    name_b = 'SNB%05d' % random.randint(0, 99999)
    tok_a = http_json('/api/register', {'name': name_a, 'password': 'e2e-pass-123'})['token']
    tok_b = http_json('/api/register', {'name': name_b, 'password': 'e2e-pass-123'})['token']
    x = 3300.0 + random.randint(0, 200)
    z = 3300.0 + random.randint(0, 200)
    with sqlite3.connect(DB, timeout=10) as c:
        c.execute('UPDATE roles SET gold=20000000, x=?, z=? WHERE name=?', (x, z, name_a))
        c.execute('UPDATE roles SET x=?, z=? WHERE name=?', (x + 12, z, name_b))
        c.commit()
    tid = 0
    ok = False
    try:
        async def run():
            nonlocal tid
            async with websockets.connect(WS, max_size=16 * 1024 * 1024) as wa, \
                       websockets.connect(WS, max_size=16 * 1024 * 1024) as wb:
                await wa.send(json.dumps({'t': 'hello', 'd': {'token': tok_a}}))
                await wb.send(json.dumps({'t': 'hello', 'd': {'token': tok_b}}))
                await wait(wa, lambda m: m['t'] == 'world')
                await wait(wb, lambda m: m['t'] == 'world')
                await asyncio.sleep(0.5)

                await wa.send(json.dumps({'t': 'town_create', 'd': {
                    'name': '睡觉测试' + name_a[-3:], 'tier': 30, 'x': x, 'z': z}}))
                r = await wait(wa, lambda m: m['t'] == 'townresult')
                assert r and r['d'].get('ok') == 1, 'create: %r' % (r,)
                tid = int(r['d']['town']['id'])
                await wa.send(json.dumps({'t': 'place_building', 'd': {
                    'catalog': 'house_flat_v1', 'x': x, 'z': z}}))
                p = await wait(wa, lambda m: m['t'] in ('placed', 'townresult'))
                assert p and p['t'] == 'placed', 'place: %r' % (p,)
                hid = 'obj' + str(p['d']['object']['id'])
                await asyncio.sleep(0.8)

                # 从 A 的视角读 B 的位置（快照里不含自己）
                before = None
                for _ in range(30):
                    m = await wait(wa, lambda m: m['t'] == 'world', n=60)
                    if not m:
                        break
                    me = [q for q in m['d']['players'] if q['n'] == name_b]
                    if me:
                        before = (me[0]['x'], me[0]['z'])
                        break
                print('  B before A sleeps:', before)
                assert before, 'could not read B position'

                await wa.send(json.dumps({'t': 'house_sleep', 'd': {'id': hid}}))
                s = await wait(wa, lambda m: m['t'] in ('sleep_state', 'house'))
                print('  A sleep:', s['t'], s['d'] if s['t'] == 'sleep_state' else '')
                assert s['t'] == 'sleep_state' and s['d'].get('on') == 1, 'A did not fall asleep'
                assert s['d'].get('self') == 1, 'sleep_state missing self flag'

                await asyncio.sleep(1.2)
                after = None
                for _ in range(20):
                    m = await wait(wa, lambda m: m['t'] == 'world', n=60)
                    if not m:
                        break
                    me = [q for q in m['d']['players'] if q['n'] == name_b]
                    if me:
                        after = (me[0]['x'], me[0]['z'])
                        break
                print('  B after  A sleeps:', after)
                assert after, 'could not read B position after'
                moved = math.hypot(after[0] - before[0], after[1] - before[1])
                print('  B moved: %.3f m' % moved)
                assert moved < 0.05, 'A sleeping pulled B away by %.2f m' % moved
                return True
        ok = asyncio.run(run())
    finally:
        time.sleep(1.0)
        cleanup([name_a, name_b], tid)
        print('cleanup: town', tid)
    print('sleep no pull: OK' if ok else 'sleep no pull: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
