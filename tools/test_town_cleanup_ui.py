# -*- coding: utf-8 -*-
"""主城静态清理校验（2026-10-22）

用户要求：把「不能移动的」住宅和道具全部删掉。
  ① 静态 solids 从 374 降到 ~125（住宅 60 + 道具 123 + 椅子 66 都被丢掉）
  ② 住宅中心点不再被任何 solid 覆盖（没有隐形墙）
  ③ 放置物件的碰撞仍然注册着（TOWN_OBJ_SOLIDS > 100）

跑法：python tools/test_town_cleanup_ui.py
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
    port = random.randint(11200, 11299)
    prof = tempfile.mkdtemp(prefix='cleanup-')
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
                    if await c.ev('return typeof TOWN_SOLIDS !== "undefined" && !!P;'):
                        break
                except Exception:
                    pass
            await asyncio.sleep(2.5)
            await c.ev("var bs=document.querySelectorAll('button');"
                       "for(var i=0;i<bs.length;i++){if((bs[i].textContent||'').indexOf('知道了')>=0){bs[i].click();}}"
                       "return 1;")
            await asyncio.sleep(0.8)

            st = await c.ev(
                "return {solids: TOWN_SOLIDS.length,"
                " objSolids: (typeof TOWN_OBJ_SOLIDS!=='undefined')?TOWN_OBJ_SOLIDS.length:-1,"
                " dataSolids: (TOWN_DATA&&TOWN_DATA.solids)?TOWN_DATA.solids.length:-1,"
                " houses: (TOWN_DATA&&TOWN_DATA.houses)?TOWN_DATA.houses.length:-1};")
            print('  state:', st)
            assert st['dataSolids'] == 374, 'town_data not regenerated: %r' % (st['dataSolids'],)
            static_n = st['solids'] - st['objSolids']
            print('  static solids:', static_n)
            # 剩下的应该是：8 城墙 + 喷泉 + 仓库柜台 + 4 花坛 + 2 信息亭 = 16，全部有可见模型
            assert static_n <= 16, 'static solids still too many: %r' % (static_n,)
            assert st['objSolids'] > 100, 'placed-object solids missing: %r' % (st['objSolids'],)

            # 住宅中心点不应该被任何 solid 覆盖（没有隐形墙）
            bad = await c.ev(
                "var out=[];"
                "var hs=(TOWN_DATA&&TOWN_DATA.houses)||[];"
                "for(var i=0;i<hs.length;i++){var h=hs[i];"
                "  var cx=(h.x0+h.x1)/2, cz=(h.z0+h.z1)/2, hit=false;"
                "  var ls=(typeof TOWN_OBJ_SOLIDS!=='undefined')?TOWN_OBJ_SOLIDS:[];"
                "  var keep=TOWN_SOLIDS.filter(function(x){return ls.indexOf(x)<0;});"
                "  for(var j=0;j<keep.length;j++){var s=keep[j];"
                "    if(Math.abs(cx-s.x)<=s.hw+0.1 && Math.abs(cz-s.z)<=s.hd+0.1){hit=true;break;}}"
                "  if(hit){out.push(h.id);}}"
                "return out.slice(0,5);")
            print('  houses still colliding:', bad)
            assert not bad, 'invisible walls remain at houses: %r' % (bad,)
            # 门洞 / 室内：建筑中心与门口正中都不该被静态墙挡住
            door = await c.ev(
                "var out=[];"
                "var ls=(typeof TOWN_OBJ_SOLIDS!=='undefined')?TOWN_OBJ_SOLIDS:[];"
                "var keep=TOWN_SOLIDS.filter(function(x){return ls.indexOf(x)<0;});"
                "var objs=(window.MY_OBJECTS||[]).filter(function(o){"
                "  return /sh|house/.test(o.catalog||'') && !o.parent;}).slice(0,8);"
                "for(var i=0;i<objs.length;i++){var o=objs[i];"
                "  var cx=o.x, cz=o.z;"
                "  var inside=false;"
                "  for(var j=0;j<keep.length;j++){var s=keep[j];"
                "    if(Math.abs(cx-s.x)<=s.hw+0.05 && Math.abs(cz-s.z)<=s.hd+0.05){inside=true;break;}}"
                "  if(inside){out.push(o.catalog);}}"
                "return out;")
            print('  building interiors blocked by static walls:', door)
            assert not door, 'static walls still cover building interiors: %r' % (door,)
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
    name = 'CLN%05d' % random.randint(0, 99999)
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
    print('town cleanup: OK' if ok else 'town cleanup: FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
