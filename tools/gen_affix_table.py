# -*- coding: utf-8 -*-
"""生成词条数值表：docs/词条表.md（数据直接从 server/affixes.py 读，不手抄）"""
import io
import os
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'server'))
import affixes  # noqa: E402

SLOT = {'weapon': '武器', 'armor': '防具'}
MODE = {'pct': '百分比', 'flat': '固定值'}


def fmt(mode, v):
    if mode == 'flat' and v >= 10:
        return str(int(round(v)))
    return ('%.1f' % v).rstrip('0').rstrip('.')


rows = []
for a in affixes.AFFIXES:
    key, name, mode, rng, w, slots, live, tpl = a
    lo1, hi1 = rng[0]
    lo6, hi6 = rng[5]
    lo12, hi12 = rng[11]
    rows.append({
        'key': key, 'name': name, 'mode': mode, 'slots': slots, 'live': live,
        'rng': rng, 'lo1': lo1, 'hi1': hi1, 'lo6': lo6, 'hi6': hi6,
        'lo12': lo12, 'hi12': hi12,
    })

# ---------- 控制台 / 文档共用 ----------
def slot_txt(sl):
    return '、'.join(SLOT.get(s, s) for s in sl)


lines = []
lines.append('# 词条数值表（自动生成，不要手改）')
lines.append('')
lines.append('> 由 `tools/gen_affix_table.py` 直接读 `server/affixes.py` 生成 ✓')
lines.append('> 数据来源：`_D`（12 阶骨架）× 每条词条的倍率（`_s(mul, base)`）')
lines.append('> **品的阶数**：游戏里显示 1~12 阶，代码里是 `tier = 0~11` ✓')
lines.append('')
lines.append('## 一、一目了然（1 阶 / 6 阶 / 12 阶）')
lines.append('')
lines.append('| 词条 | 部位 | 类型 | 1 阶 | 6 阶 | 12 阶 | 已实装 |')
lines.append('|---|---|---|---|---|---|---|')
for r in rows:
    lines.append('| %s | %s | %s | %s~%s | %s~%s | %s~%s | %s |' % (
        r['name'], slot_txt(r['slots']), MODE.get(r['mode'], r['mode']),
        fmt(r['mode'], r['lo1']), fmt(r['mode'], r['hi1']),
        fmt(r['mode'], r['lo6']), fmt(r['mode'], r['hi6']),
        fmt(r['mode'], r['lo12']), fmt(r['mode'], r['hi12']),
        '是' if r['live'] else '否（不掉）'))
lines.append('')

lines.append('## 二、完整 12 阶区间')
lines.append('')
for r in rows:
    lines.append('### %s（%s · %s）%s' % (
        r['name'], slot_txt(r['slots']), MODE.get(r['mode'], r['mode']),
        '' if r['live'] else ' —— 未实装，不会掉'))
    lines.append('')
    lines.append('| 阶 | 最低 | 最高 |')
    lines.append('|---|---|---|')
    for t in range(12):
        lo, hi = r['rng'][t]
        lines.append('| %d 阶 | %s | %s |' % (t + 1, fmt(r['mode'], lo), fmt(r['mode'], hi)))
    lines.append('')

lines.append('## 三、一条装备能有几条词条')
lines.append('')
lines.append('| 品阶 | 条数范围 |')
lines.append('|---|---|')
for t in range(12):
    lo, hi = affixes.COUNT_RANGE[t]
    lines.append('| %d 阶 | %d ~ %d 条 |' % (t + 1, lo, hi))
lines.append('')
lines.append('更多条的概率更低（每多一条权重 ×%s）✓' % affixes.COUNT_DECAY)
lines.append('')
lines.append('## 四、词条是怎么算到身上的')
lines.append('')
lines.append('| 类型 | 作用位置 | 说明 |')
lines.append('|---|---|---|')
lines.append('| 百分比（攻击力 / 爆伤 / 攻速 / 吸血 / 寻宝）| 武器自身贡献那一份 | 不作用于固有攻击（防滚雪球）|')
lines.append('| 固定值（攻击力 / 暴击率 / 生命 / 减伤 / 闪避…）| 直接加到总值 | — |')
lines.append('| 上限 | 天赋那部分才封顶 | 基础值和装备词条不受上限限制 |')
lines.append('')

out = os.path.join(ROOT, 'docs', '词条表.md')
io.open(out, 'w', encoding='utf-8').write('\n'.join(lines))
print('已生成:', out)

# ---------- 控制台简要版 ----------
print('')
print('%-12s %-8s %-8s %-14s %-14s %-14s %s' % ('词条', '部位', '类型', '1阶', '6阶', '12阶', '实装'))
for r in rows:
    print('%-12s %-8s %-8s %-14s %-14s %-14s %s' % (
        r['name'], slot_txt(r['slots']), MODE.get(r['mode'], r['mode']),
        '%s~%s' % (fmt(r['mode'], r['lo1']), fmt(r['mode'], r['hi1'])),
        '%s~%s' % (fmt(r['mode'], r['lo6']), fmt(r['mode'], r['hi6'])),
        '%s~%s' % (fmt(r['mode'], r['lo12']), fmt(r['mode'], r['hi12'])),
        '是' if r['live'] else '否'))
