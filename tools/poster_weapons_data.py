# -*- coding: utf-8 -*-
"""生成「武器图鉴」海报用的数据（全部从服务器权威表里取 ✗ 不手抄）

输出 tools/_poster_data.json：
  · 每种武器的：名字 / 攻速 / 每刀间隔 / 射程 / 扇形角度 / 伤害系数区间 / 机制文案（12 阶）
  · 12 个品阶的名字 + 颜色（和游戏里掉落物/背包颜色同一份 ✓）
"""
import io
import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server'))

import weapons as W      # noqa: E402

# 客户端 LOOT_COL（和 web/core/game.js 里那份一致 —— 这里只抄颜色值 ✓）
LOOT_COL = ['#bfa88a', '#8fd28a', '#8fc4ff', '#c08fff', '#ffd83d', '#ff9a5c',
            '#ff6a5c', '#ff5cf0', '#5cf0ff', '#ffffff', '#ffe08a', '#ff4a4a']

# 玩法点评（人写的 ✗ 数值全部来自表 ✓）
TIP = {
    'dagger': '最快的手，贴脸缠斗；奇数刀是投掷，等于自带一发远程。',
    'sword':  '数值最稳的万金油，连刺一出就是双倍结算。',
    'saber':  '刀数随品阶暴涨，高阶砍起来像绞肉机。',
    'staff':  '一条直线扫过去，清一片还能把人推开。',
    'spear':  '最远的近战，一枪把怪挑到半空再砸下来。',
    'axe':    '慢，但一下能扫到一大片——人堆里最爽。',
    'hammer': '单下最狠，旋击一转让周围全部吃伤害。',
    'bow':    '唯一的远程，站安全距离点名；自动战斗会自己保持 8 米放箭。',
}

ORDER = ['dagger', 'sword', 'saber', 'staff', 'spear', 'axe', 'hammer', 'bow']

out = {'weapons': [], 'tiers': [], 'clamp': [W.CLAMP_LO, W.CLAMP_HI]}

for look in ORDER:
    s, c0, c1, reach, arc, name = W.TYPES[look]
    item = {
        'look': look,
        'name': name,
        'speed': round(s, 2),
        'interval': round(W.BASE_INTERVAL / s, 2),
        'windup': round(W.BASE_WINDUP / s, 2),
        'reach': reach,
        'arcDeg': int(round(arc * 180.0 / math.pi)),
        'coeff': [c0, c1],
        'ranged': look in W.RANGED,
        'tip': TIP.get(look, ''),
    }
    # 机制文案按【12 阶封顶】算（fx_of 内部会封在 11 ✓ 和游戏里一模一样）
    fx = W.fx_of(look, 12)
    if fx:
        item['fxName'] = fx.get('name') or ''
        item['fxText'] = fx.get('text') or ''
        item['fxChance'] = round(float(fx.get('chance') or 0) * 100, 0)
    else:
        item['fxName'] = '远程射击'
        item['fxText'] = '射出箭矢，飞行途中命中；射程 14 米，被近身就没有优势'
        item['fxChance'] = 100
    out['weapons'].append(item)

for i, nm in enumerate(W.TIER_NAME):
    out['tiers'].append({'i': i + 1, 'name': nm, 'col': LOOT_COL[i]})

p = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_poster_data.json')
with io.open(p, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print('写好: %s' % p)
for w in out['weapons']:
    print('  %-4s %-3s 间隔%.2fs 射程%.1fm %2d° 系数%.2f~%.2f · %s'
          % (w['look'], w['name'], w['interval'], w['reach'], w['arcDeg'],
             w['coeff'][0], w['coeff'][1], w['fxText'][:40]))
