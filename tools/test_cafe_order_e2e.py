# -*- coding: utf-8 -*-
"""咖啡店「坐下点单 → 桌上出杯 → 喝掉」端到端测试（A2）

跑法（服务必须已经在跑）：
    python tools/test_cafe_order_e2e.py

用主城已放置的咖啡店 #157：
    桌子 #513 (dining_table)  椅子 #514/#515
流程：注册 → 定位到 514 号椅子 → sit → order_open → order_buy → 等上菜
      → cup_take(drink=1) → 校验金币/杯位/数据库 → 删号
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
CHAIR = 'obj514'
TABLE = 'tbl513'
ITEM = 'americano'
PRICE = 15
START_GOLD = 500
PASSWORD = 'e2e-pass-123'
SEAT_X, SEAT_Z = -17.95, 6.4


def http_json(path, data=None, token=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(HTTP + path, data=body)
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('X-Token', token)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


def db_conn():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def set_role(name):
    with db_conn() as c:
        c.execute('UPDATE roles SET gold=?, x=?, z=? WHERE name=?',
                  (START_GOLD, SEAT_X, SEAT_Z, name))
        c.commit()


def cleanup(name, order_id):
    with db_conn() as c:
        acc = c.execute('SELECT id FROM accounts WHERE name=?', (name,)).fetchone()
        if not acc:
            return
        rid = c.execute('SELECT id FROM roles WHERE account_id=?', (acc['id'],)).fetchone()
        rid = rid['id'] if rid else -1
        if order_id:
            c.execute('DELETE FROM table_cups WHERE order_id=?', (order_id,))
            c.execute('DELETE FROM table_orders WHERE id=?', (order_id,))
            c.execute('DELETE FROM waiter_tasks WHERE order_id=?', (order_id,))
        if rid > 0:
            c.execute('DELETE FROM table_cups WHERE order_id IN '
                      '(SELECT id FROM table_orders WHERE player_id=?)', (rid,))
            c.execute('DELETE FROM table_orders WHERE player_id=?', (rid,))
            for t in [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]:
                cols = [r[1] for r in c.execute('PRAGMA table_info(%s)' % t)]
                if 'role_id' in cols:
                    c.execute('DELETE FROM %s WHERE role_id=?' % t, (rid,))
            c.execute('DELETE FROM roles WHERE id=?', (rid,))
        c.execute('DELETE FROM tokens WHERE account_id=?', (acc['id'],))
        c.execute('DELETE FROM accounts WHERE id=?', (acc['id'],))
        c.commit()


async def wait_for(ws, pred, limit=300, timeout=10.0):
    deadline = time.time() + timeout
    for _ in range(limit):
        left = deadline - time.time()
        if left <= 0:
            break
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=left)
        except asyncio.TimeoutError:
            break
        m = json.loads(raw)
        if pred(m):
            return m
    return None


async def run(name):
    reg = http_json('/api/register', {'name': name, 'password': PASSWORD})
    set_role(name)
    login = http_json('/api/login', {'name': name, 'password': PASSWORD})
    tok = login['token']
    rid = int(login['role']['id'])
    order_id = None

    async with websockets.connect(WS, max_size=32 * 1024 * 1024) as ws:
        await ws.send(json.dumps({'t': 'hello', 'd': {'token': tok}}))
        assert await wait_for(ws, lambda m: m['t'] == 'world'), 'no world'
        await asyncio.sleep(0.2)

        await ws.send(json.dumps({'t': 'sit', 'd': {'id': CHAIR}}))
        seated = await wait_for(ws, lambda m: m['t'] in ('seated', 'seaterr'))
        assert seated and seated['t'] == 'seated', 'sit failed: %r' % (seated,)
        print('  sit:', seated['d']['id'])

        await ws.send(json.dumps({'t': 'order_open', 'd': {}}))
        opened = await wait_for(ws, lambda m: m['t'] == 'order')
        assert opened and opened['d'].get('ok') == 1, 'order_open failed: %r' % (opened,)
        tbl = opened['d'].get('table') or {}
        assert tbl.get('id') == TABLE, 'wrong table: %r' % (tbl,)
        assert int(tbl.get('max') or 0) == 2 and not tbl.get('cups'), 'table state: %r' % (tbl,)
        print('  order_open: table=%s max=%s cups=%d' % (tbl['id'], tbl['max'], len(tbl['cups'])))

        await ws.send(json.dumps({'t': 'order_buy', 'd': {'item': ITEM}}))
        bought = await wait_for(ws, lambda m: m['t'] == 'order' and m['d'].get('msg') == 'ORDER_OK')
        assert bought, 'order_buy not accepted'
        gold = int(bought['d']['gold'])
        order_id = bought['d'].get('order')
        assert gold == START_GOLD - PRICE, 'gold %d' % gold
        cups = (bought['d'].get('table') or {}).get('cups') or []
        assert len(cups) == 1 and cups[0]['state'] == 'cooking', 'cup not cooking: %r' % (cups,)
        print('  order_buy: gold=%d order=%s cup=%s' % (gold, order_id, cups[0]['state']))

        served = await wait_for(
            ws, lambda m: m['t'] == 'tablecups' and any(
                c.get('state') == 'served' for c in m['d']['table'].get('cups') or []),
            limit=600, timeout=8.0)
        assert served, 'cup never served'
        print('  served: cup=%s' % served['d']['table']['cups'][0]['state'])

        with db_conn() as c:
            st = c.execute('SELECT state FROM table_orders WHERE id=?', (order_id,)).fetchone()
        if not st or st['state'] != 'served':
            # 落库走 saves 队列，等它一下
            for _ in range(30):
                time.sleep(0.1)
                with db_conn() as c:
                    st = c.execute('SELECT state FROM table_orders WHERE id=?', (order_id,)).fetchone()
                if st and st['state'] == 'served':
                    break
        assert st and st['state'] == 'served', 'db order state %r' % (st and st['state'],)
        print('  db: table_orders.state=served')

        await ws.send(json.dumps({'t': 'cup_take', 'd': {'table': TABLE, 'slot': 0, 'drink': 1}}))
        taken = await wait_for(
            ws, lambda m: m['t'] == 'tablecups' and not (m['d']['table'].get('cups') or []))
        assert taken, 'cup not removed'
        print('  cup_take: table empty')

    with db_conn() as c:
        n_cup = c.execute('SELECT count(*) FROM table_cups WHERE order_id=?', (order_id,)).fetchone()[0]
        st = c.execute('SELECT state FROM table_orders WHERE id=?', (order_id,)).fetchone()
    for _ in range(30):
        if n_cup == 0 and st and st['state'] == 'done':
            break
        time.sleep(0.1)
        with db_conn() as c:
            n_cup = c.execute('SELECT count(*) FROM table_cups WHERE order_id=?', (order_id,)).fetchone()[0]
            st = c.execute('SELECT state FROM table_orders WHERE id=?', (order_id,)).fetchone()
    assert n_cup == 0, 'cup row still there'
    assert st and st['state'] == 'done', 'order not done: %r' % (st and st['state'],)
    print('  db: cup deleted, order done')
    return order_id


def main():
    name = 'CAF%05d' % random.randint(0, 99999)
    print('test role:', name)
    order_id = None
    ok = False
    try:
        order_id = asyncio.run(run(name))
        ok = True
    finally:
        for _ in range(40):
            if not http_json('/api/health')['world'].get('online'):
                break
            time.sleep(0.25)
        try:
            cleanup(name, order_id)
            print('cleanup: removed', name)
        except Exception as e:
            print('cleanup FAIL:', repr(e))
    print('cafe order e2e: OK' if ok else 'cafe order e2e: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
