# -*- coding: utf-8 -*-
"""后台管理鉴权（第 48 轮）

★★ 为什么必须有这个 ★★
   之前有几样东西是【直接暴露给玩家】的：
     · WS 意图 spawn      —— 任何玩家都能自己刷一堆怪 ✗
     · WS 意图 giveweapon —— 任何玩家都能给自己发武器 ✗
     · /api/health        —— 把世界内部状态（在线数、tick 耗时、账号数）也吐出来了 ✗
   现在：这些能力全部搬到【管理页】（/admin），由这里鉴权 ✓
   玩家端那两个意图默认【拒绝】（配置里 allow_player_debug=false ✓）

设计（够用就好，不引第三方）：
   · 密码放 config.json 的 admin_password ✓（不落库、不进版本库的示例里用占位符 ✓）
   · 登录成功发一个随机 token，存在内存里（重启即失效 ✓ 这正合适）
   · token 有有效期（默认 12 小时 ✓）—— 过期要重新登录
   · ★ 登录失败要限速（防在线爆破 ✓）—— 和账号登录用同一套思路（简单计数 ✓）
"""

import secrets
import threading
import time

# token -> 到期时间戳
_sessions = {}
_lock = threading.Lock()
TTL = 12 * 3600.0            # 会话有效期：12 小时

# 登录限速：ip -> [失败时间戳...]
_fails = {}
_fail_lock = threading.Lock()
FAIL_WINDOW = 300.0          # 5 分钟内
FAIL_MAX = 8                 # 失败 8 次就锁一会儿


def _fail_state(ip):
    now = time.time()
    with _fail_lock:
        arr = [t for t in _fails.get(ip, []) if now - t < FAIL_WINDOW]
        _fails[ip] = arr
        return len(arr)


def _fail_add(ip):
    with _fail_lock:
        _fails.setdefault(ip, []).append(time.time())


def _fail_clear(ip):
    with _fail_lock:
        _fails.pop(ip, None)


def enabled(cfg):
    """配了管理密码才算启用（没配就是没开这个功能 ✓）"""
    return bool((cfg.get('admin_password') or '').strip())


def login(cfg, password, ip='-'):
    """管理员登录 → (True, token) / (False, 原因)"""
    if not enabled(cfg):
        return False, '没有配置管理密码（server/config.json 里的 admin_password）'
    if _fail_state(ip) >= FAIL_MAX:
        return False, '试得太多了，过几分钟再来'
    want = (cfg.get('admin_password') or '').strip()
    got = (password or '').strip()
    # ★ 用 compare_digest 做恒定时间比较（别让"逐字符试"从耗时上猜出来 ✓）
    if not got or not secrets.compare_digest(want, got):
        _fail_add(ip)
        return False, '管理密码不对'
    _fail_clear(ip)
    tk = secrets.token_urlsafe(32)
    with _lock:
        _sessions[tk] = time.time() + TTL
    return True, tk


def check(cfg, token):
    """校验管理 token（顺便清掉过期的 ✓）"""
    if not token:
        return False
    now = time.time()
    with _lock:
        exp = _sessions.get(token)
        if exp is None:
            return False
        if exp < now:
            _sessions.pop(token, None)
            return False
        return True


def logout(token):
    with _lock:
        _sessions.pop(token, None)


def session_count():
    with _lock:
        return len(_sessions)
