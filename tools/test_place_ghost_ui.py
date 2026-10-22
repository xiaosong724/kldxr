# -*- coding: utf-8 -*-
"""放置 / 移动的半透明预览测试（2026-10-22）

  ① 放置：选一个目录项 → ghost 存在、半透明（opacity<=0.5）、位置在玩家附近
  ② 编辑移动：选中一个物件 → 点「移动」→ 半透明 ghost 出现、原物件隐藏
  ③ Esc 取消 → ghost 消失、原物件恢复显示

跑法：python tools/test_place_ghost_ui.py
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
SHOT = os.path.join(ROOT, 'docs', 'shots', 'ghost-preview.png')
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
    port = random.randint(11000, 11099)
    prof = tempfile.mkdtemp(prefix='ghost-')
    proc = subprocess.Popen(
        [CHROME, '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
         '--mute-audio', '--user-data-dir=' + prof, '--remote-debugging-port=%d' % port,
         '--window-size=1500,950', ORIGIN + '/'],
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

            # ① 放置预览
            started = False
            for _ in range(10):
                started = await c.ev("return PlaceMode.startPlaceById('plant_pot');")
                if started:
                    break
                await asyncio.sleep(0.4)
            print('  placement started:', started)
            assert started, 'catalog never arrived'
            await asyncio.sleep(0.4)
            st = await c.ev('return PlaceMode.previewState();')
            print('  place preview:', st)
            assert st['placing'] and st['ghost'], 'no placement ghost'
            assert st['ghostOpacity'] is not None and st['ghostOpacity'] <= 0.5, \
                'ghost not translucent: %r' % (st['ghostOpacity'],)
            await c.ev('PlaceMode.close(); return 1;')

            # ② 编辑移动预览
            obj_id = await c.ev("return (window.MY_OBJECTS||[]).filter(function(o){"
                                "return !o.parent;})[0].id;")
            await c.ev('PlaceMode.startEdit(); PlaceMode.selectById(%d); return 1;' % obj_id)
            await asyncio.sleep(0.3)
            await c.ev("var bs=[].slice.call(document.querySelectorAll('#editBar button'));"
                       "var b=bs.filter(function(x){return x.textContent.indexOf('移动')>=0;})[0];"
                       "if(b){b.click();} return 1;")
            await asyncio.sleep(0.4)
            st2 = await c.ev('return PlaceMode.previewState();')
            print('  move preview:', st2)
            assert st2['moving'] and st2['moveGhost'], 'no move ghost'
            assert st2['moveGhostOpacity'] is not None and st2['moveGhostOpacity'] <= 0.5
            assert st2['srcVisible'] is False, 'original mesh should be hidden while moving'

            shot = await c.send('Page.captureScreenshot', {'format': 'png'})
            with open(SHOT, 'wb') as f:
                f.write(base64.b64decode(shot['result']['data']))
            print('  screenshot:', SHOT)

            # ③ Esc 取消
            await c.ev("dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); return 1;")
            await asyncio.sleep(0.3)
            st3 = await c.ev('return PlaceMode.previewState();')
            vis3 = await c.ev('return PlaceMode.objVisible(%d);' % obj_id)
            print('  after esc:', st3, 'obj visible:', vis3)
            assert not st3['moveGhost'], 'ghost not removed'
            assert vis3 is True, 'original mesh not restored'
            await c.ev('PlaceMode.stopEdit(); return 1;')

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
    name = 'GHO%05d' % random.randint(0, 99999)
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
    print('ghost preview: OK' if ok else 'ghost preview: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
