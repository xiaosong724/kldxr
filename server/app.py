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
import gzip
import json
import os
import sys
import threading
import time
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

import rankboard          # noqa: E402  ★ round424：排行榜定义 + 算榜
import auth as authmod    # noqa: E402  （都必须在本目录下）
import db as dbmod        # noqa: E402
import protocol as P      # noqa: E402
from net import Net       # noqa: E402
from ws import WSServer   # noqa: E402
from world import World   # noqa: E402

DEFAULT_CFG = os.path.join(HERE, 'config.json')

# round303: 一次最多卖几件（批量出售）。
#   ★ 为什么要有上限：一个请求里循环 DELETE ✗ 没有任何上限的话
#     改个包就能一次塞几千件 ✓ 把 saver 线程堵住 ✓
#   ★ 和客户端那个 100 是同一个数 ✗ 改这里记得两边一起改 ✓
#   上限算的是【成功卖出的件数】✓ 见 api_sell 里的注释 ✓
BATCH_SELL_MAX = 100
# 一次请求最多尝试多少条（含卖不掉的）—— 纯粹是防滥用保险 ✓
BATCH_SELL_ATTEMPT_MAX = 1000

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

def rank_refresh_once(cfg, world):
    """算一次 5 个榜 → 发布到 world（只读快照 ✗ tick 只读 ✓）

    ★ 只能在非 tick 线程调（要读库 ✗）：刷新线程 + /api/rank 兜底 ✓
    """
    rows = rankboard.refresh(cfg, cfg.get('test_name_keys') or [])
    m = rankboard.build_map(rows)
    if world is not None:
        world.rank_rows = rows          # ★ 一次性赋值（不原地改 ✓）
        world.rank_map = m
        world.rank_at = int(time.time())


