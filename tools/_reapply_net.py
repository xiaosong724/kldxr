# -*- coding: utf-8 -*-
import io

p = 'server/net.py'
s = io.open(p, encoding='utf-8').read()

old = "if t in ('skillask', 'skilllearn', 'skillforget', 'skillload', 'useskillbook', 'useitem', 'fridge_open', 'fridge_put', 'fridge_take'):"
new = "if t in ('skillask', 'skilllearn', 'skillforget', 'skillload', 'useskillbook', 'useitem'):"
assert old in s
s = s.replace(old, new, 1)

anchor = "        # \u2605\u2605 round424\uff1a\u5934\u9876\u79f0\u53f7\u9009\u54ea\u4e2a\u699c"  # ★★ round424：头顶称号选哪个榜
if anchor not in s:
    # fallback: insert before the ranktitle branch using a plain substring
    anchor = "        if t == 'ranktitle':"

FRIDGE = '''        # fridge: db side here (network thread)
        if t in ('fridge_open', 'fridge_put', 'fridge_take'):
            import json as _jf
            import db as _dbf
            import fridge as _frm
            hid = str((d or {}).get('id') or '')
            role = self.authed.get(conn.cid) or {}
            rid = int(role.get('id') or 0)
            if not rid:
                return
            owner = 0
            with _dbf.db(self.cfg) as c:
                hrow = c.execute('SELECT owner_id FROM houses WHERE id=? LIMIT 1', (hid,)).fetchone()
                if not hrow:
                    conn.push_text(P.pack('fridge', ok=0, msg='NO_HOUSE', house=hid))
                    return
                owner = int(hrow[0] or 0)
                if owner != rid:
                    conn.push_text(P.pack('fridge', ok=0, msg='OWNER_ONLY', house=hid))
                    return
                if t == 'fridge_open':
                    pass
                elif t == 'fridge_put':
                    iid = int((d or {}).get('iid') or 0)
                    row = c.execute('SELECT item_json, stack FROM items WHERE id=? AND role_id=?'
                                    ' AND in_storage=0', (iid, rid)).fetchone()
                    if not row:
                        conn.push_text(P.pack('notice', text='NO_ITEM'))
                        return
                    it = _jf.loads(row[0])
                    if it.get('kind') != 'food':
                        conn.push_text(P.pack('notice', text='FOOD_ONLY'))
                        return
                    st = int(row[1] or 1)
                    okp, msgp = _frm.put_item(c, hid, it, 1)
                    if not okp:
                        conn.push_text(P.pack('notice', text='FRIDGE_FULL'))
                        return
                    if st > 1:
                        c.execute('UPDATE items SET stack = stack - 1 WHERE id=? AND role_id=?',
                                  (iid, rid))
                    else:
                        c.execute('DELETE FROM items WHERE id=? AND role_id=?', (iid, rid))
                    c.commit()
                else:
                    slot = int((d or {}).get('slot') or 0)
                    it, st = _frm.take_item(c, hid, slot)
                    if it is None:
                        conn.push_text(P.pack('notice', text='EMPTY_SLOT'))
                        return
                    c.execute('INSERT INTO items(role_id, in_storage, slot_index, stack, item_json, created_at)'
                              ' VALUES(?,0,-1,?,?,?)',
                              (rid, st, _jf.dumps(it, ensure_ascii=False), _dbf.now_ms()))
                    c.commit()
            conn.push_text(P.pack('bagrefresh'))
            data = _frm.public(self.cfg, hid, owner, rid)
            data['ok'] = 1
            data['msg'] = 'PUT_OK' if t == 'fridge_put' else ('TAKE_OK' if t == 'fridge_take' else '')
            conn.push_text(P.pack('fridge', **data))
            return

'''

if anchor in s:
    s = s.replace(anchor, FRIDGE + anchor, 1)
else:
    raise SystemExit('anchor missing')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('net fridge re-applied', len(s))
