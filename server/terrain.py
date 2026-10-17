# -*- coding: utf-8 -*-
"""地形（高度 / 材质）—— 纯函数，无状态，可离线测

★★ 为什么要有这个文件 ★★
   地形是【按世界种子确定性生成】的 ✗ 客户端 web/core/game.js 和
   服务端都要各算一遍 ✓ 两份必须一模一样 ✗
   差一点 → 服务器认为这里有堵墙 / 客户端看到一条路 ✗ 僵尸穿墙 ✓
   （第 41 轮就是为这个写了 worldgen.py ✓ 这里沿用同一套做法 ✓）

★★ 一条绝对不能违反的规矩 ★★
   本文件和 game.js 里的 TER_* 函数必须【逐位等价】✓
   所以只用 + − × ÷ 和 floor / sqrt ✗ 不用 pow / sin ✓
   （不同语言的 libm 结果可能有 1ulp 的差 ✗ 差一点就全错 ✓）

★★ 设计改动（用户 2026-10-17 第三轮）★★
   ① **不要斜坡了** ✗ 山靠"跳 1 格"爬上去 ✓
   ② 平地上的方块【完全一样高】✗ 高度差只出现在山上 ✓
      → 没有低频噪声、没有每格抖动 ✓
   ③ 山的样式要多样 ✗ 也要有悬崖峭壁 ✓
      → 每座山由 3 个偏移的圆叠出来（形状不规整 ✓）
      → 两种：缓山（跳得上去）/ 悬崖山（跳不上去，要绕路）✓

单位：高度单位是【层】✗ 整数 ✗ 0 = 地面 ✓ 一层 = LEVEL_H 世界单位 ✓
"""

import math

LEVEL_H = 0.62      # 一层多高（= G.TS ✓ 方块才是方的 ✓）

HB = 24             # 大山：每 24×24 格最多一座
HB_SMALL = 12       # 小土包：每 12×12 格
HILL_CHANCE = 0.50
SMALL_CHANCE = 0.30
MAX_H = 5

STEP_WALK = 0.35    # 走上去的最大落差（层）
STEP_JUMP = 1.15    # 跳上去的最大落差（层）

_cache_hill = {}


def _i32(x):
    """JS 的 ToInt32（取低 32 位按有符号解释 ✓）"""
    x &= 0xFFFFFFFF
    return x - 0x100000000 if x >= 0x80000000 else x


def ter32(gx, gz, salt):
    """和 game.js 的 ter32 完全一致 → 无符号 32 位"""
    a = gx * 2654435761
    b = gz * 40503
    c = salt * 2246822519
    h = _i32(_i32(a) ^ _i32(b) ^ _i32(c))
    return h & 0xFFFFFFFF


def rand01(gx, gz, salt):
    return (ter32(gx, gz, salt) % 1000000) / 1000000.0


def smoothstep(t):
    """3t² − 2t³ ✗ 只用乘法 ✗ 两边一位不差 ✓"""
    if t <= 0.0:
        return 0.0
    if t >= 1.0:
        return 1.0
    return t * t * (3.0 - 2.0 * t)


def _hill_of_block(bx, bz, hb, salt, chance, hmin, hmax, r_flat, r_cliff, cliff_at):
    """从区块坐标生成一座山（没有就 None ✓）→ (blobs, H)"""
    key = (bx, bz, hb, salt)
    if key in _cache_hill:
        return _cache_hill[key]
    out = None
    if rand01(bx, bz, salt + 0) < chance:
        cx = bx * hb + rand01(bx, bz, salt + 1) * hb
        cz = bz * hb + rand01(bx, bz, salt + 2) * hb
        hh = hmin + int(rand01(bx, bz, salt + 3) * (hmax - hmin + 1))
        if hh > hmax:
            hh = hmax
        cliff = rand01(bx, bz, salt + 4) < cliff_at
        base_r = (r_cliff if cliff else r_flat) * hh + 1.2
        base_r *= 0.80 + rand01(bx, bz, salt + 5) * 0.55
        blobs = []
        for k in range(3):
            ox = cx + (rand01(bx, bz, salt + 10 + k) - 0.5) * base_r * 0.75
            oz = cz + (rand01(bx, bz, salt + 20 + k) - 0.5) * base_r * 0.75
            rr = base_r * (0.58 + rand01(bx, bz, salt + 30 + k) * 0.42)
            blobs.append((ox, oz, rr))
        out = (blobs, hh)
    if len(_cache_hill) > 8192:
        _cache_hill.clear()
    _cache_hill[key] = out
    return out


def big_hill(bx, bz):
    """大山（2~5 层 ✗ 34% 是悬崖山）"""
    return _hill_of_block(bx, bz, HB, 71, HILL_CHANCE, 2, 5, 1.35, 0.45, 0.34)


def small_hill(bx, bz):
    """小土包（1~2 层 ✗ 让荒野不那么平）"""
    return _hill_of_block(bx, bz, HB_SMALL, 101, SMALL_CHANCE, 1, 2, 1.40, 0.60, 0.20)


