# -*- coding: utf-8 -*-
"""客户端性能采样（C4）：三角形 / draw call / 网格数 / 重灾区 Top 12

跑法：python tools/profile_client.py
会注册一个临时号、站在主城出生点、等场景加载完，然后读 renderer.info + 遍历 scene。
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


PROFILE_JS = r"""
var out = { tris: 0, meshes: 0, calls: 0, top: [], shadow: 0, groups: [] };
var top = [];
try { out.calls = rd.info.render.calls; out.tri = rd.info.render.triangles; } catch (e) { }
scene.traverse(function (o) {
  if (!o.isMesh || !o.visible || !o.geometry) { return; }
  var g = o.geometry, idx = g.index;
  var t = idx ? idx.count / 3 : (g.attributes && g.attributes.position ? g.attributes.position.count / 3 : 0);
  if (!t) { return; }
  out.meshes++; out.tris += t;
  if (o.castShadow) { out.shadow += t; }
  var nm = o.name || '';
  var p = o.parent;
  for (var i = 0; i < 3 && p && !nm; i++) { nm = p.name || ''; p = p.parent; }
  top.push({ n: nm || o.type, t: Math.round(t), m: (o.material && o.material.type) || '' });
});
top.sort(function (a, b) { return b.t - a.t; });
out.top = top.slice(0, 12);
for (var ci = 0; ci < scene.children.length; ci++) {
  var ch = scene.children[ci], ct = 0, cn = 0;
  ch.traverse(function (o) {
    if (!o.isMesh || !o.visible || !o.geometry) { return; }
    var g2 = o.geometry, i2 = g2.index;
    var t2 = i2 ? i2.count / 3 : (g2.attributes && g2.attributes.position ? g2.attributes.position.count / 3 : 0);
    if (t2) { ct += t2; cn++; }
  });
  if (cn) { out.groups.push({ n: ch.name || ch.type, t: Math.round(ct), m: cn }); }
}
out.mats = [];
scene.traverse(function (o) {
  if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.color) { return; }
  var a2 = o.geometry.attributes.color;
  if (a2.count < 20000) { return; }
  var m2 = o.material || {};
  out.mats.push({ c: a2.count, vc: !!m2.vertexColors,
                  col: (m2.color && m2.color.getHexString) ? m2.color.getHexString() : '',
                  side: m2.side, vis: o.visible, y: +o.position.y.toFixed(3) });
});
out.mats = out.mats.slice(0, 10);
out.sample = null;
scene.traverse(function (o) {
  if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.color) { return; }
  var a = o.geometry.attributes.color;
  if (a.count < 100000 || out.sample) { return; }
  var uniq = {};
  for (var q = 0; q < a.count; q += Math.max(1, Math.floor(a.count / 400))) {
    uniq[(a.getX(q)).toFixed(2) + ',' + (a.getY(q)).toFixed(2) + ',' + (a.getZ(q)).toFixed(2)] = 1;
  }
  out.sample = { count: a.count, first: [a.getX(0), a.getY(0), a.getZ(0)],
                 uniq: Object.keys(uniq).slice(0, 8), y: o.position.y };
});
out.groups.sort(function (a, b) { return b.t - a.t; });
out.groups = out.groups.slice(0, 10);
return JSON.stringify(out);
"""


class CDP:
    def __init__(self, ws):
        self.ws = ws
        self.seq = 0

    async def send(self, method, params=None):
        self.seq += 1
        mid = self.seq
        await self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
        while True:
            m = json.loads(await asyncio.wait_for(self.ws.recv(), 30))
            if m.get('id') == mid:
                return m

    async def ev(self, expr):
        r = await self.send('Runtime.evaluate', {
            'expression': '(function(){' + expr + '})()',
            'returnByValue': True, 'awaitPromise': True})
        res = r.get('result', {})
        if 'exceptionDetails' in res:
            raise RuntimeError('JS %r' % (res['exceptionDetails'],))
        return (res.get('result') or {}).get('value')


async def profile(token, suffix=''):
    port = random.randint(10600, 10699)
    prof = tempfile.mkdtemp(prefix='prof-')
    proc = subprocess.Popen(
        [CHROME, '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
         '--mute-audio', '--user-data-dir=' + prof, '--remote-debugging-port=%d' % port,
         '--window-size=1600,950', ORIGIN + '/' + (suffix or '')],
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
            await c.ev('localStorage.setItem("token", %s); location.reload(); return 1;'
                       % json.dumps(token))
            for _ in range(80):
                await asyncio.sleep(0.25)
                try:
                    if await c.ev('return typeof rd !== "undefined" && !!scene;'):
                        break
                except Exception:
                    pass
            await asyncio.sleep(3.0)
            await c.ev("var bs=document.querySelectorAll('button');"
                       "for(var i=0;i<bs.length;i++){if((bs[i].textContent||'').indexOf('知道了')>=0){bs[i].click();}}"
                       "return 1;")
            await asyncio.sleep(1.5)
            # 等地形瓦片建完
            for _ in range(20):
                await asyncio.sleep(0.3)
                fps = await c.ev("return typeof FPS !== 'undefined' ? FPS : (window.__fps||0);")
                if fps:
                    break
            await c.ev("window.__n=0; window.__t0=performance.now();"
                       "function __f(){window.__n++; if(performance.now()-window.__t0<1000){requestAnimationFrame(__f);}}"
                       "requestAnimationFrame(__f); return 1;")
            await asyncio.sleep(1.2)
            fps = await c.ev('return window.__n;')
            raw = await c.ev(PROFILE_JS)
            data = json.loads(raw)
            data['fps'] = fps
            print('  scene meshes :', data['meshes'])
            print('  scene tris   :', int(data['tris']))
            print('  drawn calls  :', data['calls'])
            print('  drawn tris   :', data['tri'])
            print('  color sample :', data.get('sample'))
            print('  color meshes :', data.get('mats'))
            print('  shadow tris  :', int(data.get('shadow') or 0))
            print('  fps sample   :', data.get('fps'))
            print('  groups:')
            for g in data.get('groups') or []:
                print('    %-24s %8d  x%d' % (g['n'][:24], g['t'], g['m']))
            print('  top:')
            for t in data['top']:
                print('    %-28s %8d  %s' % (t['n'][:28], t['t'], t['m']))
            import base64
            shot = await c.send('Page.captureScreenshot', {'format': 'png'})
            path = os.path.join(ROOT, 'docs', 'shots', 'perf-c4.png')
            with open(path, 'wb') as f:
                f.write(base64.b64decode(shot['result']['data']))
            print('  screenshot:', path)
            return data
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
    name = 'PRF%05d' % random.randint(0, 99999)
    reg = http_json('/api/register', {'name': name, 'password': 'e2e-pass-123'})
    print('test role:', name)
    try:
        suffix = sys.argv[1] if len(sys.argv) > 1 else ''
        asyncio.run(profile(reg['token'], suffix))
    finally:
        for _ in range(40):
            if not http_json('/api/health')['world'].get('online'):
                break
            time.sleep(0.25)
        cleanup(name)
        print('cleanup done')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
