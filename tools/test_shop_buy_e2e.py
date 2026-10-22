# -*- coding: utf-8 -*-
"""商店购买闭环端到端测试（A1）

跑法（服务必须已经在跑）：
    python tools/test_shop_buy_e2e.py

覆盖：
  1. 注册一个临时测试号（名字 E2E#####，跑完删除）
  2. 直接把金币/坐标写进库（角色还没登录，内存里没有它 ✓）
  3. 走真实 WS：hello -> shop_open -> shop_buy
  4. 断言：回包 gold 减少、msg=BOUGHT、背包里真的多了一件
  5. 清理：删角色 + 背包 + 令牌 + 账号

为什么坐标直接写库：_shop_ok 要求离店员 3.2m 以内，从出生点走过去要 190m，
走真实移动会跟反瞬移打架；考的是"购买"，不是"走路"。
"""
import asyncio
import json
import os
import random
import sys
import time
import urllib.request
import sqlite3

import websockets

sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, 'server', 'game.db')
HTTP = 'http://127.0.0.1:8899'
WS = 'ws://127.0.0.1:8900/ws'
ITEM = 'americano'              # 15 金币
START_GOLD = 500
PASSWORD = 'e2e-pass-123'

# 交互点从 shops.py 算（建筑坐标在 import 时被平移到 TOWN_CX/CZ，硬编码很容易错）
sys.path.insert(0, os.path.join(ROOT, 'server'))
import shops as shopmod          # noqa: E402
_s = shopmod.shop_by_id('cafe')
CAFE = (_s['id'], _s['x'], _s['z'])


def http_json(path, data=None, token=None, method=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(HTTP + path, data=body, method=method)
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('X-Token', token)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


def db_conn():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def set_test_role(name):
    with db_conn() as c:
        c.execute('UPDATE roles SET gold=?, x=?, z=? WHERE name=?',
                  (START_GOLD, CAFE[1], CAFE[2], name))
        c.commit()


def cleanup(name):
    """删除测试号的一切痕迹（只在角色离线后调用）"""
    with db_conn() as c:
        acc = c.execute('SELECT id FROM accounts WHERE name=?', (name,)).fetchone()
        if not acc:
            return
        acc_id = acc['id']
        role = c.execute('SELECT id FROM roles WHERE account_id=?', (acc_id,)).fetchone()
        rid = role['id'] if role else -1
        tables = [r[0] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")]
        for t in tables:
            cols = [r[1] for r in c.execute('PRAGMA table_info(%s)' % t)]
            if 'role_id' in cols and rid > 0:
                c.execute('DELETE FROM %s WHERE role_id=?' % t, (rid,))
        if rid > 0:
            c.execute('DELETE FROM roles WHERE id=?', (rid,))
        c.execute('DELETE FROM tokens WHERE account_id=?', (acc_id,))
        c.execute('DELETE FROM accounts WHERE id=?', (acc_id,))
        c.commit()


async def wait_for(ws, pred, limit=200, timeout=8.0):
    """30Hz 的 world 快照会淹没回包：读够 limit 条，直到 pred 命中"""
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
    tok = reg['token']
    set_test_role(name)
    login = http_json('/api/login', {'name': name, 'password': PASSWORD})
    tok = login['token']
    gold0 = int(login['role'].get('gold') or 0)
    assert gold0 == START_GOLD, 'login gold=%r, expected %d' % (gold0, START_GOLD)
    role_id = int(login['role']['id'])

    async with websockets.connect(WS, max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({'t': 'hello', 'd': {'token': tok}}))
        w = await wait_for(ws, lambda m: m['t'] == 'welcome')
        assert w, 'no welcome'
        assert abs(float(w['d']['role']['x']) - CAFE[1]) < 0.01, 'position not applied'
        print('  welcome: pos=(%.1f, %.1f) gold=%d' % (
            w['d']['role']['x'], w['d']['role']['z'], w['d']['role']['gold']))
        # welcome 先发、join 是 tick 线程下一步才做的：等第一帧世界快照再发意图
        # （快照里 players 只含"别人"，所以不能拿自己在不在里面当条件）
        got_world = await wait_for(ws, lambda m: m['t'] == 'world', limit=120, timeout=8.0)
        assert got_world, 'no world snapshot'
        await asyncio.sleep(0.2)

        await ws.send(json.dumps({'t': 'shop_open', 'd': {'id': CAFE[0]}}))
        opened = await wait_for(ws, lambda m: m['t'] == 'shop' and m['d'].get('items'))
        assert opened and opened['d'].get('ok') == 1, 'shop_open failed: %r' % (opened,)
        price = next(i['price'] for i in opened['d']['items'] if i['key'] == ITEM)
        print('  shop_open: ok, %d items, %s=%d' % (len(opened['d']['items']), ITEM, price))

        await ws.send(json.dumps({'t': 'shop_buy', 'd': {'id': CAFE[0], 'item': ITEM}}))
        bought = await wait_for(ws, lambda m: m['t'] == 'shop' and m['d'].get('msg') == 'BOUGHT')
        assert bought, 'shop_buy: no BOUGHT'
        gold1 = int(bought['d']['gold'])
        assert gold1 == START_GOLD - price, 'gold %d != %d' % (gold1, START_GOLD - price)
        print('  shop_buy: BOUGHT, gold %d -> %d' % (START_GOLD, gold1))

        # 背包走的是客户端同一条 /api/bag
        got = None
        for _ in range(20):
            bag = http_json('/api/bag', token=tok)
            got = next((it for it in bag['items'] if it['item'].get('name') == '美式咖啡'), None)
            if got:
                break
            time.sleep(0.2)
        assert got, 'item 美式咖啡 not in bag'
        print('  bag: got item id=%s name=美式咖啡' % got.get('id'))

    # 等存档线程把金币写回库，再核对一次（内存权威 -> 落库）
    for _ in range(30):
        with db_conn() as c:
            row = c.execute('SELECT gold FROM roles WHERE id=?', (role_id,)).fetchone()
        if row and int(row['gold']) == gold1:
            break
        time.sleep(0.3)
    with db_conn() as c:
        db_gold = int(c.execute('SELECT gold FROM roles WHERE id=?', (role_id,)).fetchone()['gold'])
        n_items = int(c.execute('SELECT count(*) FROM items WHERE role_id=?',
                                (role_id,)).fetchone()[0])
    assert db_gold == gold1, 'persisted gold=%d, memory=%d' % (db_gold, gold1)
    assert n_items >= 1, 'persisted items=0'
    print('  persist: gold=%d items=%d' % (db_gold, n_items))


def main():
    name = 'E2E%05d' % random.randint(0, 99999)
    print('test role:', name)
    ok = False
    try:
        asyncio.run(run(name))
        ok = True
    finally:
        # 等角色真的离线，再删库（否则 tick 线程还会把它存回去）
        for _ in range(40):
            h = http_json('/api/health')
            if not h['world'].get('online'):
                break
            time.sleep(0.25)
        try:
            cleanup(name)
            print('cleanup: removed', name)
        except Exception as e:
            print('cleanup FAIL:', repr(e))
    print('shop buy e2e: OK' if ok else 'shop buy e2e: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
