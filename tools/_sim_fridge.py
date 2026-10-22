# -*- coding: utf-8 -*-
"""模拟 _fridge_house 流程。"""
import os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

# 模拟 World 的最小化上下文
HOUSES_CATALOG = ('house_flat_v1', 'shop_apartment_v1', 'shop_inn_v1', 'house_villa_v1')

class FakeWorld:
    def __init__(self):
        import db as dbmod
        import towns
        self.cfg = {'db': os.path.join(os.path.dirname(__file__), '..', 'server', 'game.db')}
        self.towns = {}
        for t in towns.list_towns(self.cfg):
            self.towns[int(t['id'])] = t
        # 静态房屋
        try:
            import houses as housemod
            self.houses = housemod.load_all(self.cfg)
        except Exception:
            self.houses = {}

    def _dyn_house(self, hid):
        if not str(hid).startswith('obj'):
            return None
        import town_objects as objreg3
        try:
            oid = int(str(hid)[3:])
        except Exception:
            return None
        for tid in list(self.towns.keys()):
            rows = objreg3.nearby(self.cfg, tid, 0.0, 0.0, 400.0)
            for o in rows:
                if int(o['id']) != oid:
                    continue
                cat = str(o.get('catalog_id') or '')
                if cat not in HOUSES_CATALOG:
                    return None
                x, z = float(o['x']), float(o['z'])
                return {'id': hid, 'owner_id': int(o.get('owner_id') or 0),
                        'x': x, 'z': z, 'door_x': x, 'door_z': z + 3.0,
                        'tier': 'dynamic', 'placed': True}
        return None

    def _house_lookup(self, hid):
        h = self.houses.get(str(hid))
        if h:
            return h
        return self._dyn_house(hid)

    def _house_near_ok(self, p, hid):
        dh = self._dyn_house(str(hid))
        if dh:
            dx = p[0] - float(dh['x']); dz = p[1] - float(dh['z'])
            return (dx*dx + dz*dz) <= 36.0
        return False

w = FakeWorld()
hid = None
# 找 house_flat 对象
import town_objects as obj
for tid in w.towns:
    for o in obj.nearby(w.cfg, tid, 0, 0, 400):
        if o['catalog_id'] == 'house_flat_v1' and int(o.get('parent_id') or 0) == 0:
            hid = 'obj%d' % int(o['id'])
            break
    if hid: break
print('hid:', hid)
h = w._house_lookup(hid)
print('lookup:', {k: h[k] for k in ('id','owner_id','placed')} if h else None)
near = w._house_near_ok((-29.0, 17.5), hid)
print('near ok:', near)
