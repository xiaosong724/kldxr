# -*- coding: utf-8 -*-
"""地形（高度 / 材质 / 斜坡）—— 纯函数，无状态，可离线测

★★ 为什么要有这个文件 ★★
   地形是【按世界种子确定性生成】的 ✗ 客户端 web/core/game.js 和
   服务端都要各算一遍 ✓ 两份必须一模一样 ✗
   差一点 → 服务器认为这里有堵墙 / 客户端看到一条路 ✗ 僵尸穿墙 ✓
   （第 41 轮就是为这个写了 worldgen.py ✓ 这里沿用同一套做法 ✓）

★★ 一条绝对不能违反的规矩 ★★
   本文件和 game.js 里的 TER_* 函数必须【逐位等价】✓
   所以：
     · 只用 + − × ÷ 和 floor ✗ 不用 pow / sin / 三角函数 ✓
       （不同语言的 libm 结果可能有 1ulp 的差 ✗ 差一点就全错 ✓）
     · 整数哈希必须模拟 JS 的 int32 语义 ✓
     · 改任何一边 ✗ tools/check_terrain_sync.py 会立刻红 ✓ 必须两边一起改 ✓

单位约定：
   高度 h 的单位是【层】✗ 浮点 ✗ 0.0 = 地面 ✓ 范围 −1.0 ~ 5.2
   一层 = LEVEL_H 世界单位（= G.TS = 0.62 ✓ 和格子一样宽 ✓ 所以是方块）
"""

import math

# ★ 和 game.js 的 G.TS 一致（改一边就要改另一边 ✗ 有交叉验证测试盯着 ✓）
LEVEL_H = 0.62

HB = 24              # 小山：每 24×24 格最多一座
HILL_CHANCE = 0.55   # 有山的区块比例（0.55 → 约 45%）
MAX_H = 5.2          # 高度上限（层）
MIN_H = -1.0         # 高度下限（层 ✗ 负数 = 坑 ✓）

# 走 / 跳 的高度阈值（层 ✗ 不是世界单位 ✓）
STEP_WALK = 0.35
STEP_JUMP = 1.15

_cache_hill = {}


def _i32(x):
    """JS 的 ToInt32（取低 32 位按有符号解释 ✓）"""
    x &= 0xFFFFFFFF
    return x - 0x100000000 if x >= 0x80000000 else x


def ter32(gx, gz, salt):
    """和 game.js 的 ter32 完全一致 → 无符号 32 位

    ★ 三个坑：
      ① JS 的 ^ 是 int32 语义 ✗ Python 的 int 无限大 ✓ 必须先截断 ✓
      ② 乘法必须在 2^53 以内才和 JS 的 double 完全一致 ✓
         |gx| < 2^21 时 gx*2654435761 < 5.6e15 ✓ 安全 ✓
      ③ 结果要 & 0xFFFFFFFF（负数要绕回来 ✓）
    """
    a = gx * 2654435761
    b = gz * 40503
    c = salt * 2246822519
    h = _i32(_i32(a) ^ _i32(b) ^ _i32(c))
    return h & 0xFFFFFFFF


def rand01(gx, gz, salt):
    """稳定的 0..1（同一个格子永远同一个值 ✓）"""
    return (ter32(gx, gz, salt) % 1000000) / 1000000.0


def smoothstep(t):
    """3t² − 2t³ ✗ 只用乘法 ✗ 两边算出来一位不差 ✓"""
    if t <= 0.0:
        return 0.0
    if t >= 1.0:
        return 1.0
    return t * t * (3.0 - 2.0 * t)


def _lerp(a, b, t):
    return a + (b - a) * t


