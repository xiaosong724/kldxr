# -*- coding: utf-8 -*-
"""管理页新增功能测试：玩家金币加减 + 小镇权限（含系统主城）

覆盖：
  ① 离线玩家：+ / - / 设为 0（直接写库）
  ② 在线玩家：+ / -（走内存 _gain_gold，tick 立即生效，管理列表能读到）
  ③ 系统主城权限：perm_set / perm_list / 再清零

跑法：python tools/test_admin_gold_perm.py
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


def gold_of(name):
    with db() as c:
        r = c.execute('SELECT gold FROM roles WHERE name=?', (name,)).fetchone()
        return int(r['gold']) if r else None


def online_gold(name):
    r = http_json('/api/admin/players?page=1&size=100&test=1', headers={'X-Admin': ADMIN})
    for p in r.get('players') or []:
        if p.get('name') == name:
            return int(p.get('gold') or 0), bool(p.get('online'))
    return None, False


def cleanup(names):
    with db() as c:
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


async def ws_session(tok, fn):
    async with websockets.connect(WS, max_size=32 * 1024 * 1024) as ws:
        return await fn(ws)


async def wait_for(ws, pred, limit=300, timeout=8.0):
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


ADMIN = ''


def main():
    global ADMIN
    ADMIN = http_json('/api/admin/login', {'password': ADMIN_PW})['token']
    nm_off = 'GOF%05d' % random.randint(0, 99999)
    nm_on = 'GON%05d' % random.randint(0, 99999)
    a = http_json('/api/register', {'name': nm_off, 'password': PASSWORD})
    b = http_json('/api/register', {'name': nm_on, 'password': PASSWORD})
    ok = False
    try:
        # ---------- ① 离线：+ / - / 设 0 ----------
        r = http_json('/api/admin/act', {'act': 'gold', 'name': nm_off, 'add': 1000000},
                      {'X-Admin': ADMIN})
        assert r.get('ok') and r.get('online') is False, r
        assert gold_of(nm_off) == 1000000, gold_of(nm_off)
        r = http_json('/api/admin/act', {'act': 'gold', 'name': nm_off, 'add': -250000},
                      {'X-Admin': ADMIN})
        assert r.get('ok') and gold_of(nm_off) == 750000, gold_of(nm_off)
        r = http_json('/api/admin/act', {'act': 'gold', 'name': nm_off, 'add': -999999999},
                      {'X-Admin': ADMIN})
        assert r.get('ok') and gold_of(nm_off) == 0, '负数没夹住: %r' % gold_of(nm_off)
        r = http_json('/api/admin/act', {'act': 'gold', 'name': nm_off, 'v': 123456},
                      {'X-Admin': ADMIN})
        assert r.get('ok') and gold_of(nm_off) == 123456
        print('  offline gold: +1,000,000 -> 750,000 -> floor 0 -> set 123,456  OK')

        # ---------- ② 在线：+ / - ----------
        async def flow(ws):
            await ws.send(json.dumps({'t': 'hello', 'd': {'token': b['token']}}))
            await wait_for(ws, lambda m: m['t'] == 'world')
            await asyncio.sleep(0.4)
            g0 = online_gold(nm_on)[0]
            http_json('/api/admin/act', {'act': 'gold', 'name': nm_on, 'add': 5000},
                      {'X-Admin': ADMIN})
            await wait_for(ws, lambda m: m['t'] == 'notice' and '金币' in str(m['d'].get('text')))
            g1 = g0
            for _ in range(20):
                await asyncio.sleep(0.2)
                g1 = online_gold(nm_on)[0]
                if g1 == g0 + 5000:
                    break
            assert g1 == g0 + 5000, 'online + failed: %r -> %r' % (g0, g1)
            http_json('/api/admin/act', {'act': 'gold', 'name': nm_on, 'add': -2000},
                      {'X-Admin': ADMIN})
            g2 = g1
            for _ in range(20):
                await asyncio.sleep(0.2)
                g2 = online_gold(nm_on)[0]
                if g2 == g1 - 2000:
                    break
            assert g2 == g1 - 2000, 'online - failed: %r -> %r' % (g1, g2)
            return g0, g1, g2
        g0, g1, g2 = asyncio.run(ws_session(b['token'], flow))
        print('  online gold: %d -> +5000 -> %d -> -2000 -> %d  OK' % (g0, g1, g2))

        # ---------- ③ 系统主城权限 ----------
        rid = None
        with db() as c:
            rid = int(c.execute('SELECT id FROM roles WHERE name=?', (nm_off,)).fetchone()['id'])
        r = http_json('/api/admin/town', {'act': 'perm_set', 'id': 1,
                                          'player': rid, 'mask': 127},
                      {'X-Admin': ADMIN})
        assert r.get('ok') and r.get('mask') == 127, r
        r = http_json('/api/admin/town', {'act': 'perm_list', 'id': 1}, {'X-Admin': ADMIN})
        got = next((p for p in r['perms'] if p['player'] == rid), None)
        assert got and got['mask'] == 127, 'perm_list: %r' % (got,)
        print('  system town perm: #%d mask=127  OK' % rid)
        r = http_json('/api/admin/town', {'act': 'perm_set', 'id': 1,
                                          'player': rid, 'mask': 0},
                      {'X-Admin': ADMIN})
        assert r.get('ok')
        r = http_json('/api/admin/town', {'act': 'perm_list', 'id': 1}, {'X-Admin': ADMIN})
        got = next((p for p in r['perms'] if p['player'] == rid), None)
        assert got and got['mask'] == 0
        print('  system town perm: cleared  OK')
        ok = True
    finally:
        time.sleep(1.0)
        try:
            cleanup([nm_off, nm_on])
            print('cleanup done')
        except Exception as e:
            print('cleanup FAIL:', repr(e))
    print('admin gold/perm: OK' if ok else 'admin gold/perm: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
