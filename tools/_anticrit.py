# -*- coding: utf-8 -*-
"""round473：
  ① 新增天赋「抗爆」= 降低【受到暴击时的伤害】（爆伤的克制属性，和闪避↔命中 同构）
  ② 爆伤上限统一成 250%（显示口径 = 暴击伤害倍率）
"""
import io

# ---------------- ① 服务端：天赋定义 ----------------
p = 'server/talents.py'
s = io.open(p, encoding='utf-8').read()


def rep(old, new, tag):
    global s
    assert s.count(old) == 1, (tag, s.count(old))
    s = s.replace(old, new, 1)
    print('  ok:', tag)


rep("""    ('critdmg',  '\u7206\u4f24',   'buff', 1.0,   100.0, None,      True),
    ('pen',      '\u7a7f\u900f',   'vs',   0.5,   None, None,      True),""",
    """    # \u2605 round473\uff1a\u7206\u4f24\u4e0a\u9650 250%\uff08\u663e\u793a\u53e3\u5f84 = \u66b4\u51fb\u4f24\u5bb3\u500d\u7387\uff1b\u57fa\u7840 150%\uff09
    ('critdmg',  '\u7206\u4f24',   'buff', 1.0,   100.0, None,      True),
    # \u2605\u2605\u2605 round473\uff08\u7528\u6237\uff1a"\u589e\u52a0\u6297\u7206\u5c5e\u6027\uff0c\u7528\u6765\u964d\u4f4e\u53d7\u5230\u66b4\u51fb\u7684\u4f24\u5bb3\uff0c
    #   \u76f8\u5f53\u4e8e\u95ea\u907f\u548c\u547d\u4e2d\u8fd9\u6837\u7684\u514b\u5236\u5c5e\u6027"\uff09\u2605\u2605\u2605
    #   \u5bf9\u6297\u5173\u7cfb\uff1a\u4ed6\u7684\u7206\u4f24 \u2212 \u6211\u7684\u6297\u7206 \u2192 \u5b9e\u9645\u66b4\u51fb\u4f24\u5bb3 \u2713
    #   \uff08\u548c \u547d\u4e2d\u2194\u95ea\u907f\u3001\u514d\u7206\u2194\u66b4\u51fb\u7387 \u5b8c\u5168\u540c\u6784 \u2713\uff09
    ('anticritdmg', '\u6297\u7206', 'vs', 0.5,   None, 'critdmg',  True),
    ('pen',      '\u7a7f\u900f',   'vs',   0.5,   None, None,      True),""",
    'DEFS anticritdmg')

io.open(p, 'w', encoding='utf-8').write(s)
print('talents.py 改完')

# ---------------- ② 服务端：战斗结算（PvP 要减对方抗爆）----------------
p = 'server/world.py'
s = io.open(p, encoding='utf-8').read()


def rep2(old, new, tag):
    global s
    assert s.count(old) == 1, (tag, s.count(old))
    s = s.replace(old, new, 1)
    print('  ok:', tag)


rep2("""        _cd = _T.get('crit_dmg', 0.0) + self._tal(p, 'critdmg')""",
     """        # \u2605\u2605 round473\uff1a\u66b4\u4f24 = \u8bcd\u6761 + \u5929\u8d4b \u2212 \u5bf9\u65b9\u3010\u6297\u7206\u3011\u2717 \u5c01\u9876 250% \u2713
        #   \u5bf9\u6297\u5173\u7cfb\u548c \u547d\u4e2d\u2194\u95ea\u907f \u5b8c\u5168\u540c\u6784 \u2713
        _cd = (_T.get('crit_dmg', 0.0) + self._tal(p, 'critdmg')
               - max(0.0, self._tal(q, 'anticritdmg')))
        _cd = max(0.0, min(100.0, _cd))          # 150% + 100% = 250% \u5c01\u9876 \u2713""",
     'pvp critdmg anticrit')

# 属性总览：爆伤口径改成倍率（基础 150），加上抗爆一行
rep2("""        add('critdmg', '\u7206\u4f24', (mobs.CRIT_MUL - 1.0) * 100.0 + g('crit_dmg') + tal('critdmg'),
            (mobs.CRIT_MUL - 1.0) * 100.0, g('crit_dmg'), tal('critdmg'), 100, '%', '\u8f93\u51fa')""",
     """        # \u2605 round473\uff1a\u7206\u4f24\u663e\u793a\u53e3\u5f84 = \u3010\u66b4\u51fb\u4f24\u5bb3\u500d\u7387\u3011\u2717 \u57fa\u7840 150% \u00b7 \u4e0a\u9650 250% \u2713
        #   \uff08\u4ee5\u524d\u57fa\u7840\u5199 50 \u2717 \u4e0a\u9650\u5199 100 \u2717 \u548c\u5b9e\u9645 2.5 \u500d\u5bf9\u4e0d\u4e0a \u2713\uff09
        _cd_b = float(mobs.CRIT_MUL) * 100.0
        _cd_v = min(250.0, _cd_b + g('crit_dmg') + tal('critdmg'))
        add('critdmg', '\u7206\u4f24', _cd_v, _cd_b, g('crit_dmg'), tal('critdmg'), 250, '%', '\u8f93\u51fa')
        # \u2605 round473\uff1a\u6297\u7206\uff08\u51cf\u5c11\u53d7\u5230\u7684\u66b4\u51fb\u4f24\u5bb3\uff09
        add('anticritdmg', '\u6297\u7206', tal('anticritdmg'), 0.0, 0.0, tal('anticritdmg'), 0, '%', '\u751f\u5b58')""",
     'stat_sheet critdmg cap + anticritdmg')

io.open(p, 'w', encoding='utf-8').write(s)
print('world.py 改完')

# ---------------- ③ 客户端：天赋列表加一行 ----------------
p = 'web/platform/web.js'
s = io.open(p, encoding='utf-8').read()
old = """  ['critdmg', '\u7206\u4f24', '%'], ['pen', '\u7a7f\u900f', '%']
];"""
new = """  ['critdmg', '\u7206\u4f24', '%'],
  /* \u2605 round473\uff1a\u6297\u7206 \u2014\u2014 \u964d\u4f4e\u53d7\u5230\u7684\u66b4\u51fb\u4f24\u5bb3\uff08\u7206\u4f24\u7684\u514b\u5236\u5c5e\u6027 \u2713\uff09*/
  ['anticritdmg', '\u6297\u7206', '%'],
  ['pen', '\u7a7f\u900f', '%']
];"""
assert s.count(old) == 1
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('  ok: TAL_META 抗爆')
print('platform 改完')
