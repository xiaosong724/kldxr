# -*- coding: utf-8 -*-
"""商店菜单 + 小镇 NPC（店员/路人/猫狗）

商店交互点取建筑门内侧 1.3 米；店员站在门内侧 2.3 米。
客户端/服务端共用这份数据（导出到 town_data.js）。
"""
import town

# key = 建筑 k；items: key, name, price, hp_pct, qi_pct, exp, icon, model, desc
SHOPS = {
    'mart': dict(served=False, name='超市', keeper='店员小满', items=[
        dict(key='stone_low', name='下品灵石', price=20, qi_pct=0.30, icon='💎', model='crystal', desc='灵气 +30%'),
        dict(key='stone_mid', name='中品灵石', price=45, qi_pct=0.60, icon='💎', model='crystal', desc='灵气 +60%'),
        dict(key='stone_high', name='上品灵石', price=80, qi_pct=1.00, icon='💎', model='crystal', desc='灵气 +100%'),
        dict(key='water', name='矿泉水', price=5, hp_pct=0.10, icon='💧', model='bottle', desc='生命 +10%'),
        dict(key='bread_snack', name='面包', price=8, hp_pct=0.15, icon='🍞', model='bread', desc='生命 +15%'),
    ]),
    'dessert': dict(served=True, name='奶茶店', keeper='店员小桃', items=[
        dict(key='pearl_tea', name='珍珠奶茶', price=18, qi_pct=0.35, icon='🧋', model='cup', desc='灵气 +35%'),
        dict(key='taro_tea', name='芋泥奶茶', price=30, qi_pct=0.55, icon='🧋', model='cup', desc='灵气 +55%'),
        dict(key='fruit_tea', name='水果茶', price=22, qi_pct=0.30, hp_pct=0.10, icon='🍹', model='cup', desc='灵气+30% 生命+10%'),
    ]),
    'cafe': dict(served=True, name='咖啡店', keeper='店员阿岚', items=[
        dict(key='americano', name='美式咖啡', price=15, qi_pct=0.30, icon='☕', model='cup', desc='灵气 +30%'),
        dict(key='latte', name='拿铁', price=25, qi_pct=0.45, icon='☕', model='cup', desc='灵气 +45%'),
        dict(key='cake', name='蛋糕', price=18, hp_pct=0.20, icon='🍰', model='cake', desc='生命 +20%'),
    ]),
    'ramen': dict(served=True, name='饭店', keeper='店员阿福', items=[
        dict(key='ramen', name='招牌拉面', price=25, hp_pct=0.45, qi_pct=0.20, icon='🍜', model='bowl', desc='生命+45% 灵气+20%'),
        dict(key='fried_rice', name='炒饭', price=20, hp_pct=0.35, icon='🍚', model='bowl', desc='生命 +35%'),
        dict(key='dumpling', name='煎饺', price=12, hp_pct=0.15, icon='🥟', model='plate', desc='生命 +15%'),
    ]),
    'izakaya': dict(served=True, name='居酒屋', keeper='店员阿吉', items=[
        dict(key='skewer', name='烤串', price=10, hp_pct=0.15, icon='🍢', model='plate', desc='生命 +15%'),
        dict(key='sake', name='清酒', price=15, qi_pct=0.25, icon='🍶', model='bottle', desc='灵气 +25%'),
        dict(key='set', name='酒菜套餐', price=35, hp_pct=0.40, qi_pct=0.20, icon='🍱', model='plate', desc='生命+40% 灵气+20%'),
    ]),
    'bakery': dict(served=False, name='面包店', keeper='店员小麦', items=[
        dict(key='bread', name='面包', price=10, hp_pct=0.20, icon='🍞', model='bread', desc='生命 +20%'),
        dict(key='cream_roll', name='奶油卷', price=15, hp_pct=0.30, icon='🍥', model='bread', desc='生命 +30%'),
    ]),
    'clinic': dict(served=False, name='药铺', keeper='药师阿芷', items=[
        dict(key='heal_s', name='金疮药', price=25, hp_pct=0.50, icon='🧪', model='bottle', desc='生命 +50%'),
        dict(key='qi_s', name='回气散', price=30, qi_pct=0.50, icon='🧪', model='bottle', desc='灵气 +50%'),
        dict(key='heal_l', name='大还丹', price=60, hp_pct=0.80, icon='💊', model='pill', desc='生命 +80%'),
    ]),
    'tea': dict(served=True, name='茶馆', keeper='茶博士', items=[
        dict(key='tea', name='清茶', price=5, qi_pct=0.15, icon='🍵', model='cup', desc='灵气 +15%'),
        dict(key='dimsum', name='点心', price=8, hp_pct=0.10, icon='🥮', model='plate', desc='生命 +10%'),
    ]),
    'flower': dict(served=False, name='花店', keeper='店员小葵', items=[
        dict(key='flower_tea', name='花茶', price=12, qi_pct=0.20, icon='🌺', model='cup', desc='灵气 +20%'),
        dict(key='flower_dew', name='花露', price=15, hp_pct=0.20, icon='🌸', model='bottle', desc='生命 +20%'),
    ]),
    'general': dict(served=False, name='杂货铺', keeper='店员老周', items=[
        dict(key='return_town', name='回城符', price=30, icon='📜', model='scroll', desc='传回中央广场'),
        dict(key='heal_snack', name='小还丹', price=20, hp_pct=0.30, icon='💊', model='pill', desc='生命 +30%'),
    ]),
}


