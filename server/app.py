# -*- coding: utf-8 -*-
"""末日丧尸 × 组队修仙 · 独立版后端入口

当前进度（对应 docs/方案.md §15.1）：
  P0-1 目录骨架与配置        ✓ 本文件 + config.json + db.py
  P0-2 SQLite 表结构         ✓ db.py 里的 MIGRATIONS
  P0-3 账号系统              ← 待做
  P0-4 WebSocket 服务器      ← 待做（本文件已留好配置项 ws_port）
  P0-6 tick 与事件循环分离   ← 待做

这一版提供：
  · HTTP 静态服务（把 web/ 发出去）
  · GET /api/health —— 健康检查（自检 / 排查用）
  · 启动时自动建表（幂等）

跑法：
  python app.py                 用 config.json
  python app.py --port 9000     临时改端口
"""

import argparse
import json
import os
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# ★ 控制台是 GBK，中文输出会乱码 → 强制 UTF-8（配合 .bat 里的 chcp 65001）
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

import auth as authmod    # noqa: E402  （都必须在本目录下）
import db as dbmod        # noqa: E402
import protocol as P      # noqa: E402
from net import Net       # noqa: E402
from ws import WSServer   # noqa: E402
from world import World   # noqa: E402

DEFAULT_CFG = os.path.join(HERE, 'config.json')

# 静态文件的 MIME（.ogg/.mp3/.wav 必须有，不然音效放不出来 —— 这个坑踩过）
MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/plain; charset=utf-8',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.bin': 'application/octet-stream',
}


# ============================================================ 配置

def load_cfg(path=DEFAULT_CFG):
    with open(path, encoding='utf-8') as f:
        cfg = json.load(f)
    base = os.path.dirname(os.path.abspath(path))

    # ${HERE} 替换 → 整个项目可以挪位置而不用改配置 ✓
    for k, v in list(cfg.items()):
        if isinstance(v, str) and '${HERE}' in v:
            cfg[k] = os.path.normpath(v.replace('${HERE}', base))
    cfg.setdefault('host', '0.0.0.0')
    cfg.setdefault('http_port', 8899)
    cfg.setdefault('ws_port', 8900)
    cfg.setdefault('web_root', os.path.normpath(os.path.join(base, '..', 'web')))
    return cfg


# ============================================================ HTTP 服务