def vnoise(gx, gz, salt, period):
    """双线性插值的 value noise（波长 = period 格 ✓）

    ★ 不用 sin / 不用 pow ✗ 只用四则运算 + floor ✓
      这样 Python 和 JS 算出来是【同一个 double】✓
    """
    fx = gx / period
    fz = gz / period
    ix = math.floor(fx)
    iz = math.floor(fz)
    tx = fx - ix
    tz = fz - iz
    sx = smoothstep(tx)
    sz = smoothstep(tz)
    v00 = rand01(ix, iz, salt)
    v10 = rand01(ix + 1, iz, salt)
    v01 = rand01(ix, iz + 1, salt)
    v11 = rand01(ix + 1, iz + 1, salt)
    a = _lerp(v00, v10, sx)
    b = _lerp(v01, v11, sx)
    return _lerp(a, b, sz)


def hills_of_block(bx, bz):
    """这一区块里的小山（没有就返回 None ✗ 有就返回 (cx, cz, H, R)）

    ★ 用区块坐标做哈希 ✗ 所以整块只有一座（或者没有）✓
    """
    key = (bx, bz)
    if key in _cache_hill:
        return _cache_hill[key]
    out = None
    if rand01(bx, bz, 71) < HILL_CHANCE:
        cx = bx * HB + rand01(bx, bz, 72) * HB
        cz = bz * HB + rand01(bx, bz, 73) * HB
        hh = 2 + int(rand01(bx, bz, 74) * 4)          # 2 ~ 5 层（整数 ✓）
        rr = 3.0 + rand01(bx, bz, 75) * 3.0           # 3 ~ 6 格
        out = (cx, cz, float(hh), rr)
    if len(_cache_hill) > 4096:
        _cache_hill.clear()
    _cache_hill[key] = out
    return out


def hill_h(gx, gz):
    """所有附近小山对这一点的高度贡献（取最大值 ✗ 不叠加 ✓）"""
    bx = int(math.floor(gx / float(HB)))
    bz = int(math.floor(gz / float(HB)))
    best = 0.0
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            hl = hills_of_block(bx + dx, bz + dz)
            if not hl:
                continue
            cx, cz, hh, rr = hl
            ddx = gx - cx
            ddz = gz - cz
            dist = math.sqrt(ddx * ddx + ddz * ddz)
            if dist >= rr:
                continue
            t = 1.0 - dist / rr
            v = hh * smoothstep(t)
            if v > best:
                best = v
    return best


def base_h(gx, gz):
    """高低起伏（不含抖动 ✗ 抖动单独算 ✗ 因为斜坡要用干净的值 ✓）"""
    h = 0.0
    h += vnoise(gx, gz, 11, 18) * 0.80        # 大缓坡
    h += vnoise(gx, gz, 23, 7) * 0.35         # 小起伏
    h += hill_h(gx, gz)                        # 小山
    if h < MIN_H:
        h = MIN_H
    if h > MAX_H:
        h = MAX_H
    return h


def jitter(gx, gz):
    """每格的微小高度抖动（±0.06 层 ✗ 用户要求"不要每个都很准确的一格"✓）

    ★ 注意：它【参与】玩法判定 ✓ 所以两边必须一样 ✓
    """
    return (rand01(gx, gz, 41) - 0.5) * 0.12


def height(gx, gz):
    """这一格的最终高度（层 ✓ 含抖动 ✓）"""
    h = base_h(gx, gz) + jitter(gx, gz)
    if h < MIN_H:
        h = MIN_H
    if h > MAX_H:
        h = MAX_H
    return h


# ---------------------------------------------------------------- 材质

MAT_GRASS = 'grass'
MAT_DIRT = 'dirt'
MAT_STONE = 'stone'
MAT_ICE = 'ice'
MAT_SWAMP = 'swamp'
MAT_BRICK = 'brick'


def material(gx, gz):
    """材质（P0 只按高度 + 噪声决定 ✗ 地貌分区放 P2 ✓）"""
    h = height(gx, gz)
    if h >= 4.2:
        return MAT_STONE
    if vnoise(gx, gz, 31, 11) > 0.74:
        return MAT_STONE
    if vnoise(gx, gz, 37, 17) > 0.62:
        return MAT_DIRT
    return MAT_GRASS


# ---------------------------------------------------------------- 斜坡

