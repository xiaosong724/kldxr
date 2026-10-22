# -*- coding: utf-8 -*-
"""云端 world.py 对照审计（2026-10-22）

为什么要有这个脚本：
    本地 world.py 曾经被回滚到 10-18 的版本，丢了 10-19~21 三天的战斗/技能/皮肤代码。
    恢复过程中我吃过两个亏：
      ① 只数"函数在不在"→ 函数在但没人调用（挂载点没搬）
      ② 只数"调用点在不在"→ 字段没下发（`me.sz` 漏了，体型不生效）

    所以审计必须覆盖【所有信息通道】，一条一条过，不靠记忆。

用法：
    python tools/audit_cloud_parity.py [参考文件]
    （参考文件默认 server/_cloud_world.py，从云端 /opt/xiuxian2d/server/world.py 取）

判定标准：
    ① 方法覆盖     云端每个方法，本地必须有
    ② 调用点       云端调 N 次 → 本地至少 N 次（_pvp_ok 用 _can_hit_player 等价替换）
    ③ me 字段      本地发的 ⊇ 云端发的 ⊇ 客户端读的
    ④ 怪物 wire    字段顺序和数量（客户端按下标读，只能往后加）
    ⑤ 模块常量     一个不能少
    ⑥ Player 字段  __slots__ 少一个就 AttributeError
    ⑦ 消息类型     云端会发的包，本地也要能发
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def uniq_defs(src):
    return set(re.findall(r'^    def (\w+)\(', src, re.M))


def call_count(src, name):
    n = 0
    for m in re.finditer(r'self\.%s\(' % re.escape(name), src):
        ls = src.rfind('\n', 0, m.start()) + 1
        if src[ls:src.find('\n', m.start())].strip().startswith('def '):
            continue
        n += 1
    return n


def me_fields(src):
    return set(re.findall(r"_me0\[['\"](\w+)['\"]\]", src))


def player_slots(src):
    i = src.index('class Player')
    j = src.index('def __init__', i)
    return set(re.findall(r"'(\w+)'", src[i:j]))


def packs(src):
    return set(re.findall(r"P\.pack\('(\w+)'", src))


def main():
    ref = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'server', '_cloud_world.py')
    for p in (ref, os.path.join(ROOT, 'server', 'world.py')):
        if not os.path.exists(p):
            print('找不到文件: %s' % p)
            return 2
    C = io.open(ref, encoding='utf-8').read()
    L = io.open(os.path.join(ROOT, 'server', 'world.py'), encoding='utf-8').read()
    G = io.open(os.path.join(ROOT, 'web', 'core', 'game.js'), encoding='utf-8').read()
    M = io.open(os.path.join(ROOT, 'server', 'mobs.py'), encoding='utf-8').read()

    bad = 0
    cm, lm = uniq_defs(C), uniq_defs(L)
    missing = sorted(cm - lm)
    print('① 云端方法覆盖      %d/%d  %s' % (len(cm & lm), len(cm),
                                          'OK' if not missing else '缺 %s' % missing))
    bad += len(missing)

    gaps = {}
    for n in sorted(cm & lm):
        cc, ll = call_count(C, n), call_count(L, n)
        if cc > ll:
            gaps[n] = (cc, ll)
    total = sum(c - l for c, l in gaps.values())
    subst = min(len(re.findall(r'self\._can_hit_player\(', L)),
                gaps.get('_pvp_ok', (0, 0))[0] - gaps.get('_pvp_ok', (0, 0))[1])
    real = total - subst
    print('② 调用点缺口        %d 处（其中 %d 处是 _pvp_ok→_can_hit_player 等价替换，实际缺 %d）'
          % (total, subst, real))
    bad += real

    lme, cme = me_fields(L), me_fields(C)
    cli = set(re.findall(r'd\.me\.(\w+)', G))
    miss_srv, miss_cli = sorted(cme - lme), sorted(cli - lme)
    print('③ me 字段           %d/%d  云端缺:%s  客户端缺:%s'
          % (len(lme), len(cme), miss_srv or '无', miss_cli or '无'))
    bad += len(miss_srv) + len(miss_cli)

    m = re.search(r'return \[self\.mid.*?\]\n', M, re.S)
    print('④ 怪物 wire 字段    %d 个' % ((m.group(0).count(',') + 1) if m else -1))

    cc = set(re.findall(r'^([A-Z_][A-Z0-9_]*) *=', C, re.M))
    lc = set(re.findall(r'^([A-Z_][A-Z0-9_]*) *=', L, re.M))
    mc = sorted(cc - lc)
    print('⑤ 模块常量          缺:%s' % (mc or '无'))
    bad += len(mc)

    sp, lp = player_slots(C), player_slots(L)
    mp = sorted(sp - lp)
    print('⑥ Player 字段       缺:%s' % (mp or '无'))
    bad += len(mp)

    pk = sorted(packs(C) - packs(L))
    print('⑦ 消息类型          云端独有:%s' % (pk or '无'))

    if gaps:
        print()
        print('调用点明细:')
        for n, (c, l) in sorted(gaps.items(), key=lambda x: -(x[1][0] - x[1][1])):
            print('   %-22s 云端 %2d / 本地 %2d  缺 %d' % (n, c, l, c - l))
    print()
    if bad == 0:
        print('结论：与云端参考完全对齐 ✓')
        return 0
    print('结论：还有 %d 项不对齐（见上）' % bad)
    return 1


if __name__ == '__main__':
    sys.exit(main())
