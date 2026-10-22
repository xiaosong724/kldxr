# -*- coding: utf-8 -*-
"""仓库建筑：移动/删除后，飘字与交互是否跟着变（2026-10-22）

  ① 站在仓库旁边 → 能交互（WH_NEAR = true）
  ② 把仓库挪到别处 → 原位置失效、新位置可用（飘字锚点也跟过去）
  ③ 删除仓库 → 原位置和新位置都不能交互，飘字隐藏
  ④ 测试结束把仓库挪回原位（不留脏数据）

跑法：python tools/test_warehouse_follow_ui.py
"""
import asyncio
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
CHROME = next((p for p in (
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe') if os.path.exists(p)), None)


def http_json(path, data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(ORIGIN + path, data=body)
    req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


class CDP:
    def __init__(self, ws):
        self.ws = ws
        self.seq = 0
        self.events = []

    async def send(self, method, params=None):
        self.seq += 1
        mid = self.seq
        await self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
        while True:
            m = json.loads(await asyncio.wait_for(self.ws.recv(), 30))
            if m.get('id') == mid:
                return m
            self.events.append(m)

    async def ev(self, expr):
        r = await self.send('Runtime.evaluate', {
            'expression': '(function(){' + expr + '})()',
            'returnByValue': True, 'awaitPromise': True})
        res = r.get('result', {})
        if 'exceptionDetails' in res:
            raise RuntimeError('JS %r' % (res['exceptionDetails'],))
        return (res.get('result') or {}).get('value')


async def main_async(token):
    port = random.randint(11800, 11899)
    prof = tempfile.mkdtemp(prefix='wh-')
    proc = subprocess.Popen(
        [CHROME, '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
         '--mute-audio', '--user-data-dir=' + prof, '--remote-debugging-port=%d' % port,
         '--window-size=1400,900', ORIGIN + '/'],
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
            c = CDP(ws)
            await c.send('Runtime.enable')
            for _ in range(80):
                await asyncio.sleep(0.25)
                try:
                    if await c.ev('return location.origin;') == ORIGIN:
                        break
                except Exception:
                    pass
            await c.ev('localStorage.setItem("token", %s); location.reload(); return 1;'
                       % json.dumps(token))
            for _ in range(80):
                await asyncio.sleep(0.3)
                try:
                    if await c.ev('return typeof PlaceMode !== "undefined" && !!P;'):
                        break
                except Exception:
                    pass
            await asyncio.sleep(2.5)
            await c.ev("var bs=document.querySelectorAll('button');"
                       "for(var i=0;i<bs.length;i++){if((bs[i].textContent||'').indexOf('知道了')>=0){bs[i].click();}}"
                       "return 1;")
            await asyncio.sleep(0.8)

            wh = await c.ev(
                "var l=(window.MY_OBJECTS||[]).filter(function(o){"
                "  return !o.parent && o.catalog==='shop_warehouse_v1';})[0];"
                "return l?{id:l.id,x:+l.x,z:+l.z}:null;")
            print('  warehouse:', wh)
            assert wh, 'no warehouse building'

            def near_at(x, z):
                return c.ev('return townNearWarehouse(%f,%f);' % (x, z))

            ok0 = await near_at(wh['x'], wh['z'])
            print('  near original:', ok0)
            assert ok0 is True, 'cannot interact at original spot'

            # 挪到 +30m
            nx, nz = wh['x'] + 30.0, wh['z']
            await c.ev("wsSend('move_object',{id:%d,x:%f,z:%f}); return 1;" % (wh['id'], nx, nz))
            await asyncio.sleep(1.2)
            old_ok = await near_at(wh['x'], wh['z'])
            new_ok = await near_at(nx, nz)
            print('  after move  old:%r new:%r' % (old_ok, new_ok))
            assert old_ok is False, 'old spot still interactive'
            assert new_ok is True, 'new spot not interactive'

            # 挪回去
            await c.ev("wsSend('move_object',{id:%d,x:%f,z:%f}); return 1;" % (wh['id'], wh['x'], wh['z']))
            await asyncio.sleep(1.2)
            back = await near_at(wh['x'], wh['z'])
            print('  moved back :', back)
            assert back is True, 'move back failed'

            # 删除 → 交互与飘字都应消失
            await c.ev("wsSend('remove_object',{id:%d}); return 1;" % wh['id'])
            await asyncio.sleep(1.4)
            gone = await near_at(wh['x'], wh['z'])
            still = await c.ev(
                "return (window.MY_OBJECTS||[]).filter(function(o){"
                " return String(o.id)===String(%d);}).length;" % wh['id'])
            flt = await c.ev("var f=document.getElementById('interactFloat');"
                             "return f?getComputedStyle(f).display:'none';")
            print('  after delete: near=%r inCache=%d float=%s' % (gone, still, flt))
            assert gone is False, 'deleted warehouse still interactive'
            assert still == 0, 'deleted warehouse still in cache'
            assert flt == 'none', 'floating label still visible after delete'
            return True
    finally:
        try:
            subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
        shutil.rmtree(prof, ignore_errors=True)


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
    if not CHROME:
        print('no chrome'); return 2
    name = 'WHF%05d' % random.randint(0, 99999)
    reg = http_json('/api/register', {'name': name, 'password': 'e2e-pass-123'})
    print('test role:', name)
    ok = False
    try:
        ok = asyncio.run(main_async(reg['token']))
    finally:
        for _ in range(40):
            if not http_json('/api/health')['world'].get('online'):
                break
            time.sleep(0.25)
        cleanup(name)
        print('cleanup done')
    print('warehouse follow: OK' if ok else 'warehouse follow: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
