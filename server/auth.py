# -*- coding: utf-8 -*-
"""账号系统：注册 / 登录 / token 校验 / 退出

设计要点（对应 docs/方案.md §15.1 P0-3）：
  · 密码 PBKDF2-SHA256 + 每账号独立盐 → **绝不存明文**
  · token 落库（tokens 表），走 X-Token 头
  · **一个账号同时只有一个有效 token** —— 新登录踢掉旧的
    （否则同一角色能在两台设备同时在线，等于可以刷）
  · 登录失败有退避：同一名字连续失败多次要等一会儿（挡暴力破解）

对外暴露的都是 (ok, data_or_error) 形式，HTTP 层只负责翻译成状态码。
"""

import hashlib
import os
import re
import secrets
import threading
import time

import db as dbmod

# ---------------------------------------------------------------- 参数

PBKDF2_ROUNDS = 200_000          # Python 的 pbkdf2_hmac 是 C 实现，约 60~80ms，可接受
TOKEN_TTL_MS = 30 * 24 * 3600 * 1000    # token 有效期 30 天
NAME_RE = re.compile(r'^[0-9A-Za-z_\u4e00-\u9fa5-]{2,16}$')
PW_MIN, PW_MAX = 6, 64

MAX_FAIL = 5                     # 连续失败几次开始退避
FAIL_WINDOW = 60.0               # 退避观察窗口（秒）
FAIL_COOLDOWN = 30.0             # 退避时长（秒）

# 首次进游戏送几点天赋，让新手一进来就能加点（炼气 1 级）
START_TALENT = 3
SKILL_PAGES = 4                  # 方案 §6.1：初始 4 页
PAGE_ACTIVES = 4                 # 每页 4 主动
PAGE_PASSIVES = 5                # 每页 5 被动

_fail_lock = threading.Lock()
_fails = {}                      # name(lower) -> [失败时间戳...]


# ---------------------------------------------------------------- 内部

def _hash_pw(password, salt_hex):
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'),
                             bytes.fromhex(salt_hex), PBKDF2_ROUNDS)
    return dk.hex()


def _new_salt():
    return os.urandom(16).hex()


def _new_token():
    return secrets.token_urlsafe(32)


def _norm_name(name):
    return (name or '').strip()


def _check_name(name):
    if not name:
        return '请填写游戏名'
    if not NAME_RE.match(name):
        return '游戏名只能 2~16 个中英文、数字、下划线或短横线'
    return None


def _check_pw(pw):
    if not pw:
        return '请填写密码'
    if len(pw) < PW_MIN:
        return '密码至少 %d 位' % PW_MIN
    if len(pw) > PW_MAX:
        return '密码最多 %d 位' % PW_MAX
    return None


def _fail_state(name):
    """返回还差多少秒才能再试；0 = 可以试"""
    k = name.lower()
    now = time.time()
    with _fail_lock:
        arr = [t for t in _fails.get(k, []) if now - t < FAIL_WINDOW]
        _fails[k] = arr
        if len(arr) >= MAX_FAIL:
            wait = FAIL_COOLDOWN - (now - arr[-1])
            if wait > 0:
                return wait
        return 0


def _fail_add(name):
    k = name.lower()
    now = time.time()
    with _fail_lock:
        arr = [t for t in _fails.get(k, []) if now - t < FAIL_WINDOW]
        arr.append(now)
        _fails[k] = arr


def _fail_clear(name):
    with _fail_lock:
        _fails.pop(name.lower(), None)


def _issue_token(c, account_id):
    """发新 token。★ 先把该账号的旧 token 全删掉（单点在线）"""
    c.execute('DELETE FROM tokens WHERE account_id=?', (account_id,))
    tk = _new_token()
    now = dbmod.now_ms()
    c.execute('INSERT INTO tokens(token, account_id, created_at, last_seen) VALUES(?,?,?,?)',
              (tk, account_id, now, now))
    return tk