def _point(k):
    b = next((x for x in town.BUILDINGS if x['k'] == k), None)
    if not b:
        return None
    at = float(b['door_at'])
    side = b['door']
    if side == 'east':
        return (float(b['x1']) - 1.3, at)
    if side == 'west':
        return (float(b['x0']) + 1.3, at)
    if side == 'south':
        return (at, float(b['z1']) - 1.3)
    return (at, float(b['z0']) + 1.3)


def shop_list():
    out = []
    for k, d in SHOPS.items():
        p = _point(k)
        if not p:
            continue
        out.append(dict(id=k, name=d['name'], keeper=d['keeper'],
                        served=1 if d.get('served') else 0,
                        x=round(p[0], 2), z=round(p[1], 2),
                        pass_at=[round(p[0] - 2.2, 2), round(p[1], 2)],
                        items=d['items']))
    return out


def shop_by_id(sid):
    for s in shop_list():
        if s['id'] == sid:
            return s
    return None


# 出餐口相对商店交互点的偏移（门内侧向左 2.2m）
PASS_OFFSET = (-2.2, 0.0)
TABLE_NAMES = ['1 号桌', '2 号桌', '3 号桌', '4 号桌', '5 号桌', '6 号桌', '吧台 1', '吧台 2']


def shop_tables(sid):
    """这家店可以点单的座位（落在店内的椅子）"""
    s = shop_by_id(sid)
    if not s or not s.get('served'):
        return []
    b = next((x for x in town.BUILDINGS if x['k'] == sid), None)
    if not b:
        return []
    out = []
    for i, seat in enumerate(town.SEATS):
        x, z = float(seat['x']), float(seat['z'])
        if not (b['x0'] <= x <= b['x1'] and b['z0'] <= z <= b['z1']):
            continue
        out.append(dict(idx=i, id=seat.get('id') or ('seat_%d' % i),
                        x=x, z=z, label=TABLE_NAMES[len(out) % len(TABLE_NAMES)]))
    return out


def work_slots(sid):
    """打工岗位：堂食店 2 个位，其它 1 个位"""
    s = shop_by_id(sid)
    if not s:
        return 0
    return 2 if s.get('served') else 1


def npc_list():
    """店员 + 路人 + 猫狗（客户端实例化渲染）"""
    out = []
    for s in shop_list():
        # 店员站在店内/柜台后 1 米
        out.append(dict(id='clerk_' + s['id'], kind='clerk', shop=s['id'],
                        name=s['keeper'], x=round(s['x'] + 1.0, 2), z=round(s['z'], 2),
                        ry=1.571))
    for s2 in shop_list():
        if not s2.get('served'):
            continue
        out.append(dict(id='waiter_' + s2['id'], kind='waiter', shop=s2['id'],
                        name='传菜员' + s2['name'][:2],
                        x=round(s2['pass_at'][0], 2), z=round(s2['pass_at'][1], 2), ry=0.0))
    # 路人
    walkers = [
        ('w1', '阿澄', 4.0, -12.0), ('w2', '小满', -6.0, 13.0),
        ('w3', '老李', 14.0, 4.0), ('w4', '阿青', -14.0, -4.0),
        ('w5', '小虎', 8.0, 20.0), ('w6', '阿月', -8.0, 22.0),
    ]
    for wid, nm, x, z in walkers:
        out.append(dict(id=wid, kind='walker', shop='', name=nm, x=x + town.TOWN_CX, z=z + town.TOWN_CZ, ry=0.0))
    # 猫狗（纯 NPC，不做养成）
    animals = [
        ('cat1', 'cat', '橘子', -6.0, 6.0), ('cat2', 'cat', '小白', 5.0, -6.0),
        ('cat3', 'cat', '黑豆', -8.0, 12.0),
        ('dog1', 'dog', '阿柴', 7.0, 12.0), ('dog2', 'dog', '大黑', -12.0, 15.0),
    ]
    for aid, kind, nm, x, z in animals:
        out.append(dict(id=aid, kind=kind, shop='', name=nm, x=x + town.TOWN_CX, z=z + town.TOWN_CZ, ry=0.0))
    return out
