# -*- coding: utf-8 -*-
"""Q 群「修仙战报」渲染（Pillow ✗ 不依赖浏览器 ✓ 云上有 Pillow 9.0.1 ✓）

★ 样式和游戏里/公告同一套：暗金底 + 金标题 + 圆角卡片 + 编号
★ 装备图标 = server/weapon_icons.json（从游戏 core 导出的同一份零件数据 ✓）
   → 画出来的剑/刀/弓和背包里【一模一样】✓

用法：
    import battlereport
    battlereport.render(data, '/tmp/report.png')
data 结构：
    {'t0': ts, 't1': ts, 'players': [
        {'name': '半个六道', 'exp': 48250, 'gold': 8400, 'kills': 312,
         'gear': [{'look': 'sword', 'tier': 7, 'n': 1}, ...],   # 已按品阶降序
         'gearTotal': 11}, ...]}
"""
import io
import json
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ICON_JSON = os.path.join(HERE, 'weapon_icons.json')

W = 1180
PAD = 44

BG_TOP = (36, 31, 22)
BG_BOT = (20, 18, 13)
GOLD = (255, 216, 61)
TEXT = (223, 232, 212)
DIM = (143, 154, 132)
LINE = (255, 255, 255, 18)

# 品阶色（和游戏 LOOT_COL 完全一致）
TIER_COL = ['#bfa88a', '#8fd28a', '#8fc4ff', '#c08fff', '#ffd83d', '#ff9a5c',
            '#ff6a5c', '#ff5cf0', '#5cf0ff', '#ffffff', '#e0b830', '#ff3b30']

FONT_CANDIDATES = [
    # 云上（Noto CJK）· Windows（微软雅黑）
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc',
    '/usr/share/fonts/truetype/msyh/msyhbd.ttc',
    '/usr/share/fonts/truetype/msyh/msyh.ttc',
    'C:/Windows/Fonts/msyhbd.ttc',
    'C:/Windows/Fonts/msyh.ttc',
    'C:/Windows/Fonts/simhei.ttf',
]

_font_path = None
_font_cache = {}


def font(size, bold=True):
    global _font_path
    if _font_path is None:
        for p in FONT_CANDIDATES:
            if os.path.isfile(p):
                _font_path = p
                break
        if _font_path is None:
            _font_path = ''
    key = (size, bold)
    if key in _font_cache:
        return _font_cache[key]
    try:
        f = ImageFont.truetype(_font_path, size) if _font_path else ImageFont.load_default()
    except Exception:
        f = ImageFont.load_default()
    _font_cache[key] = f
    return f


def _hex(c):
    c = c.lstrip('#')
    return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16))


def _rgba(c, a):
    if isinstance(c, str):
        c = _hex(c)
    return (c[0], c[1], c[2], a)


_icons = None


def icons():
    global _icons
    if _icons is None:
        try:
            with io.open(ICON_JSON, encoding='utf-8') as f:
                _icons = json.load(f)
        except Exception:
            _icons = {}
    return _icons


def fmt(n):
    n = int(round(n or 0))
    if n >= 10000:
        s = '%.1f' % (n / 10000.0)
        s = s[:-2] if s.endswith('.0') else s
        return s + ' 万'
    return '{:,}'.format(n)


def _text_c(d, xy, s, f, fill):
    """居中写字"""
    try:
        w = d.textlength(s, font=f)
    except Exception:
        w = d.textsize(s, font=f)[0]
    d.text((xy[0] - w / 2, xy[1]), s, font=f, fill=fill)
    return w


def _spaced_title(d, cx, y, s, f, fill, gap):
    """标题字间距（海报那套：字分开写）"""
    widths = []
    for ch in s:
        try:
            widths.append(d.textlength(ch, font=f))
        except Exception:
            widths.append(d.textsize(ch, font=f)[0])
    total = sum(widths) + gap * (len(s) - 1)
    x = cx - total / 2
    for i, ch in enumerate(s):
        d.text((x, y), ch, font=f, fill=fill)
        x += widths[i] + gap


