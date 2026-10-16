# -*- coding: utf-8 -*-
# round293: gold system step 1 - redo the world.py changes.
# ★ HARD RULE THIS TIME: PURE INSERTIONS ONLY. No line is ever deleted.
#   (The previous attempt broke syntax because deleting a line left an orphan
#    continuation line behind. See docs/gongzuoliucheng.md.)
# Every anchor is matched as a whole line and asserted unique. ast.parse runs
# on the joined result BEFORE writing to disk - nothing is written if it fails.
import ast
import io

p = 'server/world.py'
lines = io.open(p, encoding='utf-8').read().split('\n')
orig_len = len(lines)
inserted = []

# ---------------------------------------------------------------- 1) __slots__
a1 = "                 'moveT', 'moveBad', 'suspect')"
h1 = [i for i, ln in enumerate(lines) if ln == a1]
assert len(h1) == 1, 'slots anchor: %d hits' % len(h1)
i1 = h1[0]
ind1 = ' ' * (len(lines[i1]) - len(lines[i1].lstrip()))
lines[i1:i1] = [
    ind1 + "# round293: gold. Memory is authoritative (see docs v3 section 1);",
    ind1 + "#   goldDirty = client has not seen this value yet; goldLog = ring buffer.",
    ind1 + "'gold', 'goldDirty', 'goldLog',",
]
inserted.append('slots (+3 lines at %d)' % (i1 + 1))

# ---------------------------------------------------------------- 2) _gain_gold
a2 = "    def _gain_exp(self, q, amount):"
h2 = [i for i, ln in enumerate(lines) if ln == a2]
assert len(h2) == 1, '_gain_exp anchor: %d hits' % len(h2)
i2 = h2[0]
FN = '''    # ================= round293: gold =================
    GOLD_CAP = 1000000000          # 10 yi
    GOLD_PER_BULLION = 100000000

    def _gain_gold(self, q, n, why=''):
        """THE only place gold changes. Returns the amount actually applied.

          * memory is authoritative - never write the db from here (tick thread)
          * n < 0 -> refuses to go below zero (returns 0 when it cannot pay)
          * n > 0 -> the part above GOLD_CAP becomes gold bullion automatically
          * every change goes into a small ring buffer (admin page / debugging)
        """
        if q is None or not n:
            return 0
        try:
            n = int(n)
        except Exception:
            return 0
        cur = int(getattr(q, 'gold', 0) or 0)
        if n < 0:
            pay = min(cur, -n)
            if pay <= 0:
                return 0
            q.gold = cur - pay
            applied = -pay
        else:
            q.gold = cur + n
            applied = n
            try:
                if q.gold > self.GOLD_CAP:
                    k = (q.gold - self.GOLD_CAP) // self.GOLD_PER_BULLION
                    if k > 0 and self._give_bullion(q, k):
                        q.gold -= k * self.GOLD_PER_BULLION
            except Exception as e:
                print('[gold] bullion convert failed: %r' % (e,))
        q.goldDirty = True
        try:
            log = getattr(q, 'goldLog', None)
            if log is None:
                log = q.goldLog = []
            log.append((int(now_s()), int(applied), str(why)[:24]))
            if len(log) > 200:
                del log[:len(log) - 200]
        except Exception:
            pass
        return applied

    def _give_bullion(self, q, k):
        """Hand k gold bullion to the player. True when it was queued.

        post_save() takes SQL, NOT an action name - the first version of this
        function passed 'give_bullion' and would have failed at runtime. The
        pattern below is copied from the debug-give-weapon branch (world.py:914).
        """
        try:
            rid = getattr(q, 'role_id', None)
            if not rid:
                return False
            import json
            import db as dbmod
            it = {'name': '\u9ec4\u91d1', 'tier': 0, 'kind': 'material', 'rarity': 'legend'}
            self.post_save(
                'INSERT INTO items(role_id, in_storage, slot_index, stack, item_json, created_at)'
                ' VALUES(?,0,-1,?,?,?)',
                (rid, int(k), json.dumps(it, ensure_ascii=False), dbmod.now_ms()))
            try:
                self._send_cid(q.cid, P.pack('notice',
                    text='\u91d1\u5e01\u5df2\u8fbe\u4e0a\u9650\u2014\u2014\u81ea\u52a8\u5151\u6362\u6210 %d \u4e2a\u3010\u9ec4\u91d1\u3011\u653e\u8fdb\u80cc\u5305\u4e86' % int(k)))
            except Exception:
                pass
            return True
        except Exception as e:
            print('[gold] give bullion failed: %r' % (e,))
            return False

'''
lines[i2:i2] = FN.split('\n')
inserted.append('_gain_gold/_give_bullion (+%d lines at %d)' % (len(FN.split('\n')), i2 + 1))

# ---------------------------------------------------------------- 3) kill drop
a3 = "        self._gain_exp(p, int(m.exp))"
h3 = [i for i, ln in enumerate(lines) if ln == a3]
assert len(h3) == 1, 'mob award anchor: %d hits' % len(h3)
i3 = h3[0]
ind3 = ' ' * (len(lines[i3]) - len(lines[i3].lstrip()))
lines[i3 + 1:i3 + 1] = [
    ind3 + "# round293: gold from kills. Base by kind, scaled by mob level.",
    ind3 + "#   Deliberately small (~25 gold per mob average) so a normal player",
    ind3 + "#   earns thousands per day, not millions - user decision (docs v3).",
    ind3 + "try:",
    ind3 + "    _gk = str(getattr(m, 'kind', '') or '')",
    ind3 + "    if _gk in ('\u5de5\u4eba', '\u4fdd\u5b89', '\u5065\u8eab\u6559\u7ec3'):",
    ind3 + "        _gb = 12",
    ind3 + "    elif _gk in ('\u533b\u751f', '\u7a0b\u5e8f\u5458'):",
    ind3 + "        _gb = 8",
    ind3 + "    else:",
    ind3 + "        _gb = 5",
    ind3 + "    _gl = max(1, int(getattr(m, 'lv', 1) or 1))",
    ind3 + "    _gg = int(_gb * (1.0 + _gl / 12.0))",
    ind3 + "    if _gg > 0:",
    ind3 + "        self._gain_gold(p, _gg, 'kill')",
    ind3 + "except Exception as _ge:",
    ind3 + "    print('[gold] kill drop failed: %r' % (_ge,))",
]
inserted.append('kill drop (+17 lines after %d)' % (i3 + 1))

# ---------------------------------------------------------------- write
out = '\n'.join(lines)
ast.parse(out)                      # ★ raises before anything is written
io.open(p, 'w', encoding='utf-8', newline='\n').write(out)
print('  ORIGINAL %d lines -> NEW %d lines' % (orig_len, len(lines)))
for s in inserted:
    print('    + ' + s)
print('  ast.parse passed - file written')
