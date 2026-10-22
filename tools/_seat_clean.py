# -*- coding: utf-8 -*-
"""移除调试日志，保留功能。"""
import io
p = 'server/world.py'
s = io.open(p, encoding='utf-8').read()

start = s.index("    def _seat_sit(self, p, d):")
end = s.index("    def _seat_stand(self, p):", start)

new = '''    def _seat_sit(self, p, d):
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
            if q is p:
                continue
            if str(getattr(q, 'seat', '')) == str(seat['idx']):
                self._send_cid(p.cid, P.pack('seaterr', msg='SEAT_TAKEN'))
                return
        p.seat = seat['idx']
        p.x = sx
        p.z = sz
        p.yaw = float(seat.get('yaw') or seat.get('ry') or 0)
        p.jy = 0.0
        self._send_cid(p.cid, P.pack('seated', id=seat['idx'], x=sx, z=sz,
                                     yaw=p.yaw, y=float(seat.get('y') or 0.30)))

'''
s = s[:start] + new + s[end:]
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('debug logs removed')