def _draw_weapon(d, look, tier, bx, by, size):
    """把游戏里的武器图标（零件 JSON）画出来 ✓ 和背包里一样"""
    data = icons().get(look or 'sword') or icons().get('sword')
    if not data:
        d.rectangle([bx, by, bx + size, by + size], outline=_hex(TIER_COL[tier % 12]), width=2)
        return
    d1 = data.get(str(tier % 12)) or data.get('0')
    vb = d1['vb']
    parts = d1['parts']
    scale = (size * 0.80) / max(vb[2], vb[3], 0.001)
    cx = bx + size / 2.0
    cy = by + size / 2.0
    ox = vb[0] + vb[2] / 2.0
    oy = vb[1] + vb[3] / 2.0

    def T(x, y):
        return (cx + (x - ox) * scale, cy - (y - oy) * scale)

    for p in parts:
        col = _hex(p['c'])
        if p.get('cir'):
            cx0, cy0 = T(p['x'], p['y'])
            r = p['w'] / 2.0 * scale
            d.ellipse([cx0 - r, cy0 - r, cx0 + r, cy0 + r], fill=col)
            continue
        hw, hh = p['w'] / 2.0, p['h'] / 2.0
        ang = p.get('r') or 0
        ca, sa = __import__('math').cos(ang), __import__('math').sin(ang)
        pts = []
        for (lx, ly) in ((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)):
            wx = p['x'] + lx * ca - ly * sa
            wy = p['y'] + lx * sa + ly * ca
            pts.append(T(wx, wy))
        d.polygon(pts, fill=col)


def _draw_armor(d, tier, bx, by, size, col):
    """防具图标（衣服）：用几块拼出来（和游戏那个形状接近 ✓）"""
    s = size * 0.72
    x = bx + (size - s) / 2.0
    y = by + (size - s) / 2.0
    body = [x + s * 0.22, y + s * 0.10, x + s * 0.78, y + s * 0.10,
            x + s * 0.96, y + s * 0.22, x + s * 0.90, y + s * 0.42,
            x + s * 0.78, y + s * 0.38, x + s * 0.78, y + s * 0.92,
            x + s * 0.22, y + s * 0.92, x + s * 0.22, y + s * 0.38,
            x + s * 0.10, y + s * 0.42, x + s * 0.04, y + s * 0.22]
    d.polygon(body, fill=col)


