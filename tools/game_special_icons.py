# -*- coding: utf-8 -*-
"""游戏里的【专用图标】→ PNG

为什么要单独一个模块：
  游戏里的图标不是"随便找个相似的就用"✗
  有些是用户【从预览页亲自挑定的】✗ 比如防具的「龙鳞胸甲」✓
  必须原样复刻，不能自己乱选 ✗✓

目前收录：
  · ARMOR_ICON  —— 防具专用（龙鳞胸甲，第 125 轮用户钦定）
  · SKILL_BOOK_ICON —— 技能书
  · SKIN_CARD_ICON  —— 皮肤卡
"""
import io
import os
import re
import sys

# sys.stdout.reconfigure 只在独立运行时需要 ✗ 被 import 时不能调 ✓
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_svg_const(name):
    """从 web/platform/web.js 里读出某个 var XXX = '<svg ...>'; 的完整字符串"""
    p = os.path.join(ROOT, 'web', 'platform', 'web.js')
    s = io.open(p, encoding='utf-8').read()
    # 找到 var NAME = 然后拼接到分号
    i = s.find('var ' + name + ' =')
    if i < 0:
        return ''
    j = s.find(';\n', i)
    seg = s[i:j]
    # 把所有 '...' 字符串片段拼起来（游戏里是字符串拼接的）
    parts = re.findall(r"'((?:[^'\\]|\\.)*)'", seg)
    return ''.join(parts).replace('\\n', '')


# ── SVG path 解析（复用 game_icons 的思路，但支持 fill / stroke）──
def parse_subpaths(d):
    """把 d 拆成若干子路径（遇到 M 就断开）"""
    tokens = re.findall(r'([MLHVCSQTAZmlhvcsqtaz])|(-?\d*\.?\d+)', d)
    segs = []
    cmd = None
    buf = []
    for c, n in tokens:
        if c:
            if cmd is not None:
                segs.append((cmd, buf))
            cmd, buf = c, []
        elif n:
            buf.append(float(n))
    if cmd is not None:
        segs.append((cmd, buf))
    return segs


def draw_path(dr, d, sc, off, fill=None, stroke=None, width=1.0, opacity=1.0):
    """按 SVG path 指令画到 Pillow（支持 M L H V C Z）"""
    cur = (0.0, 0.0)
    start = None
    poly = []

    def flush(closed=False):
        nonlocal poly
        if len(poly) >= 2:
            if fill and len(poly) >= 3:
                pts = [(off + x * sc, off + y * sc) for x, y in poly]
                fc = fill + (int(255 * opacity),) if len(fill) == 3 else fill
                dr.polygon(pts, fill=fc)
            if stroke:
                pts = [(off + x * sc, off + y * sc) for x, y in poly]
                if closed:
                    pts.append(pts[0])
                stc = stroke + (int(255 * opacity),) if len(stroke) == 3 else stroke
                dr.line(pts, fill=stc, width=max(1, int(width * sc)), joint='curve')
        poly = []

    for cmd, nums in parse_subpaths(d):
        k = cmd.upper()
        rel = cmd.islower()
        i = 0
        if k == 'M':
            flush()
            x, y = nums[0], nums[1]
            if rel:
                x += cur[0]
                y += cur[1]
            cur = (x, y)
            start = cur
            poly = [cur]
            i = 2
            # 后续连续坐标当 L
            while i + 1 < len(nums):
                x, y = nums[i], nums[i + 1]
                if rel:
                    x += cur[0]
                    y += cur[1]
                cur = (x, y)
                poly.append(cur)
                i += 2
        elif k == 'L':
            while i + 1 < len(nums):
                x, y = nums[i], nums[i + 1]
                if rel:
                    x += cur[0]
                    y += cur[1]
                cur = (x, y)
                poly.append(cur)
                i += 2
        elif k == 'H':
            while i < len(nums):
                x = nums[i] + (cur[0] if rel else 0)
                cur = (x, cur[1])
                poly.append(cur)
                i += 1
        elif k == 'V':
            while i < len(nums):
                y = nums[i] + (cur[1] if rel else 0)
                cur = (cur[0], y)
                poly.append(cur)
                i += 1
        elif k == 'C':
            while i + 5 < len(nums):
                x1, y1, x2, y2, x, y = nums[i:i + 6]
                if rel:
                    x1 += cur[0]; y1 += cur[1]
                    x2 += cur[0]; y2 += cur[1]
                    x += cur[0]; y += cur[1]
                # 贝塞尔采样 8 段
                for s in range(1, 9):
                    t = s / 8.0
                    mt = 1 - t
                    bx = (mt ** 3 * cur[0] + 3 * mt * mt * t * x1 +
                          3 * mt * t * t * x2 + t ** 3 * x)
                    by = (mt ** 3 * cur[1] + 3 * mt * mt * t * y1 +
                          3 * mt * t * t * y2 + t ** 3 * y)
                    poly.append((bx, by))
                cur = (x, y)
                i += 6
        elif k == 'Z':
            if start:
                cur = start
            flush(closed=True)
        else:
            i = len(nums)
    flush()


