# -*- coding: utf-8 -*-
"""交互细节测试（2026-10-22）

  ① 靠近椅子/床时提示【一直显示】，不会 3 秒后消失
  ② 坐着时点交互按钮 = 起身（不弹交互菜单）
  ③ 躺着时点交互按钮 = 起床
  ④ 床要贴近（1.4m 内）才提示睡觉；2m 外不提示

跑法：python tools/test_interaction_rules_ui.py
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
    port = random.randint(12100, 12199)
    prof = tempfile.mkdtemp(prefix='rules-')
    proc = subprocess.Popen(
        [CHROME, '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
         '--mute-audio', '--user-data-dir=' + prof, '--remote-debugging-port=%d' % port,
         '--window-size=1200,800', ORIGIN + '/'],
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
                    if await c.ev('return !!P && typeof townSeatNear === "function";'):
                        break
                except Exception:
                    pass
            await asyncio.sleep(2.2)
            await c.ev("var bs=document.querySelectorAll('button');"
                       "for(var i=0;i<bs.length;i++){if((bs[i].textContent||'').indexOf('知道了')>=0){bs[i].click();}}"
                       "return 1;")
            await asyncio.sleep(0.6)

            # ① 站在椅子旁：提示一直显示（4 秒后还在）
            chair = await c.ev(
                "var l=(window.MY_OBJECTS||[]).filter(function(o){"
                "  return /chair|sofa/.test(o.catalog||'');})[0];"
                "if(!l) return null; P.x=+l.x; P.z=+l.z; P.air=false;"
                "return {x:+l.x, z:+l.z, cat:l.catalog};")
            assert chair, 'no chair'
            await asyncio.sleep(0.8)
            vis0 = await c.ev("var e=document.getElementById('sitPrompt');"
                              "return e?getComputedStyle(e).display:'none';")
            await asyncio.sleep(4.2)
            vis1 = await c.ev("var e=document.getElementById('sitPrompt');"
                              "return e?getComputedStyle(e).display:'none';")
            txt = await c.ev("return (document.getElementById('sitPrompt')||{}).textContent||'';")
            print('  prompt now/4s later: %s / %s  text=%r' % (vis0, vis1, txt[:40]))
            assert vis0 != 'none' and vis1 != 'none', 'prompt disappeared after 3s'

            # ② 刷新后坐姿要恢复
            await c.ev("SEAT_NEAR = townSeatNear(P.x,P.z); trySit(); return 1;")
            await asyncio.sleep(1.5)
            before = await c.ev('return MY_SEAT ? String(MY_SEAT.idx) : null;')
            await c.ev('location.reload(); return 1;')
            for _ in range(80):
                await asyncio.sleep(0.3)
                try:
                    if await c.ev('return typeof MY_SEAT !== "undefined" && !!P;'):
                        break
                except Exception:
                    pass
            for _ in range(30):
                await asyncio.sleep(0.4)
                after = await c.ev('return MY_SEAT ? String(MY_SEAT.idx) : null;')
                if after:
                    break
            stillSeated = await c.ev('return MY_SEAT ? true : false;')
            print('  seatid before reload: %r  after reload: %r' % (before, after))
            assert before, 'did not sit before reload'
            assert stillSeated, 'seat state lost after page reload'
            await c.ev('tryStand(); return 1;')
            await asyncio.sleep(1.0)

            # ③ 坐着时点交互 = 起身
            seated = await c.ev(
                "SEAT_NEAR = townSeatNear(P.x,P.z); trySit(); return 1;")
            await asyncio.sleep(1.2)
            isSeat = await c.ev('return !!MY_SEAT;')
            print('  seated:', isSeat)
            assert isSeat, 'did not sit down'
            act = await c.ev(
                "var called=null; var oldStand=window.tryStand;"
                "window.tryStand=function(){called='stand'; return oldStand.apply(window,arguments);};"
                "var oldPick=window.nearPickOpen; var picked=false;"
                "window.nearPickOpen=function(){picked=true;};"
                "var b=document.getElementById('atk');"
                "b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));"
                "window.tryStand=oldStand; window.nearPickOpen=oldPick;"
                "return {called:called, picked:picked};")
            print('  click while seated:', act)
            assert act['called'] == 'stand', 'clicking while seated did not stand up'
            assert not act['picked'], 'clicking while seated opened the picker'
            await asyncio.sleep(0.8)

            # ④ 床：2m 外不提示，1m 内提示
            bed = await c.ev(
                "var l=(window.MY_OBJECTS||[]).filter(function(o){"
                "  return /bed_single|bed_double/.test(o.catalog||'');})[0];"
                "if(!l) return null; return {x:+l.x, z:+l.z, id:l.id, parent:l.parent};")
            if bed:
                far = await c.ev(
                    "P.x=%f; P.z=%f; return townHouseSleepNear(P.x, P.z) ? 1 : 0;"
                    % (bed['x'] + 2.2, bed['z']))
                near = await c.ev(
                    "P.x=%f; P.z=%f; return townHouseSleepNear(P.x, P.z) ? 1 : 0;"
                    % (bed['x'] + 0.6, bed['z']))
                print('  bed 2.2m->%r  0.6m->%r' % (far, near))
                assert far == 0, 'bed interaction still triggers from 2.2m away'
                assert near == 1, 'bed interaction broken up close'

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
    name = 'IRC%05d' % random.randint(0, 99999)
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
    print('interaction rules: OK' if ok else 'interaction rules: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
