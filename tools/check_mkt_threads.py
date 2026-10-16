# -*- coding: utf-8 -*-
"""round304b check #3: the exchange must respect the thread discipline.

The rule (docs v3 section 9, and the project's three iron laws):
    the TICK thread never touches the disk - the shelf lives in memory only.
    Every db read/write for the exchange happens on the NETWORK thread (login)
    or the SAVER thread (the SQL below).

This is checked with ast, not by eye: it walks every function in server/world.py whose
name starts with _mkt / _save_mkt and reports which ones contain direct db access.
Reading the source is not enough here - one stray dbmod.db() inside a tick helper is
exactly the kind of bug that only shows up as a stutter under load.

Run:  python tools/check_mkt_threads.py
"""
import ast
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORLD = os.path.join(ROOT, 'server', 'world.py')
NET = os.path.join(ROOT, 'server', 'net.py')

# 允许写库的函数（★ 它们只在 saver 线程跑 ✗ 见各自注释 ✓）
# ★ 名字长得像但归属完全不同（自测第一版就栽在这 ✗）：
#     _save_mkt          ← 分支入口 ✓ saver
#     _mkt_save_list     ← 真写库 ✓ saver（★ 也以 _mkt 开头 ✗ 会被 tick 那拨误抓 ✓）
#     _mkt_*             ← tick 侧 ✗ 一次都不许碰库
SAVER_OK = {'_save_mkt', '_mkt_save_list', '_mkt_save_buy', '_mkt_save_back'}
# ★ 什么才算"直接碰库"（★ 这条口径很重要 ✗ 写粗了全是假警报 ✓）：
#     dbmod.db(cfg)        → 开连接 ✗ 真碰库 ✓
#     x.execute(...)       → 真碰库 ✓
#     .commit()/.rollback()→ 真碰库 ✓
#   ★ 不算的：import db as dbmod（只是导入 ✓）
#             dbmod.now_ms()（纯时间函数 ✗ 一次 IO 都没有 ✓ 自测第一版就误报了它 ✓）
#             self.post_save(...)（只是入队 ✗ 写盘是 saver 的事 ✓）

fails = []


def ok(cond, msg):
    print(('  PASS  ' if cond else '  FAIL  ') + msg)
    if not cond:
        fails.append(msg)


PURE_DBMOD = {'now_ms'}          # ★ 只借了 dbmod 里的纯函数 ✗ 不算碰库 ✓


def _is_dbmod_attr(node):
    return (isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id in ('dbmod', 'db'))


def is_db_node(node):
    """这个节点是不是在"直接碰数据库"（★ 只看调用 ✗ 不看名字 ✓）

    ★ 为什么不能见到 'dbmod' 就算：`import db as dbmod` 和 `dbmod.now_ms()`
      都是完全无害的 ✗ 见了就报会让这个脚本变成狼来了 ✓（自测第一版就是这样 ✓）
    """
    if isinstance(node, ast.Call):
        f = node.func
        if isinstance(f, ast.Attribute):
            if f.attr in ('execute', 'executemany', 'commit', 'rollback', 'connect',
                          'cursor'):
                return True
            if f.attr == 'db' and isinstance(f.value, ast.Name):
                return True                       # dbmod.db(cfg) / db.db(cfg)
            if f.attr in PURE_DBMOD and _is_dbmod_attr(f):
                return False                      # dbmod.now_ms() —— 纯函数 ✓
        return any(is_db_node(a) for a in node.args)
    return False


def scan(path, want_prefix):
    src = open(path, encoding='utf-8').read()
    tree = ast.parse(src, path)
    out = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef):
            continue
        if not node.name.startswith(want_prefix):
            continue
        hits = set()
        for sub in ast.walk(node):
            if isinstance(sub, ast.Call):
                fn = sub.func
                nm = fn.attr if isinstance(fn, ast.Attribute) else (
                    fn.id if isinstance(fn, ast.Name) else '')
                if nm == 'post_save':
                    continue          # ★ 只是入队 ✗ 写盘是 saver 的事 ✓
            if is_db_node(sub):
                hits.add(getattr(sub, 'attr', None)
                         or getattr(getattr(sub, 'func', None), 'attr', None)
                         or 'db')
        out[node.name] = sorted(x for x in hits if x)
    return out


print('== 1. tick 侧（world.py 里的 _mkt_*）不许直接碰库 ==')
#   ★ 顺序很重要：'_save_mkt_list' 也 startswith('_mkt') 吗？不 ✓ 但 '_save_mkt'
#     和 '_mkt_*' 是两拨人 ✗ 先扫长的 ✗ 再把它从 tick 那拨里排除 ✓
tick_fns = {k: v for k, v in scan(WORLD, '_mkt').items() if k not in SAVER_OK}
ok(bool(tick_fns), 'found the tick-side helpers (%d of them)' % len(tick_fns))
bad = {k: v for k, v in tick_fns.items() if v}
ok(not bad, 'no tick-side helper touches the db directly%s'
   % ('' if not bad else ' -> %r' % (bad,)))

print('== 2. saver 侧才是唯一写库的地方 ==')
save_fns = {k: v for k, v in scan(WORLD, '_mkt_save').items()}
save_fns['_save_mkt'] = scan(WORLD, '_save_mkt').get('_save_mkt', [])
ok(set(save_fns) == SAVER_OK, 'the saver helpers are exactly %s (got %s)'
   % (sorted(SAVER_OK), sorted(save_fns)))
with_sql = sorted(k for k, v in save_fns.items() if v)
# ★ _save_mkt 本身【不写 SQL】✗ 它只是个分发器（看 params[0] 决定叫谁 ✓）
#   所以这里要的是"三个真写的必须有 SQL ✗ 分发器允许没有"✓
ok(set(with_sql) == SAVER_OK - {'_save_mkt'},
   'the three real writers do SQL (%s)' % with_sql)
ok(not save_fns.get('_save_mkt'),
   '_save_mkt itself only dispatches (no SQL of its own)')

print('== 3. 网络线程（net.py 登录装载）读库是允许的 ==')
net_src = open(NET, encoding='utf-8').read()
ok('market_rows_of' in net_src, 'net.py loads the shelf at login')
ok("role['bag'] = authmod.bag_of" in net_src.replace('"', "'"),
   'net.py loads the bag snapshot at login (the listing check needs item ids)')
ok('role[\'mktRows\']' in net_src, 'the shelf goes out with the role (tick takes it in)')

print('== 4. tick 侧的浏览【一次都不查库】==')
browse_body = ast.get_source_segment(open(WORLD, encoding='utf-8').read(),
                                     next(n for n in ast.walk(ast.parse(
                                         open(WORLD, encoding='utf-8').read()))
                                         if isinstance(n, ast.FunctionDef)
                                         and n.name == '_mkt_browse'))
ok(browse_body is not None and 'execute' not in browse_body
   and 'dbmod' not in browse_body, '_mkt_browse has no db call at all')
ok('mkmod.browse' in (browse_body or ''), '_mkt_browse filters/sorts in memory (market.py)')

print('== 5. market.py 是纯计算（★ 连 import sqlite3 都不该有 ✓）==')
msrc = open(os.path.join(ROOT, 'server', 'market.py'), encoding='utf-8').read()
ok('sqlite' not in msrc and 'import db' not in msrc,
   'market.py never imports the db layer (pure rules)')
ok('def browse' in msrc and 'def fee_of' in msrc and 'def tax_of' in msrc,
   'the rules live there (browse / fee_of / tax_of)')

print('')
print('FAILED: %d' % len(fails))
for f in fails:
    print('  - %s' % f)
sys.exit(1 if fails else 0)
