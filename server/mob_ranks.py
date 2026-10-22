# -*- coding: utf-8 -*-
"""精英 / Boss 基础倍率（round600）

只在 Mob.__init__ 里应用一次，禁止在其他地方重复乘。
"""

RANKS = {
    1: {
        'label': '精英',
        'hp_mul': 3.5, 'atk_mul': 1.8, 'exp_mul': 4.0,
        'hit_r': 0.35, 'affix_min': 2, 'affix_max': 3,
        'control_mul': 0.5, 'despawn_range': 100.0,
        'despawn_grace': 60.0, 'max_alive': 3,
    },
    2: {
        'label': 'BOSS',
        'hp_mul': 12.0, 'atk_mul': 2.5, 'exp_mul': 15.0,
        'hit_r': 0.9, 'affix_min': 4, 'affix_max': 4,
        'control_mul': 0.0, 'despawn_range': 1000.0,
        'despawn_grace': 300.0, 'max_alive': 1,
    },
}


def cfg(rank):
    return RANKS.get(int(rank or 0)) or {}


def label(rank):
    return cfg(rank).get('label', '')


ELITE_SKINS = ('rift', 'guard', 'ember', 'toad', 'beetle', 'wolf')
BOSS_SKINS = ('butcher', 'mage', 'mech', 'dragon', 'serpent', 'eye')

NAMES = {
    'rift': '裂口者', 'guard': '铁卫', 'ember': '火鬼',
    'toad': '毒沼蟾', 'beetle': '刃甲虫', 'wolf': '影狼',
    'butcher': '屠夫', 'mage': '深渊法师', 'mech': '钢铁巨兽',
    'dragon': '骨龙', 'serpent': '熔岩巨蟒', 'eye': '虚空之眼',
}


def name_of(skin, rank=0):
    return NAMES.get(str(skin or ''), label(rank) or '妖兽')

