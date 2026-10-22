# -*- coding: utf-8 -*-
"""技能定义表（round538）

★ 加技能 = 往 SKILLS 里加一行，不改任何逻辑
★ 字段：
  key      唯一 id（客户端/DB 都用它）
  name     显示名
  kind     'A' 主动 / 'B' 被动释放 / 'C' 被动加成
  cast     'point' / 'drag_circle' / 'drag_line' / '-'（被动不用）
  qi       灵气消耗
  cd       冷却（秒，0 = 无）
  dmg      倍率（1.0 = 100%；0 = 不造成伤害）
  can_crit 默认能不能暴击（C2 技能暴击可以让 False 的也能暴击）
  radius   范围半径（米）
  range    最远投放距离（drag 用）
  dur      持续时间
  chance   触发概率（B 类）
  trigger  'attack' / 'kill' / 'hurt' / 'tick' / 'hp_low' / 'lethal' / 'always'
  vfx      动画 key（web/vfx.js 里的名字）
  tier_max 被动加成书的最大品阶（1 = 不分品）
  desc     描述
"""

SKILLS = [
    # ---------------- A 主动（15） ----------------
    dict(key='blackhole', name='黑洞', kind='A', cast='drag_circle', qi=5, cd=15.0,
         dmg=2.00, can_crit=False, radius=10.0, range=14.0, dur=1.0, vfx='blackhole',
         delay=1.0, pull=5.0, desc='抛出黑洞，10 米内实体被吸起，1 秒后炸开（200%，不暴击）'),
    dict(key='swordrain', name='万剑归宗', kind='A', cast='drag_circle', qi=6, cd=18.0,
         dmg=0.60, can_crit=True, radius=6.0, range=14.0, dur=3.0, vfx='swordrain',
         delay=0.5, desc='范围内 3 秒落 12 把剑，每把 60%'),
    dict(key='earthsplit', name='地裂', kind='A', cast='drag_line', qi=4, cd=12.0,
         dmg=1.50, can_crit=True, radius=2.0, range=8.0, dur=5.0, vfx='earthsplit',
         delay=0.4, desc='沿直线劈开地面，150% 并击退；随后 5 秒每秒 5% 最大生命'),
    dict(key='icefield', name='冰封领域', kind='A', cast='drag_circle', qi=7, cd=20.0,
         dmg=1.20, can_crit=True, radius=7.0, range=14.0, dur=1.0, vfx='icefield',
         delay=0.35, desc='50% 概率冻结 5 秒；没冻住的受 120% 伤害'),
    dict(key='thunder', name='雷霆万钧', kind='A', cast='point', qi=8, cd=25.0,
         dmg=1.20, can_crit=True, radius=2.5, range=15.0, dur=1.5, vfx='thunder',
         delay=0.2, desc='15 米内随机 5 个目标落雷，每道 120%'),
    dict(key='bloodrage', name='血怒', kind='A', cast='self', qi=5, cd=30.0,
         dmg=0.0, can_crit=False, radius=0, range=0, dur=15.0, vfx='bloodrage',
         desc='15 秒内攻击 +40%、受伤 +20%'),
    dict(key='gale', name='疾风步', kind='A', cast='self', qi=3, cd=14.0,
         dmg=0.0, can_crit=False, radius=0, range=0, dur=20.0, vfx='gale',
         desc='20 秒内移速 +80%、闪避 +30%（可突破上限）'),
    dict(key='shield', name='灵能护盾', kind='A', cast='self', qi=6, cd=20.0,
         dmg=0.0, can_crit=False, radius=0, range=0, dur=30.0, vfx='shield',
         desc='护盾 = 攻击力 ×5，持续 30 秒，先于生命吸收伤害'),
    dict(key='timestop', name='时间凝滞', kind='A', cast='point', qi=9, cd=35.0,
         dmg=0.10, can_crit=False, radius=10.0, range=0, dur=6.0, vfx='timestop',
         delay=0.1, desc='10 米内减速 70% 持续 6 秒，造成 10% 伤害'),
    dict(key='bloodslash', name='燃血斩', kind='A', cast='self', qi=4, cd=16.0,
         dmg=1.80, can_crit=True, radius=4.0, range=0, dur=0.3, vfx='bloodslash',
         delay=0.15, desc='朝面向方向劈出扇形 180%，吸血 50% 伤害量'),
    dict(key='judgement', name='天罚', kind='A', cast='drag_circle', qi=12, cd=40.0,
         dmg=3.00, can_crit=False, radius=8.0, range=14.0, dur=1.2, vfx='judgement',
         delay=0.9, desc='巨剑砸地，8 米内 300%，不暴击'),
    dict(key='arrowrain', name='混沌箭雨', kind='A', cast='drag_circle', qi=7, cd=22.0,
         dmg=0.70, can_crit=True, radius=10.0, range=14.0, dur=2.0, vfx='arrowrain',
         delay=0.6, desc='范围内随机落 12 支箭，每支 70%'),
    dict(key='firestorm', name='烈焰风暴', kind='A', cast='drag_circle', qi=8, cd=28.0,
         dmg=0.40, can_crit=True, radius=5.0, range=14.0, dur=4.0, vfx='firestorm',
         delay=0.5, desc='火柱持续 4 秒，每 0.5 秒 40%'),
    dict(key='blink', name='空间跳跃', kind='A', cast='drag_circle', qi=3, cd=12.0,
         dmg=0.80, can_crit=True, radius=4.0, range=15.0, dur=0.3, vfx='blink',
         delay=0.2, desc='跳到指定位置并炸开，80%'),
    dict(key='plague', name='病毒扩散', kind='A', cast='self', qi=1, cd=0.0,
         dmg=0.10, can_crit=False, radius=1.6, range=0, dur=3.0, vfx='plague',
         toggle=True, desc='点一下开启（每秒 1 灵气）；移动时每 2 秒留毒，毒云 3 秒每 0.5 秒 10%'),

    # ---------------- B 被动释放（9） ----------------
    dict(key='clone', name='AI 分身', kind='B', cast='-', qi=5, cd=0.0,
         dmg=0.60, can_crit=True, radius=0, range=0, dur=30.0, chance=0.10,
         trigger='attack', vfx='clone', desc='普攻 10% 召唤分身（60% 伤害，30 秒）'),
    dict(key='tank', name='坦克引擎', kind='B', cast='-', qi=0, cd=0.0,
         dmg=0.0, can_crit=False, radius=0, range=0, dur=0.0, chance=1.0,
         trigger='kill', vfx='tank', desc='击杀后生命上限 +1%（复利）、体型 ×1.01，体型上限 1000%'),
    dict(key='shadowstep', name='影袭', kind='B', cast='-', qi=3, cd=0.0,
         dmg=1.50, can_crit=True, radius=0, range=0, dur=0.2, chance=0.08,
         trigger='attack', vfx='shadowstep', delay=0.15, desc='普攻 8% 闪到目标背后背刺 150%'),
    dict(key='thunderbolt', name='雷引', kind='B', cast='-', qi=2, cd=6.0,
         dmg=0.70, can_crit=True, radius=2.0, range=12.0, dur=0.3, chance=1.0,
         trigger='tick', vfx='thunderbolt', desc='每 6 秒对最近目标落雷 70%'),
    dict(key='thorns', name='荆棘护甲', kind='B', cast='-', qi=2, cd=0.0,
         dmg=0.30, can_crit=False, radius=0, range=0, dur=0.2, chance=0.15,
         trigger='hurt', vfx='thorns', desc='受伤 15% 反弹 30%'),
    dict(key='splitarrow', name='分裂箭', kind='B', cast='-', qi=2, cd=0.0,
         dmg=0.50, can_crit=True, radius=0, range=0, dur=0.2, chance=0.20,
         trigger='attack', ranged_only=True, vfx='splitarrow',
         desc='远程武器射击 20% 额外 4 箭（各 50%）'),
    dict(key='berserk', name='暴走', kind='B', cast='-', qi=0, cd=30.0,
         dmg=0.0, can_crit=False, radius=0, range=0, dur=15.0, chance=1.0,
         trigger='hp_low', vfx='berserk', desc='血量 <30% 时 15 秒攻速 +50%、伤害 +20%'),
    dict(key='undying', name='不灭意志', kind='B', cast='-', qi=0, cd=60.0,
         dmg=0.0, can_crit=False, radius=0, range=0, dur=0.0, chance=1.0,
         trigger='lethal', vfx='undying', desc='致命伤时免死一次并回复 30% 血'),
    dict(key='bloodthirst', name='嗜血', kind='B', cast='-', qi=0, cd=0.0,
         dmg=0.0, can_crit=False, radius=0, range=0, dur=8.0, chance=1.0,
         trigger='kill', vfx='bloodthirst', desc='击杀后 8 秒攻速 +20%、移速 +10%'),

    # ---------------- C 被动加成（14） ----------------
    dict(key='cdcut', name='技能冷却', kind='C', cast='-', qi=0, cd=0.0, dmg=0.0,
         vfx='-', tier_max=5, desc='主动/被动技能冷却 -30%~-50%'),
    dict(key='skillcrit', name='技能暴击', kind='C', cast='-', qi=0, cd=0.0, dmg=0.0,
         vfx='-', tier_max=1, desc='让不能暴击的技能也能暴击（暴击率 = 玩家暴击率）'),
    dict(key='omnivamp', name='全能吸血', kind='C', cast='-', qi=0, cd=0.0, dmg=0.0,
         vfx='-', tier_max=5, desc='任意伤害最终值的 8%~15% 回血'),
    dict(key='skilldmg', name='技能增伤', kind='C', cast='-', qi=0, cd=0.0, dmg=0.0,
         vfx='-', tier_max=5, desc='全部技能伤害 +20%~+40%（同类叠加）'),
    dict(key='qiflow', name='灵气涌动', kind='C', cast='-', qi=0, cd=0.0, dmg=0.0,
         vfx='-', tier_max=5, desc='灵气上限 +20%~40%，每秒回 0.5~1.5'),
    dict(key='skillten', name='技能韧性', kind='C', cast='-', qi=0, cd=0.0, dmg=0.0,
         vfx='-', tier_max=5, desc='受到技能伤害 -15%~30%'),
    dict(key='chain', name='连锁反应', kind='C', cast='-', qi=0, cd=0.0, dmg=0.0,
         vfx='-', tier_max=5, desc='技能击杀时 CD 立刻 -15%~30%'),
    dict(key='masterA', name='专精·主动', kind='C', cast='-', qi=0, cd=0.0, dmg=0.0,
         vfx='-', tier_max=5, desc='主动技能伤害 +10%~25%'),
    dict(key='masterB', name='专精·被动', kind='C', cast='-', qi=0, cd=0.0, dmg=0.0,
         vfx='-', tier_max=5, desc='被动触发率 ×1.2~×1.5'),
    dict(key='thrifty', name='节能', kind='C', cast='-', qi=0, cd=0.0, dmg=0.0,
         vfx='-', tier_max=5, desc='技能灵气消耗 -15%~35%'),
    dict(key='burn', name='灼烧', kind='B', cast='-', qi=1, cd=1.0, dmg=0.10,
         can_crit=False, radius=3.0, range=0, dur=0.4, chance=1.0, trigger='tick',
         vfx='burn', tier_max=1, desc='身边 3 米每秒受自身当前血量 10% 的伤害（坦克引擎时降为 2%）'),
    dict(key='skrange', name='技能范围', kind='C', cast='-', qi=0, cd=0.0, dmg=0.0,
         vfx='-', tier_max=5, desc='技能半径 +10%~30%'),
    dict(key='skdur', name='技能持续', kind='C', cast='-', qi=0, cd=0.0, dmg=0.0,
         vfx='-', tier_max=5, desc='持续型技能时长 +15%~35%'),
    dict(key='extra_crit', name='额外暴击', kind='C', cast='-', qi=0, cd=0.0, dmg=0.0,
         vfx='-', tier_max=5, desc='释放技能时额外 +10%~30% 暴击率，可突破暴击上限'),
]

