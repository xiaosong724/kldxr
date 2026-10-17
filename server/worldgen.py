# -*- coding: utf-8 -*-
"""世界生成（服务端那一份）—— 第 41 轮：让僵尸不再穿墙

★★ 为什么要在服务端再写一遍 ★★
   建筑是【按世界种子确定性生成】的：客户端 web/core/game.js 的 buildChunk()
   只用 (格子坐标) 算哈希 → 谁算都是同一个结果 ✓
   （第 28/29 轮做的"两个客户端看到的建筑完全一致"就是靠这条性质 ✓）
   所以服务端照着算一遍，就知道墙在哪儿 → 僵尸的移动在【服务器上】就被挡住 ✓
   ★ 而不是让客户端上传（那个 netUploadProps 一直是空壳）——
     上传就意味着"改包的客户端可以说我这边没有墙"，僵尸照样穿墙 ✗

★ 这份必须和 game.js 的 buildChunk() **一模一样**，差一点全世界就错位 ✗
   所以配套一条交叉验证：tools/dump_props.js 把【客户端真代码】算出来的
   solid 盒子导成 JSON，tools/test_worldgen.py 拿服务端这份逐块对比 ✓
   改了任何一边的生成规则，那条对比会立刻红 ✓

★ 这里只算【碰撞要用的 solid 盒子】（x, z, hw, hd），不算几何体 —— 那是客户端的事 ✓
"""

import math

# ★ 这些值全部和 web/core/game.js 的 G / PROP_* 对应，改一边就得改另一边 ✗
TS = 0.62                 # 逻辑格边长（G.TS）
PROP_CHUNK = 32           # 每块 32 格（PROP_CHUNK）
PROP_HALO = 8             # 光环（PROP_HALO）
PROP_DENSITY = 34         # 密度（G.PROP_DENSITY）
SPAWN_SAFE = 17.0         # 出生点附近不生成（G.SPAWN_SAFE）
PROP_SCALE = 0.48         # 物件缩放（G.PROP_SCALE）
HOUSE_CELLS = 7           # markHouseCells 的 ±7
TREE_CELLS = 3            # markTreeCells 的 ±3

_cache = {}
CACHE_MAX = 192


def _i32(x):
    """JS 的 ToInt32：取低 32 位按有符号解释（JS 的 ^ 和 & 都是 int32 语义 ✓）"""
    x &= 0xFFFFFFFF
    return x - 0x100000000 if x >= 0x80000000 else x


def cell_hash(gx, gz):
    """和 game.js 完全一致的格子哈希 → q（0..999）

    game.js：  hh = ((gx * 2654435761) ^ (gz * 40503)) & 0xffffffff
               q  = Math.abs(hh % 1000)
    ★ 两个坑：
      ① JS 的 % 符号跟着【被除数】（Python 的跟着除数 ✗ 差一个周期就全错）
      ② ^ 和 & 都是 int32 语义（Python 的 int 是无限的 ✗ 必须先截成 32 位）
    ★ gx * 2654435761 在 JS 里是 double 运算 —— |gx| < 2^21 时是精确的 ✓
      我们的活动范围远远小于这个（跑一小时也就几千格）✓
    """
    hh = _i32(_i32(gx * 2654435761) ^ _i32(gz * 40503))
    hh = _i32(hh & 0xFFFFFFFF)
    return abs(int(math.fmod(hh, 1000)))     # fmod = JS 的 %（截断取余 ✓）


def kind_at(q):
    """种类分配 —— 和 buildChunk() 里那串三元表达式逐字对应 ✓"""
    qq = q % 250
    vi = (q >> 5) % 3
    if 80 <= qq < 96:
        return 'house' if vi == 0 else 'house2'
    if qq < 70:
        return 'dead' if vi == 0 else ('tree2' if vi == 1 else 'tree3')
    if qq < 120:
        return None
    if qq < 180:
        return 'rock' if vi == 0 else ('rubble' if vi == 1 else 'rock3')
    if qq < 200:
        return 'fence' if vi == 0 else 'fence2'
    if qq < 214:
        return 'wreck' if vi == 0 else 'barrel'
    if qq < 236:
        return 'ruin'
    return None


def kind_of_cell(gx, gz):
    """这一格长着什么（★ 只给"能不能砍"用 ✓ 不追求和客户端 100% 一致 ✓）

    ★ 和客户端 buildChunk 的差别：那边还有【占位表】（房子占了 ±7 格、
      树占了 ±3 格，会互相排斥）✗ 这里没做那一层 ✓
    ★ 为什么可以接受：这里只用于【服务端校验"这一格真的有东西可砍"】
      多认了几格 → 玩家砍空气 ✗ 视觉上没有树 ✗ 影响很小 ✓
      少认了 → 树砍不动 ✗ 那个更糟 ✓ 所以宁可宽松一点 ✓
    """
    q = cell_hash(gx, gz)
    if q % PROP_DENSITY != 0:
        return None
    return kind_at(q)


