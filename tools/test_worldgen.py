# -*- coding: utf-8 -*-
"""离线单测：服务端那份世界生成（server/worldgen.py）

为什么要有：僵尸的移动改由【服务器】判定建筑碰撞（第 41 轮）——
  建筑是确定性生成的，服务端照着算一遍就能挡住僵尸 ✓
  但这份必须和客户端 game.js 的 buildChunk() **一模一样**，差一点就错位 ✗

跑法：
  ① node tools\\dump_props.js        （把客户端真代码算的碰撞盒导出）
  ② python tools\\test_worldgen.py  （和服务端那份逐块对比 + 自检）
★ 第 ① 步没跑过也能跑，只是会跳过"对比"那部分并提示你 ✓
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server'))
import worldgen as wg          # noqa: E402

fails = []


def ok(cond, msg, got=None):
    if cond:
        print('  PASS  ' + msg)
    else:
        fails.append(msg)
        print('  FAIL  ' + msg + ('   got=%r' % (got,)))


print('== ① 自检：格子哈希与生成结果 ==')
# 同一个格子必须永远同一个结果 ✓（这就是"谁算都一样"的根）
ok(wg.cell_hash(0, 0) == wg.cell_hash(0, 0), '哈希是确定性的 ✓')
ok(wg.cell_hash(1234, -567) == wg.cell_hash(1234, -567), '负坐标也确定 ✓')
ok(0 <= wg.cell_hash(1234, -567) < 1000, 'q 落在 0..999（实测 %d）' % wg.cell_hash(1234, -567))
# 换一片格子，q 得不一样（不然全世界一个样 ✗）
qs = set(wg.cell_hash(i, 7) for i in range(60))
ok(len(qs) > 40, '不同格子的 q 分布开了（60 个格子出现 %d 个不同值）' % len(qs), len(qs))

CI, CJ = 20, 20   # 小镇 (0,0) 周围不生成随机物件，换一块荒野做生成自检
s00 = wg.build_chunk(CI, CJ)
ok(len(s00) > 0, '第 (%d,%d) 块算出了碰撞盒（%d 个）' % (CI, CJ, len(s00)), len(s00))
W = wg.PROP_CHUNK * wg.TS
bad = [it for it in s00 if not (CI * W <= it[0] < (CI + 1) * W and CJ * W <= it[1] < (CJ + 1) * W)]
ok(not bad, '★ 本块的碰撞盒都落在本块范围内（越界 %d 个）' % len(bad), bad[:2])
ok(all(it[2] > 0 and it[3] > 0 for it in s00), '半宽半深都是正数 ✓')

print('')
print('== ② 碰撞判定 blocked() ==')
it = s00[0]
ok(wg.blocked(it[0], it[1], 0.05, 0.05), '★ 站在建筑中心 → 判定为撞上 ✓', it)
ok(not wg.blocked(it[0], it[1] + 40.0, 0.05, 0.05), '离建筑 40 米 → 不撞 ✓')
# 空地块：找一块没有任何碰撞盒的地方
free = None
for gx in range(0, 400):
    for gz in range(0, 400):
        x, z = gx * wg.TS, gz * wg.TS
        if not wg.blocked(x, z, 0.25, 0.25):
            free = (x, z)
            break
    if free:
        break
ok(free is not None, '★ 能找到一个没有建筑的落脚点（不然僵尸没地方站 ✗）', free)

print('')
print('== ③ 和客户端逐块对比（两边必须一模一样）==')
dump = os.path.join(os.environ.get('TEMP', '/tmp'), 'xx2d_props_client.json')
if not os.path.exists(dump):
    print('  [跳过] 没找到 %s —— 先跑一次：node tools\\dump_props.js' % dump)
else:
    with open(dump, 'r', encoding='utf-8') as f:
        cli = json.load(f)
    for key in sorted(cli.keys()):
        ci, cj = [int(t) for t in key.split(',')]
        srv = wg.build_chunk(ci, cj)
        cl = cli[key]
        if len(srv) != len(cl):
            ok(False, '第 (%d,%d) 块：客户端 %d 个 / 服务端 %d 个 ✗' % (ci, cj, len(cl), len(srv)))
            continue
        a = sorted((round(t[0], 3), round(t[1], 3), round(t[2], 3), round(t[3], 3)) for t in srv)
        b = sorted((round(t[0], 3), round(t[1], 3), round(t[2], 3), round(t[3], 3)) for t in cl)
        same = (a == b)
        if not same:
            diff = [x for x in a if x not in b][:2]
            ok(False, '第 (%d,%d) 块两边不一致 ✗（服务端多出来的：%r）' % (ci, cj, diff))
        else:
            ok(True, '★ 第 (%d,%d) 块两边完全一致（%d 个碰撞盒）✓' % (ci, cj, len(cl)))

print('')
if fails:
    print('FAILED: %d 条 ✗' % len(fails))
    for f in fails:
        print('  - ' + f)
    sys.exit(1)
print('ALL PASS ✓')
