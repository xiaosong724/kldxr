# -*- coding: utf-8 -*-
"""最小 WebSocket 服务端（RFC 6455）—— 只用标准库，零依赖

为什么手写：方案 §13.2 —— 50 人长连接必须换掉 HTTP 轮询，而小游戏只认 WebSocket；
项目又约定 Python 标准库零依赖，所以自己实现握手 + 帧编解码。

实现范围（够游戏用）：
  ✓ 握手（Sec-WebSocket-Accept）
  ✓ 文本 / 二进制帧
  ✓ 分片帧（continuation）
  ✓ ping / pong / close
  ✓ ★ 客户端掩码校验 —— RFC 要求客户端帧必须掩码，不校验就是留了个洞
  ✓ 半包 / 粘包（readexactly 天然处理）
  ✗ 不做扩展协商（RSV 位一律拒绝）；✗ 不做压缩

性能注意：
  · 解掩码走 int XOR（C 速度），不用逐字节生成器 —— 30Hz × 50 人差别很大
  · 所有收包都有大小上限，别让人一个包把内存打爆
"""

import asyncio
import base64
import hashlib
import struct

WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

OP_CONT = 0x0
OP_TEXT = 0x1
OP_BIN = 0x2
OP_CLOSE = 0x8
OP_PING = 0x9
OP_PONG = 0xA

MAX_MSG = 1 << 20        # 单条消息上限 1MB（游戏消息都在几 KB）
MAX_HTTP = 16 << 10      # 握手请求头上限


class WSProtoError(Exception):
    def __init__(self, code, msg):
        super().__init__('%d %s' % (code, msg))
        self.code = code
        self.msg = msg


# ============================================================ 帧编解码

def make_frame(opcode, payload=b'', fin=True):
    """服务端发出的帧：**不加掩码**（RFC：服务端不许掩码）"""
    n = len(payload)
    h = bytearray()
    h.append((0x80 if fin else 0) | opcode)
    if n < 126:
        h.append(n)
    elif n < 65536:
        h.append(126)
        h += struct.pack('>H', n)
    else:
        h.append(127)
        h += struct.pack('>Q', n)
    return bytes(h) + payload


def _unmask(data, key):
    """XOR 解掩码。走 int 运算（C 速度），逐字节生成器在这里会拖慢整个 tick"""
    n = len(data)
    if n == 0:
        return data
    k = key * ((n >> 2) + 1)
    x = int.from_bytes(data, 'big') ^ int.from_bytes(k[:n], 'big')
    return x.to_bytes(n, 'big')


async def read_frame(reader, max_size=MAX_MSG):
    """读一帧 → (fin, opcode, payload)。

    客户端必须掩码；不掩码按协议错处理（1002）。
    """
    b1, b2 = await reader.readexactly(2)
    fin = bool(b1 & 0x80)
    rsv = b1 & 0x70
    opcode = b1 & 0x0F
    masked = bool(b2 & 0x80)
    ln = b2 & 0x7F

    if rsv:
        raise WSProtoError(1002, 'RSV 位非 0（不支持扩展）')
    if ln == 126:
        ln = struct.unpack('>H', await reader.readexactly(2))[0]
    elif ln == 127:
        ln = struct.unpack('>Q', await reader.readexactly(8))[0]

    is_ctrl = opcode >= 0x8
    if is_ctrl:
        if not fin:
            raise WSProtoError(1002, '控制帧不能分片')
        if ln > 125:
            raise WSProtoError(1002, '控制帧载荷超过 125 字节')

    if ln > max_size:
        raise WSProtoError(1009, '消息太大（%d > %d）' % (ln, max_size))

    key = await reader.readexactly(4) if masked else None
    data = await reader.readexactly(ln) if ln else b''
    if not masked and opcode != OP_CLOSE:
        # RFC 6455 §5.1：客户端发给服务端的帧必须掩码
        raise WSProtoError(1002, '客户端帧未掩码')
    if key:
        data = _unmask(data, key)
    return fin, opcode, data


def accept_key(client_key):
    return base64.b64encode(
        hashlib.sha1((client_key + WS_GUID).encode('ascii')).digest()).decode('ascii')


# ============================================================ 连接

