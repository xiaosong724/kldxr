# -*- coding: utf-8 -*-
"""用本地可访问的 FLUX schnell Space 生成 4 张骨龙方向图。"""
import io
import json
import os
import time
import urllib.request

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'shots')
os.makedirs(OUT, exist_ok=True)
BASE = 'https://black-forest-labs-flux-1-schnell.hf.space'
BASE_PROMPT = (
    'ultra photorealistic cinematic full body concept art of a colossal undead bone dragon boss, '
    'three-quarter side view, standing on dark volcanic rock ground, one single cohesive creature, '
    'seamless continuous anatomy, fused spine and ribcage, long S-curved neck, tapered tail, '
    'four digitigrade legs with claws, huge bat-like wings with tattered membrane, '
    'ancient ivory bone plates with realistic weathering, hairline cracks, porous surface, '
    'dark fantasy game boss, dramatic cold moonlight, volumetric fog, dark background, '
    'Unreal Engine 5 render, 8k, extremely detailed, sharp focus, centered composition, '
    'no text, no watermark, no logo, no disconnected bones, no floating parts'
)
VARIANTS = [
    ('dragon-option-1.png', BASE_PROMPT + ', ivory ancient bone dragon, cold cyan glowing eyes and chest, '
     'dark purple torn wing membranes, elegant and majestic'),
    ('dragon-option-2.png', BASE_PROMPT + ', corrupted blood bone dragon, crimson glowing eyes, exposed dark red marrow, '
     'blood-red torn wing membranes, burnt ground, feral and ominous'),
    ('dragon-option-3.png', BASE_PROMPT + ', frost bone dragon, pale blue-white ice crystals growing from the bones, '
     'translucent icy wing membranes, blue glowing eyes, snowy cliff, cold mist'),
    ('dragon-option-4.png', BASE_PROMPT + ', obsidian magma bone dragon, charcoal gray bone armor with glowing orange lava cracks, '
     'molten orange eyes, ember wing membranes, volcanic ash, aggressive'),
]


def call(prompt, seed=620, w=1536, h=1024):
    payload = json.dumps({'data': [prompt, seed, False, w, h, 4]}).encode('utf-8')
    req = urllib.request.Request(BASE + '/gradio_api/call/infer', data=payload,
                                 headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=90) as r:
        eid = json.loads(r.read().decode())['event_id']
    for _ in range(50):
        try:
            with urllib.request.urlopen(BASE + '/gradio_api/call/infer/' + eid, timeout=120) as r:
                txt = r.read().decode()
            if 'data:' in txt:
                line = [x for x in txt.splitlines() if x.startswith('data:')][-1][5:].strip()
                obj = json.loads(line)
                return obj[0]['url']
        except Exception:
            pass
        time.sleep(3)
    raise RuntimeError('no result')


def label(im, text):
    d = ImageDraw.Draw(im)
    font = ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc', 48)
    small = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 24)
    d.rectangle([0, 0, 760, 150], fill=(5, 8, 9, 210))
    d.text((38, 24), text, font=font, fill=(238, 227, 204))
    d.text((40, 92), 'DRAGON MODEL DIRECTION / choose 01-04', font=small, fill=(151, 168, 159))


for name, prompt in VARIANTS:
    for attempt in range(3):
        try:
            url = call(prompt)
            with urllib.request.urlopen(url, timeout=120) as r:
                raw = r.read()
            im = Image.open(io.BytesIO(raw)).convert('RGB')
            im = im.resize((1800, 1100), Image.Resampling.LANCZOS)
            label(im, name.replace('dragon-option-', 'OPTION ').replace('.png', ''))
            im.save(os.path.join(OUT, name), 'PNG')
            print('OK', name, len(raw))
            break
        except Exception as e:
            print('RETRY', name, attempt, repr(e))
            time.sleep(5 + attempt * 5)
    else:
        print('FAIL', name)
