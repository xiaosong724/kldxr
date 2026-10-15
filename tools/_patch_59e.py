# -*- coding: utf-8 -*-
"""第 59 轮 第三批：眩晕拦截 + 招架 + 耐久同步/落库"""
import io

P = 'server/world.py'
t = io.open(P, encoding='utf-8').read()


def rep(a, b, name):
    global t
    c = t.count(a)
    assert c == 1, '%s: %d 次' % (name, c)
    t = t.replace(a, b)
    io.open(P, 'w', encoding='utf-8', newline='\n').write(t)
    print('  OK', name)


# ① 眩晕：晕着不动、不咬、不蓄力
rep("""            if near is not None and nd2 <= agg2:
                # ---- 有目标：追 / 咬（外卖残血时改成逃，见下）----
                m.tgt = near.cid""",
"""            # ★★ 第 59 轮：被锤砸【晕住】了 —— 不能动、不能咬、也不蓄力 ✓
            #   拦在"有目标"判断之前 ✓ 晕着就是彻底停下（这才叫眩晕 ✓）
            if m.stunT > 0:
                m.stunT = max(0.0, m.stunT - dt)
                m.windT = 0.0                 # 蓄力也取消 → 醒来要重新起手 ✓
                continue                      # 跳过后面所有追击/咬人逻辑 ✓
            if near is not None and nd2 <= agg2:
                # ---- 有目标：追 / 咬（外卖残血时改成逃，见下）----
                m.tgt = near.cid""", '眩晕拦截')

# ② 招架：挨打时按手上武器概率减半
rep("""        if getattr(p, 'invulnT', 0) > 0:
            return
        dv, crit = mobs.roll_damage(m.atk)""",
"""        if getattr(p, 'invulnT', 0) > 0:
            return
        dv, crit = mobs.roll_damage(m.atk)
        # ★★ 第 59 轮：单手剑的【招架】—— 按手上武器的概率把这一口减半 ✓
        #   （意图写在武器文案里 ✓ 玩家看得到才不冤 ✓）
        _w = p.weapon or {}
        _fx = weapons.fx_of(_w.get('look'), int(_w.get('tier') or 0))
        if _fx and _fx['name'] == '招架' and random.random() < _fx['chance']:
            dv = max(1, int(round(dv * (1.0 - _fx['value']))))
            self._send_cid(p.cid, P.pack('fx', kind='parry'))""", '招架')

# ③ 装备/卸下时同步耐久
rep("""            w = d.get('weapon')
            p.weapon = w or dict(weapons.FIST)
            p.weaponItemId = d.get('itemId')""",
"""            w = d.get('weapon')
            self._flush_dur(p)                      # ★ 换武器前先把旧的耐久落库 ✓
            p.weapon = w or dict(weapons.FIST)
            p.weaponItemId = d.get('itemId')
            # ★ 第 59 轮：读出手上这把的耐久（没记录就从上限开始 ✓）
            p.wDurMax = int((w or {}).get('durMax') or 0)
            p.wDur = int((w or {}).get('dur') or p.wDurMax)
            p.wDurDirty = 0""", '装备同步耐久')

# ④ 攒 50 次落一次库
rep("""        if p.wDurMax > 0:
            p.wDur -= 1
            if p.wDur <= 0:
                self._break_weapon(p)
                return""",
"""        if p.wDurMax > 0:
            p.wDur -= 1
            p.wDurDirty += 1
            if p.wDurDirty >= 50:
                self._flush_dur(p)                  # ★ 攒 50 次写一次盘 ✓ 不炸磁盘 ✓
            if p.wDur <= 0:
                self._break_weapon(p)
                return""", '定期落库')

# ⑤ 下线/存档也落一次
rep("""    def _save_player(self, p):
        \"\"\"只入队，不写盘 —— 写盘交给存档线程\"\"\"
        import db as dbmod""",
"""    def _save_player(self, p):
        \"\"\"只入队，不写盘 —— 写盘交给存档线程\"\"\"
        import db as dbmod
        self._flush_dur(p)                      # ★ 下线时把耐久落一次 ✓""", '下线落库')