BY_KEY = dict((s['key'], s) for s in SKILLS)
KEYS = [s['key'] for s in SKILLS]
NAME = dict((s['key'], s['name']) for s in SKILLS)
KIND = dict((s['key'], s['kind']) for s in SKILLS)

LIMIT_LEARN = 20      # 每类学习上限
LIMIT_LOAD = 5        # 每类装配槽


def valid(key):
    return key in BY_KEY


def of(kind):
    return [s for s in SKILLS if s['kind'] == kind]


def tier_max(key):
    return int(BY_KEY.get(key, {}).get('tier_max') or 1)


def to_client():
    """给客户端的一份精简定义（不含服务端内部字段也没关系，都是公开数值）"""
    out = []
    for s in SKILLS:
        out.append({
            'k': s['key'], 'n': s['name'], 'kind': s['kind'],
            'cast': s.get('cast', '-'), 'qi': s.get('qi', 0),
            'cd': s.get('cd', 0.0), 'dmg': s.get('dmg', 0.0),
            'crit': 1 if s.get('can_crit') else 0,
            'r': s.get('radius', 0), 'rg': s.get('range', 0),
            'dur': s.get('dur', 0), 'ch': s.get('chance', 0),
            'tg': s.get('trigger', ''), 'vfx': s.get('vfx', '-'),
            'tmax': int(s.get('tier_max') or 1),
            'tg2': 1 if s.get('toggle') else 0,
            'ro': 1 if s.get('ranged_only') else 0,
            'd': s.get('desc', ''),
        })
    return out
