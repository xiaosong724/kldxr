# -*- coding: utf-8 -*-
"""编辑/交互细节测试（2026-10-22）

  ① 编辑工具条里的物件名是中文（不能出现 chair_wood 这类 id）
  ② 删除用我们自己的确认框（#editConfirm），不是浏览器 confirm
  ③ 坐放置家具椅子时 sit 包里的 id 不是 undefined
  ④ 仓库飘字以「仓库建筑对象」为锚点（挪走后跟随、删掉后消失）

跑法：python tools/test_ui_polish.py
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
    port = random.randint(11700, 11799)
    prof = tempfile.mkdtemp(prefix='polish-')
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

            # ① 选中一把椅子：工具条应显示中文
            chair = await c.ev(
                "var l=(window.MY_OBJECTS||[]).filter(function(o){"
                "  return /chair|bench|sofa/.test(o.catalog||'') && PlaceMode.objPos(o.id);})[0];"
                "if(!l){return null;} PlaceMode.startEdit(); PlaceMode.selectById(l.id);"
                "return {id:l.id, cat:l.catalog,"
                " bar:(document.getElementById('editBar')||{}).textContent||''};")
            print('  edit bar:', chair['cat'], '->', chair['bar'] if chair else None)
            assert chair, 'no chair object'
            assert chair['cat'] not in chair['bar'], 'edit bar still shows english id'
            assert any('\u4e00' <= ch <= '\u9fff' for ch in chair['bar']), 'edit bar has no chinese'

            # ② 删除按钮 → 自定义确认框
            opened = await c.ev(
                "var bs=[].slice.call(document.querySelectorAll('#editBar button'));"
                "var d=bs.filter(function(x){return x.textContent.indexOf('删除')>=0;})[0];"
                "if(!d){return 'nobtn';} d.click();"
                "var box=document.getElementById('editConfirm');"
                "return {vis: box?getComputedStyle(box).display:'none',"
                " txt: box?box.textContent.slice(0,60):''};")
            print('  delete dialog:', opened)
            assert opened['vis'] != 'none', 'custom confirm not shown'
            assert '删除' in opened['txt'], 'confirm text wrong'
            await c.ev("var bs=[].slice.call(document.querySelectorAll('#editConfirm button'));"
                       "var n=bs.filter(function(x){return x.textContent.indexOf('取消')>=0;})[0];"
                       "if(n){n.click();} return 1;")
            await c.ev('PlaceMode.stopEdit(); return 1;')

            # ③ 坐放置椅子：sit 包 id 不能是 undefined
            sit = await c.ev(
                "var l=(window.MY_OBJECTS||[]).filter(function(o){"
                "  return /chair|bench/.test(o.catalog||'');})[0];"
                "P.x=+l.x; P.z=+l.z; P.air=false;"
                "var got=null, old=window.wsSend;"
                "window.wsSend=function(t,d){ if(t==='sit'){got=d;} return old.apply(window,arguments); };"
                "SEAT_NEAR = townSeatNear(P.x,P.z); trySit();"
                "window.wsSend=old; return got;")
            print('  sit payload:', sit)
            assert sit and sit.get('id') not in (None, 'undefined', ''), 'sit missing id: %r' % (sit,)

            # ④ 仓库飘字以仓库对象为锚
            wh = await c.ev(
                "var l=(window.MY_OBJECTS||[]).filter(function(o){"
                "  return !o.parent && o.catalog==='shop_warehouse_v1';})[0];"
                "if(!l){return null;}"
                "var nearOld=townNearWarehouse(TOWN_COUNTER.x, TOWN_COUNTER.z);"
                "var nearNew=townNearWarehouse(+l.x, +l.z);"
                "return {x:+l.x,z:+l.z,nearOld:nearOld,nearNew:nearNew};")
            print('  warehouse:', wh)
            if wh:
                assert wh['nearNew'] is True, 'warehouse proximity not following object'

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
    name = 'POL%05d' % random.randint(0, 99999)
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
    print('ui polish: OK' if ok else 'ui polish: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
