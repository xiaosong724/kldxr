# -*- coding: utf-8 -*-
"""round502：Q 群「修仙战报」—— 统计 + 15 分钟调度 + 发图

★ 统计口径（用户定）：**这 15 分钟的增量**（不是生涯累计）
   · 经验 = 这 15 分钟通过 _gain_exp 拿到的
   · 金币 = 这 15 分钟通过 _gain_gold 拿到的（正数）
   · 击杀 = 这 15 分钟结算的僵尸
   · 装备 = 这 15 分钟【捡到背包】的武器/防具（按 look+tier 合并计数）
★ 没人有数据 → 不发（用户定）
★ 发图走 NapCat 的 OneBot WS（4999）✗ 不去动 xiuxian-card 那个服务 ✓
"""
import io
import json
import os
import socket
import struct
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
INTERVAL = 15 * 60          # 15 分钟
SAVE_DIR = os.path.join(HERE, 'reports')

_lock = threading.Lock()
_cur = {}                   # role_id -> {...}


def _bucket(rid, name):
    b = _cur.get(rid)
    if b is None:
        b = _cur[rid] = {'name': name or '?', 'exp': 0, 'gold': 0, 'kills': 0,
                         'gear': {}, 'gearTotal': 0}
    if name:
        b['name'] = name
    return b


# ---------------- 累加（都在 tick 线程里调 ✓ 只改内存 ✓）----------------

def add_exp(p, n):
    try:
        n = int(n)
        if n <= 0 or p is None:
            return
        with _lock:
            _bucket(p.role_id, p.name)['exp'] += n
    except Exception:
        pass


def add_gold(p, n):
    try:
        n = int(n)
        if n <= 0 or p is None:
            return
        with _lock:
            _bucket(p.role_id, p.name)['gold'] += n
    except Exception:
        pass


def add_kill(p, n=1):
    try:
        if p is None:
            return
        with _lock:
            _bucket(p.role_id, p.name)['kills'] += int(n or 1)
    except Exception:
        pass


def add_gear(p, item):
    """捡到装备（武器/防具）→ 按 look + 品阶 计数"""
    try:
        if p is None or not isinstance(item, dict):
            return
        slot = item.get('slot')
        if slot not in ('weapon', 'armor'):
            return
        look = 'armor' if slot == 'armor' else (item.get('look') or 'sword')
        tier = max(0, min(11, int(item.get('tier') or 0)))
        key = '%s#%d' % (look, tier)
        with _lock:
            b = _bucket(p.role_id, p.name)
            g = b['gear'].get(key)
            if g is None:
                g = b['gear'][key] = {'look': look, 'tier': tier, 'n': 0}
            g['n'] += 1
            b['gearTotal'] += 1
    except Exception:
        pass


# ---------------- 取一份 + 清空 ----------------

def take():
    """把这一段的统计拿走并清空 → 已排序好的 players 列表（经验降序）"""
    global _cur
    with _lock:
        raw = _cur
        _cur = {}
    players = []
    for rid, b in raw.items():
        if (b['exp'] or b['gold'] or b['kills'] or b['gearTotal']) <= 0 and not b['gear']:
            continue
        gear = sorted(b['gear'].values(), key=lambda g: (-g['tier'], -g['n'], g['look']))[:12]
        players.append({'rid': rid, 'name': b['name'], 'exp': b['exp'], 'gold': b['gold'],
                        'kills': b['kills'], 'gear': gear, 'gearTotal': b['gearTotal']})
    players.sort(key=lambda x: (-x['exp'], -x['gold'], x['name']))
    return players


def reset():
    global _cur
    with _lock:
        _cur = {}


# ---------------- 发图：NapCat OneBot WS（最小客户端） ----------------

