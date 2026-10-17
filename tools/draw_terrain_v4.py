# -*- coding: utf-8 -*-
"""地形方案示意图 · 第二版（补跳跃 / 斜坡 / 小山 / 好看做法 / 破坏动画）

① terrain-overview.png  小山 + 斜坡 + 台地 + 跳跃（贴近游戏现有色调）
② terrain-jump.png      跳跃规则：只能跳 1 格、跳沟、跳不上去的墙
③ terrain-look.png      怎么做才好看：4 档对比 + 技法清单
④ terrain-break.png     破坏动画时间轴
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'docs', 'shots')
os.makedirs(OUT, exist_ok=True)

# ---- 配色：贴游戏现有画面（泥土黄褐 + 灰石 + 低饱和）----
BG     = (20, 19, 18)
TEXT   = (234, 232, 228)
DIM    = (150, 148, 142)
GOLD   = (255, 208, 74)
RED    = (255, 112, 96)
GREEN  = (130, 222, 140)
CYAN   = (130, 205, 225)

DIRT   = (122, 92, 62)      # 泥土（游戏里地面就是这色）
DIRT2  = (140, 108, 74)
GRASS  = (110, 122, 68)
GRASS2 = (126, 138, 80)
STONE  = (128, 126, 120)
STONE2 = (146, 144, 136)
BRICK  = (138, 84, 64)
WOOD   = (110, 82, 52)
ICE    = (150, 200, 218)
SWAMP  = (78, 88, 60)
WATER  = (58, 100, 112)
SAND   = (160, 142, 104)


def font(sz, bold=False):
    for p in (r'C:\Windows\Fonts\msyhbd.ttc' if bold else r'C:\Windows\Fonts\msyh.ttc',
              r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simhei.ttf'):
        if os.path.isfile(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()


# ★ 自测踩到：微软雅黑【没有】✗(U+2717) / ✓(U+2713) ✗ 画出来是两个方块 □ ✓
#   项目里的注释习惯用 ✗/✓ 当"否定/肯定"的标记 ✗ 结果全变成豆腐块 ✓
#   → 画到图上之前统一换成 × / √（这两个 CJK 字体一定有 ✓）
_GLYPH = {'✗': '×', '✓': '√',
          '✘': '×', '✅': '√', '❌': '×'}


def fix(s):
    for a, b in _GLYPH.items():
        s = s.replace(a, b)
    return s


def T(d, x, y, txt, col=TEXT, sz=14, anchor='la', bold=False):
    d.text((x, y), fix(txt), font=font(sz, bold), fill=col, anchor=anchor)


def sh(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


# ======================================================================
# 等距绘制工具
# ======================================================================
class Iso(object):
    def __init__(self, d, ox, oy, cw=84, ch=42, lv=30):
        self.d = d
        self.ox, self.oy = ox, oy
        self.cw, self.ch, self.lv = cw, ch, lv

    def px(self, x, y, h=0):
        return (self.ox + (x - y) * self.cw / 2,
                self.oy + (x + y) * self.ch / 2 - h * self.lv)

    def cube(self, x, y, h, top, side_k=0.60, face_k=0.44, skirt=None):
        """画一个格子（顶面 + 两个可见侧面）

        h    ：这一格顶面所在层数（0 = 地面）
        skirt：额外的裙边高度（0 层的格子也画一点边 → 看得出是方块）
        """
        d = self.d
        px, py = self.px(x, y, h)
        CW, CH, LV = self.cw, self.ch, self.lv
        hw, hh = CW / 2, CH / 2
        # ★ 每升一层亮 8% ✗ 高度层次一下就出来了 ✓
        #   （只有 5 层 ✗ 不会变成"发光"✓）
        top = sh(top, 1.0 + 0.08 * max(0, h))
        sd = LV * h + (skirt if skirt is not None else (0 if h else 6))
        if sd > 0:
            d.polygon([(px, py + hh), (px + hw, py + CH),
                       (px + hw, py + CH + sd), (px, py + hh + sd)],
                      fill=sh(top, side_k))
            d.polygon([(px + hw, py + CH), (px + CW, py + hh),
                       (px + CW, py + hh + sd), (px + hw, py + CH + sd)],
                      fill=sh(top, face_k))
        d.polygon([(px, py + hh), (px + hw, py), (px + CW, py + hh),
                   (px + hw, py + CH)], fill=top)
        return px, py

    def slope(self, x, y, h, top, axis='x'):
        """斜坡：一格内从 h 升到 h+1（视觉上是一块斜板）

        axis='x' → 沿 x 方向升高（右边高）
        axis='y' → 沿 y 方向升高（左边高）
        """
        d = self.d
        px, py = self.px(x, y, h)
        CW, CH, LV = self.cw, self.ch, self.lv
        hw, hh = CW / 2, CH / 2
        # 四个角（顶面菱形）
        A = (px, py + hh)              # 上
        B = (px + hw, py)              # 右
        C = (px + CW, py + hh)         # 下
        Dd = (px + hw, py + CH)        # 左
        up = LV                      # 抬高量
        if axis == 'x':
            A2, B2, C2, D2 = A, (B[0], B[1] - up), (C[0], C[1] - up), Dd
        else:
            A2, B2, C2, D2 = A, B, (C[0], C[1] - up), (Dd[0], Dd[1] - up)
        # 侧面（先画，压在下层）
        base_sd = LV * h
        d.polygon([Dd, C, (C[0], C[1] + base_sd), (Dd[0], Dd[1] + base_sd)],
                  fill=sh(top, 0.50))
        d.polygon([C, B, (B[0], B[1] + base_sd), (C[0], C[1] + base_sd)],
                  fill=sh(top, 0.66))
        # 斜面
        d.polygon([A2, B2, C2, D2], fill=sh(top, 1.10))
        # 斜面上的细纹（提示这是坡 ✗ 不是平地）
        for t in (0.25, 0.5, 0.75):
            if axis == 'x':
                p1 = (A2[0] + (C2[0] - A2[0]) * t, A2[1] + (C2[1] - A2[1]) * t)
                p2 = (D2[0] + (B2[0] - D2[0]) * t, D2[1] + (B2[1] - D2[1]) * t)
            else:
                p1 = (A2[0] + (C2[0] - A2[0]) * t, A2[1] + (C2[1] - A2[1]) * t)
                p2 = (B2[0] + (D2[0] - B2[0]) * t, B2[1] + (D2[1] - B2[1]) * t)
            d.line([p1, p2], fill=sh(top, 0.82), width=1)
        return px, py


def person(d, x, y, col=(222, 206, 162), shadow=True, lift=0):
    """两格高的小人（俯视 3/4 视角）"""
    if shadow:
        d.ellipse([x - 13, y - 6, x + 13, y + 7], fill=(20, 18, 16))
    yy = y - lift
    d.rectangle([x - 9, yy - 46, x + 9, yy - 4], fill=col, outline=(56, 48, 36), width=2)
    d.ellipse([x - 8, yy - 66, x + 8, yy - 46], fill=(214, 186, 148),
              outline=(56, 48, 36), width=2)


# ======================================================================
# ① 小山 + 斜坡 + 台地
# ======================================================================
def make_overview():
    W, H = 1280, 880
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    T(d, 36, 22, '地形示意 1  小山 · 斜坡 · 台地 · 跳跃', TEXT, 26, bold=True)
    T(d, 36, 58, '一格 = 1 层 = 一格地砖。人 2 格高；落差 ≤2 可直接走，≥3 掉落掉血。',
      DIM, 13)

    iso = Iso(d, 400, 350, 78, 39, 32)
    N = 9

    # ── 高度图 ──
    HM = {}
    for x in range(N):
        for y in range(N):
            HM[(x, y)] = [0, DIRT, None]

    # ★ 小山：按【到山心的距离】算高度 ✗ 自然成一层层的锥形 ✓
    #   （自测踩到：手排格子会长成一堆盒子 ✗ 看不出是"山"✓）
    cx, cy = 3.4, 3.4
    for x in range(N):
        for y in range(N):
            dd = math.hypot(x - cx, y - cy)
            h = int(round(3.5 - dd * 1.12))
            if h > 0:
                HM[(x, y)] = [min(3, h), GRASS, None]
    # 山顶换石头（可破坏 6 下）
    for x in range(N):
        for y in range(N):
            if HM[(x, y)][0] == 3:
                HM[(x, y)][1] = STONE
    # 西侧两条斜坡（0→1、1→2）✗ 演示"不用跳就能上山"✓
    HM[(0, 2)] = [0, GRASS, ('x', 1)]
    HM[(1, 2)] = [1, GRASS, ('x', 1)]

    # ── 石塔（独立的一个 2 层台）──
    HM[(5, 6)] = [2, STONE, None]
    HM[(6, 6)] = [1, STONE, None]
    # ── 砖地（城区边）──
    for (x, y) in ((7, 0), (8, 0), (7, 1), (8, 1)):
        HM[(x, y)] = [0, BRICK, None]
    # ── 坑（挖出来的，深 1 层）──
    HM[(0, 8)] = [-1, DIRT, None]
    # ── 跳跃演示台：1 层高的矮台 ──
    HM[(1, 7)] = [1, DIRT, None]

    keys = sorted(HM.keys(), key=lambda k: (k[0] + k[1], k[0]))
    for (x, y) in keys:
        h, mat, sl = HM[(x, y)]
        if sl:
            iso.slope(x, y, h, mat, axis=sl[0])
        else:
            iso.cube(x, y, h, mat)

    # ── 人物：站在山腰（2 层）──
    for (x, y) in keys:
        # ★ 站到"前侧"山腰（x+y 大 = 靠画面下方）✗
        #   原来挑的是最早遍历到的 2 层格 ✗ 正好在石头旁边 ✗ 标签打架 ✓
        if HM[(x, y)][0] == 2 and HM[(x, y)][1] == GRASS and x + y >= 7:
            px, py = iso.px(x, y, 2)
            cx2, cy2 = px + iso.cw / 2, py + iso.ch / 2 + 6
            person(d, cx2, cy2)
            d.line([cx2 + 20, cy2 - 4, cx2 + 20, cy2 - 64], fill=GREEN, width=2)
            T(d, cx2 + 26, cy2 - 34, '2 格', GREEN, 13, anchor='lm', bold=True)
            break

    # ── 斜坡标注 ──
    sx, sy = iso.px(0, 2, 0)
    T(d, sx - 30, sy + 6, '斜坡', GREEN, 15, anchor='rm', bold=True)
    T(d, sx - 30, sy + 26, '不用跳就能上山', GREEN, 12, anchor='rm')

    # ── 山顶石头标注 ──
    for (x, y) in keys:
        if HM[(x, y)][0] == 3:
            tx, ty = iso.px(x, y, 3)
            d.polygon([(tx, ty + iso.ch / 2), (tx + iso.cw / 2, ty),
                       (tx + iso.cw, ty + iso.ch / 2), (tx + iso.cw / 2, ty + iso.ch)],
                      outline=GOLD, width=3)
            T(d, tx + iso.cw + 6, ty + 4, '山顶石头', GOLD, 13, anchor='lm',
              bold=True)
            T(d, tx + iso.cw + 6, ty + 24, '打 6 下才碎', GOLD, 12, anchor='lm')
            break

    # ── 挖出的坑标注 ──
    kx, ky = iso.px(0, 8, -1)
    T(d, kx + iso.cw / 2, ky + iso.ch + 22, '挖出的坑（深 1 层）', DIM, 12, anchor='ma')

    # ── 跳跃弧线：地面 → 1 层矮台（只能跳 1 格）──
    j0x, j0y = iso.px(0, 7, 0)
    j1x, j1y = iso.px(1, 7, 1)
    ax0 = j0x + iso.cw / 2
    ay0 = j0y + iso.ch - 8
    ax1 = j1x + iso.cw / 2
    ay1 = j1y + iso.ch - 8
    pts = []
    for i in range(15):
        t = i / 14.0
        pts.append((ax0 + (ax1 - ax0) * t,
                    ay0 + (ay1 - ay0) * t - math.sin(t * math.pi) * 30))
    d.line(pts, fill=GOLD, width=3)
    d.polygon([(ax1 - 2, ay1 - 2), (ax1 - 12, ay1 - 12), (ax1 - 11, ay1 + 2)], fill=GOLD)
    T(d, (ax0 + ax1) / 2, (ay0 + ay1) / 2 - 46, '跳 1 格', GOLD, 13, anchor='mm',
      bold=True)

    # ---- 右侧规则 ----
    x0 = 880
    T(d, x0, 96, '高度（一格 = 1 层）', GOLD, 18, bold=True)
    for k, t in enumerate([
        '· 0 = 地面；负数 = 坑（最深 1 层）',
        '· 最高 5 层（再高会挡住视线）',
        '· 人占 2 格：头顶那格必须是空气',
        '· 落差 +1：自动迈上去（台阶）',
        '· 落差 +2：跳不上去（只能跳 1 格）',
        '             走斜坡，或者破坏掉',
        '· 落差 ≥+3：墙，跳也上不去',
    ]):
        T(d, x0, 126 + k * 23, t, TEXT, 13)

    T(d, x0, 312, '斜坡（不用跳就能走上去）', GOLD, 18, bold=True)
    for k, t in enumerate([
        '· 斜坡也是【一格】✗ 只是顶面是斜面 ✓',
        '· 走进去 → 高度连续上升 ✗ 不减速 ✓',
        '· 爬山必须靠它 ✗ 光有台阶会爬得很烦 ✓',
        '· 生成规则：山体外圈自动铺一圈斜坡 ✓',
    ]):
        T(d, x0, 342 + k * 23, t, TEXT, 13)

    T(d, x0, 452, '小山（这样才像"地形"）', GOLD, 18, bold=True)
    for k, t in enumerate([
        '· 山不是"一堵墙"✗ 是一圈一圈矮下去 ✓',
        '· 按【到山心的距离】算高度 ✗ 自然成锥形 ✓',
        '· 每圈只差 1 层 → 配合斜坡就能爬 ✓',
        '· 山顶放石头 → 能拆开、能居高临下 ✓',
        '· 山脚留 1~2 格平地 → 好摆阵 ✓',
    ]):
        T(d, x0, 482 + k * 23, t, TEXT, 13)

    T(d, 36, 822, '说明：形状由世界种子决定；这张只定"有哪些要素、比例多大"。', DIM, 12)
    p = os.path.join(OUT, 'terrain-overview.png')
    im.save(p)
    print('saved', p)


# ======================================================================
# ② 跳跃规则
# ======================================================================
def make_jump():
    """★ 重写成 4 个独立小场景 ✗ 原来塞在一张里 ✗ 方块和弧线全对不上 ✓"""
    W, H = 1280, 780
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    T(d, 36, 22, '地形示意 2  跳跃规则：只能跳 1 格高', TEXT, 26, bold=True)
    T(d, 36, 58, '跳跃 = 1 格高度 + 0.35 秒滞空。所以 2 格以上的落差错不开，只能靠斜坡或破坏。',
      DIM, 13)

    PW, PH = 288, 340
    GAP = 20
    X0, Y0 = 36, 104
    U = 50            # 一格的边长（像素）
    BASE = 258        # 格子底边在面板里的 y

    def panel(i, title, sub, col):
        ox = X0 + i * (PW + GAP)
        d.rectangle([ox, Y0, ox + PW, Y0 + PH], fill=(27, 26, 24))
        T(d, ox + 14, Y0 + 12, title, col, 15, bold=True)
        T(d, ox + 14, Y0 + 34, sub, DIM, 11)
        return ox

    def blk(ox, gx, gy_top, wu, hu, col, outline=True):
        """画一摞方块：gx = 左边缘格数，hu = 高几层，gy_top 忽略"""
        for lv in range(hu):
            x1 = ox + gx * U
            y1 = Y0 + BASE - (lv + 1) * U
            d.rectangle([x1, y1, x1 + wu * U - 2, Y0 + BASE - lv * U],
                        fill=sh(col, 1.0 - lv * 0.10),
                        outline=(30, 28, 26) if outline else None, width=1)

    def ground(ox, gx0, gx1):
        d.line([ox + gx0 * U, Y0 + BASE, ox + gx1 * U, Y0 + BASE],
               fill=(60, 58, 54), width=2)

    def figure(ox, gx, top_h):
        """小人（2 格高），脚在 top_h 层"""
        fx = ox + gx * U + U / 2
        fy = Y0 + BASE - top_h * U
        d.ellipse([fx - 11, fy - 4, fx + 11, fy + 6], fill=(24, 22, 20))
        d.rectangle([fx - 8, fy - 42, fx + 8, fy - 2], fill=(222, 206, 162),
                    outline=(56, 48, 36), width=2)
        d.ellipse([fx - 7, fy - 60, fx + 7, fy - 42], fill=(214, 186, 148),
                  outline=(56, 48, 36), width=2)
        return fx, fy

    def arc(ox, gx0, h0, gx1, h1, col, lift=34, dash=False):
        ax = ox + gx0 * U + U / 2
        ay = Y0 + BASE - h0 * U
        bx = ox + gx1 * U + U / 2
        by = Y0 + BASE - h1 * U
        pts = []
        for i in range(17):
            t = i / 16.0
            pts.append((ax + (bx - ax) * t,
                        ay + (by - ay) * t - math.sin(t * math.pi) * lift))
        d.line(pts, fill=col, width=3)
        # 箭头
        d.polygon([(bx, by), (bx - 11, by - 9), (bx - 9, by + 5)], fill=col)

    # ---------- A：0 → 1 层，能跳 ----------
    ox = panel(0, 'A · 跳 1 格  ✓', '1 格高的台子：能跳上去', GREEN)
    ground(ox, 0, 5)
    blk(ox, 0, 0, 1, 1, DIRT)
    blk(ox, 1, 0, 1, 1, DIRT)
    blk(ox, 3, 0, 2, 1, GRASS)
    arc(ox, 1, 0, 3, 1, GOLD, lift=62)
    figure(ox, 1, 0)
    T(d, ox + 1.4 * U - 10, Y0 + BASE - 104, '跳 1 格 ✓', GOLD, 12, anchor='lm',
      bold=True)
    T(d, ox + 14, Y0 + 300, '也能直接走上去（台阶）', DIM, 11)

    # ---------- B：0 → 3 层，跳不上去 ----------
    ox = panel(1, 'B · 3 层  ×', '只能跳 1 格，3 层跳不上去', RED)
    ground(ox, 0, 5)
    blk(ox, 0, 0, 2, 1, DIRT)
    blk(ox, 2, 0, 2, 3, STONE)
    arc(ox, 1, 0, 2, 3, RED, lift=66)
    mx = ox + 2 * U
    my = Y0 + BASE - 3 * U + 10
    d.line([mx - 11, my - 11, mx + 11, my + 11], fill=RED, width=4)
    d.line([mx - 11, my + 11, mx + 11, my - 11], fill=RED, width=4)
    figure(ox, 1, 0)
    T(d, ox + 14, Y0 + 300, '要么绕路，要么把石头打碎', DIM, 11)

    # ---------- C：跳过 1 格坑 ----------
    ox = panel(2, 'C · 跨坑  ✓', '1 格宽的坑跳得过去', GREEN)
    ground(ox, 0, 5)
    blk(ox, 0, 0, 1, 1, GRASS)
    blk(ox, 1, 0, 1, 1, DIRT)
    blk(ox, 2, 0, 1, 1, GRASS)
    # 坑挖掉
    d.rectangle([ox + 2 * U + 1, Y0 + BASE - U + 1,
                 ox + 3 * U - 1, Y0 + BASE], fill=BG)
    d.polygon([(ox + 2 * U + 1, Y0 + BASE - U + 1),
               (ox + 3 * U - 1, Y0 + BASE - U + 1),
               (ox + 3 * U - 1, Y0 + BASE - U + 14),
               (ox + 2 * U + 1, Y0 + BASE - U + 14)], fill=(48, 40, 32))
    T(d, ox + 2.5 * U, Y0 + BASE + 8, '坑', DIM, 11, anchor='ma')
    arc(ox, 1, 1, 3, 1, GOLD, lift=40)
    figure(ox, 1, 1)
    T(d, ox + 14, Y0 + 300, '2 格宽的坑就跳不过去了', DIM, 11)

    # ---------- D：斜坡，不用跳 ----------
    ox = panel(3, 'D · 斜坡  ✓', '不用跳，走上去就行', CYAN)
    ground(ox, 0, 5)
    blk(ox, 0, 0, 1, 1, GRASS)
    # 斜坡（一个斜面）
    x1 = ox + 1 * U
    x2 = ox + 2 * U
    ylo = Y0 + BASE - 1 * U
    yhi = Y0 + BASE - 2 * U
    d.polygon([(x1, ylo), (x2 - 2, yhi), (x2 - 2, Y0 + BASE),
               (x1, Y0 + BASE)], fill=sh(GRASS, 1.10), outline=(30, 28, 26))
    for t in (0.3, 0.6):
        px = x1 + (x2 - x1) * t
        py = ylo + (yhi - ylo) * t
        d.line([(px, py), (px, Y0 + BASE)], fill=sh(GRASS, 0.82), width=1)
    blk(ox, 2, 0, 2, 2, GRASS)
    # 走上坡的虚线
    pts = []
    for i in range(11):
        t = i / 10.0
        pts.append((ox + 0.5 * U + t * 1.5 * U,
                    Y0 + BASE - (t * 2.0) * U))
    d.line(pts, fill=CYAN, width=3)
    d.polygon([(ox + 2.0 * U, Y0 + BASE - 2 * U),
               (ox + 2.0 * U - 12, Y0 + BASE - 2 * U + 8),
               (ox + 2.0 * U - 2, Y0 + BASE - 2 * U + 14)], fill=CYAN)
    figure(ox, 1, 1)
    T(d, ox + 14, Y0 + 300, '爬山的唯一正路 ✓', DIM, 11)

    # ---- 底部：规则 ----
    yb = 470
    T(d, 36, yb, '跳跃的规则（初版数值）', GOLD, 18, bold=True)
    rules = [
        ('跳跃高度', '1 格（= 1.0 × 层高）'),
        ('滞空时间', '0.35 秒'),
        ('起跳速度', '4.2（水平跑速是 4.4，跳不会变快）'),
        ('冷却', '0.15 秒（不能连跳刷位移）'),
        ('空中控制', '可以转向，但不能加速'),
        ('冷却/衔接', '跳完落地才开始算掉血（落差 ≥3）'),
    ]
    for i, (k, v) in enumerate(rules):
        cx = 36 + (i % 3) * 410
        cy = yb + 40 + (i // 3) * 60
        T(d, cx, cy, k, CYAN, 13, bold=True)
        T(d, cx, cy + 20, v, TEXT, 12)

    T(d, 36, yb + 40 + 2 * 60 + 16,
      '★ 关键：跳跃【只能 +1 格】✗ 所以"上不去的台子"是常态 ✓ 这就是斜坡和破坏系统的用处 ✓',
      GOLD, 13, bold=True)
    T(d, 36, yb + 40 + 2 * 60 + 42,
      '★ 跳跃按钮放在攻击键【左下角】✗ 拇指不用挪 ✓ 和现有按键布局一致 ✓', DIM, 12)

    p = os.path.join(OUT, 'terrain-jump.png')
    im.save(p)
    print('saved', p)


# ======================================================================
# ③ 怎么做才好看（4 档对比）
# ======================================================================
def make_look():
    W, H = 1380, 1000
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    T(d, 36, 22, '地形示意 3  怎么做才好看：4 档逐层加技法', TEXT, 26, bold=True)
    T(d, 36, 58, '同一个山头画四遍 ✗ 每格加一层处理 ✓ 你能直接看出哪一步带来了"立体感"。',
      DIM, 13)

    # 四个小图并排
    CW, CH, LV = 46, 23, 17
    pw, ph = 320, 300
    gap = 16
    x00, y00 = 36, 110

    def patch(ox, oy, level):
        """level: 1=纯色 2=+侧面明暗 3=+接触阴影/投影 4=+边缘高光+草边"""
        # 高度图（一个小山包）
        hm = {}
        N = 7
        for x in range(N):
            for y in range(N):
                dd = math.hypot(x - 3, y - 3)
                h = max(0, 3 - int(dd * 1.15))
                hm[(x, y)] = h

        def px(x, y, h):
            return (ox + (x - y) * CW / 2, oy + (x + y) * CH / 2 - h * LV)

        keys = sorted(hm.keys(), key=lambda k: (k[0] + k[1], k[0]))
        # 投影（第 3 档起）
        if level >= 3:
            for (x, y) in keys:
                h = hm[(x, y)]
                ax, ay = px(x, y, 0)
                # 只要高处的格子投影
                if h >= 2:
                    d.polygon([(ax + 4, ay + CH / 2 + 10), (ax + CW / 2 + 4, ay + 10),
                               (ax + CW + 4, ay + CH / 2 + 10),
                               (ax + CW / 2 + 4, ay + CH + 10)],
                              fill=(26, 24, 22))
        for (x, y) in keys:
            h = hm[(x, y)]
            ax, ay = px(x, y, h)
            hw, hh = CW / 2, CH / 2
            col = GRASS2 if h >= 2 else GRASS
            sd = LV * h + (0 if h else 4)
            if level >= 2:
                # 侧面：越靠近地面越暗（接触阴影 ✓ 第 3 档加强）
                for lvi in range(sd):
                    k = 0.72 - (0.30 if level >= 3 else 0.12) * (lvi / max(1, sd))
                    d.polygon([(ax, ay + hh + lvi), (ax + hw, ay + CH + lvi),
                               (ax + hw, ay + CH + lvi + 1), (ax, ay + hh + lvi + 1)],
                              fill=sh(col, k))
                    d.polygon([(ax + hw, ay + CH + lvi), (ax + CW, ay + hh + lvi),
                               (ax + CW, ay + hh + lvi + 1),
                               (ax + hw, ay + CH + lvi + 1)],
                              fill=sh(col, k - 0.10))
            else:
                if sd > 0:
                    d.polygon([(ax, ay + hh), (ax + hw, ay + CH),
                               (ax + hw, ay + CH + sd), (ax, ay + hh + sd)],
                              fill=sh(col, 0.75))
                    d.polygon([(ax + hw, ay + CH), (ax + CW, ay + hh),
                               (ax + CW, ay + hh + sd), (ax + hw, ay + CH + sd)],
                              fill=sh(col, 0.62))
            # 顶面
            d.polygon([(ax, ay + hh), (ax + hw, ay), (ax + CW, ay + hh),
                       (ax + hw, ay + CH)], fill=col)
            if level >= 4:
                # 边缘高光（顶面上沿）
                d.line([(ax, ay + hh), (ax + hw, ay), (ax + CW, ay + hh)],
                       fill=sh(col, 1.30), width=1)
                # 草边：顶面靠外一圈深一点（假 AO）
                d.polygon([(ax, ay + hh), (ax + hw, ay + 3),
                           (ax + CW, ay + hh), (ax + hw, ay + CH)],
                          outline=sh(col, 0.78))

    names = [
        (1, 'A · 纯色方块', '现在的地面就是这样 ✗ 平的', RED),
        (2, 'B · 侧面明暗', '每层固定亮度 → 能看出高度', GOLD),
        (3, 'C · 接触阴影 + 投影', '★ 立体感主要来自这一步', GREEN),
        (4, 'D · 边缘高光 + 草边 + 纹理', '最终想要的效果', CYAN),
    ]
    for i, (lv, nm, desc, col) in enumerate(names):
        ox = x00 + i * (pw + gap)
        d.rectangle([ox, y00, ox + pw, y00 + ph], fill=(28, 26, 24))
        patch(ox + pw / 2 - 60, y00 + 44, lv)
        T(d, ox + 14, y00 + ph - 52, nm, col, 15, bold=True)
        T(d, ox + 14, y00 + ph - 30, desc, DIM, 12)

    # 下部：技法清单
    y1 = 470
    T(d, 36, y1, '具体怎么做（按性价比排序）', GOLD, 18, bold=True)

    items = [
        ('1', '侧面每层固定亮度', 'h=0 的侧面 0.72，越高越暗/越亮都要【统一】✗ '
                                '不然同一层一半亮一半暗 ✓', '1 行代码'),
        ('2', '接触阴影（假 AO）', '侧面【靠近底面】的那几行像素压暗 ✗ 顶面靠边一圈也压暗 ✓ '
                                  '这一步收益最大 ✓', '顶点色 / shader'),
        ('3', '高处投影到低处', '比邻居高的格子 ✗ 在低处投一个软椭圆/菱形阴影 ✓ '
                              '人在山上时影子落在山下 ✓', '一次 draw call'),
        ('4', '顶面上沿高光', '顶面的上两条边提亮 ✗ 像被天光照到 ✓ 一下就"凸"起来了 ✓',
         '顶点色'),
        ('5', '边缘长草/碎石', '台地边缘不要是【直边】✗ 撒一圈小草/碎石精灵 ✓ '
                             '遮住方块感 ✓', '实例化 sprite'),
        ('6', '每层高度不一致', '所有格子一样高会像【棋盘】✗ 让顶面有 ±2px 随机偏移 ✓ '
                              '（只是视觉 ✗ 不改碰撞 ✓）', '顶点抖动'),
        ('7', '远景雾', '远处按距离淡出到背景色 ✓ 盖住区块边界 ✓ 也省性能 ✓',
         '已有 fog'),
    ]
    for i, (n, nm, desc, cost) in enumerate(items):
        yy = y1 + 34 + i * 56
        d.rectangle([36, yy, 66, yy + 30], fill=(44, 42, 38))
        T(d, 51, yy + 15, n, GOLD, 16, anchor='mm', bold=True)
        T(d, 80, yy, nm, TEXT, 15, bold=True)
        T(d, 80, yy + 20, desc, DIM, 12)
        T(d, 1130, yy + 8, cost, CYAN, 12)

    T(d, 36, 928, '★ A → B 只要一行代码，但 B → C（接触阴影）才是"看起来像地形"的关键。',
      GOLD, 13, bold=True)
    T(d, 36, 954, '★ D 的"边缘长草"要等美术资源 ✗ 先用棋盘格 + 顶点色也能到 80% 的效果 ✓',
      DIM, 12)
    p = os.path.join(OUT, 'terrain-look.png')
    im.save(p)
    print('saved', p)


# ======================================================================
# ④ 破坏动画时间轴
# ======================================================================
def make_break():
    """★ 重排：时间轴+方块在第一行，说明放第二行 ✗ 原来右栏和方块挤在一起 ✓"""
    W, H = 1380, 820
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    T(d, 36, 22, '地形示意 4  破坏动画：时间轴 + 四层实现', TEXT, 26, bold=True)
    T(d, 36, 58, '一次破坏 = 命中反馈（每刀）+ 裂纹（三段）+ 碎裂（0.6 秒）+ 尘烟。',
      DIM, 13)

    # ---- 第一行：时间轴 + 5 个阶段方块 ----
    BW = 92
    base_y = 230
    xs = [90 + i * 202 for i in range(5)]
    marks = ['第 1 刀', '第 2 刀', '第 3 刀', '第 5 刀', '最后一刀']
    subs = ['完好 → 裂一道', '裂纹变成一片', '再补，快碎了', '快到临界', '整块碎掉']
    ty = 130
    d.line([70, ty, 990, ty], fill=(58, 56, 52), width=2)
    for i, mx in enumerate(xs):
        cx = mx + BW / 2
        d.ellipse([cx - 7, ty - 7, cx + 7, ty + 7], fill=GOLD)
        T(d, cx, ty - 26, marks[i], TEXT, 13, anchor='mm', bold=True)

    stages = [(0, '完好'), (2, '裂'), (4, '裂'), (5, '裂'), (6, '碎')]
    for i, (hits, nm) in enumerate(stages):
        x = xs[i]
        k = [1.0, 0.94, 0.86, 0.78, 0.60][i]
        col = sh(STONE, k)
        d.rectangle([x, base_y, x + BW, base_y + BW], fill=col,
                    outline=(26, 24, 22), width=2)
        # 裂纹（前 4 格）+ 碎块（最后一格）
        rr = random.Random(hits * 17 + 3)
        if i < 4:
            for _c in range(hits):
                x1 = x + rr.randint(10, BW - 10)
                y1 = base_y + rr.randint(10, BW - 10)
                pts = [(x1, y1)]
                for _ in range(3):
                    x1 = max(x + 5, min(x + BW - 5, x1 + rr.randint(-20, 20)))
                    y1 = max(base_y + 5, min(base_y + BW - 5, y1 + rr.randint(-18, 18)))
                    pts.append((x1, y1))
                d.line(pts, fill=(24, 22, 20), width=2)
        else:
            rr2 = random.Random(99)
            for _ in range(10):
                cx2 = x + BW / 2 + rr2.randint(-70, 70)
                cy2 = base_y + BW / 2 + rr2.randint(-56, 56)
                s2 = rr2.randint(6, 14)
                d.rectangle([cx2, cy2, cx2 + s2, cy2 + s2], fill=sh(STONE, 0.9),
                            outline=(24, 22, 20))
            d.text((x + BW / 2, base_y + BW / 2), '碎', font=font(24, True),
                   fill=(255, 255, 255), anchor='mm')
        T(d, x + BW / 2, base_y + BW + 14, nm, TEXT, 13, anchor='ma', bold=True)
        T(d, x + BW / 2, base_y + BW + 34, subs[i], DIM, 11, anchor='ma')

    # ---- 第二行左：四层实现 ----
    y2 = 400
    T(d, 36, y2, '四层动画（按"每刀都做 / 只在碎时做"分）', GOLD, 18, bold=True)
    layers = [
        ('① 命中抖动', '模型沿【受击方向】位移 2px，0.08 秒回弹',
         '改 mesh.position ★ 每刀都做', 60),
        ('② 碎屑粒子', '每次命中掉 3~5 个小方块，抛出去 0.5 秒',
         '对象池 32 个 ★ 每刀都做', 120),
        ('③ 裂纹贴图', '三张裂纹图，按血量切（1/3、2/3）',
         '同材质共用 3 张图 · 只在过阈值时换', 180),
        ('④ 碎裂 + 尘烟', '炸成 8~12 块抛物线飞散，落地淡出；一团尘烟',
         'InstancedMesh 一次画完 · 只在最后一下', 240),
    ]
    for i, (nm, desc, how, dy) in enumerate(layers):
        yy = y2 + 36 + dy - 60 + 24
        d.rectangle([36, yy, 40, yy + 52], fill=GOLD)
        T(d, 50, yy, nm, TEXT, 15, bold=True)
        T(d, 50, yy + 21, desc, DIM, 12)
        T(d, 50, yy + 39, how, CYAN, 11)

    # ---- 第二行右：为什么 ----
    xr = 740
    T(d, xr, y2, '为什么这样分', GOLD, 18, bold=True)
    for k, t in enumerate([
        '· 第 ①②层【每一刀都有】✗ 打击感全靠它 ✓',
        '  少了这两层 ✗ 会觉得在打空气 ✓',
        '· 第 ③层让玩家【看得出还要几刀】',
        '  没有裂纹的话 ✗ 不知道什么时候碎 ✓',
        '· 第 ④层是奖励 ✗ 6 刀才一次 ✓',
        '  所以可以做得夸张一点 ✓',
        '',
        '耗时（手机实测目标）：',
        '  普通一刀 ~3ms（抖动 + 3 个粒子）',
        '  碎的那一刀 ~8ms（10 块 + 尘烟）',
    ]):
        c = CYAN if t.startswith('  ') else TEXT
        T(d, xr, y2 + 38 + k * 24, t, c, 12)

    T(d, 36, 720, '★ 关键：命中抖动和碎屑必须【同帧】出现 ✗ 有延迟就没有打击感了 ✓',
      GOLD, 13, bold=True)
    T(d, 36, 748, '★ 裂纹贴图三张就够 ✗ 不用做动画 ✓ 换图那一瞬间玩家会自己"听到"进度 ✓',
      DIM, 12)
    T(d, 36, 774, '★ 碎块落地要【马上消失】✗ 留在地上会越积越多 ✓ 只留一块"碎石地"纹理 ✓',
      DIM, 12)

    p = os.path.join(OUT, 'terrain-break.png')
    im.save(p)
    print('saved', p)


make_overview()
make_jump()
make_look()
make_break()
