# -*- coding: utf-8 -*-
"""游戏图标 → PNG（和游戏里的完全一致）

游戏里的图标有两套：
  ① ITEM_ICON  —— 24×24 的 SVG path（材料/防具等）
  ② weaponIconSvg —— 按【零件数据】程序化生成的矩形/圆（武器）

这里把两套都移植成 Pillow 绘制 ✗ 保证群里发的图和游戏里长得一模一样 ✓
"""
import io
import math
import os
import re
import sys

# sys.stdout.reconfigure 只在独立运行时需要 ✗ 被 import 时不能调 ✓
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ============================================================
# ① ITEM_ICON：24×24 SVG path（线框图标）
# ============================================================

def load_item_icons():
    """从 web/platform/web.js 里读出 ITEM_ICON 的定义"""
    p = os.path.join(ROOT, 'web', 'platform', 'web.js')
    s = io.open(p, encoding='utf-8').read()
    i = s.find('var ITEM_ICON = {')
    j = s.find('};', i)
    seg = s[i:j]
    out = {}
    for k, v in re.findall(r"(\w+):\s*ICON_SVG\('([^']*)'\)", seg):
        out[k] = v
    return out


def _parse_path(d, scale=1.0):
    """极简 SVG path 解析：只支持 M/m L/l H/h V/v Z 和相对坐标（图标只用到这些）"""
    tokens = re.findall(r'([MLHVZmlhvz])|(-?\d*\.?\d+)', d)
    pts = []
    cur = (0.0, 0.0)
    start = None
    cmd = None
    buf = []
    segs = []
    for c, n in tokens:
        if c:
            if cmd is not None and buf:
                segs.append((cmd, buf))
            cmd = c
            buf = []
        elif n:
            buf.append(float(n))
    if cmd is not None and buf:
        segs.append((cmd, buf))

    for cmd, nums in segs:
        k = cmd.upper()
        rel = cmd.islower()
        i = 0
        while i < len(nums) or k in ('Z',):
            if k == 'Z':
                if start:
                    cur = start
                break
            if k == 'M' or k == 'L':
                if i + 1 >= len(nums) + 1:
                    break
                x, y = nums[i], nums[i + 1]
                if rel:
                    x += cur[0]
                    y += cur[1]
                cur = (x, y)
                if k == 'M' and start is None:
                    start = cur
                pts.append(cur)
                i += 2
                if k == 'M':
                    k = 'L'      # M 之后的隐式坐标是 L
            elif k == 'H':
                x = nums[i]
                if rel:
                    x += cur[0]
                cur = (x, cur[1])
                pts.append(cur)
                i += 1
            elif k == 'V':
                y = nums[i]
                if rel:
                    y += cur[1]
                cur = (cur[0], y)
                pts.append(cur)
                i += 1
            else:
                i += 1
    return pts


def draw_item_icon(name, size=96, color=(232, 238, 246), stroke=2.2):
    """把 ITEM_ICON 的 SVG path 画成 PNG 图像"""
    icons = load_item_icons()
    d = icons.get(name)
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    if not d:
        return img
    dr = ImageDraw.Draw(img)
    sc = (size * 0.78) / 24.0
    off = size * 0.11
    # 提取所有 path 的 d
    for pd in re.findall(r'<path d="([^"]*)"', d):
        pts = _parse_path(pd)
        if len(pts) >= 2:
            xy = [(off + p[0] * sc, off + p[1] * sc) for p in pts]
            dr.line(xy, fill=color + (255,), width=int(stroke * 2), joint='curve')
    # circle
    for cx, cy, r in re.findall(r'<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"', d):
        cx, cy, r = float(cx), float(cy), float(r)
        dr.ellipse([off + (cx - r) * sc, off + (cy - r) * sc,
                    off + (cx + r) * sc, off + (cy + r) * sc],
                   outline=color + (255,), width=int(stroke * 2))
    return img


# ============================================================
# ② 武器图标：按零件数据画矩形/圆
# ============================================================

def _hex_rgb(h):
    return ((h >> 16) & 255, (h >> 8) & 255, h & 255)


def _mix_hex(a, b, t):
    ar, ag, ab = _hex_rgb(a)
    br, bg, bb = _hex_rgb(b)
    return ((int(ar + (br - ar) * t) << 16) |
            (int(ag + (bg - ag) * t) << 8) |
            int(ab + (bb - ab) * t))


