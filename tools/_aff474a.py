# -*- coding: utf-8 -*-
"""round474：按用户拍板的方案实装 9 条新词条 + 移速上限砍半

用户决定：
  1. 经验词条 → 防具
  2. 移速上限砍一半（60% → 30%）
  3. 全量吸血在 PvP 里【全额】
  4. 经验对组队分经验：各自算自己的
  5. 减伤% + 天赋减伤，总上限仍 50%
  6. 词条池保持随机（A）
  7. 我建议的三条（破甲/击杀回血/反伤）都不要
"""
import io

# ================= ① affixes.py：9 条定义 =================
p = 'server/affixes.py'
s = io.open(p, encoding='utf-8').read()


def rep(old, new, tag):
    global s
    assert s.count(old) == 1, (tag, s.count(old))
    s = s.replace(old, new, 1)
    print('  ok:', tag)


# 武器池：命中 / 穿透实装 / 全量吸血
rep("""    ('lifesteal', '\u5438\u8840',     'pct',  _s(0.09, 1),      70, ('weapon',), True,   '\u9020\u6210\u4f24\u5bb3\u7684 {v}% \u56de\u8840'),""",
    """    ('lifesteal', '\u5438\u8840',     'pct',  _s(0.09, 1),      70, ('weapon',), True,   '\u9020\u6210\u4f24\u5bb3\u7684 {v}% \u56de\u8840'),
    # \u2605\u2605\u2605 round474\uff1a\u628a\u73b0\u6709\u5c5e\u6027\u8865\u6210\u8bcd\u6761 \u2713
    ('hit_pt',   '\u547d\u4e2d',     'flat', _s(0.14, 1),      60, ('weapon',), True,   '\u547d\u4e2d +{v}%'),
    # \u2605 \u5168\u91cf\u5438\u8840\uff1a\u4efb\u4f55\u4f24\u5bb3\u90fd\u56de\u8840\uff08\u5305\u62ec PvP\uff0c\u7528\u6237\u5b9a"\u5168\u989d" \u2713\uff09
    ('vamp_all', '\u5168\u91cf\u5438\u8840', 'pct',  _s(0.05, 1),      55, ('weapon',), True,   '\u9020\u6210\u4f24\u5bb3\u7684 {v}% \u56de\u8840\uff08\u5bf9\u6240\u6709\u4f24\u5bb3\u751f\u6548\uff09'),""",
    'weapon new affixes')

# 穿透：实装
rep("""    ('pen_pt',   '\u7a7f\u900f',     'flat', _s(0.22, 1),      60, ('weapon',), False,  '\u65e0\u89c6 {v} \u70b9\u51cf\u4f24'),""",
    """    ('pen_pt',   '\u7a7f\u900f',     'flat', _s(0.22, 1),      60, ('weapon',), True,   '\u65e0\u89c6 {v} \u70b9\u51cf\u4f24'),   # \u2605 round474\uff1a\u5b9e\u88c5 \u2713""",
    'pen_pt live')

# 防具池：免爆 / 抗爆 / 减伤% / 灵气上限 / 移速 / 经验
rep("""    ('dodge_pt', '\u95ea\u907f',     'flat', _s(0.14, 1),      60, ('armor',), True,    '\u95ea\u907f +{v}%'),""",
    """    ('dodge_pt', '\u95ea\u907f',     'flat', _s(0.14, 1),      60, ('armor',), True,    '\u95ea\u907f +{v}%'),
    # \u2605\u2605 round474\uff1a\u628a\u73b0\u6709\u5c5e\u6027\u8865\u6210\u8bcd\u6761 \u2713
    ('anticrit', '\u514d\u7206',     'flat', _s(0.16, 1),      60, ('armor',), True,    '\u514d\u7206 +{v}%'),
    ('anticritdmg', '\u6297\u7206',  'flat', _s(0.20, 2),      60, ('armor',), True,    '\u6297\u7206 +{v}%'),
    ('dr_pct',   '\u51cf\u4f24',     'pct',  _s(0.10, 1),      55, ('armor',), True,    '\u51cf\u4f24 +{v}%'),
    ('qi_flat',  '\u7075\u6c14\u4e0a\u9650', 'flat', _s(0.30, 2),      50, ('armor',), True,    '\u7075\u6c14\u4e0a\u9650 +{v} \u70b9'),
    ('speed_pct', '\u79fb\u901f',    'pct',  _s(0.08, 1),      50, ('armor',), True,    '\u79fb\u901f +{v}%'),
    # \u2605 \u7ecf\u9a8c\uff1a\u7528\u6237\u5b9a\u3010\u9632\u5177\u3011\uff08\u4e0d\u662f\u6b66\u5668\uff09\u2713
    ('exp_pct',  '\u7ecf\u9a8c',     'pct',  _s(0.10, 2),      50, ('armor',), True,    '\u7ecf\u9a8c +{v}%'),""",
    'armor new affixes')

# 百分比类的 unit 判定 + 不补 % 的例外
rep("""    if a[0] in ('crit_pt', 'dodge_pt', 'lifesteal', 'spd_pct', 'treasure'):""",
    """    if a[0] in ('crit_pt', 'dodge_pt', 'lifesteal', 'spd_pct', 'treasure',
                'hit_pt', 'anticrit', 'anticritdmg', 'vamp_all',
                'dr_pct', 'speed_pct', 'exp_pct'):""",
    'unit pct keys')

rep("""    if '%' not in txt and a[0] not in ('atk_flat', 'hp_flat', 'dr_flat', 'pen_pt',
                                       'spellbreak', 'qi_on_hurt', 'qi_on_kill'):""",
    """    if '%' not in txt and a[0] not in ('atk_flat', 'hp_flat', 'dr_flat', 'pen_pt',
                                       'spellbreak', 'qi_on_hurt', 'qi_on_kill',
                                       'qi_flat'):""",
    'no-pct list')

io.open(p, 'w', encoding='utf-8').write(s)
print('affixes.py 改完')

# ================= ② 移速上限砍半 =================
p = 'server/talents.py'
s = io.open(p, encoding='utf-8').read()
old = "    ('speed',    '\u79fb\u901f',   'buff', 1.0,   60.0, None,      True),"
new = ("    # \u2605 round474\uff08\u7528\u6237\uff1a\"\u628a\u79fb\u901f\u7684\u4e0a\u9650\u780d\u4e00\u534a\"\uff09\u2192 60% \u2192 30% \u2713\n"
       "    ('speed',    '\u79fb\u901f',   'buff', 1.0,   30.0, None,      True),")
assert s.count(old) == 1, s.count(old)
io.open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
print('  ok: 移速上限 30%')
