# -*- coding: utf-8 -*-
"""C1：/admin 小镇管理接口 + 页面冒烟

接口部分：
  建一个临时镇 → 列表里能看到 → 冻结 → 恢复 → 立刻结算（扣维护费）→ 改目录价格
页面部分：
  无头 Chrome 打开 /admin（带管理 token）→ 小镇表格有行、目录价格输入框在

跑法：python tools/test_admin_towns.py
"""
import asyncio
import base64
import json
import os
import random
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request

import websockets

sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, 'server', 'game.db')
ORIGIN = 'http://127.0.0.1:8899'
WS = 'ws://127.0.0.1:8900/ws'
SHOT = os.path.join(ROOT, 'docs', 'shots', 'admin-towns.png')
ADMIN_PW = 'xiuxian-admin'
PASSWORD = 'e2e-pass-123'
CHROME = next((p for p in (
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe') if os.path.exists(p)), None)


def http_json(path, data=None, headers=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(ORIGIN + path, data=body)
    req.add_header('Content-Type', 'application/json')
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


def admin(path, data=None):
    return http_json(path, data, {'X-Admin': ADMIN})


def db():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def town(tid):
    with db() as c:
        return c.execute('SELECT * FROM towns WHERE id=?', (tid,)).fetchone()


async def wait_for(ws, pred, limit=300, timeout=10.0):
    end = time.time() + timeout
    for _ in range(limit):
        if time.time() > end:
            break
        m = json.loads(await asyncio.wait_for(ws.recv(), timeout=end - time.time()))
        if pred(m):
            return m
    return None


async def ws_create(tok, name, x, z):
    async with websockets.connect(WS, max_size=32 * 1024 * 1024) as ws:
        await ws.send(json.dumps({'t': 'hello', 'd': {'token': tok}}))
        await wait_for(ws, lambda m: m['t'] == 'world')
        await asyncio.sleep(0.2)
        await ws.send(json.dumps({'t': 'town_create', 'd': {
            'name': name, 'tier': 30, 'x': x, 'z': z}}))
        return await wait_for(ws, lambda m: m['t'] == 'townresult')


async def cdP_ui():
    port = random.randint(10500, 10599)
    prof = tempfile.mkdtemp(prefix='admintown-')
    proc = subprocess.Popen(
        [CHROME, '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
         '--mute-audio', '--user-data-dir=' + prof, '--remote-debugging-port=%d' % port,
         '--window-size=1400,1000', ORIGIN + '/admin'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        target = None
        for _ in range(160):
            await asyncio.sleep(0.25)
            try:
                with urllib.request.urlopen('http://127.0.0.1:%d/json/list' % port, timeout=2) as r:
                    lst = json.load(r)
                cas = [x for x in lst if x.get('type') == 'page' and x.get('webSocketDebuggerUrl')]
                if cas:
                    target = cas[0]
                    break
            except Exception:
                pass
        assert target, 'chrome devtools not ready'
        async with websockets.connect(target['webSocketDebuggerUrl'], max_size=64 * 1024 * 1024) as ws:
            seq = [0]

            async def send(method, params=None):
                seq[0] += 1
                mid = seq[0]
                await ws.send(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
                while True:
                    m = json.loads(await asyncio.wait_for(ws.recv(), 30))
                    if m.get('id') == mid:
                        return m

            async def ev(expr):
                r = await send('Runtime.evaluate', {
                    'expression': '(function(){' + expr + '})()',
                    'returnByValue': True, 'awaitPromise': True})
                res = r.get('result', {})
                if 'exceptionDetails' in res:
                    raise RuntimeError('JS %r' % (res['exceptionDetails'],))
                return (res.get('result') or {}).get('value')

            await send('Runtime.enable')
            await send('Page.enable')
            for _ in range(40):
                await asyncio.sleep(0.25)
                try:
                    if await ev('return document.readyState === "complete" && typeof doLogin === "function";'):
                        break
                except Exception:
                    pass
            await ev('document.getElementById("pw").value = %s; doLogin(); return 1;'
                     % json.dumps(ADMIN_PW))
            await asyncio.sleep(2.5)
            rows = await ev("return document.querySelectorAll('#townRows tr').length;")
            cats = await ev("return document.querySelectorAll('#catalogRows input').length;")
            txt = await ev("return (document.getElementById('townRows')||{}).textContent||'';")
            print('  admin page: rows=%d catalogInputs=%d hasSystem=%s' % (
                rows, cats, ('主城' in txt) or ('新手镇' in txt)))
            await ev("var t=document.getElementById('townRows');"
                     "if(t){t.scrollIntoView({block:'center'});} return 1;")
            await asyncio.sleep(0.6)
            shot = await send('Page.captureScreenshot', {'format': 'png'})
            with open(SHOT, 'wb') as f:
                f.write(base64.b64decode(shot['result']['data']))
            print('  screenshot:', SHOT)
            assert rows >= 1 and cats >= 50, 'admin town card not rendered'
            return True
    finally:
        try:
            subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
        shutil.rmtree(prof, ignore_errors=True)


def cleanup(name, tid, old_price):
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
                for t in [r[0] for r in c.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'")]:
                    cols = [r[1] for r in c.execute('PRAGMA table_info(%s)' % t)]
                    if 'role_id' in cols:
                        c.execute('DELETE FROM %s WHERE role_id=?' % t, (rid,))
                c.execute('DELETE FROM roles WHERE id=?', (rid,))
            c.execute('DELETE FROM tokens WHERE account_id=?', (acc['id'],))
            c.execute('DELETE FROM accounts WHERE id=?', (acc['id'],))
        if old_price is not None:
            c.execute("UPDATE town_catalog SET price=? WHERE id='shop_cafe_v1'", (old_price,))
        c.commit()


ADMIN = ''


def main():
    global ADMIN
    ADMIN = http_json('/api/admin/login', {'password': ADMIN_PW})['token']
    name = 'ADM%05d' % random.randint(0, 99999)
    reg = http_json('/api/register', {'name': name, 'password': PASSWORD})
    tok = reg['token']
    x = 700.0 + random.randint(0, 800)
    z = -700.0 - random.randint(0, 800)
    with db() as c:
        c.execute('UPDATE roles SET gold=20000000, x=?, z=? WHERE name=?', (x, z, name))
        c.commit()
    tid = 0
    old_price = None
    ok = False
    try:
        r = asyncio.run(ws_create(tok, '管理测试' + name[-3:], x, z))
        assert r and r['d'].get('ok') == 1, 'create failed: %r' % (r,)
        tid = int(r['d']['town']['id'])
        print('  created town', tid)

        lst = None
        row = None
        for _ in range(30):
            lst = admin('/api/admin/towns')
            row = next((t for t in lst['towns'] if int(t['id']) == tid), None)
            if row:
                break
            time.sleep(0.15)
        assert row and row['status'] == 'active' and int(row['objects']) >= 0, 'not in admin list'
        old_price = next((c['price'] for c in lst['catalog'] if c['id'] == 'shop_cafe_v1'), 20000000)
        print('  admin list: town=%s owner=%s tier=%s' % (row['status'], row['owner_name'], row['tier']))

        a = admin('/api/admin/town', {'act': 'freeze', 'id': tid})
        assert a.get('ok'), 'freeze: %r' % (a,)
        time.sleep(0.4)
        assert town(tid)['status'] == 'frozen', 'db not frozen'
        print('  freeze: ok')

        a = admin('/api/admin/town', {'act': 'restore', 'id': tid})
        assert a.get('ok'), 'restore: %r' % (a,)
        for _ in range(20):
            if town(tid)['status'] == 'active':
                break
            time.sleep(0.15)
        assert town(tid)['status'] == 'active', 'db not active'
        print('  restore: ok')

        a = admin('/api/admin/town', {'act': 'settle', 'id': tid})
        assert a.get('ok'), 'settle: %r' % (a,)
        time.sleep(6.5)
        gold = None
        with db() as c:
            gold = int(c.execute('SELECT gold FROM roles WHERE name=?', (name,)).fetchone()[0])
        print('  settle: gold=%d (fee 5,000,000 charged?)' % gold)
        assert gold < 15000000, 'fee not charged: %d' % gold

        a = admin('/api/admin/town', {'act': 'price', 'catalog': 'shop_cafe_v1', 'price': 123457})
        assert a.get('ok'), 'price: %r' % (a,)
        lst2 = admin('/api/admin/towns')
        p = next((c['price'] for c in lst2['catalog'] if c['id'] == 'shop_cafe_v1'), None)
        assert p == 123457, 'price not saved: %r' % (p,)
        print('  price: shop_cafe_v1 ->', p)

        ok = asyncio.run(cdP_ui())
    finally:
        time.sleep(0.5)
        try:
            cleanup(name, tid, old_price)
            print('cleanup: town', tid, 'role', name, 'price restored', old_price)
        except Exception as e:
            print('cleanup FAIL:', repr(e))
    print('admin towns: OK' if ok else 'admin towns: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