def render(data, out_path):
    players = (data.get('players') or [])[:5]
    rest = (data.get('players') or [])[5:]
    row_h = 74
    gap = 10
    top = 178
    h_body = len(players) * (row_h + gap)
    rest_lines = (len(rest) + 1) // 2
    h_rest = 34 + rest_lines * 26 if rest else 0
    H = top + h_body + h_rest + 150

    img = Image.new('RGBA', (W, H), BG_BOT + (255,))
    d = ImageDraw.Draw(img, 'RGBA')

    # ---- 背景：竖向渐变 + 网格 ----
    for y in range(H):
        k = y / float(max(1, H - 1))
        k = k ** 0.75
        c = (int(BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * k),
             int(BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * k),
             int(BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * k))
        d.line([(0, y), (W, y)], fill=c + (255,))


    # ---- 标题 ----
    _spaced_title(d, W / 2, 32, '修 仙 战 报', font(50), GOLD + (255,), 10)
    sub = '%s – %s · 全服统计' % (data.get('t0txt', ''), data.get('t1txt', ''))
    _text_c(d, (W / 2, 112), sub, font(16), (185, 194, 168, 255))
    # 分隔线（中间亮两头透明）
    for i in range(200):
        a = int(190 * (1 - abs(i - 100) / 100.0))
        d.line([(W / 2 - 100 + i, 144), (W / 2 - 100 + i, 146)],
               fill=GOLD + (max(0, a),))

    # ---- 前五名 ----
    MEDAL = ['①', '②', '③', '④', '⑤']
    ROW_BG = (37, 42, 34, 235)
    for i, p in enumerate(players):
        y = top + i * (row_h + gap)
        x0, x1 = PAD, W - PAD
        # 卡片底 + 边框
        d.rounded_rectangle([x0, y, x1, y + row_h], radius=14, fill=ROW_BG,
                            outline=(255, 255, 255, 22), width=1)
        edge = None
        if i == 0:
            edge = GOLD
        elif i == 1:
            edge = (215, 224, 234)
        elif i == 2:
            edge = (227, 160, 106)
        if edge:
            d.rounded_rectangle([x0, y, x1, y + row_h], radius=14,
                                outline=edge + (150,), width=2)
        # 名次
        d.text((x0 + 18, y + 16), MEDAL[i], font=font(26), fill=(edge or DIM) + (255,))
        # 名字 + 击杀
        d.text((x0 + 70, y + 12), str(p.get('name') or '?'), font=font(19),
               fill=(238, 244, 228, 255))
        d.text((x0 + 70, y + 42), '击杀 %d' % int(p.get('kills') or 0), font=font(11),
               fill=DIM + (255,))
        # 经验 / 金币
        d.text((x0 + 250, y + 12), '经验', font=font(11), fill=DIM + (255,))
        d.text((x0 + 250, y + 34), '+' + fmt(p.get('exp')), font=font(17),
               fill=GOLD + (255,))
        d.text((x0 + 380, y + 12), '金币', font=font(11), fill=DIM + (255,))
        d.text((x0 + 380, y + 34), '+' + fmt(p.get('gold')), font=font(17),
               fill=(255, 224, 138, 255))
        # 装备图标
        gx = x0 + 520
        gy = y + (row_h - 46) / 2.0
        gear = p.get('gear') or []
        for g in gear[:5]:
            tier = max(0, min(11, int(g.get('tier') or 0)))
            col = TIER_COL[tier]
            d.rounded_rectangle([gx, gy, gx + 46, gy + 46], radius=9,
                                fill=(15, 18, 16, 255), outline=_hex(col) + (130,), width=2)
            if (g.get('look') or '') == 'armor':
                _draw_armor(d, tier, gx, gy, 46, _hex(col))
            else:
                _draw_weapon(d, g.get('look'), tier, gx + 3, gy + 3, 40)
            # 品阶数字（左上）+ 数量（右下）
            d.text((gx + 4, gy + 2), str(tier + 1), font=font(9), fill=_hex(col) + (230,))
            n = int(g.get('n') or 1)
            if n > 1:
                d.text((gx + 30, gy + 32), '×%d' % n, font=font(10),
                       fill=(238, 244, 228, 255))
            gx += 52
        if len(gear) > 5:
            d.rounded_rectangle([gx, gy, gx + 46, gy + 46], radius=9,
                                fill=(20, 24, 20, 220), outline=(255, 255, 255, 40), width=1)
            d.text((gx + 12, gy + 16), '+%d' % (len(gear) - 5), font=font(12),
                   fill=DIM + (255,))
        # 装备总件数（右）
        tot = '装备 %d 件' % int(p.get('gearTotal') or 0)
        try:
            tw = d.textlength(tot, font=font(12))
        except Exception:
            tw = d.textsize(tot, font=font(12))[0]
        d.text((x1 - 18 - tw, y + 28), tot, font=font(12), fill=(201, 211, 186, 255))

    # ---- 其他玩家 ----
    if rest:
        ry = top + h_body + 6
        d.text((PAD, ry), '其他玩家', font=font(12), fill=(160, 172, 148, 255))
        d.line([(PAD + 64, ry + 9), (W - PAD, ry + 9)], fill=(255, 255, 255, 18))
        ry += 26
        colw = (W - PAD * 2) // 2
        for i, p in enumerate(rest):
            cx = PAD + (i // rest_lines) * (colw + 18)
            cy = ry + (i % rest_lines) * 26
            txt = '%d. %s · 经验 %s · 金币 %s · 装备 %d 件' % (
                i + 6, p.get('name') or '?', fmt(p.get('exp')), fmt(p.get('gold')),
                int(p.get('gearTotal') or 0))
            d.text((cx, cy), txt, font=font(12), fill=(170, 182, 158, 255))

    # ---- 底部 ----
    fy = H - 92
    d.line([(PAD, fy), (W - PAD, fy)], fill=(255, 255, 255, 20))
    # 绿胶囊
    pill = '每 15 分钟自动播报'
    f2 = font(12)
    try:
        pw = d.textlength(pill, font=f2)
    except Exception:
        pw = d.textsize(pill, font=f2)[0]
    px = W / 2 - (pw + 36) / 2
    d.rounded_rectangle([px, fy + 16, px + pw + 36, fy + 42], radius=13,
                        fill=(142, 224, 168, 255))
    d.text((px + 18, fy + 20), pill, font=f2, fill=(17, 23, 15, 255))
    note = '装备只统计 武器 / 防具（材料不算）· 图标颜色 = 品阶 · 数字 = 这 15 分钟的新增'
    _text_c(d, (W / 2, fy + 50), note, font(12), DIM + (255,))

    img.convert('RGB').save(out_path, 'PNG', optimize=True)
    return out_path, W, H
