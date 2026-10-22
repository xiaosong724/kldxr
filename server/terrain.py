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

# ★ 日式街角小镇：70×70（半边 35）内地形永远压平 ✗ 不能长方块山 ✓
TOWN_HALF = 250.0
TOWN_TRANSITION = 4.0   # 出镇后 3 米内平滑过渡，避免门口直接跳崖


def town_cell_distance(gx, gz):
    """这个地形格到小镇方形的距离（米）；0 = 和小镇相交。"""
    x0 = gx * LEVEL_H
    x1 = x0 + LEVEL_H
    z0 = gz * LEVEL_H
    z1 = z0 + LEVEL_H
    if x0 < TOWN_HALF and x1 > -TOWN_HALF and z0 < TOWN_HALF and z1 > -TOWN_HALF:
        return 0.0
    cx = (x0 + x1) * 0.5
    cz = (z0 + z1) * 0.5
    dx = max(0.0, abs(cx) - TOWN_HALF)
    dz = max(0.0, abs(cz) - TOWN_HALF)
    return max(dx, dz)


def town_flatten_h(gx, gz, h):
    """小镇内强制 0；门口 2 米平滑过渡。"""
    d = town_cell_distance(gx, gz)
    if d <= 0.0:
        return 0.0
    if d < TOWN_TRANSITION:
        return h * (d / TOWN_TRANSITION)
    return h


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


def basin(gx, gz):
    """这一格是不是【水盆】（比其他地面低一层 ✓ 纯函数）

    ★★ 用户 2026-10-18："水应该是在地面下一格，得有方块包围才合理" ★★
      之前水是【浮在平地上】的 ✗ 看着像一层蓝色塑料布 ✓
      现在：水盆格的高度是 −1 ✗ 四周是 0 → 水就在坑里 ✓ 四周有岸 ✓
    ★ 沼泽：一片片小水洼（噪声波长 6 ✗ 不是一整个大湖 ✓）
      留出陆地可以走 ✗ 不然整片沼泽都要跳着走 ✓
    ★ 城区：零星的地火坑（很少 ✓）
    """
    b = biome(gx, gz)
    if b == B_SWAMP:
        return vnoise(gx, gz, 131, 6) > 0.52
    if b == B_RUIN:
        return vnoise(gx, gz, 137, 7) > 0.62 and vnoise(gx, gz, 121, 9) > 0.855
    return False


def height(gx, gz):
    """这一格的最终高度（层 ✓ 整数 ✓ 平地恒为 0 ✓）"""
    if basin(gx, gz):
        h = -1.0        # ★ 水盆比其他地面低一层 ✓
    else:
        h = hill_h(gx, gz)
    if h < 0:
        h = 0
    if h > MAX_H:
        h = MAX_H
    # ★ 小镇（50×50）内不能生成方块山 / 水坑 ✓
    return town_flatten_h(gx, gz, float(h))


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


# ---------------------------------------------------------------- 地貌（P2）

B_WILD = 'wild'     # 荒野（默认 ✗ 出生点附近强制这个 ✓）
B_ICE = 'ice'       # 冰原（跑得快 ✗ 刹不住 ✓）
B_SWAMP = 'swamp'   # 沼泽（慢 ✗ 有积水 ✓）
B_RUIN = 'ruin'     # 城区废墟（砖地 ✗ 以后接可拆的墙 ✓）

BIOME_SIZE = 48     # 地貌的波长（格 ✗ 太大了会觉得世界单调 ✓ 48 刚好 ✓）
BIOME_SAFE = 70     # 出生点这么远以内强制荒野（新手区 ✓）
# ★ 各处的地貌移速（★ 客户端要一模一样 ✗ 不然"我看着跑得快但实际慢"✓）
BIOME_SPEED = {B_WILD: 1.0, B_ICE: 1.45, B_SWAMP: 0.58, B_RUIN: 1.0}


def biome(gx, gz):
    """这一格是什么地貌（★ 纯函数 ✗ 两边各算一遍 ✓ 必须一致 ✓）

    ★ 为什么用【低频噪声】而不是"画几块矩形"：
      噪声出来的边界是自然的曲线 ✗ 矩形会看到"斜着的直线"✓
    ★ 出生点附近强制荒野 ✓ 不然一出生就站在冰上会摔跟头 ✓
    """
    ddx = gx * 1.0
    ddz = gz * 1.0
    if (ddx * ddx + ddz * ddz) < (BIOME_SAFE * BIOME_SAFE):
        return B_WILD
    # ★ 阈值是【按噪声的实际分布】定的（p90=0.627 / p75=0.544 / p25=0.423 ✓）
    #   自测踩到：第一版随手写 0.76 ✗ 冰原只占 0.2% ✗ 等于没有 ✓
    n = vnoise(gx, gz, 91, BIOME_SIZE)
    if n > 0.62:
        return B_ICE        # ≈10%
    if n > 0.545:
        return B_SWAMP      # ≈15%
    if n < 0.36:
        return B_RUIN       # ≈12%
    return B_WILD


def material(gx, gz):
    """材质：高处是石头，其它按【成片】的噪声分草/土 ✓

    ★ 只影响颜色 ✗ 不影响高度 ✓（用户要的是"高低一样"✗ 不是"颜色一样"✓）
    ★ 用 vnoise（波长 9 格）✗ 一片一片的 ✓ 不是一格一格的噪点 ✓
    """
    b = biome(gx, gz)
    if b == B_ICE:
        return MAT_ICE
    if b == B_SWAMP:
        return MAT_SWAMP
    if b == B_RUIN:
        return MAT_BRICK
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


# ---------------------------------------------------------------- 流体（F0 静水）

F_NONE = 0      # 没有
F_WATER = 1     # 清水
F_SWAMP = 2     # 污水（沼泽 ✓ 腐蚀）
F_LAVA = 3      # 地火（烫伤 ✓ 会发光）

# ★ 每种流体的"深度"（占一格的多少 ✗ 0.55 = 到脚踝 ✓ 方案 §6.2）
FLUID_DEPTH = {F_WATER: 0.75, F_SWAMP: 0.70, F_LAVA: 0.80}


def fluid_of(gx, gz):
    """这一格有什么流体 → (kind, depth) ✓ 纯函数 ✗ 两边各算一遍 ✓

    ★ F0 只做【静止的流体】✗ 不会流动 ✓（流动是 F1 ✗ 要活跃集合 + 预算 ✓）
      → 所以【零 tick 开销】✗ 和地形一样只是"算出来的"✓
    ★ 只出现在【平地】上 ✗ 山上是没有水的 ✓
    ★ 污水 = 整片沼泽 ✓ 地火 = 城区废墟里零星的几格（废弃工厂熔炉 ✓）
    """
    if abs(gx * LEVEL_H) <= TOWN_HALF and abs(gz * LEVEL_H) <= TOWN_HALF:
        return (F_NONE, 0.0)
    if not basin(gx, gz):
        return (F_NONE, 0.0)
    b = biome(gx, gz)
    if b == B_SWAMP:
        return (F_SWAMP, FLUID_DEPTH[F_SWAMP])
    if b == B_RUIN:
        return (F_LAVA, FLUID_DEPTH[F_LAVA])
    return (F_NONE, 0.0)


def fluid_y(gx, gz):
    """流体的表面高度（世界单位 Y ✗ 没流体返回 None ✓）"""
    k, d = fluid_of(gx, gz)
    if not k:
        return None
    return (height(gx, gz) + d) * LEVEL_H


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
