# -*- coding: utf-8 -*-
"""把本体/分身两块名牌裁图拼成一张对比图（给用户看 ✓）"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'docs', 'shots')
a = Image.open(os.path.join(SHOTS, '_plate_owner.png')).convert('RGBA')
b = Image.open(os.path.join(SHOTS, '_plate_clone.png')).convert('RGBA')

PAD = 18
TOP = 86
W = a.width + b.width + PAD * 3
H = max(a.height, b.height) + TOP + 44
canvas = Image.new('RGBA', (W, H), (26, 22, 16, 255))
d = ImageDraw.Draw(canvas)

font_path = r'C:\Windows\Fonts\msyh.ttc'
try:
    f_big = ImageFont.truetype(font_path, 24)
    f_small = ImageFont.truetype(font_path, 15)
except Exception:
    f_big = ImageFont.load_default()
    f_small = ImageFont.load_default()

title = 'AI 分身头顶名牌 vs 玩家本体（逐项一致）'
tw = d.textlength(title, font=f_big)
d.text(((W - tw) / 2, 14), title, font=f_big, fill=(234, 242, 251, 255))

# 左：本体；右：分身
canvas.alpha_composite(a, (PAD, TOP))
canvas.alpha_composite(b, (PAD * 2 + a.width, TOP))

for text, x, w in [('本体（别的玩家看到的）', PAD, a.width),
                   ('AI 分身（同一套 UI）', PAD * 2 + a.width, b.width)]:
    tw = d.textlength(text, font=f_small)
    d.text((x + (w - tw) / 2, TOP - 26), text, font=f_small, fill=(142, 224, 168, 255))

# 底部说明
note = '名字 / 字体 / 字重 / 阴影 / 条宽 / 条高 / 绿色渐变 / 条内数字：全部一致'
tw = d.textlength(note, font=f_small)
d.text(((W - tw) / 2, TOP + a.height + 10), note, font=f_small, fill=(180, 190, 200, 255))

out = os.path.join(SHOTS, 'clone-plate-compare.png')
canvas.convert('RGB').save(out, quality=95)
print('saved', out, canvas.size)
