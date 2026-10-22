# -*- coding: utf-8 -*-
"""进屋淡出测试（2026-10-22）

用户：「玩家进入房屋后墙体和房顶会变透明」——需要的就是这个效果。

  ① 站在屋外：建筑材质 opacity = 1（不透明）
  ② 走进屋里：同一栋建筑 opacity <= 0.35、transparent = true
  ③ 走出屋外：恢复原样

跑法：python tools/test_interior_fade_ui.py
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
    port = random.randint(11600, 11699)
    prof = tempfile.mkdtemp(prefix='fade-')
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

            f = await c.ev('return TOWN_FLOORS[0] || null;')
            assert f, 'no floors'
            bid = f['id']
            print('  building:', bid, f)

            # 站到屋外
            await c.ev("P.x=%f; P.z=%f; P.air=false; return 1;" % (f['x0'] - 3.0, (f['z0'] + f['z1']) / 2))
            await asyncio.sleep(0.5)
            diag = await c.ev(
                "var e=(window.PlaceMode && PlaceMode.objPos)?true:false;"
                "var m=null; var objs=window.__dbgObjs||null;"
                "return {tick: typeof window.__townInteriorTick,"
                " floors: (TOWN_FLOORS||[]).length,"
                " cat: (window.MY_TOWN_CATALOG||[]).length};")
            print('  diag:', diag)
            ob = await c.ev("return PlaceMode.buildingFade(%d);" % bid)
            print('  fade state now:', ob)
            dbg2 = await c.ev(
                "var e=(window.MY_OBJECTS||[]).filter(function(o){return String(o.id)===String(%d);})[0];"
                "return {inCache: !!e, cat: e?e.catalog:null, parent: e?e.parent:null,"
                " objs: Object.keys(PlaceMode.objPos?{}:{}).length};" % bid)
            print('  obj dbg:', dbg2)
            errs0 = [e['params']['exceptionDetails'].get('exception', {}).get('description', '')
                     for e in c.events if e.get('method') == 'Runtime.exceptionThrown']
            print('  exceptions seen:', errs0[:3])
            objs = await c.ev(
                "var r={}; for(var k in PlaceMode.objPos?{}:{}){}"
                "var l=[]; for(var k in (window.MY_OBJECTS||[])){} return 0;")
            cnt = await c.ev("return (window.MY_OBJECTS||[]).length;")
            print('  cached objects:', cnt)
            pos143 = await c.ev('return PlaceMode.objPos(%d);' % bid)
            stats = await c.ev('return PlaceMode.stats();')
            nMesh = await c.ev(
                "var n=0; for(var k in PlaceMode.objPos?{}:{}){} return 0;")
            print('  objPos:', pos143, ' stats:', stats)
            out0 = await c.ev('return PlaceMode.buildingFade(%d);' % bid)
            print('  outside:', out0)
            assert out0 and out0['opacity'] > 0.9, 'outside should be opaque: %r' % (out0,)

            # 走进屋里
            await c.ev("P.x=%f; P.z=%f; P.air=false; P.y=0.28; return 1;"
                       % ((f['x0'] + f['x1']) / 2, (f['z0'] + f['z1']) / 2))
            await asyncio.sleep(0.6)
            out1 = await c.ev('return PlaceMode.buildingFade(%d);' % bid)
            print('  inside :', out1)
            # (diagnostics first, assertions below)

            # ★ 只有墙淡化：屋顶隐藏、屋里其它东西（家具/地板）保持不透明
            ud = await c.ev('return PlaceMode.debugUserData(%d);' % bid)
            print('  userData:', ud)
            parts = await c.ev('return PlaceMode.interiorParts(%d);' % bid)
            print('  parts inside:', parts)
            assert out1 and out1['transparent'] and out1['opacity'] <= 0.13, \
                'building did not fade: %r' % (out1,)
            if parts and parts.get('walls'):
                assert parts['walls']['transparent'], 'walls should be see-through'
                assert parts['walls']['opacity'] <= 0.13, 'walls too opaque: %r' % (parts['walls'],)
                assert parts['roofVisible'] is False, 'roof still visible'
                if parts.get('others'):
                    assert parts['others']['opacity'] > 0.9, \
                        'furniture inside got faded too: %r' % (parts['others'],)
            # 屋顶应当隐藏
            roof = await c.ev(
                "var g=null; var o=(window.MY_OBJECTS||[]).filter(function(x){"
                " return String(x.id)===String(%d);})[0];"
                "var m=null;"
                "if(window.PlaceMode){var e=null;}"
                "return PlaceMode.roofVisible ? PlaceMode.roofVisible(%d) : 'noapi';" % (bid, bid))
            print('  roof visible while inside:', roof)
            if roof != 'noapi':
                assert roof is False, 'roof still visible inside'

            # 走出屋外
            await c.ev("P.x=%f; P.z=%f; P.air=false; return 1;" % (f['x0'] - 3.0, (f['z0'] + f['z1']) / 2))
            await asyncio.sleep(0.6)
            out2 = await c.ev('return PlaceMode.buildingFade(%d);' % bid)
            print('  back   :', out2)
            assert out2 and out2['opacity'] > 0.9, 'fade not restored: %r' % (out2,)

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
    name = 'FAD%05d' % random.randint(0, 99999)
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
    print('interior fade: OK' if ok else 'interior fade: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
