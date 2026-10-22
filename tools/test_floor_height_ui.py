# -*- coding: utf-8 -*-
"""室内地板高度测试（2026-10-22）

用户：「加高的地面是否有生效，不要踩到地下去了」。

  ① 建筑门外（地形）与建筑内部（室内地板）的 P.y 应该差 ~0.28m
  ② 建筑内部的地板矩形确实由放置的建筑生成（TOWN_FLOORS 非空）

跑法：python tools/test_floor_height_ui.py
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
    port = random.randint(11300, 11399)
    prof = tempfile.mkdtemp(prefix='floor-')
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

            nf = await c.ev('return (typeof TOWN_FLOORS!=="undefined") ? TOWN_FLOORS.length : -1;')
            print('  floor rects:', nf)
            assert nf > 10, 'no building floor rects'

            info = await c.ev(
                "var f=TOWN_FLOORS[0];"
                "var o=(window.MY_OBJECTS||[]).filter(function(x){"
                "  return !x.parent && /sh|house/.test(x.catalog||'');})[0];"
                "return {f:f, o:o?{id:o.id,catalog:o.catalog,x:o.x,z:o.z}:null};")
            print('  first floor:', info['f'], ' obj:', info['o'])

            # 门外：地板矩形外侧 3m
            outside = await c.ev(
                "var f=TOWN_FLOORS[0];"
                "P.x=f.x0-3.0; P.z=(f.z0+f.z1)/2; P.air=false; P.vy=0;"
                "return {x:P.x,z:P.z};")
            await asyncio.sleep(0.5)
            y_out = await c.ev('return P.y;')
            inside = await c.ev(
                "var f=TOWN_FLOORS[0];"
                "P.x=(f.x0+f.x1)/2; P.z=(f.z0+f.z1)/2; P.air=false; P.vy=0;"
                "return {x:P.x,z:P.z};")
            await asyncio.sleep(0.5)
            y_in = await c.ev('return P.y;')
            print('  y outside=%.3f  y inside=%.3f  diff=%.3f' % (y_out, y_in, y_in - y_out))
            assert y_in > y_out + 0.2, 'floor height not applied: %.3f vs %.3f' % (y_in, y_out)

            # 还原到门外，避免留下测试痕迹
            await c.ev("P.x=%f; P.z=%f; P.air=false; return 1;" % (outside['x'], outside['z']))
            await asyncio.sleep(0.3)

            errs = [e for e in c.events if e.get('method') == 'Runtime.exceptionThrown']
            assert not errs, 'JS exceptions: %r' % ([e['params'] for e in errs][:2],)
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
    name = 'FLR%05d' % random.randint(0, 99999)
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
    print('floor height: OK' if ok else 'floor height: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
