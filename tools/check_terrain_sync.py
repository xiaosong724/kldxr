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
    bad_bio = []
    bad_fl = []
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
        if len(v) > 4 and T.biome(gx, gz) != v[4]:
            bad_bio.append((gx, gz, v[4], T.biome(gx, gz)))
        if len(v) > 5 and T.fluid_of(gx, gz)[0] != v[5]:
            bad_fl.append((gx, gz, v[5], T.fluid_of(gx, gz)[0]))
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
    ok(not bad_bio, '地貌一致（不一致 %d 格）%s'
       % (len(bad_bio), ('例：' + repr(bad_bio[:3])) if bad_bio else ''))
    ok(not bad_fl, '流体一致（不一致 %d 格）%s'
       % (len(bad_fl), ('例：' + repr(bad_fl[:3])) if bad_fl else ''))

    print('== 4. 地形本身合不合理（不靠客户端 ✗ 纯服务端）==')
    hs = []
    flat = 0
    n2 = 0
    for gx in range(-90, 90, 3):
        for gz in range(-90, 90, 3):
            h = T.height(gx, gz)
            hs.append(h)
            if h == 0:
                flat += 1
            n2 += 1
    hs.sort()
    ok(hs[-1] <= T.MAX_H + 1e-9, '最高不超过上限（%.2f ≤ %.2f）' % (hs[-1], T.MAX_H))
    ok(hs[0] >= 0 - 1e-9, '没有负数高度（最低 %.2f）' % hs[0])
    ok(hs[-1] >= 3.0, '确实有山（最高 %.2f 层）' % hs[-1])
    ok(flat * 1.0 / n2 > 0.75,
       '大部分地方是平地（%.1f%% 的格子是 0 层）' % (flat * 100.0 / n2))

    print('== 5. ★ 用户 2026-10-17 第三轮的三条要求 ==')
    # ① 不要斜坡：全部为 0
    nz = 0
    for gx in range(-60, 60, 2):
        for gz in range(-60, 60, 2):
            if T.slope_of(gx, gz) != 0:
                nz += 1
    ok(nz == 0, '① 没有斜坡了（非零 %d 处）' % nz)

    # ② 平地必须一样高：随机取 2000 个 0 层格子，看周围有没有抖动
    same = 0
    checked = 0
    for gx in range(-60, 60, 3):
        for gz in range(-60, 60, 3):
            if T.height(gx, gz) != 0:
                continue
            checked += 1
            # 一个纯平地区域：附近 3x3 全是 0 → 高度必须是【整数 0】
            if T.height(gx, gz) == 0.0 and T.jitter(gx, gz) == 0.0:
                same += 1
    ok(checked > 0 and same == checked,
       '② 平地格子高度完全一致（%d/%d 是整数 0 ✗ 没有抖动）' % (same, checked))

    # ③ 山头多样 + 有悬崖
    steps = {}
    for gx in range(-70, 70):
        for gz in range(-70, 70):
            h = T.height(gx, gz)
            d = int(T.height(gx + 1, gz) - h)
            if d:
                steps[d] = steps.get(d, 0) + 1
    up1 = steps.get(1, 0)
    up2 = steps.get(2, 0) + steps.get(3, 0)
    ok(up1 > 0, '③ 有能跳上去的一格台阶（%d 处）' % up1)
    ok(up2 > 0, '③ 也有跳不上去的峭壁（二格以上 %d 处）' % up2)
    ratios = {}
    for gx in range(-96, 96, 2):
        for gz in range(-96, 96, 2):
            v = int(T.height(gx, gz))
            ratios[v] = ratios.get(v, 0) + 1
    kinds = len([k for k in ratios if k > 0])
    ok(kinds >= 3, '③ 山的层数有 %d 种（不是只有一种高度）' % kinds)


    print()
    print('FAILED: %d' % len(fails))
    return 0 if not fails else 1


if __name__ == '__main__':
    sys.exit(main())