SLOPE_NONE = 0
# 方向：1 = +X（东）、2 = −X（西）、3 = +Z（南）、4 = −Z（北）
SLOPE_DIRS = ((1, 0), (-1, 0), (0, 1), (0, -1))


def slope_of(gx, gz):
    """这一格是不是斜坡 ✗ 返回 0 = 不是 ✓ 1..4 = 朝哪个邻居升高 ✓

    ★ 只在【小山的边缘】铺斜坡 ✗ 不然满地图都是坡 ✓
    ★ 规则：只给【跳不上去、但也不算断崖】的那一圈铺斜坡 ✓
      落差 ≤0.35  → 直接走上去 ✗ 不需要坡 ✓
      落差 ≤1.15  → 跳得上去 ✗ 不需要坡 ✓
      落差 1.15~2.2 → ★ 跳不上去 → 变成斜坡 ✓
      落差 >2.2   → 断崖 ✗ 坡也救不了（要绕路/破坏）✓
      ★ 自测踩到：原来从 0.35 就开始铺 ✗ 结果整座山变成一个大缓坡 ✓
        不是"台阶 + 局部斜坡"的外观 ✓
      并且这一格在小山的坡上 → 变成斜坡 ✓
      （太矮的坎直接走上去 ✗ 太高的落差是断崖，斜坡救不了 ✓）
    """
    h = height(gx, gz)
    # 只在有山的地方铺
    if hill_h(gx, gz) < 0.25:
        return 0
    best_dir = 0
    best_drop = 0.0
    for i, (dx, dz) in enumerate(SLOPE_DIRS):
        nh = height(gx + dx, gz + dz)
        drop = nh - h
        if STEP_JUMP < drop <= 2.2 and drop > best_drop:
            best_drop = drop
            best_dir = i + 1
    return best_dir


def ground_y(gx, gz, fx=0.5, fz=0.5):
    """格子内某一点的地面高度（世界单位 Y ✓）

    fx / fz 是格子内的 0..1 进度（0.5 = 正中间 ✓）
    ★ 斜坡：沿坡度方向插值 ✗ 所以人走在斜坡上是连续的 ✓
    """
    h = height(gx, gz)
    sl = slope_of(gx, gz)
    if sl:
        dx, dz = SLOPE_DIRS[sl - 1]
        nh = height(gx + dx, gz + dz)
        # 从"远离高处的边"到"靠近高处的边"插值
        if dx == 1:
            t = fx
        elif dx == -1:
            t = 1.0 - fx
        elif dz == 1:
            t = fz
        else:
            t = 1.0 - fz
        h = h + (nh - h) * t
    return h * LEVEL_H


def ground_y_world(wx, wz):
    """世界坐标 → 地面 Y（世界单位 ✓）"""
    from_cell_x = wx / LEVEL_H
    from_cell_z = wz / LEVEL_H
    gx = int(math.floor(from_cell_x))
    gz = int(math.floor(from_cell_z))
    return ground_y(gx, gz, from_cell_x - gx, from_cell_z - gz)


# ---------------------------------------------------------------- 采样（给测试用）

def sample(gx, gz):
    """一个格子的全部信息（给交叉验证测试用 ✓）"""
    return {
        'h': round(height(gx, gz), 6),
        'mat': material(gx, gz),
        'sl': slope_of(gx, gz),
        'gy': round(ground_y(gx, gz), 6),
    }


if __name__ == '__main__':
    # 自检：打一片格子看看范围合不合理
    import sys
    n = 0
    hs = []
    slopes = 0
    for gx in range(-60, 60, 3):
        for gz in range(-60, 60, 3):
            h = height(gx, gz)
            hs.append(h)
            if slope_of(gx, gz):
                slopes += 1
            n += 1
    hs.sort()
    print('采样 %d 格' % n)
    print('  高度 min=%.3f  p50=%.3f  p90=%.3f  max=%.3f'
          % (hs[0], hs[len(hs) // 2], hs[int(len(hs) * 0.9)], hs[-1]))
    print('  斜坡格 %d 个（%.1f%%）' % (slopes, slopes * 100.0 / n))
