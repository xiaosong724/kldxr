# -*- coding: utf-8 -*-
"""Wire placement intents into world.py."""
import io

p = 'server/world.py'
s = io.open(p, encoding='utf-8').read()

# 1) import
if 'import town_objects as objreg' not in s:
    anchor = 'import towns as townreg'
    if anchor in s:
        s = s.replace(anchor, anchor + '\nimport town_objects as objreg', 1)
    else:
        s = 'import town_objects as objreg\n' + s
    print('import added')

# 2) allow intents
old = ("'town_list', 'town_create', 'town_perm_list', 'town_perm_set',\n"
       "               'town_restore', 'town_dissolve', 'town_catalog')")
new = ("'town_list', 'town_create', 'town_perm_list', 'town_perm_set',\n"
       "               'town_restore', 'town_dissolve', 'town_catalog',\n"
       "               'place', 'place_building', 'move_object', 'remove_object',\n"
       "               'town_objects')")
if old in s:
    s = s.replace(old, new, 1)
    print('intent list updated')
else:
    print('INTENT LIST MISS')

# 3) handlers, inserted before _intent_town_create
handlers = r'''
    # ---------- v4.2 object placement ----------
    def _obj_town_ok(self, p):
        """the town the player may build in (own town, or the system town)."""
        own = self._town_of_owner(getattr(p, 'role_id', 0))
        if own and str(own.get('status')) == 'active':
            return own
        for r in self.towns.values():
            if int(r.get('is_system') or 0) and str(r.get('status')) == 'active':
                return r
        return None

    def _obj_pub(self, o):
        return {
            'id': int(o['id']), 'catalog': str(o['catalog_id']),
            'x': round(float(o['x']), 3), 'z': round(float(o['z']), 3),
            'rot': round(float(o['rot']), 4),
            'model': str(o.get('model_id') or ''),
            'ver': str(o.get('model_version') or 'v1'),
            'parent': int(o.get('parent_id') or 0),
            'floor': int(o.get('floor') or 0),
        }

    def _send_objects(self, p, town_row, limit=200):
        rows = objreg.nearby(self.cfg, town_row['id'], p.x, p.z, 90.0)[:limit]
        self._send_cid(p.cid, P.pack('objects', town=int(town_row['id']),
                                     list=[self._obj_pub(o) for o in rows]))

    def _intent_town_objects(self, p, d=None):
        r = self._obj_town_ok(p)
        if not r:
            self._send_cid(p.cid, P.pack('objects', town=0, list=[]))
            return
        self._send_objects(p, r)

    def _intent_place(self, p, d):
        d = d or {}
        r = self._obj_town_ok(p)
        if not r:
            self._town_result(p, False, '没有可用小镇')
            return
        if not int(r.get('is_system') or 0):
            try:
                allowed = townreg.has_perm(self.cfg, getattr(p, 'role_id', 0),
                                           r, townreg.P_MOVE)
            except Exception:
                allowed = False
            if not allowed:
                self._town_result(p, False, '没有放置权限')
                return
        cid = str(d.get('catalog') or '')
        try:
            x = float(d.get('x')); z = float(d.get('z'))
            rot = float(d.get('rot') or 0.0)
        except Exception:
            self._town_result(p, False, '坐标错误')
            return
        try:
            sx0, sz0, sx1, sz1 = townreg.safe_bounds_of(r)
            if not (sx0 <= x <= sx1 and sz0 <= z <= sz1):
                self._town_result(p, False, '不在小镇范围内')
                return
        except Exception:
            pass
        cat = objreg._catalog(self.cfg, cid)
        if not cat:
            self._town_result(p, False, '目录里没有这个物件')
            return
        price = int(cat.get('price') or 0)
        gold = int(getattr(p, 'gold', 0) or 0)
        if price > gold:
            self._town_result(p, False, '金币不足')
            return
        ok, err, row = objreg.place_object(self.cfg, r, cid, x, z, rot,
                                           owner_id=getattr(p, 'role_id', 0),
                                           price_paid=price)
        if not ok:
            self._town_result(p, False, err)
            return
        try:
            p.gold = gold - price
            p.goldDirty = True
        except Exception:
            pass
        self._send_cid(p.cid, P.pack('placed', object=self._obj_pub(row)))

    def _intent_place_building(self, p, d):
        d = d or {}
        r = self._obj_town_ok(p)
        if not r:
            self._town_result(p, False, '没有可用小镇')
            return
        cid = str(d.get('catalog') or '')
        try:
            x = float(d.get('x')); z = float(d.get('z'))
            rot = float(d.get('rot') or 0.0)
        except Exception:
            self._town_result(p, False, '坐标错误')
            return
        cat = objreg._catalog(self.cfg, cid)
        if not cat:
            self._town_result(p, False, '目录里没有这个建筑')
            return
        price = int(cat.get('price') or 0)
        gold = int(getattr(p, 'gold', 0) or 0)
        if price > gold:
            self._town_result(p, False, '金币不足')
            return
        ok, err, res = objreg.place_building(self.cfg, r, cid, x, z, rot,
                                             owner_id=getattr(p, 'role_id', 0))
        if not ok:
            self._town_result(p, False, err)
            return
        try:
            p.gold = gold - price
            p.goldDirty = True
        except Exception:
            pass
        self._send_cid(p.cid, P.pack('placed', object=self._obj_pub(res['building']),
                                     furniture=res['furniture_count']))

    def _intent_move_object(self, p, d):
        d = d or {}
        r = self._obj_town_ok(p)
        if not r:
            self._town_result(p, False, '没有可用小镇')
            return
        try:
            oid = int(d.get('id'))
            x = float(d.get('x')); z = float(d.get('z'))
            rot = d.get('rot')
            rot = None if rot is None else float(rot)
        except Exception:
            self._town_result(p, False, '参数错误')
            return
        ok, err, res = objreg.move_object(self.cfg, r, oid, x, z, rot)
        if not ok:
            self._town_result(p, False, err)
            return
        self._send_cid(p.cid, P.pack('moved', object=res))

    def _intent_remove_object(self, p, d):
        d = d or {}
        try:
            oid = int(d.get('id'))
        except Exception:
            self._town_result(p, False, '参数错误')
            return
        ok, err = objreg.remove_object(self.cfg, oid,
                                       cascade=bool(d.get('cascade', 1)))
        if not ok:
            self._town_result(p, False, err)
            return
        self._send_cid(p.cid, P.pack('removed', id=oid))

'''
anchor = '    def _intent_town_create(self, p, d):'
if '_intent_place_building' not in s:
    s = s.replace(anchor, handlers + anchor, 1)
    print('handlers added')
else:
    print('handlers exist')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('world.py patched')