def _contribution(gx, gz, hill):
    if not hill:
        return 0
    blobs, hh = hill
    best = 0.0
    for (ox, oz, rr) in blobs:
        ddx = gx - ox
        ddz = gz - oz
        dist = math.sqrt(ddx * ddx + ddz * ddz)
        if dist >= rr:
            continue
        t = smoothstep(1.0 - dist / rr)
        if t > best:
            best = t
    if best <= 0.0:
        return 0
    # ★ 取整成【离散台阶】✗ 不然每格高度都不同 ✓
    v = int(best * hh + 0.5)
    if v > hh:
        v = hh
    return v


def hill_h(gx, gz):
    """附近所有山的最大高度（整数 0..5 ✓ 平地 = 0 ✓）"""
    bx = int(math.floor(gx / float(HB)))
    bz = int(math.floor(gz / float(HB)))
    best = 0
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            v = _contribution(gx, gz, big_hill(bx + dx, bz + dz))
            if v > best:
                best = v
    sx = int(math.floor(gx / float(HB_SMALL)))
    sz = int(math.floor(gz / float(HB_SMALL)))
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            v = _contribution(gx, gz, small_hill(sx + dx, sz + dz))
            if v > best:
                best = v
    return best


def height(gx, gz):
    """这一格的最终高度（层 ✓ 整数 ✓ 平地恒为 0 ✓）"""
    h = hill_h(gx, gz)
    if h < 0:
        h = 0
    if h > MAX_H:
        h = MAX_H
    return float(h)


def jitter(gx, gz):
    """保留只为兼容老调用 ✗ 现在【永远 0】✓（平地必须一样高 ✓）"""
    return 0.0


# ---------------------------------------------------------------- 材质

MAT_GRASS = 'grass'
MAT_DIRT = 'dirt'
MAT_STONE = 'stone'
MAT_ICE = 'ice'
MAT_SWAMP = 'swamp'
MAT_BRICK = 'brick'


def vnoise(gx, gz, salt, period):
    """成片的 value noise（波长 = period 格 ✓ 只用四则 ✓ 两边一致 ✓）

    ★ 自测踩到：材质原来用 rand01（每格独立白噪声）✗
      画出来是【一格绿一格褐】的噪点 ✗ 像马赛克不像草地 ✓
      → 必须用【空间噪声】✗ 相邻格才会是同一个材质 ✓
    """
    fx = gx / period
    fz = gz / period
    ix = math.floor(fx)
    iz = math.floor(fz)
    sx = smoothstep(fx - ix)
    sz = smoothstep(fz - iz)
    v00 = rand01(ix, iz, salt)
    v10 = rand01(ix + 1, iz, salt)
    v01 = rand01(ix, iz + 1, salt)
    v11 = rand01(ix + 1, iz + 1, salt)
    a = v00 + (v10 - v00) * sx
    b = v01 + (v11 - v01) * sx
    return a + (b - a) * sz


def material(gx, gz):
    """材质：高处是石头，其它按【成片】的噪声分草/土 ✓

    ★ 只影响颜色 ✗ 不影响高度 ✓（用户要的是"高低一样"✗ 不是"颜色一样"✓）
    ★ 用 vnoise（波长 9 格）✗ 一片一片的 ✓ 不是一格一格的噪点 ✓
    """
    h = height(gx, gz)
    if h >= 4:
        return MAT_STONE
    if h >= 2 and vnoise(gx, gz, 43, 5) > 0.55:
        return MAT_STONE
    if vnoise(gx, gz, 31, 9) > 0.62:
        return MAT_DIRT
    return MAT_GRASS


# ---------------------------------------------------------------- 斜坡（已停用）

SLOPE_NONE = 0
SLOPE_DIRS = ((1, 0), (-1, 0), (0, 1), (0, -1))


def slope_of(gx, gz):
    """★ 用户："不要斜坡了" ✗ 永远返回 0 ✓

    函数留着不删 ✗ 交叉验证测试还要比这一项 ✓ 以后想加回来只改这里 ✓
    现在爬山全靠"跳 1 格"✓ 缓山每格落差 < 1.15 → 跳得上去 ✓
    悬崖山落差 2 格 → 跳不上去 ✗ 要绕到缓的一边 ✓（这就是"峭壁"✓）
    """
    return 0


def ground_y(gx, gz, fx=0.5, fz=0.5):
    """格子内的地面高度（世界单位 ✓）—— 没有斜坡，整格是平的 ✓"""
    return height(gx, gz) * LEVEL_H


def ground_y_world(wx, wz):
    cx = wx / LEVEL_H
    cz = wz / LEVEL_H
    return ground_y(int(math.floor(cx)), int(math.floor(cz)))


def cell_of_world(wx, wz):
    """世界坐标 → 格子坐标（整数 ✓）"""
    return (int(math.floor(wx / LEVEL_H)), int(math.floor(wz / LEVEL_H)))


def can_step(from_h, to_h):
    """能不能从 from_h 走到 to_h（单位：层 ✓）

    ★ 玩家和僵尸用同一个判定 ✗ 只差各自的跳跃高度 ✓
    """
    return (to_h - from_h) <= STEP_JUMP


if __name__ == '__main__':
    counts = {}
    n = 0
    for gx in range(-80, 81):
        for gz in range(-80, 81):
            h = int(height(gx, gz))
            counts[h] = counts.get(h, 0) + 1
            n += 1
    print('采样 %d 格' % n)
    for k in sorted(counts):
        print('  h=%d  %6d 格（%.1f%%）' % (k, counts[k], counts[k] * 100.0 / n))
