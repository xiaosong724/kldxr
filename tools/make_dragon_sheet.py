# -*- coding: utf-8 -*-
"""把 4 张方向稿做统一电影色调 + 2x2 选型总览"""
import os
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(ROOT, '..', 'docs', 'shots')
TINTS = {
    'dragon-option-1.png': (92, 180, 220, 0.06),
    'dragon-option-2.png': (210, 45, 35, 0.14),
    'dragon-option-3.png': (120, 210, 255, 0.12),
    'dragon-option-4.png': (255, 95, 20, 0.10),
}
images = []
for name, (r, g, b, a) in TINTS.items():
    p = os.path.join(SHOTS, name)
    im = Image.open(p).convert('RGB')
    if name == 'dragon-option-4.png':
        im = ImageEnhance.Brightness(im).enhance(0.78)
        im = ImageEnhance.Contrast(im).enhance(1.12)
    elif name == 'dragon-option-2.png':
        im = ImageEnhance.Color(im).enhance(0.72)
        im = ImageEnhance.Contrast(im).enhance(1.10)
    elif name == 'dragon-option-3.png':
        im = ImageEnhance.Color(im).enhance(0.82)
    # 色调叠加
    overlay = Image.new('RGB', im.size, (r, g, b))
    im = Image.blend(im, overlay, a)
    # 暗角
    w, h = im.size
    mask = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse([-w * 0.25, -h * 0.35, w * 1.25, h * 1.35], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(140))
    dark = Image.new('RGB', (w, h), (0, 0, 0))
    im = Image.composite(im, dark, mask)
    im.save(p, 'PNG')
    images.append(im)

# 2x2 总览
cw, ch = 900, 550
sheet = Image.new('RGB', (1800, 1100), (7, 10, 12))
for i, im in enumerate(images):
    thumb = im.resize((cw, ch), Image.Resampling.LANCZOS)
    sheet.paste(thumb, ((i % 2) * cw, (i // 2) * ch))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc', 26)
    small = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 15)
except Exception:
    font = small = None
for i, text in enumerate(['01 古骨龙', '02 血骨龙', '03 霜骨龙', '04 黑曜熔岩龙']):
    x, y = (i % 2) * cw + 22, (i // 2) * ch + 18
    d.rectangle([x - 10, y - 8, x + 220, y + 42], fill=(4, 6, 7))
    d.text((x, y), text, font=font, fill=(238, 226, 202))
sheet.save(os.path.join(SHOTS, 'dragon-options-sheet.png'), 'PNG')
print('OK sheet')
