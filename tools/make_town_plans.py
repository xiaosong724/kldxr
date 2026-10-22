# -*- coding: utf-8 -*-
"""生成两张小镇总览图（方案 A / 方案 B），不修改游戏代码。"""
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 1800, 2000
X0, Y0 = 150, 175
MAP = 1500
S = MAP / 50.0
CX = X0 + 25 * S
CY = Y0 + 25 * S

BG = '#171712'
INK = '#efe3c5'
DIM = '#b9aa8a'
GRID = '#2a2a22'
ROAD = '#5b564a'
PLAZA = '#77705f'
BUILD = '#8b6a45'
BUILD2 = '#7b5b3b'
WARE = '#c19a4a'
WALL = '#a58b63'
GREEN = '#465a34'
GOLD = '#ffd56a'
DOOR = '#ffe08a'


def font(size, bold=False):
    p = r'C:\Windows\Fonts\msyhbd.ttc' if bold else r'C:\Windows\Fonts\msyh.ttc'
    return ImageFont.truetype(p, size)


F_TITLE = font(56, True)
F_SUB = font(26)
F_LABEL = font(23, True)
F_SMALL = font(19)
F_LEG = font(22)


def P(x, z):
    return (X0 + (x + 25) * S, Y0 + (z + 25) * S)


def rect(d, x0, z0, x1, z1, fill, outline=None, width=2, radius=0):
    a, b = P(x0, z0)
    c, e = P(x1, z1)
    box = [min(a, c), min(b, e), max(a, c), max(b, e)]
    if radius:
        d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)
    else:
        d.rectangle(box, fill=fill, outline=outline, width=width)


def line(d, x0, z0, x1, z1, fill, width=4):
    d.line([P(x0, z0), P(x1, z1)], fill=fill, width=width)


def text(d, x, z, s, f, fill=INK, anchor='mm', dy=0):
    a, b = P(x, z)
    d.text((a, b + dy), s, font=f, fill=fill, anchor=anchor)


def wall_with_gates(d, gate=3.2, t=0.9):
    # 四边城墙，四个方向留门洞
    for z in (-25, 25):
        for x0, x1 in ((-25, -gate), (gate, 25)):
            rect(d, x0, z - t / 2, x1, z + t / 2, WALL)
    for x in (-25, 25):
        for z0, z1 in ((-25, -gate), (gate, 25)):
            rect(d, x - t / 2, z0, x + t / 2, z1, WALL)
    # 门口金色标记
    for x, z, sx, sz in ((0, -25, 1.8, .25), (0, 25, 1.8, .25),
                         (-25, 0, .25, 1.8), (25, 0, .25, 1.8)):
        rect(d, x - sx, z - sz, x + sx, z + sz, GOLD)


def building(d, x0, z0, x1, z1, name, num, door, warehouse=False, fg=INK):
    fill = WARE if warehouse else BUILD
    rect(d, x0, z0, x1, z1, fill, '#2a1b10', 3, radius=2)
    # 内部空间（提示可进入）
    rect(d, x0 + .75, z0 + .75, x1 - .75, z1 - .75, '#6f5335' if not warehouse else '#8b6a32',
         '#3b2817', 1)
    # 门
    side, at = door
    if side == 'south':
        line(d, at - 1.0, z1, at + 1.0, z1, DOOR, 7)
    elif side == 'north':
        line(d, at - 1.0, z0, at + 1.0, z0, DOOR, 7)
    elif side == 'east':
        line(d, x1, at - 1.0, x1, at + 1.0, DOOR, 7)
    else:
        line(d, x0, at - 1.0, x0, at + 1.0, DOOR, 7)
    # 编号徽章
    bx, by = P((x0 + x1) / 2, (z0 + z1) / 2)
    r = 22
    d.ellipse([bx - r, by - r, bx + r, by + r], fill='#20160d', outline=GOLD, width=2)
    d.text((bx, by - 1), str(num), font=font(25, True), fill=GOLD, anchor='mm')
    d.text((bx, by + 31), name, font=F_LABEL, fill=fg, anchor='mm')
    if warehouse:
        # 小箱子标记
        cx, cy = bx, by - 52
        d.rectangle([cx - 15, cy - 11, cx + 15, cy + 11], fill='#3a2612', outline=GOLD, width=2)
        d.line([cx - 15, cy, cx + 15, cy], fill=GOLD, width=2)
        d.line([cx, cy - 11, cx, cy + 11], fill=GOLD, width=2)


def grid(d):
    for i in range(-25, 26, 5):
        c = '#3a382c' if i % 10 == 0 else GRID
        line(d, i, -25, i, 25, c, 1)
        line(d, -25, i, 25, i, c, 1)


def base_image():
    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)
    # 外框 / 地图底
    d.rounded_rectangle([X0 - 12, Y0 - 12, X0 + MAP + 12, Y0 + MAP + 12],
                        radius=12, fill='#201f19', outline='#806a46', width=2)
    rect(d, -25, -25, 25, 25, '#23241d', '#806a46', 2)
    grid(d)
    return img, d


def header(d, title, sub):
    d.text((W / 2, 58), title, font=F_TITLE, fill=INK, anchor='mm')
    d.text((W / 2, 112), sub, font=F_SUB, fill=DIM, anchor='mm')
    # 北箭头
    ax, ay = X0 + MAP - 30, Y0 + 38
    d.line([ax, ay + 30, ax, ay - 18], fill=GOLD, width=4)
    d.polygon([(ax, ay - 26), (ax - 9, ay - 10), (ax + 9, ay - 10)], fill=GOLD)
    d.text((ax, ay + 42), '北', font=F_SMALL, fill=GOLD, anchor='mm')