def start_rank_thread(cfg, world):
    """每 60 秒算一次榜单（头顶称号要用 ✗ 不能等玩家打开面板才算 ✓）"""
    def loop():
        while True:
            try:
                rank_refresh_once(cfg, world)
            except Exception as e:
                print('[rank] 榜单刷新失败：%r' % (e,))
            time.sleep(60)
    th = threading.Thread(target=loop, name='rank', daemon=True)
    th.start()
    print('[rank] 排行榜刷新线程已启动（每 60 秒 · 5 个榜）')
    return th


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
        # ★★★ round507（用户："背包东西多了，一键整理和使用延迟特别高"）
        #   体检结论：1420 件的背包 JSON = 647KB ✗ gzip 后只有 26KB（4%）✓
        #   而这里以前【从来不压】✗ 只有静态文件走了 gzip ✓
        #   → 1 Mbps 上传要 5.3 秒；压完 0.21 秒 ✓ 一个字都没改协议 ✓
        #   ★ 只压 >800 字节的（小响应压了反而多花 CPU ✓）
        _gz = False
        if len(body) > 800:
            try:
                _ae = (self.headers.get('Accept-Encoding') or '')
                if 'gzip' in _ae.lower():
                    import gzip as _gzip
                    _z = _gzip.compress(body, 6)
                    if len(_z) < len(body) - 64:      # 压不小就别压 ✓
                        body = _z
                        _gz = True
            except Exception:
                _gz = False
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        if _gz:
            self.send_header('Content-Encoding', 'gzip')
            self.send_header('Vary', 'Accept-Encoding')
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

    def _send_static(self, code, body, ctype, etag=None, immutable=False, gz=False):
        """静态文件专用的发送（和 _send 的区别：带 ETag / 可长缓存 ✗ 不发 no-store ✓）"""
        if gz:
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Encoding', 'gzip')
            self.send_header('Vary', 'Accept-Encoding')
        else:
            self.send_response(code)
            self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        if etag:
            self.send_header('ETag', etag)
        if immutable:
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        else:
            # ★ no-cache = 可以存，但每次要回来问一下（带 ETag → 304 十几字节 ✓）
            self.send_header('Cache-Control', 'no-cache')
        self.send_header('Access-Control-Allow-Origin', '*')
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
        # ★★ round424：排行榜（只读 ✗ 登录不登录都能看 ✓）
        if path == '/api/rank':
            return self.api_rank()
        # ★★ 第 48 轮：后台管理 ★★
        #   /admin 页面本身可以公开（空壳，没登录啥也拿不到 ✓）
        #   真正有数据、有能力的都是 /api/admin/*，每一个都验管理 token ✓
        if path in ('/admin', '/admin/'):
            return self.static('/admin.html')
        # ★ round496：公告
        # ★★ round540：技能特效参数（公开读 ✗ 写要管理 token）
        if path == '/api/vfx':
            return self.api_vfx_get()
        # ★ round542：技能定义（调参台要拿"技能本身的半径/射程"画范围 ✓ 公开读）
        if path == '/api/skills':
            import skills as _skm
            return self._send(200, {'ok': True, 'defs': _skm.to_client()})
        if path == '/api/announce/latest':
            return self.api_ann_latest()
        if path == '/api/admin/announce':
            return self.api_admin_ann_list()
        if path in ('/ann', '/ann.html'):
            return self.static('/ann.html')          # 干净预览页（截图用 ✓）
        if path in ('/admin/announce', '/admin/announce/'):
            return self.static('/admin-ann.html')    # 公告管理（独立导航页 ✓）
        if path == '/api/admin/skins':
            return self.api_admin_skins()
        if path == '/api/admin/status':
            return self.api_admin_status()
        if path == '/api/admin/players':
            return self.api_admin_players()
        if path == '/api/admin/who':
            return self.api_admin_who()
        # ★ C1：小镇管理（列表 / 冻结 / 恢复 / 结算 / 目录价格）
        if path == '/api/admin/towns':
            return self.api_admin_towns()
        # round303: 卖东西前的【报价】（只读 ✗ 不动任何东西 ✓）
        #   ★ 为什么要有这个接口：确认框里要写"这次能卖多少钱" ✗
        #     而价格公式只在服务器的 value.py 里 ✗
        #     客户端自己算一遍 = 两套公式 ✗ 迟早对不上 ✓（项目的老毛病 ✓）
        if path == '/api/sellquote':
            return self.api_sellquote()
        # ★★ round304m（用户："增加一个购买和卖出记录查看，也要写分页"）★★
        #   ★ 为什么走 HTTP 而不是 WS：它是【只读 + 分页】✗ 和背包接口同一类 ✓
        #     走 tick 的话要在内存里再存一份流水 ✗ 没必要 ✓
        #     （流水是【历史】✗ 不像货架那样要参与成交判定 ✓ 查库完全没问题 ✓）
        if path == '/api/trades':
            return self.api_trades()
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
        # 第 160 轮：顺手把构建号也告诉客户端
        #   为什么放这里：这个文件是服务器生成的，而且客户端第一个加载它
        #   用途：玩家看一眼诊断行就知道自己跑的是不是最新代码
        js = ('window.WS_PORT=%d;' 'window.BUILD="%s";' '\n') % (
            int(self.cfg.get('ws_port', 8900)), self._web_build())
        return self._send(200, js.encode('utf-8'), 'application/javascript; charset=utf-8')

    def do_PUT(self):
        """★ round496：只给公告用（改内容 / 改状态）"""
        path = self.path.split('?')[0]
        if not path.startswith('/api/admin/announce/'):
            return self._send(404, {'ok': False, 'error': 'not found', 'path': path})
        body = self._body()
        self._bodyCache = body          # ★ round540：后面要用的时候别再读一遍（会卡住 ✓）
        if body is None:
            return self._send(400, {'ok': False, 'error': '请求体不是合法 JSON'})
        try:
            aid = int(path.rsplit('/', 1)[-1])
        except Exception:
            return self._send(400, {'ok': False, 'error': 'id 不对'})
        if not self._admin_ok():
            return self._send(401, {'ok': False, 'error': '管理密码不对或过期'})
        import announce as annmod
        ok, err = annmod.update(self.cfg, aid, body, status=body.get('status'))
        if not ok:
            return self._send(400, {'ok': False, 'error': err})
        return self._send(200, {'ok': True, 'id': aid, 'ann': annmod.get(self.cfg, aid)})

    def do_DELETE(self):
        """★ round496：只允许删草稿"""
        path = self.path.split('?')[0]
        if not path.startswith('/api/admin/announce/'):
            return self._send(404, {'ok': False, 'error': 'not found', 'path': path})
        try:
            aid = int(path.rsplit('/', 1)[-1])
        except Exception:
            return self._send(400, {'ok': False, 'error': 'id 不对'})
        if not self._admin_ok():
            return self._send(401, {'ok': False, 'error': '管理密码不对或过期'})
        import announce as annmod
        ok, err = annmod.drop(self.cfg, aid)
        if not ok:
            return self._send(400, {'ok': False, 'error': err})
        return self._send(200, {'ok': True, 'id': aid})

    def do_POST(self):
        path = self.path.split('?')[0]
        if not path.startswith('/api/'):
            return self._send(404, {'ok': False, 'error': 'not found', 'path': path})
        body = self._body()
        self._bodyCache = body          # ★ round540：后面要用的时候别再读一遍（会卡住 ✓）
        if body is None:
            return self._send(400, {'ok': False, 'error': '请求体不是合法 JSON'})
        if path == '/api/register':
            return self.api_register(body)
        if path == '/api/login':
            return self.api_login(body)
        if path == '/api/sell':
            return self.api_sell(body)
        if path == '/api/logout':
            return self.api_logout()
        if path == '/api/vfx':
            return self.api_vfx_save()
        if path == '/api/admin/login':
            return self.api_admin_login(body)
        if path == '/api/admin/logout':
            return self.api_admin_logout()
        if path == '/api/admin/act':
            return self.api_admin_act(body)
        if path == '/api/admin/town':
            return self.api_admin_town(body)
        if path == '/api/admin/announce':
            return self.api_admin_ann_save(body)
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
                    # ★★ round305：删角色要把【和它有关的账】一起清干净 ★★
                    #   自测抓到的：只删 items/equipment/roles ✗ 会留下三样孤儿 ✓
                    #     · pending_gold —— 这个号欠的钱永远入不了账（角色没了 ✓）
                    #     · listings     —— 他的在售挂单还挂在货架上 ✗
                    #       买家的钱付了 ✗ 货永远给不出来（落库时卖家不存在 → 回滚 ✓）
                    #     · trade_log    —— 成交记录里挂着不存在的对手方 ✓
                    #   真库里实测：4 条 pending_gold 里 3 条是这么来的孤儿 ✓
                    #   ★ 为什么留着 trade_log 也不行：那是【账目】✗
                    #     留着它 = 记录页显示一个不存在的卖家的名字 ✓
                    c.execute('DELETE FROM pending_gold WHERE role=?', (rid,))
                    c.execute('DELETE FROM listings WHERE seller=?', (rid,))
                    c.execute('DELETE FROM trade_log WHERE seller=? OR buyer=?', (rid, rid))
                    c.execute('DELETE FROM roles WHERE id=?', (rid,))
                    if aid:
                        c.execute('DELETE FROM tokens WHERE account_id=?', (aid,))
                        c.execute('DELETE FROM accounts WHERE id=?', (aid,))
                gone.append(nm)
            except Exception:
                skipped.append(nm)
        return self._send(200, {'ok': True, 'act': 'delTest' if all_test else 'delplayer',
                                'deleted': gone, 'skipped': skipped})

    def api_admin_who(self):
        """看某人的【实时状态】（只读 ✓ 第 139 轮）—— 排障用

        ★ 为什么需要：用户报"只有某个角色被打死卡住"✗
          光看数据库看不出来 ✗（数据库的 hp 和内存里的 Player.hp 不是一回事 ✓）
          必须能看到 tick 线程里那个 Player 的真实状态 ✓
        """
        if not self._admin_ok():
            return self._send(401, {'ok': False, 'error': '没登录'})
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        nm = (qs.get('name') or [''])[0]
        if self.world is None:
            return self._send(503, {'ok': False, 'error': '世界没起来'})
        self.world.who_dump = None
        self.world.post_admin('who', {'name': nm})
        # ★ 第 139 轮：这里本来写的是 time.sleep ✗ 但本文件是 from time import time ✓
        #   → NameError ✓（我靠错误日志一眼看到的 ✓ 排障接口自己也需要排障 ✓）
        import time as _t
        _t.sleep(0.35)                   # 等 tick 线程处理（排障用 ✗ 不在乎这点延迟 ✓）
        return self._send(200, {'ok': True, 'who': getattr(self.world, 'who_dump', None)})

    # ---------- C1：小镇管理 ----------

    def api_admin_towns(self):
        """所有小镇 + 目录价格（只读，管理页轮询用）"""
        if not self._admin_ok():
            return self._send(401, {'ok': False, 'error': '没登录或登录过期了'})
        import towns as townreg
        out = []
        try:
            with dbmod.db(self.cfg) as c:
                rows = c.execute(
                    'SELECT t.*, r.name AS owner_name FROM towns t'
                    ' LEFT JOIN roles r ON r.id = t.owner_id'
                    ' ORDER BY t.is_system DESC, t.id').fetchall()
                for row in rows:
                    d = {k: row[k] for k in row.keys()}
                    d['fee'] = 0 if int(d.get('is_system') or 0) else townreg.fee_for(int(d['tier']))
                    d['objects'] = c.execute(
                        "SELECT COUNT(*) FROM town_objects WHERE town_id=? AND state='active'",
                        (int(d['id']),)).fetchone()[0]
                    out.append(d)
            catalog = townreg.list_catalog(self.cfg, enabled_only=True)
        except Exception as e:
            return self._send(500, {'ok': False, 'error': '读取失败：%s' % e})
        return self._send(200, {'ok': True, 'towns': out, 'catalog': catalog})

    def api_admin_town(self, body):
        """小镇操作：freeze / restore / dissolve / settle / price"""
        if not self._admin_ok():
            return self._send(401, {'ok': False, 'error': '没登录或登录过期了'})
        import towns as townreg
        act = str(body.get('act') or '')
        if act == 'price':
            cid = str(body.get('catalog') or '')
            try:
                price = max(0, int(body.get('price')))
            except Exception:
                return self._send(400, {'ok': False, 'error': '价格不对'})
            try:
                with dbmod.db(self.cfg) as c:
                    cur = c.execute('UPDATE town_catalog SET price=?, updated_at=? WHERE id=?',
                                    (price, dbmod.now_ms(), cid))
                    c.commit()
                    if cur.rowcount <= 0:
                        return self._send(404, {'ok': False, 'error': '目录里没有这个物件'})
            except Exception as e:
                return self._send(500, {'ok': False, 'error': str(e)})
            if self.world is not None:
                try:
                    self.world.town_catalog = townreg.list_catalog(self.cfg)
                except Exception:
                    pass
            return self._send(200, {'ok': True, 'id': cid, 'price': price})

        try:
            tid = int(body.get('id'))
        except Exception:
            return self._send(400, {'ok': False, 'error': '缺少小镇 id'})

        # ★ 权限管理（主城也允许）：列表 / 设置
        if act in ('perm_list', 'perm_set'):
            t = townreg.get_town(self.cfg, tid)
            if not t:
                return self._send(404, {'ok': False, 'error': '没有这个小镇'})
            if act == 'perm_list':
                with dbmod.db(self.cfg) as c:
                    rows = c.execute(
                        'SELECT p.player_id, p.mask, p.granted_by, p.granted_at,'
                        ' r.name AS player_name FROM town_perms p'
                        ' LEFT JOIN roles r ON r.id = p.player_id'
                        ' WHERE p.town_id=? ORDER BY p.player_id', (tid,)).fetchall()
                return self._send(200, {'ok': True, 'id': tid, 'perms': [
                    {'player': int(r['player_id']), 'name': r['player_name'] or '',
                     'mask': int(r['mask'] or 0), 'granted_by': int(r['granted_by'] or 0),
                     'granted_at': int(r['granted_at'] or 0)} for r in rows]})
            try:
                target = int(body.get('player'))
                mask = int(body.get('mask')) & townreg.P_ALL
            except Exception:
                return self._send(400, {'ok': False, 'error': '权限参数不对'})
            if target <= 0:
                return self._send(400, {'ok': False, 'error': '要填玩家角色 ID'})
            with dbmod.db(self.cfg) as c:
                role = c.execute('SELECT id, name FROM roles WHERE id=?',
                                 (target,)).fetchone()
                if not role:
                    return self._send(404, {'ok': False, 'error': '没有这个角色'})
                c.execute('INSERT OR REPLACE INTO town_perms(town_id,player_id,mask,'
                          'granted_by,granted_at) VALUES(?,?,?,?,?)',
                          (tid, target, mask, 0, dbmod.now_ms()))
                c.commit()
                name = role['name'] or ''
            if self.world is not None:
                self.world.town_perms[(tid, target)] = mask
                self.world.post_admin('townperm', {'id': tid, 'player': target,
                                                   'mask': mask})
            return self._send(200, {'ok': True, 'id': tid, 'player': target,
                                    'name': name, 'mask': mask})

        t = townreg.get_town(self.cfg, tid)
        if not t:
            return self._send(404, {'ok': False, 'error': '没有这个小镇'})
        if int(t.get('is_system') or 0) and act in ('freeze', 'dissolve', 'restore'):
            return self._send(400, {'ok': False, 'error': '系统主城不能冻结/解散/恢复'})
        err = ''
        if act == 'freeze':
            townreg.freeze_town(self.cfg, tid, 'admin')
        elif act == 'dissolve':
            townreg.dissolve_town(self.cfg, tid)
        elif act == 'restore':
            x = float(t['original_x'] or t['x'])
            z = float(t['original_z'] or t['z'])
            ok, err, _r = townreg.restore_town(self.cfg, tid, x, z,
                                               townreg.next_due_ms())
            if not ok:
                return self._send(400, {'ok': False, 'error': err})
        elif act == 'settle':
            if self.world is None:
                return self._send(503, {'ok': False, 'error': '世界没起来'})
            self.world.post_admin('towndue', {'id': tid})
            return self._send(200, {'ok': True, 'msg': '已安排结算（5 秒内）'})
        else:
            return self._send(400, {'ok': False, 'error': '不认识的小镇操作'})
        # 让 tick 线程换成库里的最新状态（冻结/恢复都要立刻生效）
        if self.world is not None:
            fresh = townreg.get_town(self.cfg, tid)
            if fresh:
                self.world.post_admin('townset', {'row': {k: fresh[k] for k in fresh.keys()}})
        return self._send(200, {'ok': True, 'id': tid, 'act': act})

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
        online_gold = {}
        if self.world:
            online = set(qq.get('name') for qq in
                         ((self.world.admin_stat or {}).get('players') or []))
            for qq in ((self.world.admin_stat or {}).get('players') or []):
                try:
                    online_gold[str(qq.get('name'))] = int(qq.get('gold') or 0)
                except Exception:
                    pass
        rows, test_n = [], 0
        try:
            with dbmod.db(self.cfg) as c:
                for r in c.execute('SELECT id, name, level, exp, hp, x, z, mq, gold'
                                   ' FROM roles'   # ★ 2026-10-22：带上金币 ✓
                                   ' ORDER BY level DESC, id DESC').fetchall():
                    nm = r[1]
                    if is_test(nm):
                        test_n += 1
                        if not show_test:
                            continue
                    # ★★ 第 136 轮：每个人的"单人覆盖"也一起报回去 ★★
                    #   （用户："单独设置改到下面的玩家列表中去"✗
                    #     列表里要显示每个人当前是什么 ✓ 所以必须报回来 ✓）
                    #   ov = {pvp: True/False/None, mobatk: ..., cap: N/None}
                    _ov = {}
                    try:
                        _w = self.world
                        if _w is not None:
                            if r[0] in (getattr(_w, 'pvp_of', {}) or {}):
                                _ov['pvp'] = bool(_w.pvp_of[r[0]])
                            if r[0] in (getattr(_w, 'mob_atk_of', {}) or {}):
                                _ov['mobatk'] = bool(_w.mob_atk_of[r[0]])
                            if r[0] in (getattr(_w, 'mob_cap_of', {}) or {}):
                                _ov['cap'] = int(_w.mob_cap_of[r[0]])
                    except Exception:
                        _ov = {}
                    rows.append({'id': r[0], 'name': nm, 'level': r[2], 'exp': r[3],
                                 'hp': r[4], 'x': round(float(r[5] or 0), 1),
                                 'z': round(float(r[6] or 0), 1),
                                 'online': nm in online, 'test': is_test(nm), 'ov': _ov,
                                 'mq': int(r[7] or 0),   # ★ 第 152 轮：魔气 ✓
                                 # ★ 在线用内存金币（权威），离线用库里的
                                 'gold': (online_gold.get(nm)
                                          if nm in online_gold else int(r[8] or 0))})
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
            _mc['pvpAll'] = bool(getattr(_w, 'pvp_all', False))
            _mc['pvpOnes'] = dict(getattr(_w, 'pvp_of', {}) or {})
            _mc['atkAll'] = bool(getattr(_w, 'mob_atk_all', True))
            _mc['atkOnes'] = dict(getattr(_w, 'mob_atk_of', {}) or {})
            # ★ round418：QQ 群转发的开关 + 计数（管理页要显示 ✓）
            try:
                _qb = getattr(_w, 'qq', None)
                _mc['qqOn'] = bool(_qb.on) if _qb is not None else False
                _mc['qqStats'] = _qb.stats() if _qb is not None else {'on': False}
            except Exception:
                _mc['qqOn'] = False
                _mc['qqStats'] = {'on': False}
            # ★ 第 153 轮：把魔气配置一起报回去（管理页要显示当前值 ✓）
            import mq as _mqm
            _mc['mq'] = dict(_mqm.TUNE)
            _mc['mqDoc'] = [list(x) for x in _mqm.TUNE_DOC]
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
                        # ★★ 第 135 轮补：前两轮新加的三个动作忘了进白名单 ✗✗
                        # 表现就是【点了按钮报 400】✗ 而且静默不生效 ✗
                        # （我自己测的时候才发现 ✗ 不然你会发现按钮点了没反应 ✗）
                        # ★ 教训：加一个管理动作要改【两处】✗
                        # app.py 的白名单 + world._handle_admin 的分支 ✗
                        # 漏一处就是这个后果 ✗（按钮点了没反应 ✗）
                        'mobcap', 'pvp', 'mobatk', 'who',
                        # ★ 第 153 轮：魔气配置 + 单人魔气
                        'mqcfg', 'mqset',
                       'delplayer', 'delTest',
                       # ★ round418：QQ 群转发的开关
                       #   ★ 又踩了同一个坑（加管理动作要改【两处】：
                       #     这个白名单 + world._handle_admin ✗）
                       #   → 下次再加，只改一处就会报 400 "不认识的动作" ✓
                       # ★ B1：小镇立刻结算（扣维护费/冻结），自测和管理页用
                       'towndue',
                       # ★ 2026-10-22：管理页加减玩家金币
                       'gold',
                       'qq', 'trigB'):
            return self._send(400, {'ok': False, 'error': '不认识的动作'})
        if self.world is None:
            return self._send(503, {'ok': False, 'error': '世界没起来'})
        payload = {k: v for k, v in body.items() if k != 'act'}
        # ★★ give 在【HTTP 层】直接做 ★★
        #   为什么：发东西本质是【往背包表里插一条】，和"玩家在不在线"没关系 ✓
        #   放在 tick 线程做的话，离线玩家就发不进去（而且 tick 线程不许查库 ✗）
        #   踩过：管理员给还没上线的玩家发武器 → 静默什么也没发生 ✗
        # ★★ 第 154 轮：mqset 的【落库】在这里做（和 give 一个道理 ✓）★★
        #   ★ 为什么不让 tick 线程写：它是异步的 ✗ 而且 post_save 还要排队 ✓
        #     结果就是"接口返回成功、值却没变"✗ 这种最难查 ✓
        #   ★ 在线玩家的【内存】值还是要 tick 线程改 → 下面照旧 post_admin ✓
        if act == 'mqset':
            nm = str(payload.get('name') or '').strip()
            if not nm:
                return self._send(400, {'ok': False, 'error': '要填玩家名字'})
            import mq as _mqm
            cap = int(_mqm.cfg('mq_max', _mqm.MQ_MAX))
            try:
                with dbmod.db(self.cfg) as c:
                    row = c.execute('SELECT id, mq FROM roles WHERE name=? LIMIT 1',
                                    (nm,)).fetchone()
                    if row is None:
                        return self._send(404, {'ok': False, 'error': '没有这个角色'})
                    rid, old = int(row[0]), int(row[1] or 0)
                    if payload.get('clear'):
                        new = 0
                    elif payload.get('add') is not None:
                        new = max(0, min(cap, old + int(payload.get('add') or 0)))
                    else:
                        new = max(0, min(cap, int(payload.get('v') or 0)))
                    c.execute('UPDATE roles SET mq=?, mq_at=? WHERE id=?',
                              (new, dbmod.now_ms(), rid))
                    c.commit()
            except Exception as e:
                return self._send(500, {'ok': False, 'error': str(e)})
            # 在线的话，让 tick 线程把内存里的值也改掉（并给本人一条提示 ✓）
            self.world.post_admin('mqset', {'name': nm, 'v': new, 'exact': 1})
            return self._send(200, {'ok': True, 'act': act, 'name': nm, 'mq': new})
        # ★★ 第 158 轮（用户："管理页面里面的设置会保存，而不是重启就恢复了"）★★
        #   ★ 为什么写库放在 HTTP 层：第 154 轮的教训 ——
        #     写库放 tick 线程那边会有"异步 + 异常被吞"的问题
        #     表现就是"接口返回 200 但值没变"（那次是魔气值，这次是配置）
        #   ★ tick 那边只广播一句提示，不再改 TUNE（单一写者）
        if act == 'mqcfg':
            import mq as _mqm
            if payload.get('reset'):
                _mqm.reset_tune()
                saved = {}
            else:
                _n, bad = _mqm.apply_tune(payload)
                if bad:
                    return self._send(400, {'ok': False, 'error': '这些值不对：' + bad})
                saved = _mqm.changed_tune()
            try:
                with dbmod.db(self.cfg) as c:
                    if saved:
                        # ★ 只存【和默认不一样】的项：以后改默认值时，老库不会把新默认顶回去
                        c.execute("INSERT OR REPLACE INTO meta(k, v) VALUES('mq_tune', ?)",
                                  (json.dumps(saved, ensure_ascii=False),))
                    else:
                        c.execute("DELETE FROM meta WHERE k='mq_tune'")
                    c.commit()
            except Exception as e:
                return self._send(500, {'ok': False, 'error': '存库失败：' + str(e)})
            if self.world:
                self.world.post_admin('mqcfg', {'done': 1})
            return self._send(200, {'ok': True, 'act': act, 'saved': saved})
        if act == 'give':
            return self._admin_give(payload)
        if act == 'gold':
            return self._admin_gold(payload)
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

    def api_vfx_get(self):
        """所有技能特效参数（{key: {参数}}）—— 公开 ✓ 客户端启动时拉一次"""
        import json as _j
        out = {}
        try:
            with dbmod.db(self.cfg) as c:
                for r in c.execute('SELECT key, data FROM vfx_params'):
                    try:
                        out[r['key']] = _j.loads(r['data'])
                    except Exception:
                        pass
        except Exception as e:
            return self._send(500, {'ok': False, 'error': str(e)})
        return self._send(200, {'ok': True, 'params': out})

    def api_vfx_save(self):
        """写一个技能的特效参数（要管理 token ✓）"""
        import json as _j
        if not self._admin_ok():
            return self._send(401, {'ok': False, 'error': '要管理密码'})
        d = getattr(self, '_bodyCache', None)
        if d is None:
            d = self._body() or {}
        key = str(d.get('key') or '')[:40]
        data = d.get('data') or {}
        if not key or not isinstance(data, dict):
            return self._send(400, {'ok': False, 'error': '参数不对'})
        try:
            with dbmod.db(self.cfg) as c:
                c.execute('INSERT OR REPLACE INTO vfx_params(key, data, at) VALUES(?,?,?)',
                          (key, _j.dumps(data, ensure_ascii=False), dbmod.now_ms()))
                c.commit()
        except Exception as e:
            return self._send(500, {'ok': False, 'error': str(e)})
        return self._send(200, {'ok': True, 'key': key, 'data': data})

    def api_ann_latest(self):
        """最新的已发布公告（公开 ✓ 预览页和客户端都能读）"""
        import announce as annmod
        a = annmod.latest(self.cfg)
        return self._send(200, {'ok': True, 'ann': a})

    def api_admin_ann_list(self):
        if not self._admin_ok():
            return self._send(401, {'ok': False, 'error': '管理密码不对或过期'})
        import announce as annmod
        return self._send(200, {'ok': True, 'list': annmod.list_all(self.cfg)})

    def api_admin_ann_save(self, body):
        """新建（POST）→ {ok, id}；publish=1 直接发布"""
        if not self._admin_ok():
            return self._send(401, {'ok': False, 'error': '管理密码不对或过期'})
        import announce as annmod
        try:
            aid = annmod.create(self.cfg, body, publish=bool(body.get('publish')))
        except Exception as e:
            return self._send(500, {'ok': False, 'error': '保存失败：%r' % (e,)})
        return self._send(200, {'ok': True, 'id': aid, 'ann': annmod.get(self.cfg, aid)})

    def api_admin_skins(self):
        """皮肤目录（给管理页做"发皮肤"的按钮用 ✓ 只读 ✓）"""
        import skins as skinsmod
        out = [{'k': k, 'n': skinsmod.NAME.get(k, k),
                'g': skinsmod.GENDER.get(k, '')} for k in skinsmod.KEYS]
        return self._send(200, {'ok': True, 'skins': out})

    def _admin_gold(self, d):
        """管理页给玩家加/减金币。

        ★ 金币是【内存权威】：
          在线 → 交给 tick 线程走 _gain_gold（会封顶/转金锭/立即排队存档）；
          离线 → 直接 UPDATE roles.gold（登录时读库）。
        ★ 减不能减成负数（在线/离线都一样）。
        """
        name = (d.get('name') or '').strip()
        if not name:
            return self._send(400, {'ok': False, 'error': '没写玩家名字'})
        add = d.get('add')
        setv = d.get('v')
        try:
            add = int(add) if add is not None else 0
            setv = int(setv) if setv is not None else None
        except Exception:
            return self._send(400, {'ok': False, 'error': '金币数不对'})
        if add == 0 and setv is None:
            return self._send(400, {'ok': False, 'error': '没填加减多少'})
        if abs(add) > 1000000000:
            return self._send(400, {'ok': False, 'error': '一次最多 10 亿'})
        with dbmod.db(self.cfg) as c:
            row = c.execute('SELECT id, gold FROM roles WHERE name=? LIMIT 1',
                            (name,)).fetchone()
        if row is None:
            return self._send(404, {'ok': False, 'error': '没有这个角色：%s' % name})
        rid, old = int(row[0]), int(row[1] or 0)
        online = False
        if self.world is not None:
            try:
                online = name in (self.world.online_names or frozenset())
            except Exception:
                online = False
        if online:
            # 在线：只排队，tick 线程改内存并落库
            self.world.post_admin('gold', {'name': name, 'add': add, 'v': setv})
            return self._send(200, {'ok': True, 'name': name, 'online': True,
                                    'gold': None, 'queued': True})
        new = max(0, setv if setv is not None else old + add)
        try:
            with dbmod.db(self.cfg) as c:
                c.execute('UPDATE roles SET gold=?, updated_at=? WHERE id=?',
                          (new, dbmod.now_ms(), rid))
                c.commit()
        except Exception as e:
            return self._send(500, {'ok': False, 'error': '存库失败：%s' % e})
        return self._send(200, {'ok': True, 'name': name, 'online': False,
                                'gold': new, 'before': old})

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
        # ★ round304p：管理端也能发【材料】（可堆叠 ✗ 交易所有数量滑条要拿它验 ✓）
        #   ★ 为什么要这个：材料只在打怪掉落里出现 ✗
        #     要造"一堆碎玻璃"来验按数量上架 ✗ 靠打怪太不确定 ✓
        #   ★ kind='material' 时 name 可以指定（不给就随机一个能掉的 ✓）
        # ★★★ round492（用户："管理页面增加皮肤的发放管理，可以选择对应的皮肤，方便测试"）★★★
        #   kind='skin' + skinKey=<key>|'*'（* = 全部 40 个）
        #   equip=1 → 顺手给他换上（测试时少点两下 ✓）
        # ★★★ round527（用户："管理页面给的皮肤改成给皮肤卡，不要直接给皮肤"）
        #   → 现在只发【皮肤卡】✗ 进背包自己点「使用」解锁 ✓（和打怪掉落同一条路 ✓）
        #   kind='skin' + skinKey=<key>|'*'（* = 全部 40 个）+ count（每个发几张，默认 1）
        #   ★ 不再直接写 skin_unlocks ✗ 也不再直接换装 ✓（那两条只有玩家自己点才会发生 ✓）
        if (d.get('kind') or '') == 'skin':
            import json as _json
            import skins as skinsmod
            key = str(d.get('skinKey') or d.get('key') or '')
            keys = list(skinsmod.KEYS) if key == '*' else [key]
            keys = [k2 for k2 in keys if skinsmod.valid(k2)]
            if not keys:
                return self._send(400, {'ok': False, 'error': '没有这个皮肤：%s' % key})
            try:
                cnt = max(1, min(20, int(d.get('count') or 1)))
            except Exception:
                cnt = 1
            n_card = 0
            try:
                with dbmod.db(self.cfg) as c:
                    for k2 in keys:
                        it = {'name': '皮肤·' + skinsmod.NAME.get(k2, k2), 'tier': 0,
                              'kind': 'skin', 'key': k2}
                        js = _json.dumps(it, ensure_ascii=False)
                        for _i in range(cnt):
                            c.execute('INSERT INTO items(role_id, in_storage, slot_index,'
                                      ' stack, item_json, created_at) VALUES(?,0,-1,1,?,?)',
                                      (rid, js, dbmod.now_ms()))
                            n_card += 1
                    c.commit()
            except Exception as e:
                return self._send(500, {'ok': False, 'error': '发皮肤卡失败：%s' % e})
            if self.world:
                self.world.post_admin('notify', {
                    'name': name,
                    'text': ('管理员发了 %d 张皮肤卡（%s）→ 背包里点「使用」解锁'
                             % (n_card, '全部 40 种' if key == '*' else
                                skinsmod.NAME.get(keys[0], keys[0])))})
                # 让他背包立刻刷新（不然要等下次打开面板）
                try:
                    self.world.post_admin('bagrefresh', {'name': name})
                except Exception:
                    pass
            return self._send(200, {'ok': True, 'act': 'give', 'kind': 'skin',
                                    'cards': n_card,
                                    'skins': keys,
                                    'item': ('%d 张皮肤卡' % n_card),
                                    'role': name})
        # ★★★ round538：管理页发【技能书】（方便测试技能）
        #   kind='skillbook' + skillKey=<key> + count（默认 1）+ tier（被动加成书用）
        if (d.get('kind') or '') == 'skillbook':
            import json as _json2
            import skills as skm
            key = str(d.get('skillKey') or d.get('key') or '')
            if not skm.valid(key):
                return self._send(400, {'ok': False, 'error': '没有这个技能：%s' % key})
            try:
                cnt = max(1, min(20, int(d.get('count') or 1)))
            except Exception:
                cnt = 1
            try:
                tr = max(1, min(skm.tier_max(key), int(d.get('tier') or 1)))
            except Exception:
                tr = 1
            nm_book = '技能书·' + skm.NAME.get(key, key) + ('' if skm.tier_max(key) <= 1
                                                            else '（%d 品）' % tr)
            n_add = 0
            try:
                with dbmod.db(self.cfg) as c:
                    it = {'name': nm_book, 'tier': tr, 'kind': 'skillbook', 'key': key}
                    js = _json2.dumps(it, ensure_ascii=False)
                    for _i in range(cnt):
                        c.execute('INSERT INTO items(role_id, in_storage, slot_index,'
                                  ' stack, item_json, created_at) VALUES(?,0,-1,1,?,?)',
                                  (rid, js, dbmod.now_ms()))
                        n_add += 1
                    c.commit()
            except Exception as e:
                return self._send(500, {'ok': False, 'error': '发技能书失败：%s' % e})
            if self.world:
                self.world.post_admin('notify', {
                    'name': name,
                    'text': '管理员发了 %d 本技能书（%s）→ 背包里点「使用」学习'
                            % (n_add, skm.NAME.get(key, key))})
                try:
                    self.world.post_admin('bagrefresh', {'name': name})
                except Exception:
                    pass
            return self._send(200, {'ok': True, 'act': 'give', 'kind': 'skillbook',
                                    'cards': n_add, 'item': nm_book, 'role': name})
        if (d.get('kind') or '') == 'material':
            import drops as dropsmod
            _pool = [m for m in dropsmod.MATERIALS if m[1] <= max(0, int(d.get('matTier') or 0))]
            if not _pool:
                _pool = list(dropsmod.MATERIALS)
            # ★ 注意：d['name'] 是【角色名】（上面用过了 ✗ 不能复用 ✓）
            #   材料名走 matName ✗ 自测踩到过：用 name 传结果角色名变成了材料名 ✓
            if d.get('matName'):
                w = {'name': str(d['matName']), 'tier': int(d.get('tier') or 0),
                     'kind': 'material'}
            else:
                _n, _t = _pool[int(d.get('pick') or 0) % len(_pool)]
                w = {'name': _n, 'tier': _t, 'kind': 'material'}
            _is_armor = False
        elif d.get('tag'):
            # ★★ round304s：装备也能指定名字（只给测试用 ✗ 比如"BX7k2"✓）★★
            #   为什么要它：同一名字会有好几件 ✗ 按名字认人必错 ✓
            #     （这个项目在"按名字认东西"上栽过四次 ✓）
            #   ★★ 自测踩到的第二个坑：这一段原来被写在【上面那个 material 的 if 里面】
            #     → 发装备（kind='sword'）永远走不到 ✗ 接口"成功"但名字没变 ✓
            #     → 表现是测试里那件专属装备在背包里根本找不到 ✓
            #     ★ 教训：python 的 if/elif 缩进插错一行 ✗ 功能会【静默失效】✓
            #       唯一的判据就是【回包里看名字对不对】✗ 别看接口返回 ok:true ✓
            w = {'id': 'w_sword_%d' % int(d.get('tier') or 0),
                 'name': str(d['tag']), 'slot': 'weapon', 'tier': int(d.get('tier') or 0),
                 'itemLv': 1, 'look': str(d.get('kind') or 'sword'),
                 'base': {'coeff': 1.0, 'atkSpeed': 1.15, 'reach': 2.4, 'arc': 1.05,
                          'critPt': 0},
                 'affixes': [], 'effect': None, 'reqLevel': 1, 'ext': {}}
            import weapons as _wm3
            _wm3.ensure_dur(w)
            _is_armor = False
        elif _is_armor:
            import armor as armormod2
            w = armormod2.make_armor(tier, max(1, int(lvl)))   # ★ round472：装备等级 = 等级 ✓
        else:
        # ★ 第 64 轮：支持指定词条条数（管理页的详细菜单 ✓）
        #   不传就按品阶概率抽（和正常掉落一样 ✓）
            w = weapons.make_weapon(look, tier, weapons.roll_coeff(look), max(1, int(lvl)))   # ★ round472 ✓
        try:
            affn = d.get('affixCount')
            if affn is not None:
                affn = max(0, min(5, int(affn)))
                import affixes as afmod
                _sl = 'armor' if _is_armor else 'weapon'   # ★ 第 68 轮：按部位抽 ✓
                w['affixes'] = afmod.roll_affixes(tier, (_sl,))[:affn]
        except Exception:
            pass
        # ★★ round304i：可选地发一件【磨损的】装备 ✗ 给验证用 ✓
        #   为什么需要：交易所有一条要求是"有人卖没耐久的装备要一眼看出来"✗
        #     而正常玩法里造一件磨损的装备只能【真去打怪】✗ 一刀一刀砍到 30% ✓
        #     （能验 ✗ 但没法在自动测试里做 ✓ 太慢且不确定 ✓）
        #   → 加一个可选参数 worn=0.3（= 只剩 30% ✓）/ dur=绝对次数 ✓
        #   ★ 不传就完全不变 ✗ 管理页和现有脚本一个字都不用改 ✓
        try:
            _worn = d.get('worn')
            _dur = d.get('dur')
            if _worn is not None or _dur is not None:
                import weapons as _wm2
                _wm2.ensure_dur(w)
                _mx = int(w.get('durMax') or 0)
                if _mx > 0:
                    if _dur is not None:
                        _d = int(_dur)
                    else:
                        _d = int(round(_mx * float(_worn)))
                    w['dur'] = max(0, min(_mx, _d))
                    if w['dur'] <= 0 and _is_armor is False:
                        w['broken'] = True      # ★ 归零 = 损坏（和游戏里那条规则一致 ✓）
                    if w['dur'] <= 0 and _is_armor:
                        w['broken'] = True
        except Exception:
            pass
        # ★ 第 56 轮：不再强制 reqLevel=1 ✗ —— 那会让背包显示「建议 1 级」
        #   看着像 bug ✗（用户就是被这个误导的 ✓）
        #   现在保留真实建议等级 ✓ 反正现在也不拦穿戴 ✓
        try:
            # ★ round304p：count 可以一次给一堆（★ 只有材料能堆 ✓ 装备永远 1 ✓）
            #   ★ 为什么要：验"按数量上架"要有一堆材料 ✗ 一条条发会变成 N 行各 1 个 ✓
            _cnt = 1
            try:
                _cnt = max(1, min(999, int(d.get('count') or 1)))
            except Exception:
                _cnt = 1
            if w.get('slot'):
                _cnt = 1          # ★ 装备不堆叠（和 market.is_stack 同一条判据 ✓）
            with dbmod.db(self.cfg) as c:
                c.execute('INSERT INTO items(role_id, in_storage, slot_index, stack, item_json, created_at)'
                          ' VALUES(?,0,-1,?,?,?)',
                          (rid, _cnt, json.dumps(w, ensure_ascii=False), dbmod.now_ms()))
        except Exception as e:
            return self._send(500, {'ok': False, 'error': '写背包失败：%s' % e})
        # 在线的话顺手告诉他（离线也无所谓，打开背包就能看到 ✓）
        self.world.post_admin('notify', {'name': name,
                                         'text': '管理员给了你一件【%s】—— 打开菜单→背包就能穿 ✓' % w['name']})
        return self._send(200, {'ok': True, 'act': 'give', 'item': w['name'], 'role': name})

    # ---------- 背包 / 装备 ----------

    def api_sell(self, body):
        """Sell bag items to the system (round297 single, round303 batch).

        Flow: validate + DELETE in auth.sell_item(), then post a 'gain' intent so
        the TICK thread credits the gold (memory is authoritative). The response
        carries the price so the client can show "+2,400" immediately.

        round303: the batch form takes {"iids": [...]} and caps at BATCH_SELL_MAX.
        A batch is best-effort on purpose: each item is its own DELETE, and the
        reply says exactly how many went through, so a half-done batch shows the
        truth instead of a vague failure. Gold is credited as one summed intent.
        """
        ok, r = authmod.check_token(self.cfg, self._token())
        if not ok:
            return self._send(401, {'ok': False, 'error': r})
        rid = r['role']['id']
        raw = body.get('iids')
        if raw is None:
            # ---- single (unchanged behaviour) ----
            ok2, price, name = authmod.sell_item(self.cfg, rid, body.get('iid'))
            if not ok2:
                return self._send(400, {'ok': False, 'error': price})
            try:
                if self.world:
                    self.world.inbox.put(('gain', None, (rid, int(price), 'sell')))
            except Exception as e:
                return self._send(500, {'ok': False, 'error': '\u5165\u8d26\u5931\u8d25\uff1a%r' % (e,)})
            return self._send(200, {'ok': True, 'gold': int(price), 'name': name})
        # ---- batch ----
        if not isinstance(raw, list):
            return self._send(400, {'ok': False, 'error': '\u53c2\u6570\u4e0d\u5bf9'})
        # round303: 上限按【成功卖出的件数】算 ✗ 不是按数组前 100 个切 ✓
        #   为什么：按位置切的话 ✗ 前面塞一堆不存在的 id
        #     就能把真的东西挤出窗口 ✓ 玩家的东西一件也卖不掉 ✓
        #     （自测抓到的：150 个假 id 排前面 → 6 件真的全被丢掉 ✓）
        #   ATTEMPT_MAX 是保险 ✗ 免得有人塞几十万条把 saver 线程拖住 ✓
        total = 0
        sold = []
        failed = 0
        first_err = ''
        for one in raw[:BATCH_SELL_ATTEMPT_MAX]:
            if len(sold) >= BATCH_SELL_MAX:
                break
            try:
                ok3, price3, _nm3 = authmod.sell_item(self.cfg, rid, one)
            except Exception as e:
                ok3, price3 = False, '\u5356\u51fa\u5931\u8d25\uff1a%r' % (e,)
            if ok3:
                total += int(price3)
                sold.append(one)
            else:
                failed += 1
                if not first_err:
                    first_err = str(price3)
        if not sold:
            return self._send(400, {'ok': False,
                                    'error': first_err or '\u4e00\u4ef6\u4e5f\u6ca1\u5356\u51fa\u53bb'})
        try:
            if self.world and total:
                self.world.inbox.put(('gain', None, (rid, int(total), 'sell')))
        except Exception as e:
            return self._send(500, {'ok': False, 'error': '\u5165\u8d26\u5931\u8d25\uff1a%r' % (e,)})
        # ★★ round412（用户："批量出售上锁的物品会报 400"）★★
        #   ★ 混着卖的时候：卖出去的那些照旧成功 ✓
        #     但要把【为什么剩下的没卖】带回去 ✗ 不然玩家只看到"有 N 件没卖出"✓
        return self._send(200, {'ok': True, 'sold': sold, 'total': int(total),
                                'failed': int(failed),
                                'error': (first_err or '') if failed else ''})


    def api_trades(self):
        """我的成交记录（买入 + 卖出）→ 分页

        ★★ round304m（用户："增加一个购买和卖出记录查看，也要写分页"）★★
        ★ 数据来源：trade_log（从交易所第 1 步就在写了 ✓ 只是以前没人读 ✓）
        ★ 线程：这是【只读 HTTP】✗ 不占 tick 线程 ✓（和 /api/bag 一个路子 ✓）
        ★ 一条记录给两边看，但字段不一样：
            我买 → 我花了多少（price）· 卖家是谁 · 税是卖家的事
            我卖 → 我到手多少（price - tax）· 买家是谁
          → 所以在服务端就把 side / 名字都算好 ✗ 客户端只管显示 ✓
        ★ 记录【永久保留】✗ 不像 listings 会过期 ✓（账目不该被清掉 ✓）
        """
        import json
        ok, r = authmod.check_token(self.cfg, self._token())
        if not ok:
            return self._send(401, {'ok': False, 'error': r})
        rid = int(r['role']['id'])
        # 手工切 ?page=N（和上面 /api/sellquote 同一个写法 ✓ 本文件没有 query 解析器）
        page = 0
        if '?' in self.path:
            for kv in self.path.split('?', 1)[1].split('&'):
                if kv.startswith('page='):
                    try:
                        page = int(urllib.parse.unquote(kv[5:]) or 0)
                    except Exception:
                        page = 0
                    break
        per = 20
        if page < 0:
            page = 0
        try:
            with dbmod.db(self.cfg) as c:
                total = int(c.execute(
                    'SELECT COUNT(*) FROM trade_log WHERE buyer=? OR seller=?',
                    (rid, rid)).fetchone()[0])
                rows = c.execute(
                    #   ★ 2026-10-17 修：这里原来把【买家的名字】写在前面 ✗
                    #     而下面解包是 `... seller, buyer, sname, bname` ✓
                    #     → sname 拿到买家、bname 拿到卖家 ✗
                    #     → 记录页把"对手方"显示成【自己】（买家和卖家都看到自己 ✓）
                    #   ★ 这类"位置对不上"的错【不报错】✗ 只是安静地给错数据 ✓
                    #     判据：side='buy' 的那一行，who 必须是【卖家】✓
                    'SELECT t.ts, t.lid, t.qty, t.price, t.tax, t.item_json,'
                    '       t.seller, t.buyer, rb.name, rs.name'
                    '  FROM trade_log t'
                    '  LEFT JOIN roles rs ON rs.id = t.seller'
                    '  LEFT JOIN roles rb ON rb.id = t.buyer'
                    ' WHERE t.buyer=? OR t.seller=?'
                    ' ORDER BY t.ts DESC, t.sid DESC LIMIT ? OFFSET ?',
                    (rid, rid, per, page * per)).fetchall()
        except Exception as e:
            return self._send(500, {'ok': False, 'error': '读成交记录失败：%r' % (e,)})
        out = []
        for rec in rows:
            ts, lid, qty, price, tax, js, seller, buyer, sname, bname = (
                rec[0], rec[1], rec[2], rec[3], rec[4], rec[5], rec[6], rec[7],
                rec[8], rec[9])
            name = ''
            try:
                it = json.loads(js)
                name = str((it or {}).get('name') or '')
                tier = int((it or {}).get('tier') or 0)
                slot = (it or {}).get('slot')
                look = (it or {}).get('look')
                kind = (it or {}).get('kind')
                key = (it or {}).get('key')
                dur = (it or {}).get('dur')
                durMax = (it or {}).get('durMax')
            except Exception:
                tier, slot, look, kind, dur, durMax = 0, None, None, None, 0, 0
                key = None
            me_sell = (int(seller or 0) == rid)
            q = max(1, int(qty or 1))
            out.append({
                'side': 'sell' if me_sell else 'buy',
                'lid': int(lid or 0), 'qty': q,
                'unit': int(round(float(price or 0) / q)) if q else int(price or 0),
                'price': int(price or 0),          # 这一笔的总价
                'tax': int(tax or 0),
                'net': int(price or 0) - int(tax or 0),   # 卖家到手（卖出时才有意义）
                'name': name, 'tier': tier,
                'who': str((sname if me_sell else bname) or '?'),   # 对手方名字
                'ts': int(ts or 0),
                # 图标要用的（★ 和背包/货架同一个 iconOfItem 输入 ✓）
                'icon': {'slot': slot, 'look': (name if not slot else look),
                         'kind': kind, 'rarity': None, 'broken': 0,
                         'key': key},
                'dur': int(dur or 0), 'durMax': int(durMax or 0),
            })
        pages = max(1, (total + per - 1) // per)
        return self._send(200, {'ok': True, 'rows': out, 'total': total,
                                'page': page, 'pages': pages, 'pageSize': per})

    def api_sellquote(self):
        """报价：这些背包装备【现在】卖给系统能拿多少钱（round303 只读 ✓）。

        Why: the confirm dialog has to state the amount before anything is sold, and
        the price formula lives in value.py only. Computing it again in JS would be a
        second source of truth - this project has been bitten by exactly that.
        The numbers here are the SAME function the sale itself uses (auth.sell_item
        calls value.value_of the same way), so the dialog cannot promise one amount
        and pay another.

        GET /api/sellquote?iids=1,2,3      (max BATCH_SELL_MAX ids)
        -> {"ok":true,"prices":{"1":2400,...},"total":2400}
        """
        ok, r = authmod.check_token(self.cfg, self._token())
        if not ok:
            return self._send(401, {'ok': False, 'error': r})
        rid = r['role']['id']
        # ★ 这里没有现成的 query 解析器 ✗ 就按本文件既有的写法手工切 ?iids= ✓
        #   （_token() 就是这么干的 ✓ 保持一致 ✓）
        raw = ''
        if '?' in self.path:
            for kv in self.path.split('?', 1)[1].split('&'):
                if kv.startswith('iids='):
                    raw = urllib.parse.unquote(kv[5:])
                    break
        ids = [x for x in str(raw).split(',') if x.strip()][:BATCH_SELL_MAX]
        if not ids:
            return self._send(400, {'ok': False, 'error': '\u6ca1\u7ed9\u7269\u54c1'})
        # one db read for the whole bag, then price in memory
        bag = {}
        try:
            for rec in authmod.bag_of(self.cfg, rid):
                bag[str(rec['id'])] = rec
        except Exception as e:
            return self._send(500, {'ok': False, 'error': '\u8bfb\u80cc\u5305\u5931\u8d25\uff1a%r' % (e,)})
        try:
            import value as valuemod
        except Exception as e:
            return self._send(500, {'ok': False, 'error': '\u4ef7\u683c\u8868\u8bfb\u4e0d\u5230\uff1a%r' % (e,)})
        prices = {}
        total = 0
        for one in ids:
            rec = bag.get(str(one).strip())
            if not rec:
                continue
            it = rec.get('item') or {}
            if it.get('locked_by') or it.get('locked'):
                continue
            try:
                p = int(valuemod.value_of(it, int(rec.get('stack') or 1)))
            except Exception:
                continue
            if p > 0:
                prices[str(one).strip()] = p
                total += p
        return self._send(200, {'ok': True, 'prices': prices, 'total': int(total)})

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

    def api_rank(self):
        """排行榜（★ round424）

        ★ 只读：不改世界不改库 ✗ HTTP 线程直接读快照 ✓
        ★ 用户定：只排前 100 名 · 每页 10 个 · 任何时候都能看到自己名次 ✓
        """
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        board = str((qs.get('board') or ['level'])[0] or 'level')
        if board not in rankboard.KEYS:
            return self._send(400, {'ok': False, 'error': '不认识的排行榜'})
        try:
            page = max(1, min(20, int((qs.get('page') or ['1'])[0])))
        except Exception:
            page = 1
        try:
            size = max(1, min(20, int((qs.get('size') or ['10'])[0])))
        except Exception:
            size = 10

        # 自己的角色（没登录就只看榜 ✗ 不报错 ✓）
        rid = None
        try:
            ok, rr = authmod.check_token(self.cfg, self._token())
            if ok and isinstance(rr, dict):
                # ★ rr['role'] 是 sqlite3.Row ✗ 它没有 .get() ✗✗
                #   （这个错被 try 吞掉的话表现就是「我的名次永远不显示」✗ 测试抓到了 ✓）
                _role = rr.get('role')
                _rid0 = 0
                try:
                    _rid0 = int(_role['id'] or 0)
                except Exception:
                    try:
                        _rid0 = int(dict(_role).get('id') or 0)
                    except Exception:
                        _rid0 = 0
                rid = _rid0 or None
        except Exception:
            rid = None

        # ★ ?force=1 只给管理员（测试 / 排查用 ✗ 普通玩家刷不动缓存 ✓）
        force = str((qs.get('force') or ['0'])[0]) == '1'
        if force and not self._admin_ok():
            return self._send(403, {'ok': False, 'error': '只有管理员能强刷'})
        now = int(time.time())
        rows_all = None
        cache_age = 0
        w = self.world
        if w is not None:
            try:
                if (not force) and w.rank_rows and \
                        (now - int(getattr(w, 'rank_at', 0) or 0)) < 120:
                    rows_all = w.rank_rows
                    cache_age = now - int(w.rank_at or 0)
            except Exception:
                rows_all = None
        if not rows_all:
            try:
                rank_refresh_once(self.cfg, w)
                rows_all = (w.rank_rows if w is not None else
                            rankboard.refresh(self.cfg, self.cfg.get('test_name_keys') or []))
                cache_age = 0
            except Exception as e:
                return self._send(500, {'ok': False, 'error': '算榜失败：%r' % (e,)})

        rows = rows_all.get(board) or []
        total = len(rows)
        top = rows[:rankboard.TOP_N]
        pages = max(1, (min(total, rankboard.TOP_N) + size - 1) // size)

        # 全量里找自己的名次（★ 即使 137 名也要告诉他 ✓）
        me = None
        if rid:
            for i, x in enumerate(rows):
                if x['rid'] == rid:
                    me = {'r': i + 1, 'v': x['v'], 'in100': (i + 1) <= rankboard.TOP_N}
                    break

        online = set()
        try:
            if w is not None:
                online = set(int(getattr(q, 'role_id', 0) or 0)
                             for q in list(w.players.values()))
        except Exception:
            online = set()

        start = (page - 1) * size
        out = []
        for i, x in enumerate(top[start:start + size]):
            r = start + i + 1
            out.append({'r': r, 'name': x['name'], 'lv': x['lv'], 'v': x['v'],
                        'sub': x['sub'], 'on': 1 if x['rid'] in online else 0,
                        'medal': r if r <= 3 else 0})
        return self._send(200, {
            'ok': True, 'board': board, 'rows': out, 'me': me,
            'total': total, 'topN': rankboard.TOP_N, 'pages': pages,
            'cacheAge': cache_age, 'ts': now,
        })

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
            # ★ round417：QQ 群转发的状态（群里没消息时先看这里 ✓）
            #   sent/fails/drops/queued ✗ 一眼就知道是"没发" 还是"没发出去" ✓
            try:
                _qq = getattr(self.world, 'qq', None) if self.world else None
                out['qq'] = _qq.stats() if _qq is not None else {'on': False}
            except Exception:
                out['qq'] = {'on': False}
            return self._send(200, out)
        except Exception as e:
            return self._send(500, {'ok': False, 'error': str(e)})

    # ---------- 静态 ----------

    # ★★★ 第 143 轮：给静态文件加"构建号"★★★
    #   为什么（用户报："同一台电脑 Edge 正常，Chrome 就是不行"）：
    #     Chrome 缓存里存着【旧版】的 game.js ✗（那是服务器加 no-store 之前存下的 ✓）
    #     这类条目没有校验器（没 ETag / 没 Last-Modified）✗
    #     → Chrome 有时直接拿本地那份，根本不问服务器 ✗✓
    #     → 表现就是：我改了代码你看不到 ✗ 你看到的和我改的对不上 ✗
    #       （我这几轮一直在这个坑里打转 ✓ 手机/Edge 正常是因为它们的缓存是干净的 ✓）
    #   修法：把脚本 URL 变成 /core/game.js?v=构建号 ✓
    #     URL 一变 → 浏览器的缓存键就变了 → 必须重新下载 ✓✓ 一劳永逸 ✓
    #   ★ 构建号 = 几个关键前端文件的最后修改时间取最大 ✓ 一改就自动变 ✓ 不用手工维护 ✓
    def _web_build(self):
        try:
            root = self.cfg.get('web_root') or '.'
            newest = 0.0
            for rel in ('index.html', 'core/game.js', 'platform/web.js',
                        'lib/three.min.js', 'admin.html'):
                fp = os.path.join(root, rel.replace('/', os.sep))
                if os.path.isfile(fp):
                    newest = max(newest, os.path.getmtime(fp))
            if newest <= 0:
                return '0'
            return str(int(newest))
        except Exception:
            return '0'

    def _bust(self, html):
        """把 html 里的脚本/样式引用加上 ?v=构建号 ✓（幂等 ✓ 已经有 v 的不重复加 ✓）"""
        v = self._web_build()
        out = html
        # ★ round457：顺便把构建号写进页面 ✗ 方便一眼看出"是不是新版本" ✓
        try:
            _tag = '<meta name="build" content="%s">' % v
            if 'name="build"' not in out:
                NL = chr(10)
                if '<meta charset' in out:
                    _i = out.index('<meta charset')
                    _j = out.index('>', _i) + 1
                    out = out[:_j] + NL + _tag + out[_j:]
                elif '<head>' in out:
                    out = out.replace('<head>', '<head>' + NL + _tag, 1)
        except Exception:
            pass
        for rel in ('/ws-config.js', '/lib/three.min.js', '/platform/web.js',
                    '/core/game.js'):
            if rel in out and (rel + '?v=') not in out:
                out = out.replace('"' + rel + '"', '"' + rel + '?v=' + v + '"')
        return out

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
            stt = os.stat(full)
        except Exception as e:
            return self._send(500, {'error': str(e)})
        # ★★ round443：ETag（mtime + 大小）✗ 没变就只回 304 ✓
        etag = '"%x-%x"' % (int(stt.st_mtime), stt.st_size)
        # ★★★ round457（用户："为什么我看没有变化，是不是缓存的问题"）★★★
        #   HTML 的 ETag 必须带上【构建号】✗✗
        #   不然：只改了 game.js → 构建号变了、但 index.html 没变 → 304 →
        #   浏览器用缓存里的【旧 HTML】→ 里面写的是【旧 ?v=】→
        #   而旧地址是 immutable（一年）→ 永远跑旧代码 ✗✗✗
        if 'text/html' in str(ctype or ''):
            try:
                etag = '"%x-%x-%s"' % (int(stt.st_mtime), stt.st_size, self._web_build())
            except Exception:
                pass
        inm = self.headers.get('If-None-Match') or ''
        if inm and etag in inm:
            self.send_response(304)
            self.send_header('ETag', etag)
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            return
        # ★ 第 95 轮查证：_send() 里【本来就发了 Cache-Control: no-store】✓
        #   （见 _send 的第 119 行）
        #   所以"管理页没有防具选项"不是服务器发旧页 ✗
        #   而是【那个标签页还是改动之前打开的】✗ → 在管理页按一下 F5 就有了 ✓
        #   ★ 我一开始在这里又加了一遍 no-cache ✗ 属于重复 ✗ 删掉 ✓
        # ★ 第 143 轮：网页文件发出前，把脚本引用加上 ?v=构建号 ✓
        #   （只改 html ✗ 别的文件原样发 ✓）
        if ctype and 'text/html' in str(ctype):
            try:
                _txt = data.decode('utf-8')
                _new = self._bust(_txt)
                if _new != _txt:
                    data = _new.encode('utf-8')
            except Exception:
                pass
        # ★★ round443：文本资源 gzip ✗✗ （1.3MB JS → 约 300KB）
        _gzip_ok = False
        _ct = str(ctype or '')
        _compressible = ('javascript' in _ct or 'text/' in _ct or 'json' in _ct
                         or 'svg' in _ct or 'css' in _ct)
        if _compressible and len(data) > 1024:
            if 'gzip' in (self.headers.get('Accept-Encoding') or ''):
                try:
                    _gz = gzip.compress(data, 6)
                    if len(_gz) < len(data) * 0.95:
                        data = _gz
                        _gzip_ok = True
                except Exception:
                    _gzip_ok = False
        # ★★ round444（用户："缓存的话有更新时这样不会跑到旧程序吧"）★★
        #   只有【v 等于当前构建号】才允许长缓存 ✗
        #   理由：构建号 = index/game.js/web.js/three 里最新的 mtime ✓
        #         任何一个改了 → 号变了 → html 里引用的地址也变了 → 不会跑旧代码 ✓
        #   另外两类永远不能长缓存：
        #     · ws-config.js（服务器现算的配置 ✗ 改配置不会变构建号）
        #     · 带上了一个不对的 v（手写/旧书签 → 回去问服务器 ✓）
        _immutable = False
        try:
            _q = (self.path or '')
            if 'v=' in _q:
                _v = _q.split('v=', 1)[1].split('&', 1)[0]
                _immutable = (_v == self._web_build()) and ('ws-config' not in _q)
        except Exception:
            _immutable = False
        return self._send_static(200, data, ctype, etag=etag,
                                 immutable=_immutable, gz=_gzip_ok)


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
        # ★ 第 158 轮：启动时把存过的魔气配置读进来
        #   ★ 放在创建 World 之前：tick 还没起来，所以碰库是安全的
        try:
            import mq as _mqm0
            with dbmod.db(cfg) as _mc:
                _row = _mc.execute("SELECT v FROM meta WHERE k='mq_tune'").fetchone()
            if _row and _row[0]:
                _n0, _bad0 = _mqm0.apply_tune(json.loads(_row[0]))
                print('[mq] 已装载魔气配置 %d 项%s' % (_n0, ('（有问题：%s）' % _bad0) if _bad0 else ''))
            else:
                print('[mq] 魔气配置用默认值（没存过自定义）')
        except Exception as _e0:
            print('[mq] 装载魔气配置失败（用默认值继续）：%s' % _e0)
        world = World(cfg)
        # 第 224 轮：把上次管理员改的开关读回来（要在 tick 起来之前 ✓）
        _load_admin_tune(world, cfg)
        # ★★ round417：QQ 群转发（滚动通知 + 玩家上线）★★
        #   ★ 在这里建实例并启后台线程 ✗ 然后挂到 world 上 ✓
        #   ★ 没开 / 没配 url → start() 返回 False → world.qq 保持 None ✓
        #     （集成测试 / 本地开发不会往真群里发消息 ✓）
        try:
            import qqbridge as _qqmod
            _qcfg = dict(cfg.get('qq') or {})
            # ★★ round421（用户："本地服转发到 1103784008，云服务器测试服转发到 346049634"）★★
            #   ★ deploy 脚本故意不传 config.json（两边各存各的 ✓）
            #     → 但万一以后改成传了 ✗ 两边就会互相覆盖 ✓
            #   ★ 现在多一层保险：环境变量能盖掉配置文件里的值 ✗
            #     云服务器只要在 service 里加一行就行 ✗ 不用动配置文件 ✓
            #     XIUXIAN_QQ_GROUP / XIUXIAN_QQ_URL / XIUXIAN_QQ_TOKEN / XIUXIAN_QQ_ENABLED
            for _ek, _ck in (('XIUXIAN_QQ_GROUP', 'group'),
                             ('XIUXIAN_QQ_URL', 'url'),
                             ('XIUXIAN_QQ_TOKEN', 'token')):
                _ev = os.environ.get(_ek)
                if _ev:
                    _qcfg[_ck] = _ev.strip()
                    print('[qq] %s 覆盖了配置里的 %s → %s'
                          % (_ek, _ck, _qcfg[_ck]))
            _ev2 = os.environ.get('XIUXIAN_QQ_ENABLED')
            if _ev2 is not None and _ev2 != '':
                _qcfg['enabled'] = _ev2.strip() not in ('0', 'false', 'no', 'off')
            # ★ round418：管理页设过的优先级高于 config.json ✗
            if getattr(world, 'qq_on', None) is not None:
                _qcfg['enabled'] = bool(world.qq_on)
            _qq = _qqmod.QqBridge(_qcfg,
                                  skip_names=cfg.get('test_name_keys') or [])
            if _qq.start():
                world.qq = _qq
        except Exception as _qe:
            print('[qq] 启动失败（不影响游戏）：%r' % (_qe,))
        # ★★ round424：排行榜刷新线程（头顶称号靠它 ✗ 启动就得算一次 ✓）
        try:
            start_rank_thread(cfg, world)
        except Exception as _re0:
            print('[rank] 线程启动失败（不影响游戏）：%r' % (_re0,))
        # ★★ round502：Q 群「修仙战报」（每 15 分钟一张图 ✗ 没数据不发 ✓）
        try:
            import battlereport_run as _rpt
            _rpt.start(cfg, world)
        except Exception as _re1:
            print('[rpt] 线程启动失败（不影响游戏）：%r' % (_re1,))
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
    # ★★ 第 207 轮修的真 bug：原来这里写 False ✗
    #   后果：服务只要【曾经有连接】就被 TIME_WAIT 卡住 ✗
    #         重启时报 [Errno 98] Address already in use ✓
    #         要等 60 秒才起得来 ✓ 云上就这么翻过一次车 ✓
    #   （第 196 轮部署时，用户正在线玩 → 连接没断干净 → TIME_WAIT ✓）
    # 改成 True ✓ 立刻能重用，重启不再看运气 ✓
    allow_reuse_address = True

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



# ============================================================
# 第 224 轮（用户）：启动时把管理员改的开关读回来
#   用户原话：刷怪上限和 PVP、妖兽伤害也是要保存的，
#             不要重启服务器后也恢复默认了
#   读法照抄魔气配置那套（dbmod.db(cfg) + meta 表）
#   存的活由 world._admin_tune_save() 在 tick 里排队做
#   ★★ 这个函数必须定义在【调用之前】✗
#      第 215 轮就是因为定义放在文件末尾 ✗ 而调用发生在模块加载时
#      → NameError → 世界起不来 → 接口 503 ✓✓ 这次放在 main() 前面 ✓
# ============================================================
ADMIN_TUNE_KEY = 'admin_tune'


def _load_admin_tune(world, cfg):
    import json as _json
    try:
        with dbmod.db(cfg) as _c:
            _row = _c.execute("SELECT v FROM meta WHERE k=?", (ADMIN_TUNE_KEY,)).fetchone()
        if not _row or not _row[0]:
            print('[admin] 没有存过的管理员设置（用默认值）')
            return False
        d = _json.loads(_row[0])
        # ★ round419：每人上限 + 补怪间隔也要读回来
        #   （以前只存了 mob_cap ✗ 所以这两个每次重启都变回 8 / 2 ✓）
        if d.get('mob_per'):
            try:
                world.mob_per_player = max(1, min(30, int(d['mob_per'])))
            except Exception:
                pass
        if d.get('spawn_interval') is not None:
            try:
                world.spawn_interval = max(0.2, min(30.0, float(d['spawn_interval'])))
            except Exception:
                pass
        if d.get('mob_cap'):
            world.mob_cap = int(d['mob_cap'])
        for k, v in (d.get('mob_cap_of') or {}).items():
            world.mob_cap_of[int(k)] = int(v)
        if 'pvp_all' in d:
            world.pvp_all = bool(d['pvp_all'])
        for k, v in (d.get('pvp_of') or {}).items():
            world.pvp_of[int(k)] = bool(v)
        if 'mob_atk_all' in d:
            world.mob_atk_all = bool(d['mob_atk_all'])
        # ★ round418：QQ 群转发的开关（管理页改过就优先 ✗ 没改过就跟 config ✓）
        if 'qq_on' in d:
            world.qq_on = (None if d.get('qq_on') is None else bool(d.get('qq_on')))
        for k, v in (d.get('mob_atk_of') or {}).items():
            world.mob_atk_of[int(k)] = bool(v)
        print('[admin] 已恢复上次的管理员设置：每人 %s 只 · 全服 %s 只 · '
              '每 %.1f 秒补一只 · 全局PVP %s · 妖兽伤害 %s · QQ 转发 %s'
              % (world.mob_per_player, world.mob_cap, world.spawn_interval,
                 '开' if world.pvp_all else '关',
                 '开' if world.mob_atk_all else '关',
                 ('跟 config' if getattr(world, 'qq_on', None) is None
                  else ('开' if world.qq_on else '关'))))
        return True
    except Exception as e:
        print('[admin] 读取管理员设置失败（用默认值）：%r' % (e,))
        return False


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
    # ★ round304b：启动时清掉"卡在交易锁里"的物品（方案 v3 第 5 节 ✓ 幂等 ✓）
    unlocked = dbmod.startup_unlock_items(cfg)
    # v4: multi-town foundation
    try:
        import towns as townsmod
        _sys_town = townsmod.ensure_system_town(cfg)
        townsmod.seed_catalog(cfg)
        print('  小镇系统  : 主城 #%s（%s）· 目录 %d 项'
              % (_sys_town.get('id'), _sys_town.get('name'),
                 len(townsmod.list_catalog(cfg))))
    except Exception as _te:
        print('  小镇系统  : 初始化失败 %r' % (_te,))

    print('=' * 58)
    print('  末日丧尸 × 组队修仙 · 独立版后端  v%s' % cfg.get('version', '?'))
    print('=' * 58)
    print('  数据库    : %s' % cfg['db'])
    print('  建表      : 版本 %d → %d（执行 %d 条 SQL）' % (v0, v1, ran))
    if unlocked:
        print('  交易锁    : 启动清掉 %d 件卡住的物品（上次崩在交易中间 ✓）' % unlocked)
    # ★ round304b：交易所参数也打出来 ✗ 用来确认"跑的是新代码"（restart_local.py 的标志 ✓）
    try:
        import value as _val
        print('  交易所    : 上架费 %d%%（%d~%d ✗ 余额<%d 免）· 税 %d%% · 每人 %d 件 · %d 天过期'
              % (_val.MKT_FEE_PCT, _val.MKT_FEE_MIN, _val.MKT_FEE_MAX,
                 _val.MKT_FEE_FREE_BELOW, _val.MKT_TAX_PCT,
                 _val.MKT_MAX_PER_PLAYER, _val.MKT_DAYS))
    except Exception as _ve:
        print('  交易所    : 参数读不到（%r）' % (_ve,))
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