def solid_of(kind):
    """碰撞盒半宽半深（格）—— 和 buildChunk 里那串 if 逐字对应 ✓（最后统一乘 PROP_SCALE）"""
    if kind.startswith('tree') or kind == 'dead':
        return 0.30, 0.30
    if kind.startswith('rock') or kind == 'rubble':
        return 0.75, 0.75
    if kind.startswith('fence'):
        return 1.4, 0.14
    if kind == 'wreck':
        return 1.30, 0.65
    if kind == 'barrel':
        return 0.40, 0.40
    if kind == 'ruin':
        return 1.90, 1.50
    return 1.95, 1.60                     # 房子


def build_chunk(ci, cj):
    """算出这一块的 solid 盒子 [(x, z, hw, hd), ...]

    ★ 两遍扫描 + 占位表，和客户端一模一样：
      第一遍只标【房子】占位；第二遍定种类、标树占位（边走边标 → 顺序不能变 ✗）
    """
    key = (ci, cj)
    hit = _cache.get(key)
    if hit is not None:
        return hit
    x0 = ci * PROP_CHUNK
    z0 = cj * PROP_CHUNK
    H = PROP_HALO
    occ = set()

    for i in range(x0 - H, x0 + PROP_CHUNK + H):
        for j in range(z0 - H, z0 + PROP_CHUNK + H):
            if math.hypot(i * TS, j * TS) < SPAWN_SAFE:
                continue
            q = cell_hash(i, j)
            if q % PROP_DENSITY != 0:
                continue
            if 80 <= (q % 250) < 96:                 # 房子 → 占一大片 ✓
                for a in range(-HOUSE_CELLS, HOUSE_CELLS + 1):
                    for b in range(-HOUSE_CELLS, HOUSE_CELLS + 1):
                        occ.add((i + a, j + b))

    out = []
    for i in range(x0 - H, x0 + PROP_CHUNK + H):
        for j in range(z0 - H, z0 + PROP_CHUNK + H):
            if math.hypot(i * TS, j * TS) < SPAWN_SAFE:
                continue
            q = cell_hash(i, j)
            if q % PROP_DENSITY != 0:
                continue
            kind = kind_at(q)
            if not kind:
                continue
            if kind not in ('house', 'house2') and (i, j) in occ:
                continue                             # 落在别人（房子）的占位里 ✗
            if kind.startswith('tree') or kind == 'dead':
                for a in range(-TREE_CELLS, TREE_CELLS + 1):
                    for b in range(-TREE_CELLS, TREE_CELLS + 1):
                        occ.add((i + a, j + b))      # ★ 边走边标：后面的格子会看到 ✓
            elif (i, j) in occ:
                continue
            # ★ 只有【真正属于本块】的格子才落地（光环里的只负责占位 ✓）
            if not (x0 <= i < x0 + PROP_CHUNK and z0 <= j < z0 + PROP_CHUNK):
                continue
            hw, hd = solid_of(kind)
            out.append((i * TS, j * TS, hw * PROP_SCALE, hd * PROP_SCALE))

    if len(_cache) > CACHE_MAX:
        _cache.clear()
    _cache[key] = out
    return out


def solids_near(x, z, r=3.0):
    """(x,z) 周围 r 米内的 solid 盒子（僵尸移动判定用 ✓）
       ★ 只用查相邻 1~2 块（一块 32 格 ≈ 19.8 米，比 r 大得多 ✓）"""
    W = PROP_CHUNK * TS
    c0 = int(math.floor((x - r) / W))
    c1 = int(math.floor((x + r) / W))
    d0 = int(math.floor((z - r) / W))
    d1 = int(math.floor((z + r) / W))
    res = []
    for ci in range(c0, c1 + 1):
        for cj in range(d0, d1 + 1):
            for it in build_chunk(ci, cj):
                if abs(it[0] - x) > r + it[2] or abs(it[1] - z) > r + it[3]:
                    continue
                res.append(it)
    return res


def blocked(x, z, hw, hd, r=3.0):
    """这个矩形和建筑撞上了吗（和客户端 blocked() 的静态部分同一套 AABB 判定 ✓）"""
    for (sx, sz, shw, shd) in solids_near(x, z, r):
        if x + hw > sx - shw and x - hw < sx + shw and z + hd > sz - shd and z - hd < sz + shd:
            return True
    return False
