# -*- coding: utf-8 -*-
"""精英 / Boss 技能表（round600）

服务器只读这张表；客户端只认 key 播动画/特效。
"""

# kind: aoe 圆形 / cone 扇形 / line 直线 / summon 召唤 / buff 自身增益
# cast: 起手秒；dmg: 以怪物攻击力为倍率
SKILLS = {
    # ---------- 精英 ----------
    'rift': [
        dict(key='rift_dash', name='撕裂突进', kind='dash', cd=9.0, rng=7.0, radius=2.2,
             cast=0.9, dmg=1.1, control='bleed', vfx='boss_line', sfx='boss_slash'),
        dict(key='rift_maw', name='血口', kind='cone', cd=12.0, rng=4.0, radius=4.0, cone=100,
             cast=1.0, dmg=1.3, control='bleed', vfx='boss_cone', sfx='boss_slash'),
    ],
    'guard': [
        dict(key='guard_bash', name='盾击', kind='cone', cd=10.0, rng=3.2, radius=3.0, cone=80,
             cast=0.8, dmg=1.0, control='stun', vfx='boss_cone', sfx='boss_slam'),
        dict(key='guard_quake', name='重锤震地', kind='aoe', cd=14.0, rng=3.5, radius=5.0,
             cast=1.3, dmg=1.5, control='knock', vfx='boss_aoe', sfx='boss_slam'),
    ],
    'ember': [
        dict(key='ember_breath', name='火焰喷吐', kind='cone', cd=9.0, rng=5.0, radius=5.0, cone=75,
             cast=1.0, dmg=1.2, control='burn', vfx='boss_cone', sfx='boss_fire'),
        dict(key='ember_burst', name='爆燃', kind='self', cd=15.0, rng=0.0, radius=5.5,
             cast=1.4, dmg=1.6, control='burn', vfx='boss_aoe', sfx='boss_fire'),
    ],
    'toad': [
        dict(key='toad_spit', name='毒液喷吐', kind='aoe', cd=9.0, rng=8.0, radius=3.2,
             cast=1.0, dmg=0.8, control='poison', vfx='boss_poison', sfx='boss_spit'),
        dict(key='toad_tongue', name='巨舌横扫', kind='cone', cd=12.0, rng=4.5, radius=4.5, cone=180,
             cast=0.9, dmg=1.2, control='knock', vfx='boss_cone', sfx='boss_slam'),
    ],
    'beetle': [
        dict(key='beetle_charge', name='甲壳冲锋', kind='dash', cd=10.0, rng=9.0, radius=2.4,
             cast=0.8, dmg=1.4, control='knock', vfx='boss_line', sfx='boss_charge'),
        dict(key='beetle_saw', name='振翅锯割', kind='self', cd=13.0, rng=0.0, radius=4.2,
             cast=1.2, dmg=1.3, control='bleed', vfx='boss_aoe', sfx='boss_saw'),
    ],
    'wolf': [
        dict(key='wolf_pounce', name='影扑', kind='dash', cd=8.0, rng=7.0, radius=2.0,
             cast=0.8, dmg=1.4, control='slow', vfx='boss_line', sfx='boss_pounce'),
        dict(key='wolf_howl', name='群猎嚎叫', kind='self', cd=15.0, rng=0.0, radius=6.0,
             cast=1.0, dmg=0.6, control='slow', vfx='boss_howl', sfx='boss_howl'),
    ],
    # ---------- Boss ----------
    'butcher': [
        dict(key='butcher_slam', name='裂地重击', kind='aoe', cd=9.0, rng=3.6, radius=6.0,
             cast=1.4, dmg=1.5, control='knock', vfx='boss_aoe', sfx='boss_slam'),
        dict(key='butcher_hook', name='钩锁', kind='line', cd=12.0, rng=10.0, radius=1.6,
             cast=1.0, dmg=1.0, control='pull', vfx='boss_line', sfx='boss_chain'),
        dict(key='butcher_whirl', name='血腥旋风', kind='self', cd=15.0, rng=0.0, radius=4.5,
             cast=1.2, dmg=1.4, control='bleed', vfx='boss_whirl', sfx='boss_saw'),
    ],
    'mage': [
        dict(key='mage_rune', name='符文爆裂', kind='aoe', cd=9.0, rng=10.0, radius=4.0,
             cast=1.5, dmg=1.4, control='slow', vfx='boss_rune', sfx='boss_magic'),
        dict(key='mage_barrage', name='暗影弹幕', kind='cone', cd=12.0, rng=10.0, radius=7.0, cone=70,
             cast=1.2, dmg=0.9, control='slow', vfx='boss_barrage', sfx='boss_magic'),
        dict(key='mage_summon', name='召唤触手', kind='summon', cd=18.0, rng=0.0, radius=0,
             cast=1.2, dmg=0.0, control='', vfx='boss_summon', sfx='boss_magic'),
    ],
    'mech': [
        dict(key='mech_cannon', name='炮击', kind='aoe', cd=8.0, rng=13.0, radius=4.0,
             cast=1.4, dmg=1.6, control='knock', vfx='boss_boom', sfx='boss_cannon'),
        dict(key='mech_charge', name='冲锋', kind='dash', cd=12.0, rng=12.0, radius=2.4,
             cast=1.0, dmg=1.5, control='stun', vfx='boss_line', sfx='boss_charge'),
        dict(key='mech_overload', name='核心过载', kind='self', cd=18.0, rng=0.0, radius=6.5,
             cast=2.0, dmg=2.0, control='knock', vfx='boss_overload', sfx='boss_overload'),
    ],
    'dragon': [
        dict(key='dragon_breath', name='骨龙息', kind='cone', cd=13.0, rng=10.0, radius=8.0, cone=70,
             cast=1.8, dmg=1.6, control='burn', vfx='boss_breath', sfx='boss_breath'),
        dict(key='dragon_wings', name='骨翼风暴', kind='self', cd=15.0, rng=0.0, radius=7.0,
             cast=1.5, dmg=1.4, control='knock', vfx='boss_wings', sfx='boss_wings'),
        dict(key='dragon_summon', name='亡者召唤', kind='summon', cd=20.0, rng=0.0, radius=0,
             cast=1.2, dmg=0.0, control='', vfx='boss_summon', sfx='boss_summon'),
    ],
    'serpent': [
        dict(key='serpent_eruption', name='熔岩喷发', kind='aoe', cd=9.0, rng=11.0, radius=3.8,
             cast=1.4, dmg=1.5, control='burn', vfx='boss_lava', sfx='boss_fire'),
        dict(key='serpent_coil', name='盘绞', kind='self', cd=13.0, rng=0.0, radius=4.6,
             cast=1.2, dmg=1.5, control='pull', vfx='boss_coil', sfx='boss_slam'),
        dict(key='serpent_pools', name='地火之池', kind='zone', cd=18.0, rng=8.0, radius=4.2,
             cast=1.0, dmg=0.55, control='burn', vfx='boss_lava', sfx='boss_fire'),
    ],
    'eye': [
        dict(key='eye_gaze', name='虚空凝视', kind='cone', cd=10.0, rng=12.0, radius=9.0, cone=55,
             cast=1.8, dmg=1.4, control='silence', vfx='boss_gaze', sfx='boss_gaze'),
        dict(key='eye_tentacles', name='触手横扫', kind='self', cd=13.0, rng=0.0, radius=5.5,
             cast=1.2, dmg=1.3, control='knock', vfx='boss_tentacle', sfx='boss_slam'),
        dict(key='eye_collapse', name='引力坍缩', kind='aoe', cd=20.0, rng=10.0, radius=7.0,
             cast=2.2, dmg=1.8, control='pull', vfx='boss_collapse', sfx='boss_collapse'),
    ],
}


def skills_for(skin, phase=1):
    """二阶段只改参数；第一版三技能全部沿用，phase2 加冷却缩减。"""
    arr = SKILLS.get(str(skin or ''), [])
    if int(phase or 1) >= 2:
        out = []
        for s in arr:
            x = dict(s)
            x['cd'] = float(x.get('cd') or 0) * 0.75
            x['phase2'] = 1
            out.append(x)
        return out
    return list(arr)
