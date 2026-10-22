# -*- coding: utf-8 -*-
"""把用户给的 打雷.wav 压成游戏用的音效

用户："把音频换成我这个并且压缩一下"

原文件：立体声 / 44.1kHz / 16bit / 1.18 秒 / 204KB
压缩：
  ① 降成单声道（游戏里都是单声道 ✓ 立体声没意义，还多一倍体积）
  ② 44.1kHz → 22.05kHz（先做低通防混叠，再抽取）
  ③ 归一化到 0.92 + 首尾 5ms 淡入淡出（防爆音/咔哒声）
  ④ 两个格式都放：
       · thunder1.mp3（48kbps，约 10KB）← 游戏优先用这个
       · thunder1.wav（约 52KB）        ← 解码失败时的兜底
"""
import os
import struct
import wave

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '打雷.wav')
DST_WAV = os.path.join(ROOT, 'web', 'assets', 'sfx', 'thunder1.wav')
DST_MP3 = os.path.join(ROOT, 'web', 'assets', 'sfx', 'thunder1.mp3')
SR_OUT = 22050

# ---------- 读 ----------
with wave.open(SRC, 'rb') as w:
    ch = w.getnchannels()
    sw = w.getsampwidth()
    sr = w.getframerate()
    n = w.getnframes()
    raw = w.readframes(n)
    print('源: %d 通道 · %d Hz · %d bit · %.2f 秒 · %.0f KB'
          % (ch, sr, sw * 8, n / sr, os.path.getsize(SRC) / 1024))

assert sw == 2, '只处理 16bit PCM'
x = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
if ch == 2:
    x = x.reshape(-1, 2).mean(axis=1)          # ① 降单声道
print('降单声道后: %d 个采样' % len(x))

# ---------- ② 低通 + 降采样（44.1k → 22.05k）----------
if sr != SR_OUT:
    ratio = sr / SR_OUT
    # 简单但有效的窗函数 sinc 低通（截止 0.45 * 新采样率）
    taps = 31
    fc = 0.45 * SR_OUT / sr                     # 归一化截止（相对源采样率）
    k = np.arange(taps) - (taps - 1) / 2
    h = 2 * fc * np.sinc(2 * fc * k) * np.hamming(taps)
    h /= h.sum()
    x = np.convolve(x, h, mode='same')
    # 线性插值重采样
    idx = np.arange(0, len(x) - 1, ratio)
    x = np.interp(idx, np.arange(len(x)), x)
print('降采样后: %d 个采样 (%.0f Hz)' % (len(x), SR_OUT))

# ---------- ③ 归一化 + 首尾淡入淡出 ----------
peak = float(np.abs(x).max()) or 1.0
x = x * (0.92 / peak)
fade = int(SR_OUT * 0.02)   # ★ 20ms（源文件尾巴没炸音，但多留一点更稳 ✓）
if fade > 0 and len(x) > fade * 2:
    ramp = np.linspace(0, 1, fade, dtype=np.float32)
    x[:fade] *= ramp
    x[-fade:] *= ramp[::-1]
print('峰值归一化到 %.2f（原峰值 %.2f）' % (float(np.abs(x).max()), peak))

pcm = np.clip(x, -1.0, 1.0)
pcm16 = (pcm * 32767).astype('<i2')

# ---------- ④ 写 wav ----------
with wave.open(DST_WAV, 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR_OUT)
    w.writeframes(pcm16.tobytes())
print('写出 wav: %.0f KB  %s' % (os.path.getsize(DST_WAV) / 1024, DST_WAV))

# ---------- ⑤ 写 mp3（lameenc）----------
try:
    import lameenc
    enc = lameenc.Encoder()
    enc.set_bit_rate(48)
    enc.set_in_sample_rate(SR_OUT)
    enc.set_channels(1)
    enc.set_quality(3)
    mp3 = enc.encode(pcm16.tobytes())
    mp3 += enc.flush()
    with open(DST_MP3, 'wb') as f:
        f.write(bytes(mp3))
    print('写出 mp3: %.1f KB  %s' % (os.path.getsize(DST_MP3) / 1024, DST_MP3))
except Exception as e:
    print('mp3 编码失败（只用 wav 也行）:', e)

orig = os.path.getsize(SRC) / 1024
print('')
print('体积: %.0f KB → wav %.0f KB (-%.0f%%) / mp3 %.1f KB (-%.0f%%)' % (
    orig, os.path.getsize(DST_WAV) / 1024,
    (1 - os.path.getsize(DST_WAV) / os.path.getsize(SRC)) * 100,
    os.path.getsize(DST_MP3) / 1024 if os.path.exists(DST_MP3) else 0,
    (1 - os.path.getsize(DST_MP3) / os.path.getsize(SRC)) * 100 if os.path.exists(DST_MP3) else 0))
