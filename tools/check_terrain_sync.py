# -*- coding: utf-8 -*-
"""地形交叉验证：客户端算的 == 服务端算的（★ 差一格就全世界错位 ✓）

★ 为什么这条测试最重要：
   地形是【两边各算一遍】的 ✗ 客户端渲染 / 服务端碰撞 ✓
   差一点 → 服务器认为这里有墙 / 客户端看到一条路 ✗ 僵尸穿墙 ✓
   第 41 轮 worldgen.py 就是为同样的原因写的 ✗ 那次踩过 ✓

跑法：python tools/check_terrain_sync.py
      （它会先跑 node tools/dump_terrain.js 抓客户端那侧 ✓）
"""
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'server'))

import terrain as T  # noqa: E402

fails = []


def ok(cond, msg):
    print(('  PASS  ' if cond else '  FAIL  ') + msg)
    if not cond:
        fails.append(msg)


def main():
    out = os.path.join(tempfile.gettempdir(), 'xx2d_terrain_client.json')
    if os.path.exists(out):
        os.remove(out)
    print('== 1. 用真客户端代码算一遍（无头 Chrome）==')
    env = dict(os.environ)
    env['OUT'] = out
    r = subprocess.run(['node', os.path.join(ROOT, 'tools', 'dump_terrain.js')],
                       cwd=ROOT, env=env, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=300)
    tail = (r.stdout or '') + (r.stderr or '')
    print('   ' + tail.strip().splitlines()[-1] if tail.strip() else '   (无输出)')
    if not os.path.exists(out):
        print('  ★ 客户端导出失败 ✗ 后面没法比 ✓')
        print(tail[-1200:])
        return 1
    with open(out, encoding='utf-8') as f:
        client = json.load(f)
    print('   客户端 %d 格' % len(client))

    print('== 2. 服务端按同一套规则算一遍（server/terrain.py）==')
    bad_h = []
    bad_mat = []
    bad_sl = []
    bad_gy = []
    n = 0
    for k, v in client.items():
        gx, gz = [int(x) for x in k.split(',')]
        n += 1
        sh = round(T.height(gx, gz), 6)
        sm = T.material(gx, gz)
        ss = T.slope_of(gx, gz)
        sg = round(T.ground_y(gx, gz, 0.5, 0.5), 6)
        if abs(sh - v[0]) > 1e-6:
            bad_h.append((gx, gz, v[0], sh))
        if sm != v[1]:
            bad_mat.append((gx, gz, v[1], sm))
        if ss != v[2]:
            bad_sl.append((gx, gz, v[2], ss))
        if abs(sg - v[3]) > 1e-6:
            bad_gy.append((gx, gz, v[3], sg))
    print('   比对 %d 格' % n)

    print('== 3. 逐项核对 ==')
    ok(not bad_h, '高度一致（不一致 %d 格）%s'
       % (len(bad_h), ('例：' + repr(bad_h[:3])) if bad_h else ''))
    ok(not bad_gy, '地面 Y 一致（不一致 %d 格）%s'
       % (len(bad_gy), ('例：' + repr(bad_gy[:3])) if bad_gy else ''))
    ok(not bad_mat, '材质一致（不一致 %d 格）%s'
       % (len(bad_mat), ('例：' + repr(bad_mat[:3])) if bad_mat else ''))
    ok(not bad_sl, '斜坡一致（不一致 %d 格）%s'
       % (len(bad_sl), ('例：' + repr(bad_sl[:3])) if bad_sl else ''))

    print('== 4. 地形本身合不合理（不靠客户端 ✗ 纯服务端）==')
    hs = []
    sl = 0
    for gx in range(-90, 90, 3):
        for gz in range(-90, 90, 3):
            hs.append(T.height(gx, gz))
            if T.slope_of(gx, gz):
                sl += 1
    hs.sort()
    p50 = hs[len(hs) // 2]
    ok(hs[-1] <= T.MAX_H + 1e-9, '最高不超过上限（%.2f ≤ %.2f）' % (hs[-1], T.MAX_H))
    ok(hs[0] >= T.MIN_H - 1e-9, '最低不低于下限（%.2f ≥ %.2f）' % (hs[0], T.MIN_H))
    ok(hs[-1] > 2.5, '确实有小山（最高 %.2f 层）' % hs[-1])
    ok(p50 < 1.2, '大部分地方是平地（中位数 %.2f 层）' % p50)
    ok(sl > 0, '确实生成出了斜坡（%d 格）' % sl)

    print()
    print('FAILED: %d' % len(fails))
    return 0 if not fails else 1


if __name__ == '__main__':
    sys.exit(main())