class WsClient(object):
    """只用来【发一条】send_group_msg 的极简 WebSocket 客户端（纯标准库 ✓）"""

    def __init__(self, host, port, token='', timeout=8):
        self.host, self.port, self.token, self.timeout = host, port, token, timeout
        self.sock = None

    def connect(self):
        s = socket.create_connection((self.host, self.port), timeout=self.timeout)
        key = 'dGhlIHNhbXBsZSBub25jZQ=='
        path = '/'
        if self.token:
            path += '?access_token=' + self.token
        req = ('GET %s HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\n'
               'Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\n'
               'Sec-WebSocket-Version: 13\r\n\r\n' % (path, self.host, self.port, key))
        s.sendall(req.encode())
        head = b''
        while b'\r\n\r\n' not in head:
            ch = s.recv(1)
            if not ch:
                raise IOError('握手失败')
            head += ch
        if b' 101 ' not in head.split(b'\r\n')[0]:
            raise IOError('握手被拒：' + head.decode('utf-8', 'ignore')[:80])
        self.sock = s
        return self

    def send_text(self, text):
        data = text.encode('utf-8')
        hdr = bytearray([0x81])
        n = len(data)
        if n < 126:
            hdr.append(0x80 | n)
        elif n < 65536:
            hdr.append(0x80 | 126)
            hdr += struct.pack('>H', n)
        else:
            hdr.append(0x80 | 127)
            hdr += struct.pack('>Q', n)
        mask = os.urandom(4)
        hdr += mask
        self.sock.sendall(bytes(hdr) + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv_text(self):
        """收一条文本帧（忽略 ping/pong 之外的二进制）"""
        s = self.sock
        b1 = s.recv(1)
        if not b1:
            return ''
        b2 = s.recv(1)
        ln = b2[0] & 0x7f
        if ln == 126:
            ln = struct.unpack('>H', s.recv(2))[0]
        elif ln == 127:
            ln = struct.unpack('>Q', s.recv(8))[0]
        payload = b''
        while len(payload) < ln:
            ch = s.recv(ln - len(payload))
            if not ch:
                break
            payload += ch
        return payload.decode('utf-8', 'ignore')

    def close(self):
        try:
            if self.sock:
                self.sock.close()
        except Exception:
            pass
        self.sock = None


def send_image(cfg, png_path, group=None):
    """把一张本地 PNG 发到 QQ 群 → (ok, err)"""
    q = (cfg or {}).get('battleReport') or {}
    host = q.get('onebotHost') or '127.0.0.1'
    port = int(q.get('onebotPort') or 4999)
    # ★ token 兜底：和 qq 转发用同一个（配置里两处一致 ✓ 少一个漂移点）
    token = q.get('onebotToken') or ((cfg or {}).get('qq') or {}).get('token') or ''
    gid = str(group or q.get('group') or '')
    if not gid:
        return False, '没配群号'
    msg = [{'type': 'image', 'data': {'file': png_path}}]
    body = {'action': 'send_group_msg',
            'params': {'message_type': 'group', 'group_id': gid, 'message': msg},
            'echo': 'rpt'}
    cli = WsClient(host, port, token)
    try:
        cli.connect()
        cli.send_text(json.dumps(body, ensure_ascii=False))
        t0 = time.time()
        while time.time() - t0 < 8:
            txt = cli.recv_text()
            if not txt:
                break
            try:
                r = json.loads(txt)
            except Exception:
                continue
            if r.get('echo') == 'rpt' or r.get('status') in ('ok', 'failed'):
                if r.get('status') == 'failed' or (r.get('retcode') not in (0, None)):
                    return False, json.dumps(r, ensure_ascii=False)[:200]
                return True, ''
        return True, ''
    except Exception as e:
        return False, repr(e)
    finally:
        cli.close()


# ---------------- 出一张图（不发送，给测试/预览用）----------------

def build_png(players, t0, t1, out_path=None):
    # ★ 懒加载：没装 Pillow 的机器（比如本地开发机）也能起服 ✗ 只是出不了图 ✓
    import battlereport
    os.makedirs(SAVE_DIR, exist_ok=True)
    if out_path is None:
        out_path = os.path.join(SAVE_DIR, 'report-%s.png' % time.strftime('%Y%m%d-%H%M%S'))
    data = {
        't0txt': time.strftime('%Y-%m-%d %H:%M', time.localtime(t0)),
        't1txt': time.strftime('%H:%M', time.localtime(t1)),
        'players': players,
    }
    path, w, h = battlereport.render(data, out_path)
    return path, w, h


def make_report(cfg, dry_run=False):
    """===== 由调度线程每 15 分钟调一次 =====
    返回 (ok, info)"""
    now = time.time()
    players = take()
    if not players:
        return True, 'skip'           # ★ 没数据就不播报 ✓
    t0 = now - INTERVAL
    try:
        path, w, h = build_png(players, t0, now)
    except Exception as e:
        return False, '渲染失败：%r' % (e,)
    if dry_run:
        return True, path
    ok, err = send_image(cfg, path)
    # ★ 只留最近 8 张（别把云盘塞满 ✓）
    try:
        fs = sorted([os.path.join(SAVE_DIR, f) for f in os.listdir(SAVE_DIR)
                     if f.endswith('.png')], key=os.path.getmtime)
        for f in fs[:-8]:
            os.remove(f)
    except Exception:
        pass
    return ok, (path if ok else err)


def start(cfg, world=None):
    """起一个后台线程：每 15 分钟出一张战报（配置里 enabled=false 就不起）"""
    q = (cfg or {}).get('battleReport') or {}
    if not q.get('enabled'):
        print('[rpt] 战报未开启（config.json 的 battleReport.enabled）')
        return None
    interval = int(q.get('intervalSec') or INTERVAL)

    def loop():
        # ★ 起点对齐：等到下一个"整 15 分钟"再开始 ✗ 不然时段是乱的 ✓
        while True:
            t = time.time()
            nxt = (int(t // interval) + 1) * interval
            wait = max(5, nxt - t)
            print('[rpt] 下一次战报：%s（%.0f 秒后）'
                  % (time.strftime('%H:%M', time.localtime(nxt)), wait))
            time.sleep(wait)
            try:
                ok, info = make_report(cfg)
                if info == 'skip':
                    print('[rpt] 这 15 分钟没人有数据 → 不发')
                elif ok:
                    print('[rpt] 已发战报：%s' % info)
                else:
                    print('[rpt] 发送失败：%s' % info)
            except Exception as e:
                print('[rpt] 出错：%r' % (e,))

    th = threading.Thread(target=loop, name='battleReport')
    th.daemon = True
    th.start()
    print('[rpt] 战报已启动：每 %d 秒（%d 分钟）一次' % (interval, interval // 60))
    return th