def render_svg_icon(svg, size=96, color=(232, 238, 246)):
    """把一个简化 SVG 渲染成 PNG"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    # viewBox
    m = re.search(r'viewBox="([\d.\- ]+)"', svg)
    if m:
        vb = [float(x) for x in m.group(1).split()]
        vw, vh = vb[2], vb[3]
    else:
        vw = vh = 24.0
    pad = size * 0.08
    sc = (size - pad * 2) / max(vw, vh)
    off = pad

    # 逐个 <path>
    for pm in re.finditer(r'<path\s+([^/]*?)/>', svg):
        attrs = pm.group(1)
        d = re.search(r'd="([^"]*)"', attrs)
        if not d:
            continue
        d = d.group(1)
        fill = None
        stroke = None
        if 'fill="currentColor"' in attrs:
            fill = color
        elif 'fill="none"' in attrs:
            fill = None
        else:
            fm = re.search(r'fill="(#[0-9a-fA-F]{3,6})"', attrs)
            if fm:
                h = fm.group(1).lstrip('#')
                if len(h) == 3:
                    h = ''.join(c * 2 for c in h)
                fill = (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
        if 'stroke="currentColor"' in attrs:
            stroke = color
        elif 'stroke="none"' in attrs or 'stroke=' not in attrs:
            sm = re.search(r'stroke="(#[0-9a-fA-F]{3,6})"', attrs)
            if sm:
                h = sm.group(1).lstrip('#')
                if len(h) == 3:
                    h = ''.join(c * 2 for c in h)
                stroke = (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
            else:
                stroke = None
        else:
            stroke = color
        sw = 1.0
        swm = re.search(r'stroke-width="([\d.]+)"', attrs)
        if swm:
            sw = float(swm.group(1))
        op = 1.0
        om = re.search(r'opacity="([\d.]+)"', attrs)
        if om:
            op = float(om.group(1))
        draw_path(dr, d, sc, off, fill=fill, stroke=stroke, width=sw, opacity=op)
    return img


def draw_armor_icon(size=96, color=(232, 238, 246)):
    """★ 游戏里的防具图标（龙鳞胸甲，用户第 125 轮钦定）"""
    svg = load_svg_const('ARMOR_ICON')
    if not svg:
        return Image.new('RGBA', (size, size), (0, 0, 0, 0))
    return render_svg_icon(svg, size, color)


if __name__ == '__main__':
    out = os.path.join(ROOT, 'docs', 'shots', 'game_special_icons')
    os.makedirs(out, exist_ok=True)
    for tier, col in ((11, (248, 113, 113)), (5, (96, 165, 250)), (0, (154, 163, 168))):
        draw_armor_icon(128, col).save(os.path.join(out, 'armor_t%d.png' % tier))
    print('防具图标已生成 →', out)
    print('ARMOR_ICON 长度:', len(load_svg_const('ARMOR_ICON')))
