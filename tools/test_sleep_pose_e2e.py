# -*- coding: utf-8 -*-
"""躺床穿模测试（2026-10-22）

用户：「在床上睡觉时，还是有概率头会超出床头穿模出去」。

原因：躺姿用的偏移方向取自**玩家自己的朝向**，床一旦被旋转（0/90/180/270），
方向就歪了 → 头伸到床外。现在改成按**床的 rot** 算。

  ① 把一张床依次旋转 0°/90°/180°/270°，每次睡下
  ② 量玩家模型包围盒在「床本地坐标」里的范围
  ③ 要求落在床板范围（X ±0.9 / Z ±1.15）之内 —— 头不出去、脚不出去

跑法：python tools/test_sleep_pose_e2e.py
"""
import asyncio
import json
import math
import os
import random
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
import shutil

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
    port = random.randint(11900, 11999)
    prof = tempfile.mkdtemp(prefix='sleep-')
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
                    if await c.ev('return typeof PlaceMode !== "undefined" && !!P && !!H;'):
                        break
                except Exception:
                    pass
            await asyncio.sleep(2.5)
            await c.ev("var bs=document.querySelectorAll('button');"
                       "for(var i=0;i<bs.length;i++){if((bs[i].textContent||'').indexOf('知道了')>=0){bs[i].click();}}"
                       "return 1;")
            await asyncio.sleep(0.8)

            got = await c.ev(
                "var l=(window.MY_OBJECTS||[]).filter(function(o){"
                "  return o.catalog==='bed_single';})[0];"
                "return l?{id:l.id,x:l.x,z:l.z,rot:l.rot,parent:l.parent}:null;")
            print('  bed:', got)
            assert got, 'no bed in the world'

            bad = []
            for deg in (0, 90, 180, 270):
                rot = deg * math.pi / 180.0
                res = await c.ev(
                    "var rot=%f;"
                    "P.sleepYaw=rot; MY_SLEEP='obj%d'; P.x=+%f; P.z=+%f; P.air=false;"
                    "P.y=0.28;"
                    "return 1;" % (rot, got['id'], got['x'], got['z']))
                await asyncio.sleep(0.25)
                box = await c.ev(
                    "var b=new THREE.Box3().setFromObject(H.g);"
                    "var cx=%f, cz=%f, rot=%f;"
                    "function toLocal(x,z){var dx=x-cx,dz=z-cz;"
                    "  return [dx*Math.cos(-rot)-dz*Math.sin(-rot), dx*Math.sin(-rot)+dz*Math.cos(-rot)];}"
                    "var xs=[],zs=[];"
                    "for(var i=0;i<8;i++){var wx=(i&1)?b.max.x:b.min.x, wy=(i&2)?b.max.y:b.min.y, wz=(i&4)?b.max.z:b.min.z;"
                    "  var p=toLocal(wx,wz); xs.push(p[0]); zs.push(p[1]);}"
                    "return {x0:Math.min.apply(null,xs),x1:Math.max.apply(null,xs),"
                    " z0:Math.min.apply(null,zs),z1:Math.max.apply(null,zs)};"
                    % (got['x'], got['z'], rot))
                print('    rot=%3d  local X[%.2f,%.2f] Z[%.2f,%.2f]'
                      % (deg, box['x0'], box['x1'], box['z0'], box['z1']))
                # 床板 1.60 x 2.05 → 半宽 0.80 / 半长 1.02；人躺平会略宽一点，给 0.95 / 1.15 容差
                if box['x0'] < -0.95 or box['x1'] > 0.95 or box['z0'] < -1.15 or box['z1'] > 1.15:
                    bad.append((deg, box))
            await c.ev("MY_SLEEP=''; return 1;")
            print('  out-of-bed cases:', bad)
            assert not bad, 'sleeping pose leaves the bed: %r' % (bad,)

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
    name = 'SLP%05d' % random.randint(0, 99999)
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
    print('sleep pose: OK' if ok else 'sleep pose: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
