# -*- coding: utf-8 -*-
"""流体（清水 / 污水 / 灵泉 / 地火）示意图

① fluid-world.png —— 3/4 视角：湖 + 沼泽浅水 + 地火裂隙 + 引水浇成石头
② fluid-flow.png  —— 流动规则：水位 0~7 / 先下后横 / 活跃集合预算
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'docs', 'shots')
os.makedirs(OUT, exist_ok=True)

BG    = (20, 19, 18)
CARD  = (28, 27, 25)
TEXT  = (234, 232, 228)
DIM   = (150, 148, 142)
GOLD  = (255, 208, 74)
RED   = (255, 112, 96)
GREEN = (130, 222, 140)
CYAN  = (130, 205, 225)

DIRT   = (122, 92, 62)
GRASS  = (110, 122, 68)
STONE  = (128, 126, 120)
LAVA   = (240, 110, 40)
LAVA2  = (255, 180, 60)
WATER  = (78, 150, 168)
WATER2 = (110, 190, 205)
DARK   = (52, 78, 80)
SPIRIT = (150, 230, 240)
SWAMP  = (70, 88, 58)


def font(sz, bold=False):
    for p in (r'C:\Windows\Fonts\msyhbd.ttc' if bold else r'C:\Windows\Fonts\msyh.ttc',
              r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simhei.ttf'):
        if os.path.isfile(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()


_GLYPH = {'\u2717': '\u00d7', '\u2713': '\u221a',
          '\u2718': '\u00d7', '\u2705': '\u221a', '\u274c': '\u00d7'}


def fix(s):
    for a, b in _GLYPH.items():
        s = s.replace(a, b)
    return s


def T(d, x, y, txt, col=TEXT, sz=14, anchor='la', bold=False):
    d.text((x, y), fix(txt), font=font(sz, bold), fill=col, anchor=anchor)


def sh(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


class Iso(object):
    def __init__(self, d, ox, oy, cw=80, ch=40, lv=30):
        self.d = d
        self.ox, self.oy = ox, oy
        self.cw, self.ch, self.lv = cw, ch, lv

    def px(self, x, y, h=0):
        return (self.ox + (x - y) * self.cw / 2,
                self.oy + (x + y) * self.ch / 2 - h * self.lv)

    def cube(self, x, y, h, top):
        d = self.d
        px, py = self.px(x, y, h)
        CW, CH, LV = self.cw, self.ch, self.lv
        hw, hh = CW / 2, CH / 2
        sd = LV * h + (0 if h else 4)
        top = sh(top, 1.0 + 0.07 * max(0, h))
        if sd > 0:
            d.polygon([(px, py + hh), (px + hw, py + CH),
                       (px + hw, py + CH + sd), (px, py + hh + sd)],
                      fill=sh(top, 0.60))
            d.polygon([(px + hw, py + CH), (px + CW, py + hh),
                       (px + CW, py + hh + sd), (px + hw, py + CH + sd)],
                      fill=sh(top, 0.44))
        d.polygon([(px, py + hh), (px + hw, py), (px + CW, py + hh),
                   (px + hw, py + CH)], fill=top)

    def fluid(self, x, y, h, frac, col, alpha=1.0, glow=None):
        """流体层：frac = 占一格的百分比高度（1.0 = 满 ✓）"""
        d = self.d
        px, py = self.px(x, y, h)
        CW, CH, LV = self.cw, self.ch, self.lv
        hw, hh = CW / 2, CH / 2
        up = LV * frac
        # 顶上那层
        d.polygon([(px, py + hh - up), (px + hw, py - up),
                   (px + CW, py + hh - up), (px + hw, py + CH - up)], fill=col)
        # 前沿的"厚度"
        if up > 2:
            d.polygon([(px, py + hh - up), (px + hw, py + CH - up),
                       (px + hw, py + CH), (px, py + hh)], fill=sh(col, 0.66))
            d.polygon([(px + hw, py + CH - up), (px + CW, py + hh - up),
                       (px + CW, py + hh), (px + hw, py + CH)], fill=sh(col, 0.48))


# ======================================================================
# ① 世界里的流体
# ======================================================================
def make_world():
    W, H = 1320, 880
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    T(d, 36, 22, '流体示意 1  清水 · 污水 · 灵泉 · 地火', TEXT, 26, bold=True)
    T(d, 36, 58, '流体是【凹坑里的水面】✗ 不是水墙 ✓ 水面高度 = 坑底 + 深度 ✓', DIM, 13)

    iso = Iso(d, 500, 340, 70, 35, 30)
    N = 10

    # ★ 整体是【平原】h=1 ✗ 上面挖三个凹坑 ✓
    #   自测踩到：给后方堆一块 h=2 的石头高地 ✗ 整张图只剩那块灰板 ✓
    HM = {}
    for x in range(N):
        for y in range(N):
            HM[(x, y)] = 1.0
    for (x, y) in ((7, 1), (8, 1), (7, 2)):
        HM[(x, y)] = 2.0
    for (x, y) in ((1, 2), (2, 2)):
        HM[(x, y)] = 1.6
    for x in range(2, 6):
        for y in range(3, 7):
            HM[(x, y)] = 0.0
    for x in range(0, 2):
        for y in range(6, 10):
            HM[(x, y)] = 0.0
    for (x, y) in ((7, 7), (8, 7), (7, 8), (8, 8), (9, 8)):
        HM[(x, y)] = 0.0
    for x in range(5, 7):
        HM[(x, 6)] = 0.0

    keys = sorted(HM.keys(), key=lambda k: (k[0] + k[1], k[0]))
    for (x, y) in keys:
        h = HM[(x, y)]
        mat = STONE if h >= 1.9 else (DIRT if (x * 7 + y * 3) % 5 == 0 else GRASS)
        iso.cube(x, y, h, mat)

    for x in range(2, 6):
        for y in range(3, 7):
            iso.fluid(x, y, 0.0, 0.82, WATER)
    iso.fluid(3, 5, 0.0, 0.88, SPIRIT)
    for i, x in enumerate(range(5, 7)):
        iso.fluid(x, 6, 0.0, 0.72 - i * 0.20, WATER2)
    for x in range(0, 2):
        for y in range(6, 10):
            iso.fluid(x, y, 0.0, 0.55, (44, 64, 44))
    for (x, y) in ((7, 7), (8, 7), (7, 8), (8, 8), (9, 8)):
        iso.fluid(x, y, 0.0, 0.90, LAVA)
        px, py = iso.px(x, y, 0.0)
        d.polygon([(px + iso.cw * 0.25, py + iso.ch * 0.5),
                   (px + iso.cw * 0.5, py + iso.ch * 0.22),
                   (px + iso.cw * 0.72, py + iso.ch * 0.5),
                   (px + iso.cw * 0.5, py + iso.ch * 0.7)], fill=LAVA2)
    px, py = iso.px(7, 7, 0.0)
    d.polygon([(px, py + iso.ch / 2), (px + iso.cw / 2, py),
               (px + iso.cw, py + iso.ch / 2), (px + iso.cw / 2, py + iso.ch)],
              fill=sh(STONE, 1.25), outline=(250, 250, 250), width=2)

    T(d, 300, 230, '清水湖', CYAN, 15, bold=True)
    T(d, 300, 252, '能游 · 能灭火', DIM, 12)
    T(d, 110, 700, '沼泽污水', (150, 180, 140), 15, bold=True)
    T(d, 110, 722, '减速 ×0.45 · 腐蚀', DIM, 12)
    T(d, 800, 690, '地火裂隙', LAVA2, 15, bold=True)
    T(d, 800, 712, '烫伤 + 灼烧', DIM, 12)
    T(d, 690, 240, '引水浇地火 → 凝固成石头', GREEN, 14, bold=True)
    T(d, 690, 262, '凝固之后能踩着走过去', DIM, 12)
    px, py = iso.px(3, 5, 0.0)
    T(d, px + iso.cw / 2, py + 2, '灵泉', SPIRIT, 12, anchor='mm', bold=True)

    # ---- 右边 ----
    x0 = 1030
    T(d, x0, 250, '四种流体', GOLD, 17, bold=True)
    rows = [('清水', '游 / 灭火', WATER), ('灵泉', '回灵气', SPIRIT),
            ('污水', '腐蚀', (46, 66, 44)), ('地火', '烫伤', LAVA)]
    for k, (nm, desc, col) in enumerate(rows):
        yy = 280 + k * 34
        d.rectangle([x0, yy + 3, x0 + 18, yy + 19], fill=col, outline=(0, 0, 0))
        T(d, x0 + 26, yy, nm, TEXT, 13, bold=True)
        T(d, x0 + 90, yy, desc, DIM, 12)

    T(d, x0, 440, '水 + 地火 = 石头', GOLD, 17, bold=True)
    for k, t in enumerate([
        '★ 最聪明的设计：',
        '   把"危险"变成"工具"',
        '   玩家会主动引水造路 ✓',
        '',
        '★ 反过来也能用：',
        '   地火浇成石头 → 安全区',
    ]):
        T(d, x0, 468 + k * 22, t, GREEN if k < 3 else DIM, 12)

    T(d, 36, 820, '说明：水面高度 = 坑底 + 深度 ✗ 所以浅的地方能看见坑底 ✓', DIM, 12)
    p = os.path.join(OUT, 'fluid-world.png')
    im.save(p)
    print('saved', p)


# ======================================================================
# ② 流动规则
# ======================================================================
def make_flow():
    W, H = 1340, 900
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    T(d, 36, 22, '流体示意 2  流动规则（照抄 MC ✗ 但简化）', TEXT, 26, bold=True)
    T(d, 36, 58, '等级 0 = 源头（满）✗ 1~7 = 流出来的（越流越浅）✗ 水铺 7 格 ✗ 地火只铺 3 格。',
      DIM, 13)

    # ---- A：先往下 ----
    U = 46
    base = 302
    x0 = 70
    T(d, 60, 96, 'A · 先往下 ✗ 下面堵住才横着流', GOLD, 16, bold=True)
    hs = [3, 3, 2, 2, 1, 1, 0, 0, 1]
    for i, h in enumerate(hs):
        for lv in range(h):
            y1 = base - (lv + 1) * U
            d.rectangle([x0 + i * U, y1, x0 + (i + 1) * U - 2, base - lv * U],
                        fill=sh(GRASS, 1.0 - lv * 0.10), outline=(28, 26, 24))
    seq = [(0, 3, 0.95), (1, 3, 0.60), (2, 2, 0.95), (3, 2, 0.55),
           (4, 1, 0.95), (5, 1, 0.50), (6, 0, 0.85), (7, 0, 0.45), (8, 1, 0.0)]
    for (i, h, frac) in seq:
        if frac <= 0:
            continue
        x1 = x0 + i * U
        ytop = base - h * U
        hgt = U * frac
        d.rectangle([x1 + 2, ytop - hgt, x1 + U - 4, ytop], fill=WATER)
        d.rectangle([x1 + 2, ytop - hgt, x1 + U - 4, ytop - hgt + 3],
                    fill=sh(WATER, 1.28))
    T(d, x0 + U * 0.5, base - 3 * U - 6, '源头', CYAN, 12, anchor='ms', bold=True)
    T(d, x0 + U * 6.4, base + 10, '越流越浅 → 最后没有', DIM, 12, anchor='ma')

    # ---- B：水位表 ----
    yb = 400
    T(d, 36, yb, 'B · 水位（等级 → 占一格的多少）', GOLD, 16, bold=True)
    BW2, BH2 = 92, 70
    gap = 16
    BX = 60
    BY = yb + 60
    for lv in range(0, 8):
        x = BX + lv * (BW2 + gap)
        frac = 1.0 - lv / 8.0
        d.rectangle([x, BY, x + BW2, BY + BH2], fill=sh(DIRT, 0.75),
                    outline=(28, 26, 24))
        hgt = BH2 * frac
        d.rectangle([x + 2, BY + BH2 - hgt, x + BW2 - 2, BY + BH2], fill=WATER)
        T(d, x + BW2 / 2, BY - 24, 'L%d' % lv, TEXT, 13, anchor='mm', bold=True)
        T(d, x + BW2 / 2, BY + BH2 + 8, '%d/8' % (8 - lv), DIM, 11, anchor='ma')
    T(d, BX + 4 * (BW2 + gap) - gap / 2, BY + BH2 + 32,
      '源头 L0 = 满格 ✗ L7 = 只剩 1/8（几乎看不见 ✗ 快没了）', DIM, 12, anchor='ma')

    # ---- C / D ----
    yc = 570
    T(d, 36, yc, 'C · 每次只处理"活跃"的格子（这条决定成败）', GOLD, 16, bold=True)
    d.rectangle([36, yc + 34, 640, yc + 168], fill=CARD)
    for k, t in enumerate([
        '· 只有【被破坏 / 被改 / 玩家走近】的格子进 active 集合',
        '· 每 tick 最多处理 120 格 ✗ 处理不完留到下 tick',
        '· 一格都不活跃时 → 这个系统【完全不花钱】',
        '· 玩家走远 → 那片水冻结 ✗ 回来再平衡一次',
        '  （看不见的地方 ✗ 玩家也发现不了 ✓）',
    ]):
        T(d, 52, yc + 50 + k * 24, t, TEXT, 12)

    xr = 680
    T(d, xr, yc, '为什么不能"全世界都在流"', GOLD, 16, bold=True)
    for k, t in enumerate([
        '★ 4096 格 × 4 方向 × 30Hz',
        '  = 每秒 50 万次 ✗ 手机直接死',
        '',
        '★ MC 有专门的流体线程 ✗ 而且只模拟加载区',
        '  这边只有一个 tick 线程',
        '  还要跑僵尸 / 交易所 / 掉落',
        '  → 必须【有预算地模拟】',
        '',
        '★ 实测目标：满负荷 120 格/帧 ≈ 0.3ms',
    ]):
        T(d, xr, yc + 34 + k * 23, t, CYAN if t.startswith('★') else DIM, 12)

    T(d, 36, 782, '★ 关键：流体【会变】✗ 所以必须服务端说了算 ✗ 客户端只负责画 ✓', GOLD, 13,
      bold=True)
    T(d, 36, 812, '★ 水铺 7 格 / 地火只铺 3 格 ✗ 危险区小一半 ✓ 掉进去也爬得出来 ✓', DIM, 12)

    p = os.path.join(OUT, 'fluid-flow.png')
    im.save(p)
    print('saved', p)


make_world()
make_flow()
