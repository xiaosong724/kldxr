# -*- coding: utf-8 -*-
"""小镇编辑权限测试（2026-10-22）

  ① A 建镇 → 放一个装饰 → 能移动 → 能删除
  ② B（无权限）在同一座镇里：移动 / 删除 → 都被拒绝

跑法：python tools/test_town_edit_e2e.py
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
PASSWORD = 'e2e-pass-123'


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


async def sess(tok, fn):
    async with websockets.connect(WS, max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({'t': 'hello', 'd': {'token': tok}}))
        await wait_for(ws, lambda m: m['t'] == 'world')
        await asyncio.sleep(0.3)
        return await fn(ws)


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
    nm_a = 'EDA%05d' % random.randint(0, 99999)
    nm_b = 'EDB%05d' % random.randint(0, 99999)
    a = http_json('/api/register', {'name': nm_a, 'password': PASSWORD})
    b = http_json('/api/register', {'name': nm_b, 'password': PASSWORD})
    x = 1800.0 + random.randint(0, 500)
    z = 1800.0 + random.randint(0, 500)
    with db() as c:
        c.execute('UPDATE roles SET gold=20000000, x=?, z=? WHERE name=?', (x, z, nm_a))
        c.execute('UPDATE roles SET x=?, z=? WHERE name=?', (x + 4, z, nm_b))
        c.commit()
    tid = 0
    oid = 0
    ok = False
    try:
        async def owner(ws):
            nonlocal tid, oid
            await ws.send(json.dumps({'t': 'town_create', 'd': {
                'name': '编辑测试' + nm_a[-3:], 'tier': 30, 'x': x, 'z': z}}))
            r = await wait_for(ws, lambda m: m['t'] == 'townresult')
            assert r and r['d'].get('ok') == 1, 'create: %r' % (r,)
            tid = int(r['d']['town']['id'])
            await ws.send(json.dumps({'t': 'place', 'd': {
                'catalog': 'plant_pot', 'x': x + 1.5, 'z': z}}))
            p = await wait_for(ws, lambda m: m['t'] in ('placed', 'townresult'))
            assert p and p['t'] == 'placed', 'place: %r' % (p,)
            oid = int(p['d']['object']['id'])
            await ws.send(json.dumps({'t': 'move_object',
                                      'd': {'id': oid, 'x': x + 2.5, 'z': z}}))
            mv = await wait_for(ws, lambda m: m['t'] in ('moved', 'townresult'))
            assert mv and mv['t'] == 'moved', 'owner move failed: %r' % (mv,)
            await ws.send(json.dumps({'t': 'remove_object', 'd': {'id': oid}}))
            rm = await wait_for(ws, lambda m: m['t'] in ('removed', 'townresult'))
            assert rm and rm['t'] == 'removed', 'owner remove failed: %r' % (rm,)
            # 再放一个，留给 B 尝试
            await ws.send(json.dumps({'t': 'place', 'd': {
                'catalog': 'plant_pot', 'x': x - 1.5, 'z': z}}))
            p2 = await wait_for(ws, lambda m: m['t'] in ('placed', 'townresult'))
            assert p2 and p2['t'] == 'placed', 'place2: %r' % (p2,)
            return int(p2['d']['object']['id'])
        oid2 = asyncio.run(sess(a['token'], owner))
        print('  owner: create/place/move/remove OK, target obj=%d' % oid2)

        async def intruder(ws):
            await ws.send(json.dumps({'t': 'move_object',
                                      'd': {'id': oid2, 'x': x + 4, 'z': z + 4}}))
            mv = await wait_for(ws, lambda m: m['t'] in ('moved', 'townresult'))
            await ws.send(json.dumps({'t': 'remove_object', 'd': {'id': oid2}}))
            rm = await wait_for(ws, lambda m: m['t'] in ('removed', 'townresult'))
            return mv, rm
        mv, rm = asyncio.run(sess(b['token'], intruder))
        assert mv and mv['t'] == 'townresult' and mv['d'].get('ok') == 0, \
            'B was allowed to move: %r' % (mv,)
        assert rm and rm['t'] == 'townresult' and rm['d'].get('ok') == 0, \
            'B was allowed to remove: %r' % (rm,)
        print('  intruder: move=%r remove=%r' % (mv['d'].get('msg'), rm['d'].get('msg')))
        with db() as c:
            row = c.execute('SELECT state FROM town_objects WHERE id=?', (oid2,)).fetchone()
        assert row and row['state'] == 'active', 'intruder deleted the object!'
        print('  object still active after intruder  OK')
        ok = True
    finally:
        time.sleep(1.0)
        try:
            cleanup([nm_a, nm_b], tid)
            print('cleanup: town', tid)
        except Exception as e:
            print('cleanup FAIL:', repr(e))
    print('town edit perms: OK' if ok else 'town edit perms: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
