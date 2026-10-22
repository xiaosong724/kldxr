# -*- coding: utf-8 -*-
"""移动后是否立刻可见（刷新前）测试（2026-10-22）

场景：移动一个物件 → 不刷新页面
  ① 场景里的模型位置立刻变到新坐标
  ② 客户端 MY_OBJECTS 缓存里的坐标也同步

跑法：python tools/test_move_visible_e2e.py
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
    port = random.randint(11100, 11199)
    prof = tempfile.mkdtemp(prefix='movevis-')
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

            solids = await c.ev('return (typeof TOWN_OBJ_SOLIDS!=="undefined") ? TOWN_OBJ_SOLIDS.length : -1;')
            print('  registered object solids:', solids)
            assert solids > 50, 'client object collision not registered: %r' % (solids,)
            info = await c.ev(
                "var o=(window.MY_OBJECTS||[]).filter(function(x){"
                "  return !x.parent && PlaceMode.objPos(x.id);})[0];"
                "return o? {id:o.id,x:+o.x,z:+o.z,cat:o.catalog}: null;")
            print('  target object:', info)
            assert info, 'no placed object in scene'

            old = await c.ev('return PlaceMode.objPos(%d);' % info['id'])
            # 建筑自带的家具（parent=该建筑），用来验证「家具跟着建筑走」
            kids = await c.ev(
                "return (window.MY_OBJECTS||[]).filter(function(x){"
                "  return String(x.parent||0)===String(%d);})"
                " .slice(0,5).map(function(x){return {id:x.id,x:+x.x,z:+x.z};});" % info['id'])
            print('  children:', len(kids))
            await c.ev("wsSend('move_object', {id:%d, x:%f, z:%f}); return 1;"
                       % (info['id'], info['x'] + 1.6, info['z']))
            new = None
            movedMeta = None
            for _ in range(20):
                await asyncio.sleep(0.2)
                new = await c.ev('return PlaceMode.objPos(%d);' % info['id'])
                movedMeta = await c.ev(
                    "var o=(window.MY_OBJECTS||[]).filter(function(x){"
                    "  return String(x.id)===String(%d);})[0];"
                    "return o? {x:+o.x,z:+o.z}: null;" % info['id'])
                if new and abs(new['x'] - (info['x'] + 1.6)) < 0.05:
                    break
            print('  before:', old, ' after:', new, ' cache:', movedMeta)
            assert new and abs(new['x'] - (info['x'] + 1.6)) < 0.05, \
                'mesh did not move without refresh: %r' % (new,)
            assert movedMeta and abs(movedMeta['x'] - (info['x'] + 1.6)) < 0.05, \
                'MY_OBJECTS not synced: %r' % (movedMeta,)
            assert new['vis'] is True, 'mesh not visible after move'
            if kids:
                movedKids = await c.ev(
                    "var ids=%s;"
                    "return (window.MY_OBJECTS||[]).filter(function(x){"
                    "  return ids.indexOf(x.id)>=0;}).map(function(x){return {id:x.id,x:+x.x,z:+x.z};});"
                    % json.dumps([k['id'] for k in kids]))
                d0 = kids[0]['x']
                d1 = next((k['x'] for k in movedKids if k['id'] == kids[0]['id']), d0)
                print('  first child moved: %.2f -> %.2f' % (d0, d1))
                assert abs((d1 - d0) - 1.6) < 0.05, 'children did not follow the building'

            # 还原（不留脏数据）
            await c.ev("wsSend('move_object', {id:%d, x:%f, z:%f}); return 1;"
                       % (info['id'], info['x'], info['z']))
            await asyncio.sleep(0.6)

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
    name = 'MVV%05d' % random.randint(0, 99999)
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
    print('move visible: OK' if ok else 'move visible: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