def legend(d, extra=''):
    y = Y0 + MAP + 35
    d.text((X0, y), '图例', font=font(25, True), fill=GOLD)
    items = [
        (ROAD, '道路'), (PLAZA, '广场'), (BUILD, '普通建筑'),
        (WARE, '仓库'), (WALL, '城墙'), (GOLD, '城门 / 入口')
    ]
    x = X0 + 85
    for col, label in items:
        d.rectangle([x, y - 11, x + 26, y + 15], fill=col, outline='#00000066')
        d.text((x + 34, y - 12), label, font=F_LEG, fill=INK)
        x += 200
    d.text((X0, y + 38), extra, font=F_SMALL, fill=DIM)


def map_a():
    img, d = base_image()
    header(d, '方案 A · 十字广场镇', '50×50 · 中央石板广场 · 8 栋可进入建筑 · 紧凑型新手村')

    # 道路
    rect(d, -3.5, -25, 3.5, 25, ROAD)
    rect(d, -25, -3.5, 25, 3.5, ROAD)
    rect(d, -8, -8, 8, 8, PLAZA, '#8c8370', 2)
    # 广场中心喷泉
    cx, cy = P(0, 0)
    d.ellipse([cx - 52, cy - 52, cx + 52, cy + 52], fill='#9da7aa', outline='#d9e4e5', width=3)
    d.ellipse([cx - 30, cy - 30, cx + 30, cy + 30], fill='#4b8aa0', outline='#c8f0ff', width=2)
    d.text((cx, cy + 78), '中央广场', font=F_LABEL, fill=INK, anchor='mm')

    wall_with_gates(d)

    # 8 栋建筑（全部有门，内部清空）
    building(d, -22, 5, -13, 14, '仓库', 1, ('east', 9.5), warehouse=True)
    building(d, 12, 5, 22, 15, '铁匠铺', 2, ('west', 10))
    building(d, -22, -15, -14, -6, '药铺', 3, ('east', -10.5))
    building(d, 10, -17, 22, -7, '旅店', 4, ('west', -12))
    building(d, -6, -23, 6, -15, '新手大厅', 5, ('south', 0))
    building(d, 14, -3, 22, 3, '杂货铺', 6, ('west', 0))
    building(d, -23, -4, -16, 3, '民居 A', 7, ('east', -.5))
    building(d, 12, 17, 21, 23, '民居 B', 8, ('north', 16.5))

    # 南北门标注
    d.text((P(0, 24)[0], P(0, 24)[1] + 42), '南门 · 主入口', font=F_SMALL, fill=GOLD, anchor='mm')
    d.text((P(0, -24)[0], P(0, -24)[1] - 42), '北门', font=F_SMALL, fill=GOLD, anchor='mm')
    legend(d, 'A 型：街道最直、去仓库最近；中央广场一眼能看到所有主要建筑。')

    out = os.path.join(os.path.dirname(__file__), '..', 'docs', 'shots', 'town-plan-a.png')
    img.save(out)
    return out


def map_b():
    img, d = base_image()
    header(d, '方案 B · 环形街区镇', '50×50 · 环形主街 · 中央广场 · 8 栋可进入建筑 · 小镇感更强')

    # 环形道路
    cx, cy = CX, CY
    ro = 15 * S
    ri = 8 * S
    d.ellipse([cx - ro, cy - ro, cx + ro, cy + ro], fill=ROAD)
    d.ellipse([cx - ri, cy - ri, cx + ri, cy + ri], fill=PLAZA, outline='#8c8370', width=2)
    # 四条放射路
    rect(d, -3.2, -25, 3.2, -14, ROAD)
    rect(d, -3.2, 14, 3.2, 25, ROAD)
    rect(d, -25, -3.2, -14, 3.2, ROAD)
    rect(d, 14, -3.2, 25, 3.2, ROAD)
    # 中央喷泉
    d.ellipse([cx - 50, cy - 50, cx + 50, cy + 50], fill='#9da7aa', outline='#d9e4e5', width=3)
    d.ellipse([cx - 28, cy - 28, cx + 28, cy + 28], fill='#4b8aa0', outline='#c8f0ff', width=2)
    d.text((cx, cy + 78), '中央广场', font=F_LABEL, fill=INK, anchor='mm')

    wall_with_gates(d)

    building(d, -24, 7, -14, 17, '仓库', 1, ('east', 12), warehouse=True)
    building(d, 13, 9, 24, 18, '铁匠铺', 2, ('west', 13))
    building(d, -24, -19, -15, -10, '药铺', 3, ('east', -14.5))
    building(d, 12, -20, 24, -11, '旅店', 4, ('west', -15.5))
    building(d, -7, -24, 7, -17, '新手大厅', 5, ('south', 0))
    building(d, 16, -9, 24, -4, '杂货铺', 6, ('west', -6.5))
    building(d, -24, -9, -17, -4, '民居 A', 7, ('east', -6.5))
    building(d, 7, 18, 14, 23, '民居 B', 8, ('north', 10.5))

    d.text((P(0, 24)[0], P(0, 24)[1] + 42), '南门 · 主入口', font=F_SMALL, fill=GOLD, anchor='mm')
    d.text((P(0, -24)[0], P(0, -24)[1] - 42), '北门', font=F_SMALL, fill=GOLD, anchor='mm')
    legend(d, 'B 型：环形街道把广场围在中间，建筑沿外圈分布；更像一个完整小镇。')

    out = os.path.join(os.path.dirname(__file__), '..', 'docs', 'shots', 'town-plan-b.png')
    img.save(out)
    return out


if __name__ == '__main__':
    print(map_a())
    print(map_b())
