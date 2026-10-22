# -*- coding: utf-8 -*-
"""生成 4 张骨龙方向图（外部免费推理接口，仅用于本地选型）"""
import os
import time
import urllib.parse
import urllib.request

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'shots')
os.makedirs(OUT, exist_ok=True)

BASE = (
    "ultra photorealistic cinematic concept art, full body colossal undead bone dragon boss, "
    "three-quarter side view, standing on dark volcanic stone ground, "
    "one single cohesive creature, seamless continuous anatomy, fused skeleton, "
    "long S curved neck, heavy ribcage, tapered tail, four digitigrade legs with claws, "
    "huge tattered membrane wings, aged ivory bone plates, realistic weathering and microfractures, "
    "dark fantasy game boss, cinematic volumetric fog, dramatic rim light, "
    "Unreal Engine 5, 8k, extremely detailed, sharp focus, centered composition, "
    "no text, no watermark, no logo"
)
VARIANTS = [
    ("dragon-option-1.png", BASE + ", ancient ivory bone dragon, cold cyan glowing eyes and chest, "
     "dark purple torn wing membranes, cold moonlight, elegant and majestic"),
    ("dragon-option-2.png", BASE + ", corrupted blood bone dragon, crimson glowing eyes and exposed red marrow, "
     "dark blood-red torn wing membranes, burnt ground, ominous and feral"),
    ("dragon-option-3.png", BASE + ", frost bone dragon, pale blue-white ice crystals growing from bone, "
     "translucent icy wings, blue glowing eyes, snowy cliff, cold mist"),
    ("dragon-option-4.png", BASE + ", obsidian magma bone dragon, charcoal gray bone armor with glowing orange lava cracks, "
     "molten orange eyes, ember wing membranes, volcanic ash, aggressive"),
]

for name, prompt in VARIANTS:
    url = ('https://image.pollinations.ai/prompt/' + urllib.parse.quote(prompt, safe='') +
           '?width=1536&height=1024&model=flux&nologo=true&enhance=true&seed=620')
    dst = os.path.join(OUT, name)
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            if len(data) < 20000:
                raise RuntimeError('image too small %d' % len(data))
            with open(dst, 'wb') as f:
                f.write(data)
            print('OK', name, len(data))
            break
        except Exception as e:
            print('RETRY', name, attempt, repr(e))
            time.sleep(4 + attempt * 3)
    else:
        print('FAIL', name)
