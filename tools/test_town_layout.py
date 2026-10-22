# -*- coding: utf-8 -*-
"""新手小镇布局体检：
  ① 建筑之间不能重叠（留 >=0.8 米巷子）
  ② 每个门洞外 1.4 米内不能有碰撞箱（不然进不去）
  ③ 椅子不能埋在碰撞箱里，且椅子周围要留出站立/走开的空间
  ④ 椅子不能挡住门
  ⑤ 地面上的道具不能在建筑墙里
"""
import os
import sys
import math

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'server'))
import town  # noqa: E402


def rect(b):
    return (b['x0'], b['z0'], b['x1'], b['z1'])


def overlap(a, b, pad=0.0):
    return not (a[2] + pad <= b[0] or b[2] + pad <= a[0] or
                a[3] + pad <= b[1] or b[3] + pad <= a[1])


def solid_hit(x, z, r=0.28):
    for (cx, cz, hw, hd) in town.solid_boxes():
        if abs(x - cx) < hw + r and abs(z - cz) < hd + r:
            return (cx, cz, hw, hd)
    return None


def main():
    bad = []
    bs = list(town.BUILDINGS) + list(town.HOUSES)
    for i in range(len(bs)):
        for j in range(i + 1, len(bs)):
            a, b = rect(bs[i]), rect(bs[j])
            if overlap(a, b, 0.8):
                bad.append('建筑重叠/太近: %s%s%s <-> %s%s%s' % (
                    bs[i]['k'], a, bs[i]['door'], bs[j]['k'], b, bs[j]['door']))

    # 门洞前 1.6 米要空
    for b in bs:
        side, at = b['door'], b['door_at']
        if side == 'east':
            px, pz = b['x1'] + 1.2, at
        elif side == 'west':
            px, pz = b['x0'] - 1.2, at
        elif side == 'south':
            px, pz = at, b['z1'] + 1.2
        else:
            px, pz = at, b['z0'] - 1.2
        hit = solid_hit(px, pz, 0.22)
        if hit:
            bad.append('门口被挡: %s @(%.1f,%.1f) hit=%s' % (b['name'], px, pz, hit))
        if not (abs(px) < town.TOWN_HALF and abs(pz) < town.TOWN_HALF):
            bad.append('门口在镇外: %s' % b['name'])

    # 椅子
    for s in town.seat_list():
        hit = solid_hit(s['x'], s['z'], 0.02)
        if hit and not (abs(hit[0] - s['x']) < 0.01 and abs(hit[1] - s['z']) < 0.01):
            # 只跳过"自己这张椅子"的碰撞箱（同心的就是自己）
            pass
        if hit and not (abs(hit[0] - s['x']) < 0.01 and abs(hit[1] - s['z']) < 0.01):
            bad.append('椅子埋在碰撞里: %s @(%.1f,%.1f) hit=%s' % (s['id'], s['x'], s['z'], hit))
        # 椅子四周至少有一侧能站人（1.0 米外不撞）
        ok = False
        for a in range(8):
            ang = a / 8.0 * math.pi * 2
            x = s['x'] + math.sin(ang) * 1.05
            z = s['z'] + math.cos(ang) * 1.05
            if not solid_hit(x, z, 0.26):
                ok = True
                break
        if not ok:
            bad.append('椅子四周全被堵: %s' % s['id'])

    # 道具不能塞进建筑墙（允许贴着外墙 <=0.35 的装饰忽略）
    for p in town.PROPS:
        if p['k'] in town.NO_SOLID:
            continue
        cx, cz, hw, hd = town._prop_box(p)
        for b in bs:
            inner = (b['x0'] - 0.45, b['z0'] - 0.45, b['x1'] + 0.45, b['z1'] + 0.45)
            if overlap((cx - hw, cz - hd, cx + hw, cz + hd), inner, 0.0):
                # 允许放在门口/墙边的花盆之类，但深入墙体就不行
                deep = overlap((cx - hw, cz - hd, cx + hw, cz + hd), rect(b), 0.0)
                if deep:
                    bad.append('道具在墙里: %s %s @(%.1f,%.1f) box=(%.1f,%.1f,%.1f,%.1f)' % (
                        p['k'], p.get('v', ''), p['x'], p['z'], cx-hw, cz-hd, cx+hw, cz+hd))
                    break

    print('buildings=%d props=%d seats=%d solids=%d' % (
        len(bs), len(town.PROPS), len(town.seat_list()), len(town.solid_boxes())))
    if bad:
        print('\n'.join(bad))
        print('FAIL %d' % len(bad))
        return 1
    print('OK')
    return 0


if __name__ == '__main__':
    sys.exit(main())