class WSConn(object):
    """一条 WebSocket 连接。

    ★ 发送走「每连接一个队列 + 一个写协程」：
      发送方只 push（同步、不 await），真正写 socket 由 pump 协程负责。
      队列满了丢**最旧**的帧 —— 实时游戏里过时的位置帧没有意义，
      绝不能因为一个慢客户端把整个 tick 拖住（方案 §13.5）。

    业务层用：conn.push_text(s) （不用 await）/ await conn.recv() / await conn.close()
    """

    __slots__ = ('reader', 'writer', 'peer', 'path', 'headers', 'cid',
                 'closed', 'close_code', 'close_reason', 'user',
                 '_outq', '_pump_task', 'dropped')

    def __init__(self, reader, writer, path, headers, cid, outq_size=64):
        self.reader = reader
        self.writer = writer
        self.path = path
        self.headers = headers
        self.cid = cid
        self.closed = False
        self.close_code = None
        self.close_reason = ''
        self.user = None                       # 认证通过后挂账号/角色
        self.dropped = 0                       # 因队列满丢掉的帧数（排查卡顿用）
        self._outq = asyncio.Queue(maxsize=outq_size)
        self._pump_task = None
        try:
            p = writer.get_extra_info('peername')
            self.peer = '%s:%s' % (p[0], p[1]) if p else '?'
        except Exception:
            self.peer = '?'

    # ---------- 发（同步，不 await） ----------

    def _push_raw(self, frame):
        try:
            self._outq.put_nowait(frame)
            return True
        except asyncio.QueueFull:
            # 丢最旧的，给最新的腾位置
            try:
                self._outq.get_nowait()
                self.dropped += 1
            except Exception:
                pass
            try:
                self._outq.put_nowait(frame)
                return True
            except Exception:
                return False

    def push(self, opcode, payload=b''):
        if self.closed:
            return False
        return self._push_raw(make_frame(opcode, payload))

    def push_text(self, s):
        return self.push(OP_TEXT, s.encode('utf-8') if isinstance(s, str) else s)

    def push_bytes(self, b):
        return self.push(OP_BIN, b)

    async def send_text(self, s):
        """兼容 await 写法（内部还是队列，只是多让出一次调度）"""
        ok = self.push_text(s)
        await asyncio.sleep(0)
        return ok

    async def send_bytes(self, b):
        ok = self.push_bytes(b)
        await asyncio.sleep(0)
        return ok

    async def ping(self, data=b''):
        return self.push(OP_PING, data)

    async def pong(self, data=b''):
        return self.push(OP_PONG, data)

    # ---------- 写协程 ----------

    def start_pump(self):
        if self._pump_task is None:
            self._pump_task = asyncio.create_task(self._pump())

    async def _pump(self):
        try:
            while True:
                frame = await self._outq.get()
                if frame is None:              # 收尾信号
                    break
                self.writer.write(frame)
                await self.writer.drain()
        except (ConnectionResetError, BrokenPipeError, asyncio.CancelledError):
            pass
        except Exception:
            pass
        finally:
            self.closed = True
            try:
                self.writer.close()
            except Exception:
                pass

    # ---------- 收 ----------

    async def recv(self, max_size=MAX_MSG):
        """读一条完整消息（自动拼分片、自动回 ping/pong）。

        返回 str（文本）/ bytes（二进制）/ None（连接已关）。
        协议错误抛 WSProtoError，由服务器统一关闭。
        """
        chunks = []
        total = 0
        want = None
        while True:
            fin, opcode, data = await read_frame(self.reader, max_size)
            total += len(data)
            if total > max_size:
                raise WSProtoError(1009, '消息超过上限')

            if opcode == OP_CLOSE:
                if len(data) >= 2:
                    self.close_code = struct.unpack('>H', data[:2])[0]
                    self.close_reason = data[2:].decode('utf-8', 'replace')
                else:
                    self.close_code = 1005
                self.closed = True
                self._push_raw(make_frame(OP_CLOSE, data[:2] if len(data) >= 2 else b''))
                self._push_raw(None)           # 让 pump 发完就收尾
                return None
            if opcode == OP_PING:
                self.pong(data)
                continue
            if opcode == OP_PONG:
                continue

            if opcode in (OP_TEXT, OP_BIN):
                if want is not None:
                    raise WSProtoError(1002, '上一条消息还没拼完')
                want = opcode
                chunks = [data]
            elif opcode == OP_CONT:
                if want is None:
                    raise WSProtoError(1002, '没有起始帧的续帧')
                chunks.append(data)
            else:
                raise WSProtoError(1002, '未知 opcode %d' % opcode)

            if fin:
                blob = b''.join(chunks)
                return blob.decode('utf-8', 'replace') if want == OP_TEXT else blob

    # ---------- 关 ----------

    async def close(self, code=1000, reason=''):
        """正常关闭握手：把 close 帧压进队列 → 等 pump 发完 → 关 socket"""
        if self.closed and self._pump_task is None:
            try:
                self.writer.close()
            except Exception:
                pass
            return
        self.closed = True
        try:
            payload = struct.pack('>H', code) + reason.encode('utf-8')[:120]
            self._push_raw(make_frame(OP_CLOSE, payload))
            self._push_raw(None)
        except Exception:
            pass
        if self._pump_task is not None:
            try:
                await asyncio.wait_for(asyncio.shield(self._pump_task), timeout=1.0)
            except Exception:
                pass
        try:
            self.writer.close()
        except Exception:
            pass


