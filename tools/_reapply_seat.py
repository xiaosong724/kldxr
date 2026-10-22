# -*- coding: utf-8 -*-
"""补回 坐下/起身/传送 的意图分支与实现（上一轮补丁丢失）。"""
import io

p = 'server/world.py'
s = io.open(p, encoding='utf-8').read()

anchor = "        elif t == 'pick':\n            self._intent_pick(p, d)"
if anchor not in s:
    raise SystemExit('anchor missing')

add = """        elif t == 'sit':
            self._seat_sit(p, d)
        elif t == 'stand':
            self._seat_stand(p)
        elif t == 'teleport':
            self._do_teleport(p, d)
        elif t == 'pick':
            self._intent_pick(p, d)"""
s = s.replace(anchor, add, 1)

methods = '''    # ---------- 椅子 / 传送 ----------
    def _seat_sit(self, p, d):
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
                                     yaw=p.yaw, y=float(seat.get('y') or 0.30)))

    def _seat_stand(self, p):
        idx = int(getattr(p, 'seat', -1))
        if idx < 0:
            return
        p.seat = -1
        seat = town.seat_by_id(idx)
        if seat:
            p.x = float(seat['x']) + 0.85
            p.z = float(seat['z']) + 0.85
        self._send_cid(p.cid, P.pack('stood', x=p.x, z=p.z, yaw=p.yaw))

    def _do_teleport(self, p, d):
        tid = str((d or {}).get('id') or '')
        tp = town.teleport_of_id(tid)
        if not tp:
            self._send_cid(p.cid, P.pack('notice', text='NO_TELEPORT'))
            return
        now = now_s()
        if now < float(getattr(p, 'tpAt', 0.0) or 0.0):
            self._send_cid(p.cid, P.pack('notice', text='TELEPORT_COOLDOWN'))
            return
        if not town.in_town(p.x, p.z):
            self._send_cid(p.cid, P.pack('notice', text='TELEPORT_IN_TOWN_ONLY'))
            return
        p.x = float(tp['x'])
        p.z = float(tp['z']) + 3.0
        p.seat = -1
        p.tpAt = now + 3.0
        self._send_cid(p.cid, P.pack('teleported', id=tid, x=p.x, z=p.z, name=tp.get('name') or ''))

''' + anchor

s = s.replace(anchor + "\n            self._intent_pick(p, d)", methods + "\n            self._intent_pick(p, d)", 1) if False else s
# insert methods before _handle_intent
h = "    def _handle_intent(self, p, t, d):"
if h not in s:
    raise SystemExit('no handle_intent')
s = s.replace(h, methods + h, 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('seat/teleport restored', len(s))
