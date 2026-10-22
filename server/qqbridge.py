# -*- coding: utf-8 -*-
"""QQ 群转发桥（round417）

用户要求（2026-10-18）：
  · 把游戏里的【滚动通知（ticker）】转发到 QQ 群 346049634
  · 再加一条【玩家上线】的转发

★ 为什么单独一个模块 + 单独一个线程：
  tick 线程的铁律是【不碰磁盘、更不碰网络】✗
  （`tools/check_mkt_threads.py` 会拦 disk/db ✗ 但网络更慢 ✗ 一卡就是整帧 ✓）
  → tick 只往队列里塞一句（纳秒级 ✓）✗ 真正的 HTTP 由本模块的后台线程慢慢发 ✓

★ 为什么用 HTTP 而不是 WS：
  qq-forwarder 是 Node 项目 ✗ 它同时暴露了
    POST http://<host>:8099/api/bridge/send  {token, group_id, message}
  （见 C:\\mc\\qq-forwarder\\main.mjs 的 /api/bridge/send ✓）
  而本项目服务端【只用标准库】✗ 自己写一个 WS 客户端太脆 ✓
  → urllib 一句话搞定 ✓ 没有第三方依赖 ✓

★ 速率：官方机器人有发送频率限制（qq-forwarder 那边 sendIntervalMs=1200）
  → 这里默认 1500ms 一条 ✓ 多了就排队 ✓ 排不下就丢最旧的 ✓
"""
import json
import queue
import re
import threading
import time
import urllib.request


class QqBridge(object):
    """把一句话排进队列 → 后台线程按节奏 POST 给 qq-forwarder"""

    MAXQ = 300          # 队列上限（防刷屏把内存吃满 ✗）
    STALE = 30.0        # 超过这么多秒的旧消息就不发了 ✓（群里看到半小时前的播报很怪）
    # ★ round417：每分钟最多发几条（团战 / 砍怪风暴时不把群刷爆 ✗ 也不会被官方限流带走 ✓）
    PER_MIN = 20

    def __init__(self, qcfg=None, skip_names=None):
        q = qcfg or {}
        self.on = bool(q.get('enabled'))
        self.ready = False      # ★ 线程真正起来了没（和 on 分开 ✓）
        self.url = str(q.get('url') or '')
        self.token = str(q.get('token') or '')
        self.group = str(q.get('group') or '')
        try:
            self.gap = max(0.3, float(q.get('minIntervalMs') or 1500) / 1000.0)
        except Exception:
            self.gap = 1.5
        self.kinds = q.get('kinds') or ['up', 'kill', 'mq', 'tier', 'join', 'sys']
        # ★ 测试账号的名字里带这些关键词 → 不往群里发 ✓
        #   （不然我自己跑冒烟测试会往真群里刷"IC123 上线了"✓ 用户会烦 ✓）
        self.skip = [str(x) for x in (skip_names or []) if x]
        self.q = queue.Queue(maxsize=self.MAXQ)
        self.sent = 0
        self.fails = 0
        self.drops = 0
        self.last_err = ''
        self.last_at = 0.0
        self.last_text = ''
        self._stop = False
        self._th = None
        self._sent_times = []      # ★ 最近 60 秒发了哪几条（算每分钟上限用 ✓）

    # ---------------------------------------------------------------- 对外
    def start(self):
        """起后台线程

        ★★ round418（用户："转发可以在管理页面开/关"）★★
          ★ 以前是"没开就不起线程" ✗
            → 管理页后来打开也没用（线程不存在 ✗）✓
          ★ 现在：只要 url/group/token 齐就把线程起来 ✗
            on 只管「发不发」✗ 不管「跑不跑」✓
          ★ 返回值改成：线程真正起来了才 True ✓（app.py 用它决定挂不挂 world.qq）"""
        self.ready = bool(self.url and self.group and self.token)
        if not self.ready:
            self.on = False
            return False
        if self._th is not None:
            return True
        self._th = threading.Thread(target=self._run, name='qqbridge', daemon=True)
        self._th.start()
        print('[qq] 转发桥已就绪 → %s · 群 %s · 每 %.1f 秒一条 · 当前%s'
              % (self.url, self.group, self.gap, '开启' if self.on else '关闭'))
        return True

    def stop(self):
        self._stop = True

    def post(self, text, kind='sys'):
        """★ 只入队 ✗ 绝不在这里发 HTTP ✓（tick 线程调用安全 ✓）"""
        if not self.on:
            return False
        try:
            text = str(text or '').strip()
        except Exception:
            return False
        if not text:
            return False
        if kind not in self.kinds:
            return False
        # ★ 测试账号过滤（名字里带关键词的整条不发 ✓）
        for sk in self.skip:
            if sk and sk in text:
                self.drops += 1
                return False
        # ★ 2026-10-22：自动测试脚本起的号形如 GHO12345 / LBL123 / PERM456
        #   （大写前缀 + 数字）→ 不发，免得往群里刷"XX 上线了"
        if re.match(r'^[A-Z]{2,8}\d{1,6} ', text):
            self.drops += 1
            return False
        if len(text) > 200:
            text = text[:199] + '…'
        item = (time.time(), text)
        try:
            self.q.put_nowait(item)
        except queue.Full:
            # 满了 → 丢最旧的（保证"最新的那条一定发得出去"✓）
            try:
                self.q.get_nowait()
            except Exception:
                pass
            self.drops += 1
            try:
                self.q.put_nowait(item)
            except Exception:
                return False
        return True

    def stats(self):
        return {'on': self.on, 'sent': self.sent, 'fails': self.fails,
                'drops': self.drops, 'queued': self.q.qsize(),
                'lastErr': self.last_err, 'group': self.group,
                'lastAt': int(self.last_at),
                # ★ 2026-10-22：把最后一条发出去的内容也报出来，
                #   以后群里没消息时一眼能看出"根本没发"还是"发了但格式不对"
                'lastText': self.last_text}

    # ---------------------------------------------------------------- 内部
    def _run(self):
        while not self._stop:
            try:
                ts, text = self.q.get(timeout=1.0)
            except queue.Empty:
                continue
            if time.time() - ts > self.STALE:
                self.drops += 1
                continue
            # ★ 每分钟上限
            _now = time.time()
            self._sent_times = [x for x in self._sent_times if _now - x < 60.0]
            if len(self._sent_times) >= self.PER_MIN:
                self.drops += 1
                continue
            self._send(text)
            # ★ 节奏控制（官方机器人有频率限制 ✗ 发太快会被丢 ✓）
            time.sleep(self.gap)

    def _send(self, text):
        body = json.dumps({'token': self.token,
                           'group_id': self.group,
                           'message': text}, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(self.url, data=body,
                                     headers={'Content-Type': 'application/json; charset=utf-8'})
        try:
            with urllib.request.urlopen(req, timeout=6) as r:
                r.read(512)
            self.sent += 1
            self.last_at = time.time()
            self.last_text = text          # ★ 最后一条成功发出的内容（排障用）
            self._sent_times.append(self.last_at)
        except Exception as e:
            self.fails += 1
            self.last_err = str(e)[:120]
            # ★ 只在前几次和每 50 次打一行 ✗ 不然断网时日志刷爆 ✓
            if self.fails <= 3 or self.fails % 50 == 0:
                print('[qq] 发送失败（第 %d 次）：%r' % (self.fails, e))
