# -*- coding: utf-8 -*-
"""地形示意图 · v5 补丁
① terrain-cross.png  —— 竖直剖面（伤害改成"每格 5 点"）
② terrain-regen.png  —— 破坏 → 自愈 时间轴 + 树的三态
③ terrain-look.png   —— 在 D 档上打"已选定"标记（重画一次 ✓）
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
GRASS2 = (126, 138, 80)
STONE  = (128, 126, 120)
BRICK  = (138, 84, 64)
WOOD   = (104, 76, 48)
WOOD2  = (128, 96, 60)
LEAF   = (92, 112, 58)
ICE    = (150, 200, 218)
SWAMP  = (78, 88, 60)
WATER  = (58, 100, 112)


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


# ======================================================================
# ① 竖直剖面（伤害改成每格 5 点）
# ======================================================================
def make_cross():
    W, H = 1240, 700
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    T(d, 36, 22, '地形示意 · 竖直剖面', TEXT, 26, bold=True)
    T(d, 36, 58, '每一小格 = 1 层。人物 2 格高。落差 ≥3 格掉血，每多一格 +5 点。', DIM, 13)

    # ★ 自测踩到：5 层地形 + 2 格人物 = 头顶到 7 层 ✗ 基准线太高会顶出画面 ✓
    U = 56
    base = 606
    x0 = 96
    hs = [1, 1, 2, 2, 5, 5, 5, 5, 4, 3, 0, 0]
    mats = ['grass', 'grass', 'grass', 'dirt', 'stone', 'stone', 'stone', 'stone',
            'grass', 'ice', 'swamp', 'swamp']
    MC = {'grass': GRASS, 'dirt': DIRT, 'stone': STONE, 'ice': ICE, 'swamp': SWAMP}

    for lv in range(0, 7):
        y = base - lv * U
        if lv <= 5:
            d.line([x0 - 34, y, x0 + len(hs) * U + 16, y], fill=(42, 40, 37))
        T(d, x0 - 42, y, '%d' % lv, DIM, 12, anchor='rm')
    T(d, x0 - 42, base - 6 * U - 24, '层', DIM, 12, anchor='rm')

    for i, (h, m) in enumerate(zip(hs, mats)):
        x = x0 + i * U
        for lv in range(h):
            y = base - (lv + 1) * U
            d.rectangle([x + 1, y + 1, x + U - 1, base - lv * U],
                        fill=sh(MC[m], 1.0 - lv * 0.10))
        if m == 'swamp':
            wy = (base - h * U + U * 0.42) if h > 0 else (base - 12)
            d.rectangle([x + 1, wy, x + U - 1, wy + 13], fill=WATER)
            T(d, x + U / 2, wy - 16, '水', CYAN, 11, anchor='ms')

    # 人物：站第 5 格（5 层）
    i = 4
    x = x0 + i * U
    feet = base - hs[i] * U
    cx = x + U / 2
    top = feet - 2 * U
    d.rectangle([cx - 18, top, cx + 18, feet], fill=(222, 206, 162),
                outline=(70, 62, 46), width=2)
    d.ellipse([cx - 15, top - 32, cx + 15, top + 2], fill=(214, 186, 148),
              outline=(70, 62, 46), width=2)
    d.line([cx + 32, feet, cx + 32, top], fill=GREEN, width=3)
    d.line([cx + 26, feet, cx + 38, feet], fill=GREEN, width=2)
    d.line([cx + 26, top, cx + 38, top], fill=GREEN, width=2)
    T(d, cx + 44, (feet + top) / 2, '2 格', GREEN, 14, anchor='lm', bold=True)

    # 落差 1（走下台阶）
    T(d, x0 + 9 * U + U / 2 - 6, base - 3 * U - 34, '落差 1', GREEN, 12,
      anchor='rm', bold=True)

    # 落差 5（掉落）：从 5 层直接到 0 层
    x2 = x0 + 10 * U + U / 2
    f2 = base
    d.line([cx + 20, feet - 40, x2 - 8, f2 - 52], fill=RED, width=3)
    d.polygon([(x2 - 8, f2 - 52), (x2 - 20, f2 - 58), (x2 - 17, f2 - 42)], fill=RED)
    T(d, x2 + 8, f2 - 92, '落差 5 → 掉落 15 点血', RED, 13, anchor='lm', bold=True)
    T(d, x2 + 8, f2 - 72, '(5 层 → 0 层)', RED, 11, anchor='lm')

    # 右侧：伤害表
    x1 = 900
    T(d, x1, 110, '掉落伤害（每格 5 点）', GOLD, 17, bold=True)
    T(d, x1, 140, '伤害 = (落差 − 2) × 5', TEXT, 14, bold=True)
    rows = [(2, '不掉血'), (3, '5 点'), (4, '10 点'), (5, '15 点'), (6, '20 点')]
    for k, (drop, dmg) in enumerate(rows):
        yy = 174 + k * 26
        T(d, x1, yy, '落差 %d 格' % drop, TEXT, 13)
        T(d, x1 + 120, yy, dmg, GREEN if drop < 3 else RED, 13, bold=True)

    T(d, x1, 336, '★ 一个要提的问题', GOLD, 15, bold=True)
    for k, t in enumerate([
        '血量 = 100 + 22L + 0.6L²',
        '  1 级 123 血 → 5 点 = 4.1% 疼',
        '  30 级 1300 血 → 5 点 = 0.4% 没感觉',
        '  60 级 3580 血 → 5 点 = 0.14% 没感觉',
        '',
        '建议：每格 = max(5, 1.5% 血)',
        '  1~5 级还是 5 点（和你一样）',
        '  30 级 20 点 / 60 级 54 点',
    ]):
        T(d, x1, 366 + k * 22, t, CYAN if t.startswith('建议') else DIM, 12)

    p = os.path.join(OUT, 'terrain-cross.png')
    im.save(p)
    print('saved', p)


# ======================================================================
# ② 破坏 → 自愈 + 树三态
# ======================================================================
def make_regen():
    W, H = 1380, 860
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    T(d, 36, 22, '地形示意 · 破坏自愈 + 树的三态', TEXT, 26, bold=True)
    T(d, 36, 58, '破坏临时存库；没人动它的时候按时间慢慢长回来（惰性计算，不跑定时器）。',
      DIM, 13)

    # ---------- 上：一堵墙的自愈 ----------
    T(d, 36, 104, 'A · 一堵石头墙被打碎后自己长回来（石头 6 下 / 20 分钟回满）',
      GOLD, 16, bold=True)

    BW, BH = 96, 96
    y0 = 150
    stages = [
        ('刚被拆', '0 秒', 6, '碎了'),
        ('3 分钟', '回了 1 下', 5, ''),
        ('8 分钟', '回了 2 下', 4, ''),
        ('15 分钟', '快好了', 2, ''),
        ('20 分钟', '完全恢复', 0, ''),
    ]
    for i, (nm, sub, cracks, note) in enumerate(stages):
        x = 60 + i * 190
        d.rectangle([x - 10, y0 - 10, x + BW + 10, y0 + BH + 10], fill=CARD)
        if i == 0:
            # 完全碎了 → 画碎石
            rr = random.Random(7)
            for _ in range(9):
                cx2 = x + BW / 2 + rr.randint(-46, 42)
                cy2 = y0 + BH / 2 + rr.randint(-38, 38)
                s2 = rr.randint(6, 13)
                d.rectangle([cx2, cy2, cx2 + s2, cy2 + s2], fill=sh(STONE, 0.85),
                            outline=(24, 22, 20))
            d.rectangle([x, y0, x + BW, y0 + BH], outline=(60, 58, 54), width=2)
            d.text((x + BW / 2, y0 + BH / 2), '碎', font=font(26, True),
                   fill=(255, 255, 255), anchor='mm')
        else:
            k = 0.62 + 0.09 * (5 - cracks)
            d.rectangle([x, y0, x + BW, y0 + BH], fill=sh(STONE, k),
                        outline=(26, 24, 22), width=2)
            rr = random.Random(cracks * 13 + 1)
            for _ in range(cracks):
                x1 = x + rr.randint(12, BW - 12)
                y1 = y0 + rr.randint(12, BH - 12)
                pts = [(x1, y1)]
                for _ in range(3):
                    x1 = max(x + 6, min(x + BW - 6, x1 + rr.randint(-20, 20)))
                    y1 = max(y0 + 6, min(y0 + BH - 6, y1 + rr.randint(-18, 18)))
                    pts.append((x1, y1))
                d.line(pts, fill=(24, 22, 20), width=2)
            if i == 4:
                # 恢复完成：上沿高光（D 档观感）
                d.line([(x, y0), (x + BW, y0)], fill=sh(STONE, 1.3), width=2)
                d.text((x + BW / 2, y0 + BH / 2), '完好', font=font(20, True),
                       fill=sh(STONE, 1.45), anchor='mm')
        T(d, x + BW / 2, y0 + BH + 20, nm, TEXT, 14, anchor='ma', bold=True)
        T(d, x + BW / 2, y0 + BH + 42, sub, DIM, 11, anchor='ma')
        if note:
            T(d, x + BW / 2, y0 + BH + 60, note, DIM, 11, anchor='ma')

    # 时间轴箭头
    for i in range(4):
        ax = 60 + i * 190 + BW + 14
        T(d, ax + 18, y0 + BH / 2, '→', (90, 88, 82), 22, anchor='mm')

    # ---------- 中：怎么算（惰性） ----------
    T(d, 36, 340, 'B · 怎么做到"没人时不花 CPU"', GOLD, 16, bold=True)
    box_y = 374
    d.rectangle([36, box_y, 660, box_y + 118], fill=CARD)
    T(d, 52, box_y + 12, '库里只存三个数：x, z, 剩余耐久 + 最后一次被砍的时刻',
      TEXT, 13)
    T(d, 52, box_y + 40, 'hp_now = min(满血, 存量 + (现在 − 最后时刻) × 每秒恢复)',
      CYAN, 14, bold=True)
    T(d, 52, box_y + 68, '★ 不跑定时器 ✗ 不扫全图 ✗ 读到的时候才算一次',
      DIM, 12)
    T(d, 52, box_y + 90, '★ 100 万格被破坏也几乎不花 CPU ✗ 恢复完成就删掉那行',
      DIM, 12)

    d.rectangle([690, box_y, 1344, box_y + 118], fill=CARD)
    T(d, 706, box_y + 12, '看得见 / 看不见 表现要一致', GOLD, 13, bold=True)
    T(d, 706, box_y + 40, '看得见：每 2 秒重算这一区块 ✗ 能看到裂缝慢慢合上',
      TEXT, 12)
    T(d, 706, box_y + 62, '看不见：不重算 ✗ 下次加载时一次算对', TEXT, 12)
    T(d, 706, box_y + 88, '★ 所以"你走了 10 分钟回来"和"你站着看 10 分钟"结果一样',
      DIM, 11)

    # ---------- 下：树三态 ----------
    T(d, 36, 528, 'C · 树的三态（用户：倒地动画 ✗ 不砸人 ✗ 再打一下就消失）',
      GOLD, 16, bold=True)

    def tree(ox, oy, lean=0.0, scale=1.0, alpha=1.0):
        """画一棵树：lean = 倾斜角度（弧度 ✗ 正数向右倒）"""
        h = 96 * scale
        tw = 11 * scale
        # 树干（旋转）
        ax, ay = ox, oy            # 根部
        bx = ox + math.sin(lean) * h
        by = oy - math.cos(lean) * h
        d.line([(ax, ay), (bx, by)], fill=sh(WOOD, 0.9), width=int(tw))
        # 树冠（跟着树干走）
        cx3 = bx
        cy3 = by - 30 * scale * math.cos(lean)
        for (dx, dy, rr) in ((0, 0, 34), (-20, 12, 24), (20, 12, 24), (0, 22, 22)):
            r = rr * scale
            d.ellipse([cx3 + dx * scale - r, cy3 + dy * scale - r,
                       cx3 + dx * scale + r, cy3 + dy * scale + r],
                      fill=sh(LEAF, 0.92))

    # 态 1：站着（打 2 下）
    bx = 90
    by = 726
    tree(bx + 60, by, 0.0)
    T(d, bx + 60, by + 18, '① 站着', TEXT, 14, anchor='ma', bold=True)
    T(d, bx + 60, by + 40, '打 2 下（木头材质）', DIM, 12, anchor='ma')
    T(d, bx + 150, by - 60, '↓ 打第 2 下', GOLD, 13, anchor='lm', bold=True)

    # 态 2：倒着
    # ★ 自测踩到：用"绕根部旋转 90°"的公式 ✗ 树冠会被算到地面下面 ✓
    #   → 直接手画：树干横躺 + 树冠在远端 ✓ 一眼就懂 ✓
    bx = 400
    d.line([(bx + 30, by - 6), (bx + 150, by - 22)], fill=sh(WOOD, 0.9), width=12)
    for (dx, dy, rr) in ((166, -26, 30), (146, -44, 22), (186, -42, 22), (168, -6, 20)):
        d.ellipse([bx + dx - rr, by + dy - rr, bx + dx + rr, by + dy + rr],
                  fill=sh(LEAF, 0.92))
    T(d, bx + 60, by + 18, '② 倒着', TEXT, 14, anchor='ma', bold=True)
    T(d, bx + 60, by + 40, '倒地动画 0.5 秒 ✗ 不砸人 ✗ 仍挡路', DIM, 12, anchor='ma')
    # 碰撞盒变扁
    d.rectangle([bx - 20, by - 16, bx + 190, by + 6], outline=CYAN, width=2)
    T(d, bx + 85, by - 26, '碰撞盒变扁（可以从上面跳过去）', CYAN, 11, anchor='ms')
    T(d, bx + 250, by - 60, '↓ 再打 1 下', GOLD, 13, anchor='lm', bold=True)

    # 态 3：消失
    bx = 800
    d.ellipse([bx + 20, by - 12, bx + 100, by + 6], fill=(46, 42, 36))
    T(d, bx + 60, by - 46, '没了', DIM, 13, anchor='mm', bold=True)
    T(d, bx + 60, by + 18, '③ 消失', TEXT, 14, anchor='ma', bold=True)
    T(d, bx + 60, by + 40, '掉木头 ×1~2', DIM, 12, anchor='ma')

    # 右侧：倒地动画时间
    T(d, 1020, 560, '倒地动画（0.5 秒）', GOLD, 16, bold=True)
    for k, t in enumerate([
        '0.00s  朝【受击反方向】倾倒 + 树根扬尘',
        '0.35s  转到 75° ✗ 开始变慢',
        '0.42s  贴地弹一下（10° → 0°）',
        '0.50s  完全躺平 + 闷响 + 树叶沙沙',
        '',
        '★ 为什么不砸人：会被自己砍的树砸到很烦',
        '★ 为什么还要挡路：不然砍树 = 瞬间清空地形',
    ]):
        T(d, 1020, 592 + k * 23, t, CYAN if t.startswith('★') else TEXT, 12)

    T(d, 36, 826, '★ 恢复速度：一格石头 6 血 / 20 分钟 → 3.3 分钟回 1 下 '
                  '✗ 拆完去别处玩一圈回来就补上了', DIM, 12)

    p = os.path.join(OUT, 'terrain-regen.png')
    im.save(p)
    print('saved', p)


make_cross()
make_regen()
