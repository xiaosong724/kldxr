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

    def api_admin_players(self):
        if not self._admin_ok():
            return self._send(401, {'ok': False, 'error': '没登录或登录过期了'})
        rows = []
        try:
            with dbmod.db(self.cfg) as c:
                for r in c.execute('SELECT id, name, level, exp, hp, x, z FROM roles'
                                   ' ORDER BY level DESC, id DESC LIMIT 200').fetchall():
                    rows.append({'id': r[0], 'name': r[1], 'level': r[2], 'exp': r[3],
                                 'hp': r[4], 'x': round(float(r[5] or 0), 1),
                                 'z': round(float(r[6] or 0), 1)})
        except Exception:
            pass
        online = set(q.get('name') for q in
                     ((self.world.admin_stat or {}).get('players') or [])) if self.world else set()
        for r in rows:
            r['online'] = r['name'] in online
        return self._send(200, {'ok': True, 'players': rows})

    def api_admin_act(self, body):
        """管理动作：spawn / give / kick / heal / say

        ★ 这里【只入队】—— 真正改世界状态的是 tick 线程（世界状态只有它能碰 ✓）
        """
        if not self._admin_ok():
            return self._send(401, {'ok': False, 'error': '没登录或登录过期了'})
        act = (body.get('act') or '').strip()
        if act not in ('spawn', 'give', 'kick', 'heal', 'say'):
            return self._send(400, {'ok': False, 'error': '不认识的动作'})
        if self.world is None:
            return self._send(503, {'ok': False, 'error': '世界没起来'})
        self.world.post_admin(act, {k: v for k, v in body.items() if k != 'act'})
        return self._send(200, {'ok': True, 'act': act})

    # ---------- 背包 / 装备 ----------

    def api_bag(self):
        """背包 + 手上的武器（只读 ✓ 打开面板/登录时拉一次就够了）"""
        ok, r = authmod.check_token(self.cfg, self._token())
        if not ok:
            return self._send(401, {'ok': False, 'error': r})
        rid = r['role']['id']
        w, wid = authmod.weapon_of(self.cfg, rid)
        return self._send(200, {'ok': True, 'items': authmod.bag_of(self.cfg, rid),
                                'weapon': w, 'weaponItemId': wid})

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
