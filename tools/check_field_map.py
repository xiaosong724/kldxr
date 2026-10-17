# -*- coding: utf-8 -*-
"""闸门：服务器快照里发的每个字段，客户端 wsApplyWorld 必须都读得到

★★★ 为什么需要这个东西（2026-10-18 的教训）★★★
  一个字段从服务器到屏幕要穿过四层：
    ① 服务端 _snapshot_for 打包 dict
    ② 客户端 wsApplyWorld 用【显式清单】重新拼对象   ← 每次都漏这里
    ③ addOther
    ④ 渲染
  第②层漏一个字段的表现是【静默失效】：不报错、不崩溃、就是不显示 ✓
  已经踩过三次：
    · 第 220 轮 hpm → 别人看你的血条永远是满的
    · 第 156 轮 mq  → 别人看不到你头顶的魔气
    · 第 316 轮 jy  → 别人看不到你跳跃（这一轮浪费了四次往返）

  这个脚本干的事：把两边的字段名抓出来对一遍 ✗ 少一个就报错 ✓
  跑一次 0.1 秒 ✗ 但能省掉一整轮"改了没反应"的排查 ✓
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, 'server', 'world.py')
CLIENT = os.path.join(ROOT, 'web', 'core', 'game.js')

# ★ 允许"服务器发了但客户端故意不读"的字段（写在这里必须给理由 ✓）
IGNORE = {
    # 目前没有：所有字段客户端都在用 ✓
}


def read(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


def server_keys(src):
    """抓 _snapshot_for 里 out.append({...}) 的键"""
    i = src.find('def _snapshot_for')
    if i < 0:
        raise SystemExit('找不到 _snapshot_for')
    j = src.find('return out', i)
    if j < 0:
        raise SystemExit('找不到 _snapshot_for 的 return out')
    block = src[i:j]
    # 只看 out.append( ... ) 里面的那一坨
    k = block.find('out.append(')
    if k < 0:
        raise SystemExit('找不到 out.append')
    seg = block[k:]
    # 只抓形如 'key': 的
    return set(re.findall(r"'([A-Za-z_][A-Za-z0-9_]*)'\s*:", seg))


def client_used(src):
    """抓 wsApplyWorld → addOther({...}) 里所有 w.xxx 的 xxx"""
    i = src.find('function wsApplyWorld')
    if i < 0:
        raise SystemExit('找不到 wsApplyWorld')
    j = src.find('function ', i + 10)
    block = src[i:j if j > 0 else len(src)]
    k = block.find('addOther({')
    if k < 0:
        raise SystemExit('找不到 addOther 调用')
    # addOther 的括号范围（粗略：到第一个 "});"）
    e = block.find('});', k)
    seg = block[k:e if e > 0 else len(block)]
    # ★★ 必须先剥掉注释 ✗ 否则注释里写的 "w.jy" 会被当成真的读了 ✓
    #   （上一版就被我自己写的注释骗过一次 ✓ 是自测抓出来的 ✓）
    seg = re.sub(r'/\*.*?\*/', '', seg, flags=re.S)
    seg = re.sub(r'//[^\n]*', '', seg)
    return set(re.findall(r'\bw\.([A-Za-z_][A-Za-z0-9_]*)', seg))


def main():
    sk = server_keys(read(SERVER))
    ck = client_used(read(CLIENT))
    # id 用的是 w.id（在 addOther 外面算的）✗ 特殊处理 ✓
    if 'id' not in ck:
        ck.add('id')
    missing = sorted(sk - ck - set(IGNORE))
    extra = sorted(ck - sk - set(IGNORE))

    print('服务端快照字段 (%d): %s' % (len(sk), ', '.join(sorted(sk))))
    print('客户端读了     (%d): %s' % (len(ck), ', '.join(sorted(ck))))
    print()

    ok = True
    if missing:
        ok = False
        print('!! 服务器发了但客户端【没读】的字段（会静默失效）：')
        for k in missing:
            print('     ' + k)
        print('   → 在 web/core/game.js 的 addOther({...}) 里加一行：')
        for k in missing:
            print("       %s: +w.%s || 0," % (k, k))
    if extra:
        # 读了一个服务器没发的字段 → 永远是 undefined ✗ 也算错
        ok = False
        print('!! 客户端读了但服务器【没发】的字段（永远是 undefined）：')
        for k in extra:
            print('     ' + k)

    if ok:
        print('✓ 两边字段一致（%d 个）—— 不会有"服务器发了但显示不出来"的问题' % len(sk))
        return 0
    return 1


def selftest():
    """★ 自测：故意把 jy 从客户端删掉 ✗ 确认闸门会报错
       ★ 为什么要有：一个永远返回"通过"的检查等于没有检查 ✓
         （本次会话我已经被"语法检查通过但逻辑没生效"骗过四次 ✓）"""
    src = read(CLIENT)
    broken = src.replace('jy: Math.max(0, +w.jy || 0),', '')
    if broken == src:
        print('!! 自测失败：没找到 jy 那一行（脚本的匹配规则过期了）')
        return 1
    sk = server_keys(read(SERVER))
    ck = client_used(broken)
    if 'id' not in ck:
        ck.add('id')
    miss = sorted(sk - ck - set(IGNORE))
    if miss == ['jy']:
        print('✓ 自测通过：故意删掉 jy 后，闸门正确报出了 [jy]')
        return 0
    print('!! 自测异常：期望只报 [jy]，实际报了 %r' % (miss,))
    return 1


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    sys.exit(main())
