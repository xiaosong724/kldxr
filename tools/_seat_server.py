# -*- coding: utf-8 -*-
"""服务端：支持坐在已放置的家具椅子上。"""
import io

p = 'server/world.py'
s = io.open(p, encoding='utf-8').read()

old = """    def _seat_sit(self, p, d):
        sid = str((d or {}).get('id') or '')
        seat = town.seat_by_id(sid)
        if not seat:
            self._send_cid(p.cid, P.pack('seaterr', msg='NO_SEAT'))
            return
        sx, sz = float(seat['x']), float(seat['z'])
        if (p.x - sx) ** 2 + (p.z - sz) ** 2 > town.SEAT_USE_R * town.SEAT_USE_R:
            self._send_cid(p.cid, P.pack('seaterr', msg='TOO_FAR'))
            return
        for q in list(self.players.values()):
            if q is not p and int(getattr(q, 'seat', -1)) == int(seat['idx']):
                self._send_cid(p.cid, P.pack('seaterr', msg='SEAT_TAKEN'))
                return
        p.seat = int(seat['idx'])
        p.x = sx
        p.z = sz
        p.yaw = float(seat.get('yaw') or seat.get('ry') or 0)
        p.jy = 0.0
        self._send_cid(p.cid, P.pack('seated', id=seat['idx'], x=sx, z=sz,
                                     yaw=p.yaw, y=float(seat.get('y') or 0.30)))"""

new = """    def _seat_lookup(self, sid):
        \"\"\"座位解析：静态座位用数字 id；已放置的家具椅子用 'obj<id>'。\"\"\"
        seat = town.seat_by_id(sid)
        if seat:
            return seat
        # 已放置的家具椅子
        if not str(sid).startswith('obj'):
            return None
        try:
            import town_objects as objreg2
            oid = int(str(sid)[3:])
        except Exception:
            return None
        for tid in self.towns:
            for o in objreg2.nearby(self.cfg, tid, 0.0, 0.0, 400.0):
                if int(o['id']) != oid:
                    continue
                cat = str(o.get('catalog_id') or '')
                if cat not in ('chair_wood', 'hall_chair', 'desk_chair',
                               'prop_bench', 'sofa_modern_2'):
                    return None
                return {
                    'id': sid, 'idx': sid, 'x': float(o['x']), 'z': float(o['z']),
                    'y': 0.30, 'yaw': float(o.get('rot') or 0) + 3.1415926,
                    'k': cat, 'placed': True,
                }
        return None

    def _seat_sit(self, p, d):
        sid = str((d or {}).get('id') or '')
        seat = self._seat_lookup(sid)
        if not seat:
            self._send_cid(p.cid, P.pack('seaterr', msg='NO_SEAT'))
            return
        sx, sz = float(seat['x']), float(seat['z'])
        if (p.x - sx) ** 2 + (p.z - sz) ** 2 > town.SEAT_USE_R * town.SEAT_USE_R:
            self._send_cid(p.cid, P.pack('seaterr', msg='TOO_FAR'))
            return
        for q in list(self.players.values()):
            if q is not p and int(getattr(q, 'seat', -1)) == int(seat['idx']) if isinstance(seat['idx'], int) else False:
                self._send_cid(p.cid, P.pack('seaterr', msg='SEAT_TAKEN'))
                return
        p.seat = seat['idx'] if not isinstance(seat['idx'], int) else int(seat['idx'])
        p.x = sx
        p.z = sz
        p.yaw = float(seat.get('yaw') or seat.get('ry') or 0)
        p.jy = 0.0
        self._send_cid(p.cid, P.pack('seated', id=seat['idx'], x=sx, z=sz,
                                     yaw=p.yaw, y=float(seat.get('y') or 0.30)))"""

if old in s:
    s = s.replace(old, new, 1)
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
    print('seat sit patched')
else:
    print('anchor miss')
