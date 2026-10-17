# -*- coding: utf-8 -*-
"""地形方案示意图（第三版）

① terrain-overview.png —— 立体剖视：三级台地 / 材质 / 两格人物 / 三格掉落
② terrain-cross.png    —— 竖直剖面：一格多高、两格人物、三格掉落线、水位
③ terrain-biomes.png   —— 地貌俯视：冰原 / 沼泽 / 城区 / 荒野 + 危险度
④ terrain-break.png    —— 破坏过程：不同材质打几下碎、碎块动画
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'docs', 'shots')
os.makedirs(OUT, exist_ok=True)

BG    = (22, 21, 19)
TEXT  = (232, 236, 240)
DIM   = (146, 152, 160)
GOLD  = (255, 216, 61)
RED   = (255, 118, 100)
GREEN = (126, 224, 138)
BLUE  = (120, 190, 214)

GRASS  = (104, 116, 62)
DIRT   = (112, 84, 56)
STONE  = (126, 124, 118)
BRICK  = (134, 78, 60)
ICE    = (150, 202, 220)
SWAMP  = (72, 82, 56)
WATER  = (54, 98, 112)
WOOD   = (100, 74, 48)


def font(sz, bold=False):
    for p in (r'C:\Windows\Fonts\msyhbd.ttc' if bold else r'C:\Windows\Fonts\msyh.ttc',
              r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simhei.ttf'):
        if os.path.isfile(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()


def T(d, x, y, txt, col=TEXT, sz=14, anchor='la', bold=False):
    d.text((x, y), txt, font=font(sz, bold), fill=col, anchor=anchor)


def sh(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


# ======================================================================
# ① 立体剖视
# ======================================================================
def make_overview():
    W, H = 1240, 830
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    T(d, 36, 24, '地形示意 1  高度差 · 材质 · 水位', TEXT, 26, bold=True)
    T(d, 36, 62, '一格 = 1 层。人物 2 格高，落差 3 格以上会掉落并掉血。', DIM, 13)

    CW, CH = 96, 48
    LV = 34
    OX, OY = 340, 310

    HM = {}
    for x in range(7):
        for y in range(7):
            HM[(x, y)] = (0, 'grass')
    for x in range(0, 3):
        for y in range(0, 2):
            HM[(x, y)] = (0, 'swamp')
    for x in range(2, 5):
        for y in range(2, 4):
            HM[(x, y)] = (2, 'grass')
    HM[(3, 2)] = (3, 'stone')
    for x in range(5, 7):
        for y in range(0, 3):
            HM[(x, y)] = (0, 'ice')
    for x in range(3, 7):
        for y in range(5, 7):
            HM[(x, y)] = (0, 'brick')
    HM[(1, 4)] = (3, 'stone')
    HM[(1, 5)] = (3, 'stone')
    HM[(2, 4)] = (1, 'stone')
    HM[(0, 4)] = (1, 'grass')

    MATC = {
        'grass': (GRASS, sh(GRASS, 0.70), sh(GRASS, 0.52)),
        'swamp': (SWAMP, sh(SWAMP, 0.68), sh(SWAMP, 0.50)),
        'stone': (STONE, sh(STONE, 0.74), sh(STONE, 0.56)),
        'ice':   (ICE, sh(ICE, 0.76), sh(ICE, 0.58)),
        'brick': (BRICK, sh(BRICK, 0.72), sh(BRICK, 0.54)),
    }

    def cell_px(x, y):
        lv = HM[(x, y)][0]
        return (OX + (x - y) * (CW / 2),
                OY + (x + y) * (CH / 2) - lv * LV)

    keys = sorted(HM.keys(), key=lambda k: (k[0] + k[1], k[0]))
    hw, hh = CW / 2, CH / 2
    for (x, y) in keys:
        lv, mat = HM[(x, y)]
        px, py = cell_px(x, y)
        ct, cl, cr = MATC[mat]
        # ★ 侧面高度只按【自身层数】算 ✗ 不额外加一层 ✓
        #   地面层 (0) 只留 3px 描边 → 看着是"平地"✓
        #   台地 (2) 露出 68px → 一眼看出高度差 ✓
        #   ★ 为什么这样不会露缝：相邻格落差最大 = lv×LV
        #     而侧面的高度正好 = lv×LV ✓ 刚好盖住 ✓
        side = LV * lv if lv > 0 else 3
        d.polygon([(px, py + hh), (px + hw, py + CH), (px + hw, py + CH + side),
                   (px, py + hh + side)], fill=cl)
        d.polygon([(px + hw, py + CH), (px + CW, py + hh),
                   (px + CW, py + hh + side), (px + hw, py + CH + side)], fill=cr)
        d.polygon([(px, py + hh), (px + hw, py), (px + CW, py + hh),
                   (px + hw, py + CH)], fill=ct)
        if mat == 'swamp':
            d.polygon([(px + 8, py + hh), (px + hw, py + 9),
                       (px + CW - 8, py + hh), (px + hw, py + CH - 9)],
                      fill=WATER)
        d.line([(px, py + hh), (px + hw, py), (px + CW, py + hh)],
               fill=sh(ct, 1.22), width=1)

    px, py = cell_px(3, 2)
    d.polygon([(px, py + hh), (px + hw, py), (px + CW, py + hh),
               (px + hw, py + CH)], outline=GOLD, width=3)
    T(d, px + hw, py - 30, '石头 · 打 6 次', GOLD, 13, anchor='ms', bold=True)

    sx, sy = 4, 3
    px, py = cell_px(sx, sy)
    # ★ 脚底 = 这一格【顶面的下沿】✗ 不是顶面再往下加一层 ✓
    #   （侧面高度改成 lv*LV 之后 ✗ 旧公式会把脚放到台地下面 ✓）
    feet = py + CH - 4
    cx = px + hw
    hhpx = LV * 2
    d.rectangle([cx - 10, feet - hhpx, cx + 10, feet], fill=(216, 198, 152),
                outline=(64, 56, 42), width=2)
    d.ellipse([cx - 9, feet - hhpx - 20, cx + 9, feet - hhpx - 2],
              fill=(210, 180, 142), outline=(64, 56, 42), width=2)
    d.line([cx + 24, feet, cx + 24, feet - hhpx], fill=GREEN, width=2)
    T(d, cx + 30, feet - hhpx / 2, '2 格', GREEN, 14, anchor='lm', bold=True)

    px2, py2 = cell_px(1, 5)
    top_y = py2 + CH
    px3, py3 = cell_px(0, 6)
    ground_y = py3 + CH + LV
    d.line([px2 + hw, top_y - 2, px3 + hw, ground_y - 40], fill=RED, width=4)
    d.polygon([(px3 + hw, ground_y - 40),
               (px3 + hw - 13, ground_y - 49),
               (px3 + hw - 11, ground_y - 30)], fill=RED)
    T(d, px2 + hw - 16, (top_y + ground_y) / 2, '落差 3 格 → 掉落掉血', RED, 15,
      anchor='rm', bold=True)

    x0 = 830
    T(d, x0, 108, '高度（一格 = 1 层）', GOLD, 18, bold=True)
    for k, t in enumerate([
        '· 地形按格子存高度，0 = 地面',
        '· 人物占 2 格：头顶那格必须空',
        '· 上坡 +1 格自动迈上去',
        '          +2 格要跳 / 攀',
        '· 落差 ≥3 格：掉落并掉血',
        '          伤害 =（落差−2）×8% 最大血',
        '          上限 60%，不会一击死',
        '· 落差 1~2 格：直接走下来',
    ]):
        T(d, x0, 138 + k * 23, t, TEXT, 13)

    T(d, x0, 330, '材质（打几次碎）', GOLD, 18, bold=True)
    res = [('草丛 / 泥土', 1, GRASS), ('木头（树 / 木墙）', 2, WOOD),
           ('冰', 2, ICE), ('砖（房子）', 4, BRICK),
           ('石头（台地 / 岩）', 6, STONE)]
    for k, (nm, n, col) in enumerate(res):
        yy = 360 + k * 27
        d.rectangle([x0, yy + 3, x0 + 18, yy + 19], fill=col, outline=(0, 0, 0))
        T(d, x0 + 26, yy, nm, TEXT, 13)
        T(d, x0 + 214, yy, '%d 次' % n, GOLD, 13, bold=True)

    T(d, x0, 520, '地貌手感', GOLD, 18, bold=True)
    for k, t in enumerate([
        '· 冰面：移速 ×1.35，停下要滑 0.6 格',
        '          转身也慢，像溜冰',
        '· 沼泽：移速 ×0.6，水位到脚踝',
        '          有涟漪 / 水声；僵尸也变慢',
    ]):
        T(d, x0, 550 + k * 23, t, TEXT, 13)

    T(d, 36, 772, '说明：颜色深浅只表示层数；最终美术会重新画。这张只定规则。',
      DIM, 12)
    p = os.path.join(OUT, 'terrain-overview.png')
    im.save(p)
    print('saved', p)


# ======================================================================
# ② 竖剖
# ======================================================================
def make_cross():
    W, H = 1200, 660
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    T(d, 36, 24, '地形示意 2  竖直剖面', TEXT, 26, bold=True)
    T(d, 36, 62, '每一小格 = 1 层。人物脚底那格就是所站的格子。', DIM, 13)

    U = 60
    base = 520
    x0 = 90
    # ★ 右边必须真的到【0 层】✗ 不然"落差 3"的标注和图形对不上 ✓
    #   （自测踩到：原来最右是 1 层 ✗ 3→1 只有 2 格落差 ✓）
    hs = [1, 1, 2, 2, 3, 3, 3, 3, 2, 2, 0, 0]
    mats = ['grass', 'grass', 'grass', 'dirt', 'stone', 'stone', 'stone', 'stone',
            'grass', 'ice', 'swamp', 'swamp']
    MC = {'grass': GRASS, 'dirt': DIRT, 'stone': STONE, 'ice': ICE, 'swamp': SWAMP}

    for lv in range(0, 5):
        y = base - lv * U
        d.line([x0 - 30, y, x0 + len(hs) * U + 14, y], fill=(42, 40, 37))
        T(d, x0 - 38, y, '%d' % lv, DIM, 12, anchor='rm')
    T(d, x0 - 38, base - 4 * U - 26, '层', DIM, 12, anchor='rm')

    for i, (h, m) in enumerate(zip(hs, mats)):
        x = x0 + i * U
        for lv in range(h):
            y = base - (lv + 1) * U
            d.rectangle([x + 1, y + 1, x + U - 1, base - lv * U],
                        fill=sh(MC[m], 1.0 - lv * 0.13))
        if m == 'swamp':
            # ★ 0 层的格子没有侧面 ✗ 水不能按"格内 42%"算 ✓
            #   0 层 = 地面就是水面 → 水面贴着地面线 ✓
            wy = (base - h * U + U * 0.42) if h > 0 else (base - 12)
            d.rectangle([x + 1, wy, x + U - 1, wy + 13], fill=WATER)
            T(d, x + U / 2, wy - 16, '水', BLUE, 11, anchor='ms')

    i = 6
    x = x0 + i * U
    feet = base - hs[i] * U
    cx = x + U / 2
    top = feet - 2 * U
    d.rectangle([cx - 18, top, cx + 18, feet], fill=(216, 198, 152),
                outline=(70, 62, 46), width=2)
    d.ellipse([cx - 15, top - 32, cx + 15, top + 2], fill=(210, 180, 142),
              outline=(70, 62, 46), width=2)
    d.line([cx + 32, feet, cx + 32, top], fill=GREEN, width=3)
    d.line([cx + 26, feet, cx + 38, feet], fill=GREEN, width=2)
    d.line([cx + 26, top, cx + 38, top], fill=GREEN, width=2)
    T(d, cx + 44, (feet + top) / 2, '2 格 = 人物', GREEN, 14, anchor='lm', bold=True)

    x1 = x0 + 8 * U + U / 2
    f1 = base - hs[8] * U
    T(d, x1 + 4, f1 - 36, '落差 1：走下台阶', GREEN, 12, anchor='lm', bold=True)

    x2 = x0 + 10 * U + U / 2
    f2 = base - hs[10] * U
    d.line([cx + 20, feet - 26, x2 - 6, f2 - 34], fill=RED, width=3)
    d.polygon([(x2 - 6, f2 - 34), (x2 - 18, f2 - 42), (x2 - 15, f2 - 25)], fill=RED)
    T(d, x2 + 6, f2 - 60, '落差 3 → 掉落 8% 血', RED, 12, anchor='lm', bold=True)

    x1s = 880
    T(d, x1s, 120, '判定顺序', GOLD, 17, bold=True)
    for k, t in enumerate([
        '1. 先看落点那格的高度',
        '2. 落差 ≤2：直接走（含碰撞）',
        '3. 落差 ≥3：判定为掉落',
        '     伤害 =（落差−2）×8% 上限 60%',
        '4. 落点下面是水：不掉血',
        '     但移速变慢（沼泽）',
        '5. 落点被占（墙 / 树）：走不过去',
    ]):
        T(d, x1s, 150 + k * 23, t, TEXT, 13)

    T(d, x1s, 340, '为什么是 2 格 / 3 格', GOLD, 17, bold=True)
    for k, t in enumerate([
        '· 人 2 格高 → 落差 1 = 台阶',
        '· 落差 2 = 跳下窗台，不疼',
        '· 落差 3 = 一层楼，摔疼',
        '· 3 格是疼但不致命的线',
    ]):
        T(d, x1s, 370 + k * 23, t, TEXT, 13)

    p = os.path.join(OUT, 'terrain-cross.png')
    im.save(p)
    print('saved', p)


# ======================================================================
# ③ 地貌俯视
# ======================================================================
def make_biomes():
    W, H = 1160, 830
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    T(d, 36, 24, '地形示意 3  地貌分布（俯视）', TEXT, 26, bold=True)
    T(d, 36, 62, '整片生成、不零碎；越往外越危险。高度只在部分地貌出现（台地 / 断崖）。',
      DIM, 13)

    x0, y0, S, N = 70, 118, 660, 26
    c = S / N
    random.seed(11)

    for i in range(N):
        for j in range(N):
            dist = math.hypot(i - N / 2, j - N / 2) / (N / 2)
            k = min(1.0, max(0.0, dist))
            d.rectangle([x0 + i * c, y0 + j * c, x0 + (i + 1) * c, y0 + (j + 1) * c],
                        fill=(int(33 + k * 34), int(31 + k * 12), int(29 + k * 8)))

    def blob(cx, cy, rad, col, seed=0):
        """有机形状的地貌块（★ 不是随机抖动 ✗ 那样会长出星形尖刺 ✓）

        ★ 自测踩到：原来每个角度独立随机 ✗ 半径忽大忽小 → 画出来是"海胆"✓
        ★ 改成【几个低频谐波叠加】✗ 边界是连续的波浪 ✓ 像真的地块 ✓
          r(θ) = rad × (1 + 0.18 sin(2θ+a) + 0.12 sin(3θ+b) + 0.07 sin(5θ+c))
        """
        rr = random.Random(seed)
        a1, a2, a3 = rr.uniform(0, 6.28), rr.uniform(0, 6.28), rr.uniform(0, 6.28)
        pts = []
        for deg in range(0, 361, 4):
            t = math.radians(deg)
            k = (1 + 0.18 * math.sin(2 * t + a1)
                   + 0.12 * math.sin(3 * t + a2)
                   + 0.07 * math.sin(5 * t + a3))
            r = rad * k
            pts.append((cx + math.cos(t) * r, cy + math.sin(t) * r))
        d.polygon(pts, fill=col)

    zones = [
        (5.0, 5.5, 4.3, sh(SWAMP, 1.00), '沼泽'),
        (19.0, 5.5, 4.4, sh(ICE, 0.95), '冰原'),
        (5.5, 19.0, 4.5, sh(GRASS, 0.96), '荒野'),
        (19.0, 19.0, 4.7, sh(BRICK, 0.94), '城区废墟'),
        (12.5, 3.5, 2.7, sh(GRASS, 1.08), '荒野'),
        (3.6, 12.5, 2.7, sh(BRICK, 1.00), '城区'),
        (20.0, 12.5, 2.5, sh(SWAMP, 1.06), '沼泽'),
    ]
    for zi, (gx, gy, gr, col, nm) in enumerate(zones):
        blob(x0 + gx * c, y0 + gy * c, gr * c, col, seed=zi)
        T(d, x0 + gx * c, y0 + gy * c, nm, TEXT, 13, anchor='mm', bold=True)

    bx0, by0 = x0 + 10.0 * c, y0 + 10.0 * c
    bx1, by1 = x0 + 15.0 * c, y0 + 15.0 * c
    d.rectangle([bx0, by0, bx1, by1], fill=(104, 106, 112), outline=GOLD, width=3)
    T(d, (bx0 + bx1) / 2, (by0 + by1) / 2 - 9, '重生区', GOLD, 14, anchor='mm', bold=True)
    T(d, (bx0 + bx1) / 2, (by0 + by1) / 2 + 12, '僵尸进不来', DIM, 11, anchor='mm')

    for (gx, gy) in ((7, 7), (8, 7), (17, 9), (16, 17), (11, 18), (13, 6)):
        d.rectangle([x0 + gx * c - 4, y0 + gy * c - 4, x0 + gx * c + 7, y0 + gy * c + 7],
                    fill=STONE, outline=(28, 26, 24))
    T(d, x0 + 7.5 * c, y0 + 7 * c - 17, '石头台地（高处）', DIM, 11, anchor='ms')

    xs = 776
    T(d, xs, 118, '地貌', GOLD, 18, bold=True)
    rows = [('冰原', '移速 ×1.35，停下要滑', ICE),
            ('沼泽', '移速 ×0.6，有水和涟漪', SWAMP),
            ('城区废墟', '砖地，拆墙能开路', BRICK),
            ('荒野', '草地 + 石头台地', GRASS)]
    for k, (nm, desc, col) in enumerate(rows):
        yy = 150 + k * 46
        d.rectangle([xs, yy + 4, xs + 20, yy + 22], fill=col, outline=(0, 0, 0))
        T(d, xs + 28, yy, nm, TEXT, 14, bold=True)
        T(d, xs + 28, yy + 20, desc, DIM, 12)

    T(d, xs, 356, '危险度（底色）', GOLD, 18, bold=True)
    for k, t in enumerate(['中心 = 安全区', '往外 = 僵尸等级 +', '最外圈 = 高阶僵尸']):
        T(d, xs, 384 + k * 22, '· ' + t, DIM, 13)

    T(d, xs, 470, '怎么生成', GOLD, 18, bold=True)
    for k, t in enumerate([
        '1. 种子定每格高度 + 材质',
        '2. 地貌按区块成片',
        '3. 高度用低频噪声叠',
        '   有缓坡、有台地',
        '4. 台地 = 少数高点',
        '5. 冰 / 沼泽 = 整片低地',
    ]):
        T(d, xs, 498 + k * 22, t, TEXT, 12)

    T(d, 36, 786, '说明：形状 / 大小由世界种子决定；这张只定有哪些地貌。', DIM, 12)
    p = os.path.join(OUT, 'terrain-biomes.png')
    im.save(p)
    print('saved', p)


# ======================================================================
# ④ 破坏过程
# ======================================================================
def make_break():
    W, H = 1240, 812
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    T(d, 36, 24, '地形示意 4  破坏：材质硬度 · 裂纹阶段 · 碎块动画', TEXT, 26, bold=True)
    T(d, 36, 62, '每种材质有自己的"总血量"；打到 1/3、2/3 会换裂纹贴图；碎的时候掉碎块。',
      DIM, 13)

    # ---- 5 个材质方块，每个画 4 个阶段 ----
    mats = [('草丛', 1, GRASS), ('木头', 2, WOOD), ('冰', 2, ICE),
            ('砖墙', 4, BRICK), ('石头', 6, STONE)]
    bx, by = 60, 130
    BW, BH = 74, 74
    gapx, gapy = 24, 42
    y = by
    for (nm, hits, col) in mats:
        T(d, bx, y - 22, nm, TEXT, 14, bold=True)
        T(d, bx + 92, y - 22, '要 %d 下' % hits, GOLD, 13, bold=True)
        for stage in range(4):
            x = bx + 150 + stage * (BW + gapx)
            # 方块底色（越到后面越暗 ✗ 表示受损 ✓）
            k = [1.0, 0.92, 0.80, 0.66][stage]
            d.rectangle([x, y, x + BW, y + BH], fill=sh(col, k), outline=(24, 22, 20),
                        width=2)
            # 裂纹（stage 1 起 ✗ 越来越多 ✓）
            random.seed(stage * 31 + hits)
            for c in range(stage * 3):
                x1 = x + random.randint(8, BW - 8)
                y1 = y + random.randint(8, BH - 8)
                pts = [(x1, y1)]
                for _ in range(3):
                    x1 = max(x + 4, min(x + BW - 4, x1 + random.randint(-16, 16)))
                    y1 = max(y + 4, min(y + BH - 4, y1 + random.randint(-14, 14)))
                    pts.append((x1, y1))
                d.line(pts, fill=(26, 24, 22), width=2)
            # 第 4 格 = 碎了（碎块飞散）
            if stage == 3:
                random.seed(hits * 77)
                for _ in range(9):
                    cx = x + BW / 2 + random.randint(-58, 58)
                    cy = y + BH / 2 + random.randint(-46, 46)
                    s = random.randint(5, 12)
                    d.rectangle([cx, cy, cx + s, cy + s], fill=sh(col, 0.8),
                                outline=(20, 18, 16))
                d.text((x + BW / 2, y + BH / 2), '碎', font=font(22, True),
                       fill=(255, 255, 255), anchor='mm')
        y += BH + gapy

    # 阶段说明
    xs = 60
    ys = by + 5 * (BH + gapy) + 6
    T(d, xs, ys, '阶段：', GOLD, 14, bold=True)
    T(d, xs + 60, ys, '完好    裂纹 1    裂纹 2    碎（掉碎块 + 一声闷响）', TEXT, 13)

    # 右侧：为什么这么设计
    xr = 760
    T(d, xr, 130, '规则', GOLD, 17, bold=True)
    for k, t in enumerate([
        '· 每种材质有固定"硬度"（打几下）',
        '· 只有【地形块】和【树/建筑】能打 ✗',
        '  妖兽、玩家不能"拆"',
        '· 谁打都算（多人一起拆更快）',
        '· 打碎的格子变成"坑"或"碎块地"',
        '· 树倒了会砸到旁边（可选）',
        '· 建筑塌了上面的格子跟着掉',
    ]):
        T(d, xr, 158 + k * 24, t, TEXT, 13)

    T(d, xr, 350, '破坏动画（3 层）', GOLD, 17, bold=True)
    for k, t in enumerate([
        '① 命中：方块整体抖 2px + 掉 2~4 个小碎屑',
        '② 裂纹：到 1/3、2/3 换贴图 + 落灰',
        '③ 碎裂：方块炸成 6~10 块，抛物线飞散',
        '        落地沉下去消失，留一块"碎石地"',
        '        同时一声闷响（按材质不同）',
    ]):
        T(d, xr, 378 + k * 24, t, TEXT, 13)

    T(d, xr, 520, '和攻击的衔接', GOLD, 17, bold=True)
    for k, t in enumerate([
        '· 挥刀时先判"前方有没有可破坏格"',
        '· 有 → 打格子（掉耐久，不掉怪血）',
        '· 没有 → 照旧打怪',
        '· 一格打碎要 1~6 下，不打断节奏',
    ]):
        T(d, xr, 548 + k * 24, t, TEXT, 13)

    p = os.path.join(OUT, 'terrain-break.png')
    im.save(p)
    print('saved', p)


make_overview()
make_cross()
make_biomes()
make_break()
