# -*- coding: utf-8 -*-
"""玩家小镇经济闭环测试（B1 + B2）

覆盖：
  B1 每日维护费：
    - 建镇按"当天 00:00"到期
    - 离线到期自动扣费（towns.charge_offline）
    - 余额不足 → 冻结 + town_payments 记 failed
    - 恢复 → 扣恢复费、重新 active
  B2 80/20 分账：
    - 在自己镇里放一家咖啡店
    - 买一杯 15 金币：主人得 12、税 3 直接扣掉（不入任何账户）
    - town_ledger 记一笔 gross=15 / owner_gain=12 / tax=3

用管理动作 `towndue` 把到期时间调到"刚刚"，等 5 秒结算，不用等真到 0 点。

跑法：python tools/test_town_fee_e2e.py
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
HTTP = 'http://127.0.0.1:8899'
WS = 'ws://127.0.0.1:8900/ws'
PASSWORD = 'e2e-pass-123'
ADMIN_PW = 'xiuxian-admin'
TIER = 30
FEE = 5000000
COORDS = (600.0, 600.0)


def http_json(path, data=None, headers=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(HTTP + path, data=body, method=None)
    req.add_header('Content-Type', 'application/json')
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


def db():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def set_role_gold(name, gold):
    with db() as c:
        c.execute('UPDATE roles SET gold=? WHERE name=?', (int(gold), name))
        c.commit()


def role_id(name):
    with db() as c:
        r = c.execute('SELECT id FROM roles WHERE name=?', (name,)).fetchone()
        return int(r['id']) if r else 0


def town_row(tid, wait=4.0):
    end = time.time() + wait
    while True:
        with db() as c:
            r = c.execute('SELECT * FROM towns WHERE id=?', (tid,)).fetchone()
        if r is not None or time.time() >= end:
            return r
        time.sleep(0.15)


async def wait_for(ws, pred, limit=400, timeout=12.0):
    deadline = time.time() + timeout
    for _ in range(limit):
        left = deadline - time.time()
        if left <= 0:
            break
        try:
            m = json.loads(await asyncio.wait_for(ws.recv(), timeout=left))
        except asyncio.TimeoutError:
            break
        if pred(m):
            return m
    return None


async def ws_session(token, actions):
    async with websockets.connect(WS, max_size=32 * 1024 * 1024) as ws:
        await ws.send(json.dumps({'t': 'hello', 'd': {'token': token}}))
        assert await wait_for(ws, lambda m: m['t'] == 'world'), 'no world'
        await asyncio.sleep(0.2)
        return await actions(ws)


def admin_act(admin, act, **kw):
    body = {'act': act}
    body.update(kw)
    return http_json('/api/admin/act', body, {'X-Admin': admin})


def wait_fee_round(seconds=7.0):
    time.sleep(seconds)


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
                for oid in [r[0] for r in c.execute(
                        'SELECT id FROM table_orders WHERE player_id=?', (rid,))]:
                    c.execute('DELETE FROM table_cups WHERE order_id=?', (oid,))
                    c.execute('DELETE FROM waiter_tasks WHERE order_id=?', (oid,))
                c.execute('DELETE FROM table_orders WHERE player_id=?', (rid,))
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
    global COORDS
    # 每次换一片空地：上一轮失败留下的"世界内存里的幽灵小镇"不会撞车
    COORDS = (650.0 + random.randint(0, 1400), 650.0 - random.randint(0, 1200))
    name = 'FEE%05d' % random.randint(0, 99999)
    print('test role:', name)
    reg = http_json('/api/register', {'name': name, 'password': PASSWORD})
    set_role_gold(name, 60000000)
    with db() as c:
        c.execute('UPDATE roles SET x=?, z=? WHERE name=?', (COORDS[0], COORDS[1], name))
        c.commit()
    login = http_json('/api/login', {'name': name, 'password': PASSWORD})
    tok = login['token']
    rid = int(login['role']['id'])
    admin = http_json('/api/admin/login', {'password': ADMIN_PW})['token']
    tid = 0
    ok = False
    try:
        # ---------- 一个连接里走完：建镇 → 放店 → 买咖啡 ----------
        async def flow(ws):
            await ws.send(json.dumps({'t': 'town_create', 'd': {
                'name': '测试镇' + name[-3:], 'tier': TIER,
                'x': COORDS[0], 'z': COORDS[1]}}))
            created = await wait_for(ws, lambda m: m['t'] == 'townresult')
            await ws.send(json.dumps({'t': 'place_building', 'd': {
                'catalog': 'shop_cafe_v1', 'x': COORDS[0], 'z': COORDS[1] - 3.5}}))
            placed = await wait_for(ws, lambda m: m['t'] in ('placed', 'townresult'))
            oid = int(placed['d']['object']['id']) if placed['t'] == 'placed' else 0
            await ws.send(json.dumps({'t': 'shop_open', 'd': {'id': 'obj%d' % oid}}))
            opened = await wait_for(ws, lambda m: m['t'] == 'shop' and m['d'].get('items'))
            g0 = int(opened['d']['gold']) if opened else -1
            await ws.send(json.dumps({'t': 'shop_buy',
                                      'd': {'id': 'obj%d' % oid, 'item': 'americano'}}))
            bought = await wait_for(ws, lambda m: m['t'] == 'shop' and m['d'].get('msg') == 'BOUGHT')
            return created, placed, oid, g0, (int(bought['d']['gold']) if bought else -1)
        r, pr, oid, g0, g1 = asyncio.run(ws_session(tok, flow))
        assert r and r['d'].get('ok') == 1, 'create failed: %r' % (r,)
        tid = int(r['d']['town']['id'])
        row = town_row(tid)
        assert int(row['owner_id']) == rid
        exp = int(row['expires_at'])
        lt = time.localtime(exp / 1000.0)
        assert (lt.tm_hour, lt.tm_min) == (0, 0), 'expires not at 00:00: %r' % (lt,)
        print('  create: town=%d expires=%s fee-paid' % (tid, time.strftime('%m-%d %H:%M', lt)))
        assert pr['t'] == 'placed' and oid > 0, 'place failed: %r' % (pr,)
        print('  place: cafe obj=%d' % oid)
        # 60M - 5M 建镇 - 20M 放店 = 35M；买 15 返 12 → 净 -3
        assert g0 == 35000000 and g1 == g0 - 3, 'gold %d -> %d' % (g0, g1)
        print('  shop: gold %d -> %d (owner +12, tax 3 burned)' % (g0, g1))

        time.sleep(1.0)
        with db() as c:
            led = c.execute('SELECT * FROM town_ledger WHERE town_id=? ORDER BY id DESC',
                            (tid,)).fetchone()
        assert led and led['gross'] == 15 and led['owner_gain'] == 12 and led['tax'] == 3, \
            'ledger: %r' % (dict(led) if led else None)
        print('  ledger: gross=15 owner=12 tax=3')

        # ---------- B1：离线到期自动扣费 ----------
        time.sleep(1.5)   # 等断开时的存档
        admin_act(admin, 'towndue', id=tid)
        wait_fee_round()
        row = town_row(tid)
        gold_db = None
        with db() as c:
            gold_db = int(c.execute('SELECT gold FROM roles WHERE id=?', (rid,)).fetchone()[0])
        print('  fee #1: town=%s gold=%d expires=%s' % (
            row['status'], gold_db, time.strftime('%m-%d %H:%M',
                                                 time.localtime(int(row['expires_at']) / 1000.0))))
        assert row['status'] == 'active' and gold_db == g1 - FEE, 'offline fee failed'
        assert int(row['expires_at']) > int(time.time() * 1000)

        # ---------- B1：余额不足 → 冻结 ----------
        set_role_gold(name, 1000000)
        admin_act(admin, 'towndue', id=tid)
        wait_fee_round()
        row = town_row(tid)
        with db() as c:
            pay = c.execute('SELECT status FROM town_payments WHERE town_id=? ORDER BY id DESC',
                            (tid,)).fetchone()
        assert row['status'] == 'frozen', 'not frozen: %s' % row['status']
        assert pay and pay['status'] == 'failed', 'payment not failed'
        hold = int(row['deleted_at']) - int(time.time() * 1000)
        assert 6 * 86400000 < hold <= 7 * 86400000 + 60000, 'retention %d' % hold
        print('  freeze: gold kept=1,000,000 retention=%.1f days' % (hold / 86400000.0))

        # ---------- B1：恢复（扣恢复费） ----------
        set_role_gold(name, 10000000)
        login2 = http_json('/api/login', {'name': name, 'password': PASSWORD})
        tok2 = login2['token']

        async def restore(ws):
            await ws.send(json.dumps({'t': 'town_restore',
                                      'd': {'id': tid, 'x': COORDS[0], 'z': COORDS[1]}}))
            return await wait_for(ws, lambda m: m['t'] == 'townresult')
        rr = asyncio.run(ws_session(tok2, restore))
        assert rr and rr['d'].get('ok') == 1, 'restore failed: %r' % (rr,)
        row = town_row(tid)
        for _ in range(30):
            if row and row['status'] == 'active':
                break
            time.sleep(0.15)
            row = town_row(tid)
        assert row['status'] == 'active', 'still %s' % (row and row['status'],)
        print('  restore: status=active')
        ok = True
    finally:
        time.sleep(1.0)
        try:
            cleanup(name, tid)
            print('cleanup: removed town', tid, 'and role', name)
        except Exception as e:
            print('cleanup FAIL:', repr(e))
    print('town fee e2e: OK' if ok else 'town fee e2e: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