def _new_role(c, account_id, name):
    """建角色 + 4 个空技能页"""
    now = dbmod.now_ms()
    cur = c.execute(
        'INSERT INTO roles(account_id, name, level, exp, hp, qi, x, z, yaw,'
        ' talent_free, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        (account_id, name, 1, 0, 0, 0, 0.0, 0.0, 0.0, START_TALENT, now, now))
    role_id = cur.lastrowid
    for i in range(SKILL_PAGES):
        c.execute('INSERT INTO skill_pages(role_id, page_index, actives, passives)'
                  ' VALUES(?,?,?,?)', (role_id, i, '[]', '[]'))
    return role_id


def role_public(row):
    """把 roles 行转成可以发给客户端的样子（不含敏感字段）"""
    if row is None:
        return None
    return {
        'id': row['id'],
        'name': row['name'],
        'level': row['level'],
        'exp': row['exp'],
        'hp': row['hp'],
        'qi': row['qi'],
        'x': row['x'],
        'z': row['z'],
        'yaw': row['yaw'],
        'talentFree': row['talent_free'],
        'playedAt': row['updated_at'],
    }


# ---------------------------------------------------------------- 对外接口

def register(cfg, name, password):
    """注册 → (True, {'token':…, 'role':…}) / (False, '错误说明')"""
    name = _norm_name(name)
    err = _check_name(name) or _check_pw(password)
    if err:
        return False, err

    salt = _new_salt()
    ph = _hash_pw(password, salt)
    now = dbmod.now_ms()
    try:
        with dbmod.db(cfg) as c:
            if c.execute('SELECT id FROM accounts WHERE name=? COLLATE NOCASE',
                         (name,)).fetchone():
                return False, '这个游戏名已经被用了'
            cur = c.execute(
                'INSERT INTO accounts(name, pass_hash, salt, created_at, last_login)'
                ' VALUES(?,?,?,?,?)', (name, ph, salt, now, None))
            acc_id = cur.lastrowid
            _new_role(c, acc_id, name)
            tk = _issue_token(c, acc_id)
            row = c.execute('SELECT * FROM roles WHERE account_id=?', (acc_id,)).fetchone()
            return True, {'token': tk, 'role': role_public(row), 'fresh': True}
    except Exception as e:
        return False, '注册失败：%s' % e


def login(cfg, name, password):
    """登录 → (True, {'token':…, 'role':…}) / (False, '错误说明')"""
    name = _norm_name(name)
    if not name or not password:
        return False, '请填写游戏名和密码'

    wait = _fail_state(name)
    if wait > 0:
        return False, '失败次数太多，请 %.0f 秒后再试' % wait

    with dbmod.db(cfg) as c:
        row = c.execute('SELECT * FROM accounts WHERE name=? COLLATE NOCASE',
                        (name,)).fetchone()
        # ★ 账号不存在 / 密码错，返回同一句话（不泄露"这个名字存在"）
        if not row or row['banned']:
            _fail_add(name)
            return False, '游戏名或密码不对'
        if not secrets.compare_digest(_hash_pw(password, row['salt']), row['pass_hash']):
            _fail_add(name)
            return False, '游戏名或密码不对'

        _fail_clear(name)
        now = dbmod.now_ms()
        c.execute('UPDATE accounts SET last_login=? WHERE id=?', (now, row['id']))
        tk = _issue_token(c, row['id'])
        role = c.execute('SELECT * FROM roles WHERE account_id=?', (row['id'],)).fetchone()
        if role is None:                       # 老账号没有角色就补一个
            _new_role(c, row['id'], row['name'])
            role = c.execute('SELECT * FROM roles WHERE account_id=?', (row['id'],)).fetchone()
        return True, {'token': tk, 'role': role_public(role), 'fresh': False}


def check_token(cfg, token):
    """校验 token → (True, {'account':…, 'role':…}) / (False, '错误说明')"""
    if not token:
        return False, '缺少登录凭证'
    now = dbmod.now_ms()
    with dbmod.db(cfg) as c:
        t = c.execute('SELECT * FROM tokens WHERE token=?', (token,)).fetchone()
        if not t:
            return False, '登录已失效，请重新登录'
        if t['created_at'] and now - t['created_at'] > TOKEN_TTL_MS:
            c.execute('DELETE FROM tokens WHERE token=?', (token,))
            return False, '登录已过期，请重新登录'
        c.execute('UPDATE tokens SET last_seen=? WHERE token=?', (now, token))
        acc = c.execute('SELECT * FROM accounts WHERE id=?', (t['account_id'],)).fetchone()
        if not acc or acc['banned']:
            return False, '账号不可用'
        role = c.execute('SELECT * FROM roles WHERE account_id=?', (acc['id'],)).fetchone()
        return True, {'account': acc, 'role': role}


def logout(cfg, token):
    """退出：删掉这个 token"""
    if not token:
        return False, '缺少登录凭证'
    with dbmod.db(cfg) as c:
        c.execute('DELETE FROM tokens WHERE token=?', (token,))
    return True, {'ok': True}


def kick_account(cfg, account_id):
    """把某个账号的 token 全清掉（改密码 / 封号 / 强制下线用）"""
    with dbmod.db(cfg) as c:
        c.execute('DELETE FROM tokens WHERE account_id=?', (account_id,))
    return True, {'ok': True}