# ============================================================ 服务器

class WSServer(object):
    """asyncio WebSocket 服务器。

    on_open(conn)            刚握手成功
    on_message(conn, text)   收到一条文本消息（业务协议都走 JSON 文本）
    on_close(conn, exc)      连接结束（exc 是异常或 None）

    三个回调都可以是协程函数；服务器会自动 await。
    """

    def __init__(self, host, port, on_open=None, on_message=None, on_close=None,
                 path='/ws', max_size=MAX_MSG):
        self.host = host
        self.port = port
        self.path = path
        self.max_size = max_size
        self.on_open = on_open
        self.on_message = on_message
        self.on_close = on_close
        self.conns = {}                # cid -> WSConn
        self._next_cid = 1
        self._server = None

    async def handle(self, reader, writer):
        cid = self._next_cid
        self._next_cid += 1
        conn = None
        try:
            # ---------- 握手 ----------
            raw = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'),
                                         timeout=10.0)
            if len(raw) > MAX_HTTP:
                raise WSProtoError(1009, '握手请求头太大')
            lines = raw.decode('latin-1').split('\r\n')
            method, path, _ver = (lines[0].split(' ') + ['', '', ''])[:3]
            headers = {}
            for ln in lines[1:]:
                if ':' in ln:
                    k, v = ln.split(':', 1)
                    headers[k.strip().lower()] = v.strip()

            up = headers.get('upgrade', '').lower()
            key = headers.get('sec-websocket-key')
            if method != 'GET' or up != 'websocket' or not key:
                writer.write(b'HTTP/1.1 400 Bad Request\r\n'
                             b'Content-Length: 0\r\nConnection: close\r\n\r\n')
                await writer.drain()
                return
            if self.path and not path.startswith(self.path):
                writer.write(b'HTTP/1.1 404 Not Found\r\n'
                             b'Content-Length: 0\r\nConnection: close\r\n\r\n')
                await writer.drain()
                return

            writer.write((
                'HTTP/1.1 101 Switching Protocols\r\n'
                'Upgrade: websocket\r\n'
                'Connection: Upgrade\r\n'
                'Sec-WebSocket-Accept: %s\r\n'
                '\r\n' % accept_key(key)).encode('ascii'))
            await writer.drain()

            try:
                sock = writer.get_extra_info('socket')
                import socket as _s
                sock.setsockopt(_s.IPPROTO_TCP, _s.TCP_NODELAY, 1)   # ★ 实时包必开
            except Exception:
                pass

            # ---------- 建连接 ----------
            conn = WSConn(reader, writer, path, headers, cid)
            conn.start_pump()                  # ★ 发送协程：业务层 push 之后就不用管了
            self.conns[cid] = conn
            if self.on_open:
                r = self.on_open(conn)
                if asyncio.iscoroutine(r):
                    await r

            # ---------- 收消息循环 ----------
            while not conn.closed:
                text = await conn.recv(self.max_size)
                if text is None:              # 对端正常关闭
                    break
                if self.on_message:
                    r = self.on_message(conn, text)
                    if asyncio.iscoroutine(r):
                        await r

        except asyncio.IncompleteReadError:
            pass                              # 对端直接断开，正常现象
        except asyncio.TimeoutError:
            pass
        except WSProtoError as e:
            if conn:
                await conn.close(e.code, e.msg)
        except (ConnectionResetError, BrokenPipeError, asyncio.CancelledError):
            pass
        except Exception as e:
            print('  [ws] 连接 %s 异常：%r' % (cid, e))
        finally:
            if conn:
                if not conn.closed:
                    try:
                        conn.writer.close()
                    except Exception:
                        pass
                self.conns.pop(cid, None)
                if self.on_close:
                    try:
                        r = self.on_close(conn, None)
                        if asyncio.iscoroutine(r):
                            await r
                    except Exception:
                        pass

    async def start(self):
        self._server = await asyncio.start_server(self.handle, self.host, self.port)
        return self._server

    async def broadcast(self, text, skip=None):
        """全服广播。★ 同步 push，不 await —— 慢客户端影响不到别人"""
        n = 0
        for c in list(self.conns.values()):
            if c is not skip and c.push_text(text):
                n += 1
        return n

    def close_all(self, code=1001, reason='服务端关闭'):
        for c in list(self.conns.values()):
            c.closed = True
            try:
                c.writer.close()
            except Exception:
                pass
        self.conns.clear()