# 从 game.js 读出来的武器零件（简版：只取常用几把）
WEAPON_PARTS = {
    'sword': [
        [0.12, 1.30, 0.06, 0xdfe9f5, 0, 0.75, 0],      # 刃
        [0.09, 0.24, 0.07, 0xdfe9f5, 0, 1.42, 0, 0, 0, 1],  # 尖
        [0.34, 0.08, 0.12, 0xffd83d, 0, 0.16, 0],      # 护手
        [0.10, 0.30, 0.10, 0x6b4a2a, 0, -0.05, 0],     # 柄
        [0.13, 0.13, 0.13, 0xffd83d, 0, -0.24, 0, 0, 0, 1],  # 尾珠
    ],
    'saber': [
        [0.10, 1.15, 0.05, 0xdfe9f5, 0, 0.70, 0, 0.16],
        [0.08, 0.20, 0.06, 0xdfe9f5, 0.10, 1.32, 0],
        [0.30, 0.07, 0.10, 0xffd83d, 0, 0.14, 0],
        [0.09, 0.28, 0.09, 0x6b4a2a, 0, -0.05, 0],
        [0.12, 0.12, 0.12, 0xffd83d, 0, -0.22, 0, 0, 0, 1],
    ],
    'dagger': [
        [0.10, 0.60, 0.05, 0xdfe9f5, 0, 0.42, 0],
        [0.07, 0.16, 0.05, 0xdfe9f5, 0, 0.78, 0, 0, 0, 1],
        [0.24, 0.06, 0.09, 0xffd83d, 0, 0.12, 0],
        [0.08, 0.22, 0.08, 0x6b4a2a, 0, -0.04, 0],
        [0.10, 0.10, 0.10, 0xffd83d, 0, -0.18, 0, 0, 0, 1],
    ],
    'axe': [
        [0.10, 1.10, 0.08, 0x6b4a2a, 0, 0.55, 0],
        [0.44, 0.42, 0.08, 0xdfe9f5, 0.22, 0.95, 0],
        [0.10, 0.10, 0.10, 0xffd83d, 0, -0.06, 0, 0, 0, 1],
    ],
    'staff': [
        [0.09, 1.40, 0.09, 0x6b4a2a, 0, 0.70, 0],
        [0.22, 0.22, 0.22, 0x9fe8ff, 0, 1.50, 0, 0, 0, 1],
        [0.12, 0.12, 0.12, 0xffd83d, 0, -0.02, 0, 0, 0, 1],
    ],
    'bow': [
        [0.08, 1.30, 0.08, 0x8a6a48, 0, 0.65, 0, 0],
        [0.05, 1.40, 0.05, 0xdfe9f5, 0.26, 0.65, 0],
        [0.10, 0.10, 0.10, 0xffd83d, 0, 0.65, 0, 0, 0, 1],
    ],
}

# 品阶配色（越高级越花）
W_TIER = {
    0: {'mix': 0x9aa3a8, 'k': 0.55},
    1: {'mix': 0x9aa3a8, 'k': 0.45},
    2: {'mix': 0x4ade80, 'k': 0.35},
    3: {'mix': 0x4ade80, 'k': 0.50},
    4: {'mix': 0x60a5fa, 'k': 0.40},
    5: {'mix': 0x60a5fa, 'k': 0.55},
    6: {'mix': 0xc084fc, 'k': 0.40},
    7: {'mix': 0xc084fc, 'k': 0.55},
    8: {'mix': 0xfbbf24, 'k': 0.40},
    9: {'mix': 0xfbbf24, 'k': 0.50},
    10: {'mix': 0xf87171, 'k': 0.40},
    11: {'mix': 0xf87171, 'k': 0.55},
}


def weapon_parts_of(look, tier):
    base = WEAPON_PARTS.get(look) or WEAPON_PARTS['sword']
    base = [list(x) + [0] * (10 - len(x)) for x in base]
    k = max(0, min(11, int(tier or 0)))
    T = W_TIER[k]
    out = []
    for p in base:
        np = list(p) + [0] * (10 - len(p))
        np[3] = _mix_hex(p[3], T['mix'], T['k'])
        out.append(np)
    if k >= 7:
        out.append([0.16, 0.16, 0.16, _mix_hex(0xffd83d, T['mix'], 0.2), 0, -0.34, 0, 0, 0, 1])
    if k >= 4:
        out.append([0.30, 0.10, 0.10, _mix_hex(0xb8c4c8, T['mix'], 0.3), 0, 0.06, 0.10])
    return out


def draw_weapon_icon(look, tier, size=96):
    """和游戏里 weaponIconSvg 完全一致的画法"""
    parts = weapon_parts_of(look, tier)
    minx = miny = 1e9
    maxx = maxy = -1e9
    parts = [list(x) + [0] * (10 - len(x)) for x in parts]
    for p in parts:
        a = p[7] or 0
        ca, sa = math.cos(a), math.sin(a)
        hw, hh = p[0] / 2.0, p[1] / 2.0
        for c in range(4):
            lx = -hw if c in (0, 3) else hw
            ly = -hh if c < 2 else hh
            wx = (p[4] or 0) + lx * ca - ly * sa
            wy = (p[5] or 0) + lx * sa + ly * ca
            minx, maxx = min(minx, wx), max(maxx, wx)
            miny, maxy = min(miny, wy), max(maxy, wy)
    pad = max(0.12, (maxy - miny) * 0.06)
    w = (maxx - minx) + pad * 2
    h = (maxy - miny) + pad * 2
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    sc = (size * 0.86) / max(w, h)
    ox = size / 2.0 - (minx - pad + w / 2.0) * sc
    oy = size / 2.0 + (miny - pad + h / 2.0) * sc   # y 翻转

    def P(x, y):
        return (ox + x * sc, oy - y * sc)

    for p in parts:
        col = _hex_rgb(p[3]) + (255,)
        a = p[7] or 0
        ca, sa = math.cos(a), math.sin(a)
        cx, cy = p[4] or 0, p[5] or 0
        if p[9]:
            r = p[0] / 2.0
            px, py = P(cx, cy)
            dr.ellipse([px - r * sc, py - r * sc, px + r * sc, py + r * sc], fill=col)
        else:
            hw, hh = p[0] / 2.0, p[1] / 2.0
            corners = []
            for lx, ly in ((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)):
                wx = cx + lx * ca - ly * sa
                wy = cy + lx * sa + ly * ca
                corners.append(P(wx, wy))
            dr.polygon(corners, fill=col)
    return img


if __name__ == '__main__':
    out_dir = os.path.join(ROOT, 'docs', 'shots', 'icons')
    os.makedirs(out_dir, exist_ok=True)
    for look in WEAPON_PARTS:
        for tier in (0, 5, 11):
            im = draw_weapon_icon(look, tier, 96)
            im.save(os.path.join(out_dir, 'w_%s_%d.png' % (look, tier)))
    for name in ('cloth', 'iron', 'box', 'crystal'):
        draw_item_icon(name, 96).save(os.path.join(out_dir, 'i_%s.png' % name))
    print('图标已生成到', out_dir)
