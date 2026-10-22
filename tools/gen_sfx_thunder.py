# -*- coding: utf-8 -*-
"""合成雷声 v2（修 v1 的致命问题：只有开头的"啪"，后面没轰鸣）

v1 的错：
  · 一阶低通把低频噪声压得极小（0.012 的系数 → 幅度只有千分之一级别 ✗）
  · 最后又按【峰值】归一化 ✗ 峰值被开头的劈裂占满 → 轰鸣被压到听不见 ✓
  → 波形上就是"开头一根尖刺 + 后面一条直线" ✓

v2 的做法：
  ① 每一层单独归一化（按 RMS），再按权重混 → 每层都听得见 ✓
  ② 加一个 45Hz 的低频"轰"（雷声的胸腔感 ✓）
  ③ 两次劈裂（0ms / 380ms，第二下更闷）→ 真实的雷都是连响 ✓
  ④ 结尾做软限幅（tanh）而不是硬裁剪 → 不刺耳 ✓
"""
import math
import os
import random
import struct
import wave

SR = 22050
DUR = 2.4
N = int(SR * DUR)
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'web', 'assets', 'sfx', 'thunder1.wav')
random.seed(20261018)

buf = [0.0] * N


def add_layer(samples, amp):
    for i, v in enumerate(samples):
        if i < N:
            buf[i] += v * amp


def rms(x):
    if not x:
        return 1e-9
    return math.sqrt(sum(v * v for v in x) / len(x))


def norm_rms(x, target):
    k = target / max(1e-9, rms(x))
    return [v * k for v in x]


# ---------- ① 劈裂（两次） ----------
def crack(dur, decay, bright, start_i):
    n = int(SR * dur)
    out = [0.0] * n
    lp = 0.0
    for i in range(n):
        t = i / SR
        nz = random.uniform(-1, 1)
        lp = lp + (nz - lp) * 0.25          # 一阶低通做"高通差分"
        hi = nz - lp * bright               # 高频为主
        env = math.exp(-t / decay)
        out[i] = hi * env
    out = norm_rms(out, 0.55)
    return out


c1 = crack(0.05, 0.010, 0.6, 0)
c2 = crack(0.09, 0.030, 0.9, 0)             # 第二下更闷 ✓
for i, v in enumerate(c1):
    buf[i] += v * 0.9
off2 = int(SR * 0.38)
for i, v in enumerate(c2):
    if off2 + i < N:
        buf[off2 + i] += v * 0.55

# ---------- ② 三层低频轰鸣（每层单独归一化） ----------
for cut, amp, decay, delay, mod_hz in [
        (0.020, 0.95, 0.75, 0.02, 2.6),
        (0.010, 1.00, 1.25, 0.10, 1.7),
        (0.004, 0.90, 1.90, 0.26, 1.1)]:
    layer = [0.0] * N
    lp1 = 0.0
    lp2 = 0.0
    for i in range(N):
        t = i / SR
        nz = random.uniform(-1, 1)
        lp1 = lp1 + (nz - lp1) * cut
        lp2 = lp2 + (lp1 - lp2) * cut * 0.7
        tt = t - delay
        if tt < 0:
            continue
        env = math.exp(-tt / decay)
        rumble = 0.7 + 0.3 * math.sin(2 * math.pi * mod_hz * tt)
        layer[i] = (lp1 * 0.6 + lp2 * 1.6) * env * rumble
    layer = norm_rms(layer, 0.30)
    add_layer(layer, amp)

# ---------- ★ v3：中频轰鸣层（200~1200Hz）----------
#   为什么要加：实测 v2 的能量 90% 在 80Hz 以下 ✗
#   而【手机扬声器】基本放不出 200Hz 以下 ✗✗
#   → 用户在手机上听到的就是"啥也没有" ✓
#   → 所以必须在 300~1200Hz 也有能量 ✓
mid = [0.0] * N
lo1 = 0.0
lo2 = 0.0
for i in range(N):
    t = i / SR
    nz = random.uniform(-1, 1)
    lo1 = lo1 + (nz - lo1) * 0.30          # ~1000Hz 低通
    lo2 = lo2 + (nz - lo2) * 0.055         # ~190Hz  低通
    bp = lo1 - lo2                          # 带通：190~1000Hz ✓
    if t < 0.03:
        continue
    tt = t - 0.03
    env = math.exp(-tt / 0.85) * (0.75 + 0.25 * math.sin(2 * math.pi * 1.9 * tt))
    mid[i] = bp * env
mid = norm_rms(mid, 0.30)
add_layer(mid, 1.55)      # ★ 再提一点：手机扬声器靠它✓

# ★ 高中颟的"碧力"层（600~2500Hz，衷得快）—— 就是雷声里那个"滋滋"的尾音 ✓
sp = [0.0] * N
h1 = 0.0
h2 = 0.0
for i in range(N):
    t = i / SR
    nz = random.uniform(-1, 1)
    h1 = h1 + (nz - h1) * 0.55
    h2 = h2 + (nz - h2) * 0.16
    bp2 = h1 - h2
    if t < 0.05:
        continue
    tt = t - 0.05
    env = math.exp(-tt / 0.45)
    sp[i] = bp2 * env
sp = norm_rms(sp, 0.25)
add_layer(sp, 0.75)

# ---------- ③ 45Hz 的"轰"（胸腔感） ----------
thump = [0.0] * N
for i in range(N):
    t = i / SR
    if t < 0.02:
        continue
    tt = t - 0.02
    env = math.exp(-tt / 0.55)
    f = 46 - 8 * min(1.0, tt / 1.2)          # 稍微往下滑 ✓
    thump[i] = math.sin(2 * math.pi * f * tt) * env
thump = norm_rms(thump, 0.22)
for i, v in enumerate(thump):
    buf[i] += v

# ---------- ④ 软限幅 + 归一化 ----------
peak = max(1e-9, max(abs(v) for v in buf))
k = 0.98 / peak
out = []
for v in buf:
    x = v * k
    out.append(math.tanh(x * 1.15) / math.tanh(1.15))

peak2 = max(1e-9, max(abs(v) for v in out))
scale = 0.92 / peak2
pcm = [int(max(-1.0, min(1.0, v * scale)) * 32767) for v in out]

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with wave.open(OUT, 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(b''.join(struct.pack('<h', v) for v in pcm))

print('写好: %s  (%d 字节, %.2f 秒 @ %dHz 单声道)' % (
    OUT, os.path.getsize(OUT), DUR, SR))