class Api(BaseHTTPRequestHandler):
    cfg = None
    world = None          # 由 main() 挂上来，/api/health 里报 tick 健康度
    server_version = 'zombie-xiuxian/0.1'
    protocol_version = 'HTTP/1.1'     # ★ keep-alive（少一次 TCP 握手，见方案 §13.2）
    timeout = 65                      # ★ 闲置连接自动关，别把线程一直挂着

    def setup(self):
        # ★ 关掉 Nagle：实时小包协议最经典的坑，最多能压 40ms
        BaseHTTPRequestHandler.setup(self)
        try:
            import socket
            self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except Exception:
            pass

    # ---------- 工具 ----------

    def _send(self, code, obj, ctype='application/json; charset=utf-8'):
        body = obj if isinstance(obj, bytes) else json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Token')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def log_message(self, fmt, *args):
        pass    # 关掉逐请求日志（实时同步时会把控制台刷爆）

    # ---------- 请求工具 ----------

    def _body(self):
        """读 JSON 请求体。返回 dict；解析失败返回 None"""
        try:
            n = int(self.headers.get('Content-Length') or 0)
        except Exception:
            n = 0
        if n <= 0:
            return {}
        if n > 64 * 1024:                     # 别让人塞大包
            return None
        try:
            return json.loads(self.rfile.read(n).decode('utf-8'))
        except Exception:
            return None

    def _token(self):
        """取 token：优先 X-Token 头；也支持 ?token= （方便浏览器直接点开自测）"""
        tk = self.headers.get('X-Token')
        if tk:
            return tk.strip()
        if '?' in self.path:
            for kv in self.path.split('?', 1)[1].split('&'):
                if kv.startswith('token='):
                    return urllib.parse.unquote(kv[6:]).strip()
        return ''

    # ---------- 路由 ----------

    def do_OPTIONS(self):
        self._send(204, b'', 'text/plain')

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/api/health':
            return self.api_health()
        if path == '/api/profile':
            return self.api_profile()
        if path == '/api/lobby':               # ★ 第 83 轮：组队大厅
            return self.api_lobby()
        if path == '/api/bag':                 # ★ 第 47 轮：背包 + 已装备的武器
            return self.api_bag()
        # ★★ 第 48 轮：后台管理 ★★
        #   /admin 页面本身可以公开（空壳，没登录啥也拿不到 ✓）
        #   真正有数据、有能力的都是 /api/admin/*，每一个都验管理 token ✓
        if path in ('/admin', '/admin/'):
            return self.static('/admin.html')
        if path == '/api/admin/status':
            return self.api_admin_status()
        if path == '/api/admin/players':
            return self.api_admin_players()
        if path == '/ws-config.js':
            return self.ws_config()
        if path.startswith('/api/'):
            return self._send(404, {'ok': False, 'error': 'not found', 'path': path})
        return self.static(path)

    def ws_config(self):
        """把 WebSocket 端口注入客户端。

        ★ 别把 8900 写死在 index.html 里 —— 改了配置客户端就连不上了。
          用 <script src="/ws-config.js"> 同步加载，不占一次往返 ✓
        """
        js = 'window.WS_PORT=%d;\n' % int(self.cfg.get('ws_port', 8900))
        return self._send(200, js.encode('utf-8'), 'application/javascript; charset=utf-8')

    def do_POST(self):
        path = self.path.split('?')[0]
        if not path.startswith('/api/'):
            return self._send(404, {'ok': False, 'error': 'not found', 'path': path})
        body = self._body()
        if body is None:
            return self._send(400, {'ok': False, 'error': '请求体不是合法 JSON'})
        if path == '/api/register':
            return self.api_register(body)
        if path == '/api/login':
            return self.api_login(body)
        if path == '/api/logout':
            return self.api_logout()
        if path == '/api/admin/login':
            return self.api_admin_login(body)
        if path == '/api/admin/logout':
            return self.api_admin_logout()
        if path == '/api/admin/act':
            return self.api_admin_act(body)
        return self._send(404, {'ok': False, 'error': 'not found', 'path': path})

    # ---------- 账号接口（P0-3） ----------

    def api_register(self, body):
        ok, r = authmod.register(self.cfg, body.get('name'), body.get('password'))
        if not ok:
            return self._send(400, {'ok': False, 'error': r})
        return self._send(200, {'ok': True, 'token': r['token'], 'role': r['role']})

    def api_login(self, body):
        ok, r = authmod.login(self.cfg, body.get('name'), body.get('password'))
        if not ok:
            return self._send(401, {'ok': False, 'error': r})
        return self._send(200, {'ok': True, 'token': r['token'], 'role': r['role']})

    def api_logout(self):
        authmod.logout(self.cfg, self._token())
        return self._send(200, {'ok': True})

    def api_profile(self):
        ok, r = authmod.check_token(self.cfg, self._token())
        if not ok:
            return self._send(401, {'ok': False, 'error': r})
        return self._send(200, {'ok': True, 'role': authmod.role_public(r['role'])})

    # ---------- 后台管理（第 48 轮） ----------

    def _admin_token(self):
        """管理 token：优先 X-Admin 头；也支持 ?at= （方便浏览器直接点开自测）"""
        tk = self.headers.get('X-Admin')
        if tk:
            return tk.strip()
        if '?' in self.path:
            for kv in self.path.split('?', 1)[1].split('&'):
                if kv.startswith('at='):
                    return urllib.parse.unquote(kv[3:]).strip()
        return ''

    def _admin_ok(self):
        import admin as adminmod
        return adminmod.check(self.cfg, self._admin_token())

    def api_admin_login(self, body):
        import admin as adminmod
        ip = self.client_address[0] if self.client_address else '-'
        ok, r = adminmod.login(self.cfg, body.get('password'), ip)
        if not ok:
            return self._send(401, {'ok': False, 'error': r})
        print('  [管理] 管理员登录成功（%s）' % ip)
        return self._send(200, {'ok': True, 'token': r})

    def api_admin_logout(self):
        import admin as adminmod
        adminmod.logout(self._admin_token())
        return self._send(200, {'ok': True})

    def api_admin_status(self):
        import admin as adminmod
        if not self._admin_ok():
            return self._send(401, {'ok': False, 'error': '没登录或登录过期了'})
        # ★ 世界状态用【只读快照】—— tick 线程每 15 tick 换一个新 dict（不直接遍历世界 ✓）
        stat = (self.world.admin_stat if self.world else {}) or {}
        acc = role_n = 0
        try:
            with dbmod.db(self.cfg) as c:
                acc = c.execute('SELECT COUNT(*) FROM accounts').fetchone()[0]
                role_n = c.execute('SELECT COUNT(*) FROM roles').fetchone()[0]
        except Exception:
            pass
        return self._send(200, {'ok': True, 'stat': stat, 'accounts': acc, 'roles': role_n,
                                'sessions': adminmod.session_count(),
                                'playerDebug': bool(self.cfg.get('allow_player_debug'))})

    def _admin_del(self, d, all_test=False):
        """删除账号（第 64 轮）—— ★ 只删【离线的】✓ 而且要显式确认 ✓

        ★ 动了就找不回来了 ✗（角色/背包/装备一起删）→ 所以：
           · 在线的一律拒绝（他还在玩 ✗）
           · 前端要二次确认 ✓
        """
        names = []
        if all_test:
            keys = [str(k) for k in (self.cfg.get('test_name_keys') or [])]
            try:
                with dbmod.db(self.cfg) as c:
                    for r in c.execute('SELECT name FROM roles').fetchall():
                        if any(k and k in str(r[0] or '') for k in keys):
                            names.append(r[0])
            except Exception as e:
                return self._send(500, {'ok': False, 'error': '查角色失败：%s' % e})
        else:
            nm = (d.get('name') or '').strip()
            if not nm:
                return self._send(400, {'ok': False, 'error': '没写名字'})
            names = [nm]
        live = set()
        if self.world:
            live = set(qq.get('name') for qq in
                       ((self.world.admin_stat or {}).get('players') or []))
        gone, skipped = [], []
        for nm in names:
            if nm in live:
                skipped.append(nm)          # ★ 在线的不能删 ✗
                continue
            try:
                with dbmod.db(self.cfg) as c:
                    row = c.execute('SELECT id, account_id FROM roles WHERE name=? LIMIT 1',
                                    (nm,)).fetchone()
                    if not row:
                        continue
                    rid, aid = row[0], row[1]
                    c.execute('DELETE FROM items WHERE role_id=?', (rid,))
                    c.execute('DELETE FROM equipment WHERE role_id=?', (rid,))
                    c.execute('DELETE FROM roles WHERE id=?', (rid,))
                    if aid:
                        c.execute('DELETE FROM tokens WHERE account_id=?', (aid,))
                        c.execute('DELETE FROM accounts WHERE id=?', (aid,))
                gone.append(nm)
            except Exception:
                skipped.append(nm)
        return self._send(200, {'ok': True, 'act': 'delTest' if all_test else 'delplayer',
                                'deleted': gone, 'skipped': skipped})

    def api_admin_players(self):
        """玩家列表（第 64 轮：在线优先 + 分页 + 测试账号过滤）

        ★ 用户要求：
           ① 测试账号默认不显示（可以在页面上打开"显示测试账号"✓）
           ② 在线的排前面 ✓ 并且分页 ✓
        """
        if not self._admin_ok():
            return self._send(401, {'ok': False, 'error': '没登录或登录过期了'})
        q = {}
        if '?' in self.path:
            for kv in self.path.split('?', 1)[1].split('&'):
                if '=' in kv:
                    k, v = kv.split('=', 1)
                    q[k] = urllib.parse.unquote(v)
        try:
            page = max(1, int(q.get('page') or 1))
        except Exception:
            page = 1
        try:
            size = max(5, min(100, int(q.get('size') or 20)))
        except Exception:
            size = 20
        show_test = q.get('test') in ('1', 'true', 'yes')

        keys = [str(k) for k in (self.cfg.get('test_name_keys') or [])]

        def is_test(nm):
            s = str(nm or '')
            return any(k and k in s for k in keys)

        online = set()
        if self.world:
            online = set(qq.get('name') for qq in
                         ((self.world.admin_stat or {}).get('players') or []))
        rows, test_n = [], 0
        try:
            with dbmod.db(self.cfg) as c:
                for r in c.execute('SELECT id, name, level, exp, hp, x, z FROM roles'
                                   ' ORDER BY level DESC, id DESC').fetchall():
                    nm = r[1]
                    if is_test(nm):
                        test_n += 1
                        if not show_test:
                            continue
                    rows.append({'id': r[0], 'name': nm, 'level': r[2], 'exp': r[3],
                                 'hp': r[4], 'x': round(float(r[5] or 0), 1),
                                 'z': round(float(r[6] or 0), 1),
                                 'online': nm in online, 'test': is_test(nm)})
        except Exception:
            pass
        # ★ 在线的排前面 ✓（其余保持"等级降序"✓）
        rows.sort(key=lambda r: (0 if r['online'] else 1, -int(r['level'] or 1)))
        total = len(rows)
        pages = max(1, (total + size - 1) // size)
        page = min(page, pages)
        head = rows[(page - 1) * size: page * size]
        # ★ 第 133 轮：顺便把"当前刷怪设置"报回去 ✓（管理页要显示"当前：每人 8 只…"✓）
        #   ★ 这几个都是普通 int/float ✓ HTTP 线程直接读没事 ✗ 不是复杂对象 ✓
        #     （跨线程规矩：tick 线程改、HTTP 线程只读简单值 ✓）
        _mc = {}
        try:
            _w = self.world
            _mc = {'per': int(getattr(_w, 'mob_per_player', 8)),
                   'cap': int(getattr(_w, 'mob_cap', 60)),
                   'interval': float(getattr(_w, 'spawn_interval', 2.0)),
                   'ones': dict(getattr(_w, 'mob_cap_of', {}) or {})}
        except Exception:
            pass
        return self._send(200, {'ok': True, 'players': head, 'total': total, 'mobCaps': _mc,
                                'page': page, 'pages': pages, 'size': size,
                                'online': len(online), 'testHidden': test_n})

    def api_admin_act(self, body):
        """管理动作：spawn / give / kick / heal / say

        ★ 这里【只入队】—— 真正改世界状态的是 tick 线程（世界状态只有它能碰 ✓）
        """
        if not self._admin_ok():
            return self._send(401, {'ok': False, 'error': '没登录或登录过期了'})
        act = (body.get('act') or '').strip()
        if act not in ('spawn', 'give', 'kick', 'heal', 'say', 'kill',
                       'delplayer', 'delTest'):
            return self._send(400, {'ok': False, 'error': '不认识的动作'})
        if self.world is None:
            return self._send(503, {'ok': False, 'error': '世界没起来'})
        payload = {k: v for k, v in body.items() if k != 'act'}
        # ★★ give 在【HTTP 层】直接做 ★★
        #   为什么：发东西本质是【往背包表里插一条】，和"玩家在不在线"没关系 ✓
        #   放在 tick 线程做的话，离线玩家就发不进去（而且 tick 线程不许查库 ✗）
        #   踩过：管理员给还没上线的玩家发武器 → 静默什么也没发生 ✗
        if act == 'give':
            return self._admin_give(payload)
        if act in ('delplayer', 'delTest'):
            return self._admin_del(payload, all_test=(act == 'delTest'))
        self.world.post_admin(act, payload)
        return self._send(200, {'ok': True, 'act': act})

    def api_lobby(self):
        """在线大厅名单（第 83 轮 ✓ 要玩家登录态 ✓）

        ★ 只给【距离】不给坐标 ✗（隐私 ✓ 距离在服务器算 ✓）
        ★ 数据来源：tick 线程每秒发布的 world.lobby_stat（只读 ✓ 不加锁 ✓）
        """
        ok, r = authmod.check_token(self.cfg, self._token())
        if not ok:
            return self._send(401, {'ok': False, 'error': r})
        # ★ 踩过的坑：check_token 返回的是 sqlite3.Row ✗
        #   它【没有 .get()】✗ 只能用下标 ✓
        #   （我写成 r.get('role') → AttributeError → 接口直接空响应 ✗）
        try:
            me = r['role']['id']
        except Exception:
            me = None
        st = None
        if self.world is not None:
            st = getattr(self.world, 'lobby_stat', None)
        if not st:
            st = {'players': [], 'parties': []}
        mx = mz = None
        for p in st['players']:
            if p.get('id') == me:
                mx, mz = p.get('x'), p.get('z')
                break
        out = []
        for p in st['players']:
            if p.get('id') == me:
                continue
            d = None
            if mx is not None and p.get('x') is not None:
                d = int(round((((p['x'] - mx) ** 2 + (p['z'] - mz) ** 2)) ** 0.5))
            out.append({'id': p.get('id'), 'name': p.get('name'), 'lv': p.get('lv'),
                        'look': p.get('look'), 'tier': p.get('tier'),
                        'hp': p.get('hp'), 'qi': p.get('qi'),
                        'party': bool(p.get('party')), 'dist': d})
        # ★ 第 84 轮用户要求：最多随机显示 10 个 ✓ 点刷新换一批 ✓
        import random as _rnd
        out.sort(key=lambda x: (99999 if x['dist'] is None else x['dist']))
        _tot = len(out)
        if _tot > 10:
            out = _rnd.sample(out, 10)
        return self._send(200, {'ok': True, 'players': out,
                                'parties': st.get('parties') or [],
                                'online': len(st['players']),
                                'shown': len(out), 'total': _tot})

    def _admin_give(self, d):
        """给某个角色发一件武器（写库 ✓ 在线的话再顺手告诉他一声 ✓）"""
        import auth as authmod2
        name = (d.get('name') or '').strip()
        if not name:
            return self._send(400, {'ok': False, 'error': '没写玩家名字'})
        rid = lvl = None
        try:
            with dbmod.db(self.cfg) as c:
                row = c.execute('SELECT id, level FROM roles WHERE name=? LIMIT 1', (name,)).fetchone()
                if row:
                    rid, lvl = row[0], int(row[1] or 1)
        except Exception as e:
            return self._send(500, {'ok': False, 'error': '查角色失败：%s' % e})
        if rid is None:
            return self._send(404, {'ok': False, 'error': '没有这个角色：%s' % name})
        import weapons
        look = d.get('kind') or 'sword'
        if look not in weapons.TYPES:
            look = 'sword'
        tier = max(0, min(11, int(d.get('tier') or 0)))
        # ★★ 第 68 轮：管理页也能发【防具】（kind='armor' ✓）★★
        #   ★ 这里不再自己写一遍入库，而是复用下面现成的"写 items + 通知"那段 ✓
        #     （上次我在这里调了个不存在的 _admin_deliver ✗ 和 _equipped 一个毛病 ✗）
        _is_armor = ((d.get('kind') or '') == 'armor') or ((d.get('slot') or '') == 'armor')
        if _is_armor:
            import armor as armormod2
            w = armormod2.make_armor(tier, max(1, lvl // 4 + 1))
        else:
        # ★ 第 64 轮：支持指定词条条数（管理页的详细菜单 ✓）
        #   不传就按品阶概率抽（和正常掉落一样 ✓）
            w = weapons.make_weapon(look, tier, weapons.roll_coeff(look), max(1, lvl // 4 + 1))
        try:
            affn = d.get('affixCount')
            if affn is not None:
                affn = max(0, min(5, int(affn)))
                import affixes as afmod
                _sl = 'armor' if _is_armor else 'weapon'   # ★ 第 68 轮：按部位抽 ✓
                w['affixes'] = afmod.roll_affixes(tier, (_sl,))[:affn]
        except Exception:
            pass
        # ★ 第 56 轮：不再强制 reqLevel=1 ✗ —— 那会让背包显示「建议 1 级」
        #   看着像 bug ✗（用户就是被这个误导的 ✓）
        #   现在保留真实建议等级 ✓ 反正现在也不拦穿戴 ✓
        try:
            with dbmod.db(self.cfg) as c:
                c.execute('INSERT INTO items(role_id, in_storage, slot_index, stack, item_json, created_at)'
                          ' VALUES(?,0,-1,1,?,?)',
                          (rid, json.dumps(w, ensure_ascii=False), dbmod.now_ms()))
        except Exception as e:
            return self._send(500, {'ok': False, 'error': '写背包失败：%s' % e})
        # 在线的话顺手告诉他（离线也无所谓，打开背包就能看到 ✓）
        self.world.post_admin('notify', {'name': name,
                                         'text': '管理员给了你一件【%s】—— 打开菜单→背包就能穿 ✓' % w['name']})
        return self._send(200, {'ok': True, 'act': 'give', 'item': w['name'], 'role': name})

    # ---------- 背包 / 装备 ----------

    def api_bag(self):
        """背包 + 手上的武器（只读 ✓ 打开面板/登录时拉一次就够了）"""
        ok, r = authmod.check_token(self.cfg, self._token())
        if not ok:
            return self._send(401, {'ok': False, 'error': r})
        rid = r['role']['id']
        w, wid = authmod.weapon_of(self.cfg, rid)
        return self._send(200, {'ok': True, 'items': authmod.bag_of(self.cfg, rid),
                                'weapon': w, 'weaponItemId': wid,
                                    'armor': authmod.armor_of(self.cfg, rid)[0],
                                    'armorItemId': authmod.armor_of(self.cfg, rid)[1]})

    # ---------- 其他接口 ----------

    def api_health(self):
        try:
            with dbmod.db(self.cfg) as c:
                n = c.execute('SELECT COUNT(*) FROM accounts').fetchone()[0]
                roles = c.execute('SELECT COUNT(*) FROM roles').fetchone()[0]
            # ★ 第 48 轮：健康检查只报"活着没 + 世界在不在跑" ✓
            #   账号数/角色数/数据库路径这些【内部信息】搬到管理页了 ✗
            #   （它以前对着玩家把家底全吐出来 —— 用户要求搬走 ✓）
            w = (self.world.admin_stat if self.world else None) or {}
            out = {
                'ok': True,
                'version': self.cfg.get('version', '?'),
                'ws_port': self.cfg.get('ws_port'),
                'ts': dbmod.now_ms(),
                'world': {'online': w.get('online', 0), 'tick': w.get('tick', 0),
                          'mobs': w.get('mobs', 0), 'tickMs': w.get('tickMs', 0)},
            }
            return self._send(200, out)
        except Exception as e:
            return self._send(500, {'ok': False, 'error': str(e)})

    # ---------- 静态 ----------

    def static(self, path):
        root = self.cfg['web_root']
        rel = path.lstrip('/')
        if rel in ('', '/'):
            # / 先找 index.html，没有就退回现有 3d-v4.html（P0-7 会补 index.html）
            for cand in ('index.html', '3d-v4.html'):
                if os.path.isfile(os.path.join(root, cand)):
                    rel = cand
                    break
            else:
                return self._send(404, {'error': 'web/ 里还没有入口页'})
        full = os.path.normpath(os.path.join(root, rel.replace('/', os.sep)))
        # 防目录穿越：必须还在 web_root 里
        if not full.startswith(os.path.normpath(root) + os.sep):
            return self._send(403, {'error': 'forbidden'})
        if not os.path.isfile(full):
            return self._send(404, {'error': 'not found', 'path': path,
                                    'hint': '文件不存在（web_root=%s）' % root})
        ctype = MIME.get(os.path.splitext(full)[1].lower(), 'application/octet-stream')
        try:
            with open(full, 'rb') as f:
                data = f.read()
        except Exception as e:
            return self._send(500, {'error': str(e)})
        # ★ 第 95 轮查证：_send() 里【本来就发了 Cache-Control: no-store】✓
        #   （见 _send 的第 119 行）
        #   所以"管理页没有防具选项"不是服务器发旧页 ✗
        #   而是【那个标签页还是改动之前打开的】✗ → 在管理页按一下 F5 就有了 ✓
        #   ★ 我一开始在这里又加了一遍 no-cache ✗ 属于重复 ✗ 删掉 ✓
        return self._send(200, data, ctype)


# ============================================================ WebSocket（P0-4）

def start_ws(cfg, ready, world_box=None):
    """在独立线程里跑 asyncio 的 WebSocket 服务器。

    为什么单开线程：HTTP 走 ThreadingHTTPServer（阻塞式），WebSocket 走 asyncio，
    两边互不干扰。★ 世界 tick 再单开一个线程（P0-6，见方案 §13.5）。
    """
    err_box = []

    def run():
        import asyncio
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        world = World(cfg)
        net = Net(cfg, world)
        if world_box is not None:
            world_box.append(world)

        async def boot():
            srv = WSServer(cfg['host'], cfg['ws_port'],
                           on_open=net.on_open,
                           on_message=net.on_message,
                           on_close=net.on_close)
            net.srv = srv
            world.srv = srv
            try:
                await srv.start()
            except OSError as e:
                err_box.append(str(e))
                ready.set()
                return
            # ★ tick 跑独立线程，不占事件循环（方案 §13.5）
            world.start(loop)
            ready.set()
            print('  [ws] 已就绪，协议 v%d；tick 独立线程 %dHz'
                  % (P.PROTOCOL_VERSION, 30))

        try:
            loop.run_until_complete(boot())
            if not err_box:
                loop.run_forever()
        except Exception as e:
            err_box.append(repr(e))
            ready.set()

    th = threading.Thread(target=run, name='ws', daemon=True)
    th.start()
    ready.wait(timeout=5.0)
    if err_box:
        return None, err_box[0]
    return th, None


# ============================================================ 启动

class Srv(ThreadingHTTPServer):
    """ quieter 的 HTTP 服务器：
    · daemon_threads → Ctrl+C / 退出时不会被工作线程拖住
    · handle_error 里过滤掉「客户端把 keep-alive 连接掐了」这种纯噪音，
      真异常照旧打印（不然排查问题时会被淹没）"""
    daemon_threads = True
    allow_reuse_address = False

    def handle_error(self, request, client_address):
        import sys as _s
        et = _s.exc_info()[0]
        if et in (ConnectionResetError, ConnectionAbortedError,
                  BrokenPipeError, TimeoutError):
            return
        ThreadingHTTPServer.handle_error(self, request, client_address)


def lan_ips():
    """列出本机局域网 IP（手机上直接用这个地址）"""
    out = []
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.2)
        try:
            s.connect(('8.8.8.8', 80))
            out.append(s.getsockname()[0])
        finally:
            s.close()
    except Exception:
        pass
    try:
        import socket
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if ip not in out and not ip.startswith('127.'):
                out.append(ip)
    except Exception:
        pass
    return out


def main():
    ap = argparse.ArgumentParser(description='末日丧尸 × 组队修仙 · 后端')
    ap.add_argument('--config', default=DEFAULT_CFG)
    ap.add_argument('--port', type=int)
    ap.add_argument('--host')
    a = ap.parse_args()

    cfg = load_cfg(a.config)
    if a.port:
        cfg['http_port'] = a.port
    if a.host:
        cfg['host'] = a.host

    # 建表（幂等）
    v0, v1, ran = dbmod.ensure_tables(cfg)
    tables = dbmod.table_names(cfg)

    print('=' * 58)
    print('  末日丧尸 × 组队修仙 · 独立版后端  v%s' % cfg.get('version', '?'))
    print('=' * 58)
    print('  数据库    : %s' % cfg['db'])
    print('  建表      : 版本 %d → %d（执行 %d 条 SQL）' % (v0, v1, ran))
    print('  表 (%d)   : %s' % (len(tables), '、'.join(tables)))
    print('  前端目录  : %s' % cfg['web_root'])
    print('-' * 58)

    # ---- WebSocket（游戏通道）----
    ready = threading.Event()
    world_box = []
    ws_thread, ws_err = start_ws(cfg, ready, world_box)
    if ws_err:
        print('  ✗ WebSocket 端口 %d 起不来：%s' % (cfg['ws_port'], ws_err))
        print('    可能已有一个后端在跑 —— 先停掉它再启动。')
        return
    Api.world = world_box[0] if world_box else None

    Api.cfg = cfg
    try:
        srv = Srv((cfg['host'], cfg['http_port']), Api)
    except OSError as e:
        print('  ✗ HTTP 端口 %d 起不来：%s' % (cfg['http_port'], e))
        print('    可能已有一个后端在跑 —— 先停掉它再启动。')
        return
    print('  网页      : http://127.0.0.1:%d/' % cfg['http_port'])
    print('  游戏通道  : ws://127.0.0.1:%d/ws   （协议 v%d）'
          % (cfg['ws_port'], P.PROTOCOL_VERSION))
    for ip in lan_ips():
        print('  手机用    : http://%s:%d/   (ws://%s:%d/ws)'
              % (ip, cfg['http_port'], ip, cfg['ws_port']))
    print('  健康检查  : /api/health')
    print('-' * 58)
    print('  按 Ctrl+C 停止')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\n  已停止')


if __name__ == '__main__':
    main()
