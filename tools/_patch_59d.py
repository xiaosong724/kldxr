# -*- coding: utf-8 -*-
"""第 59 轮 第二批：玩家耐久字段 + 损坏 + 7 种机制结算"""
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


# ---------- ① 玩家字段 ----------
rep("""                 'weapon', 'weaponItemId',
                 'invulnT')   # ★ 复活无敌剩余时间（第 56 轮）""",
"""                 'weapon', 'weaponItemId',
                 'invulnT',   # ★ 复活无敌剩余时间（第 56 轮）
                 'wDur', 'wDurMax', 'wDurDirty')   # ★ 手上武器的耐久（第 59 轮）""",
    'slots')

rep("""        # ★ 第 56 轮：复活无敌（秒）—— 无敌期间僵尸咬不动 ✓ 客户端也会穿怪 ✓
        self.invulnT = 0.0""",
"""        # ★ 第 56 轮：复活无敌（秒）—— 无敌期间僵尸咬不动 ✓ 客户端也会穿怪 ✓
        self.invulnT = 0.0
        # ★★ 第 59 轮：手上武器的耐久 ★★
        #   为什么放内存里、不每次挥砍写库：一次挥砍一次写盘 = 磁盘要炸 ✗
        #   → 内存里扣，攒够了（或卸下/下线时）再落一次库 ✓
        _w = self.weapon or {}
        self.wDur = int(_w.get('dur') or 0)
        self.wDurMax = int(_w.get('durMax') or 0)
        self.wDurDirty = 0        # 攒了多少次没落库""", '玩家耐久字段')

# ---------- ② 损坏处理 ----------
rep("""    def _mob_bite(self, m, p):""",
"""    def _break_weapon(self, p):
        \"\"\"武器耐久归零 → 损坏消失（第 59 轮 用户要求 ✓）

        · 卸下（换回空手 ✓）
        · 删掉数据库里那一行（真的消失 ✓）
        · 告诉他一声（不然会以为丢了 ✗）
        \"\"\"
        import json
        import db as dbmod
        nm = (p.weapon or {}).get('name') or '武器'
        old_id = p.weaponItemId
        p.weapon = dict(weapons.FIST)
        p.weaponItemId = None
        p.wDur = p.wDurMax = 0
        p.wDurDirty = 0
        if old_id:
            self.post_save('DELETE FROM items WHERE id=? AND role_id=?', (old_id, p.role_id))
        self._send_cid(p.cid, P.pack('notice',
                                     text='⚠ %s 耐久耗尽，已经损坏消失了' % nm))
        self._send_cid(p.cid, P.pack('weapon', w=None))

    def _flush_dur(self, p):
        \"\"\"把内存里的耐久写回数据库（攒够次数才写 ✓ 不然磁盘受不了 ✗）\"\"\"
        if p.wDurDirty and p.weaponItemId and p.wDurMax > 0:
            import json
            w2 = dict(p.weapon or {})
            w2['dur'] = p.wDur
            w2['durMax'] = p.wDurMax
            self.post_save('UPDATE items SET item_json=? WHERE id=? AND role_id=?',
                           (json.dumps(w2, ensure_ascii=False), p.weaponItemId, p.role_id))
            p.wDurDirty = 0

    def _mob_bite(self, m, p):""", '损坏 + 落库')

# ---------- ③ 结算 7 种机制 ----------
rep("""        # ① 僵尸：扇形里的全打（一刀扫一片 ✓）
        for m in list(self.mobs.values()):
            if m.hp <= 0:
                continue
            if not mobs.in_front(p.x, p.z, p.yaw, m.x, m.z, reach, arc):
                continue
            dv, crit = mobs.roll_damage(self._atk_of(p))
            # ★ 保安会格挡（方案 §3.3"高防、会格挡"）—— 防御属性已被砍（§4.5），
            #   所以这里用"减伤"实现，和方案 §5"减伤是唯一的减伤属性"一致 ✓
            blocked = False
            if m.kind == '保安' and random.random() < mobs.BLOCK_CHANCE:
                dv = max(1, int(round(dv * mobs.BLOCK_MUL)))
                blocked = True
            m.hp -= dv
            self._add_pend(p.cid, 'mhits', {'mid': m.mid, 'dmg': dv, 'crit': bool(crit),
                                            'block': blocked,
                                            'x': round(m.x, 2), 'z': round(m.z, 2)})
            if m.hp <= 0:
                m.hp = 0
                self._mob_died(p, m)""",
"""        # ① 僵尸：扇形里按武器机制结算（第 59 轮 ✓）
        rng = random.random
        _hits = 0
        _pierce = 1
        if fx and fx['name'] == '贯穿' and rng() < fx['chance']:
            _pierce = int(fx['value'])          # 这一刀最多打几个 ✓
        for m in list(self.mobs.values()):
            if m.hp <= 0:
                continue
            if not mobs.in_front(p.x, p.z, p.yaw, m.x, m.z, reach, arc):
                continue
            if _hits >= _pierce:
                break                                # 贯穿次数用完 → 后面的打不到 ✓
            _hits += 1
            atk = self._atk_of(p)

            # ★ 匕首【背击】：从背后打 +X%（僵尸是背对着你 ✓）
            back = False
            if fx and fx['name'] == '背击':
                # 僵尸的朝向 vs 我从它哪边来：夹角 > 90° = 我在它背后 ✓
                dx, dz = p.x - m.x, p.z - m.z
                fa = math.atan2(dx, dz) - m.yaw
                while fa > math.pi:
                    fa -= math.pi * 2
                while fa < -math.pi:
                    fa += math.pi * 2
                if abs(fa) > math.pi * 0.5:
                    atk *= (1.0 + fx['value'])
                    back = True

            dv, crit = mobs.roll_damage(atk)
            # ★ 保安会格挡（方案 §3.3"高防、会格挡"）—— 防御属性已被砍（§4.5），
            #   所以这里用"减伤"实现，和方案 §5"减伤是唯一的减伤属性"一致 ✓
            blocked = False
            if m.kind == '保安' and rng() < mobs.BLOCK_CHANCE:
                dv = max(1, int(round(dv * mobs.BLOCK_MUL)))
                blocked = True
            m.hp -= dv
            self._add_pend(p.cid, 'mhits', {'mid': m.mid, 'dmg': dv, 'crit': bool(crit),
                                            'block': blocked, 'back': back,
                                            'x': round(m.x, 2), 'z': round(m.z, 2)})

            # ★★ 命中后按武器类型触发机制 ★★
            self._weapon_fx(p, m, fx, dv)

            if m.hp <= 0:
                m.hp = 0
                self._mob_died(p, m)""", '机制结算')

# ---------- ④ 机制的实现 + 溅射 ----------
rep("""    def _mob_died(self, p, m):""",
"""    def _weapon_fx(self, p, m, fx, dv):
        \"\"\"命中后触发武器机制（第 59 轮 ✓ 全部由服务器算 ✓）\"\"\"
        if not fx or m.hp <= 0:
            return
        nm = fx['name']
        if nm == '流血':
            if random.random() < fx['chance']:
                m.bleedT = weapons.BLEED_TIME
                m.bleedDmg = max(0.5, dv * fx['value'] / weapons.BLEED_TIME)
                m.bleedFrom = p
                self._send_cid(p.cid, P.pack('fx', kind='bleed', mid=m.mid))
        elif nm == '击退':
            if m.knockImmune <= 0 and random.random() < fx['chance']:
                m.knockImmune = weapons.KNOCK_IMMUNE
                # 顺着"我→他"的方向推出去 ✓
                dx, dz = m.x - p.x, m.z - p.z
                d = max(0.01, (dx * dx + dz * dz) ** 0.5)
                m.x += dx / d * fx['value']
                m.z += dz / d * fx['value']
                self._send_cid(p.cid, P.pack('fx', kind='knock', mid=m.mid))
        elif nm == '眩晕':
            if m.stunImmune <= 0 and random.random() < fx['chance']:
                m.stunT = fx['value']
                m.stunImmune = weapons.STUN_IMMUNE
                self._send_cid(p.cid, P.pack('fx', kind='stun', mid=m.mid))
        elif nm == '溅射':
            # 对主目标 1.5 米内最多 2 个再各打一份 ✓（不触发二次溅射 ✓ 防递归）
            n, r2 = 0, weapons.SPLASH_R * weapons.SPLASH_R
            for o in list(self.mobs.values()):
                if n >= weapons.SPLASH_MAX:
                    break
                if o is m or o.hp <= 0:
                    continue
                if (o.x - m.x) ** 2 + (o.z - m.z) ** 2 > r2:
                    continue
                sdv = max(1, int(round(dv * fx['value'])))
                o.hp -= sdv
                self._add_pend(p.cid, 'mhits', {'mid': o.mid, 'dmg': sdv, 'crit': False,
                                                'splash': True,
                                                'x': round(o.x, 2), 'z': round(o.z, 2)})
                n += 1
                if o.hp <= 0:
                    o.hp = 0
                    self._mob_died(p, o)

    def _mob_died(self, p, m):""", '机制实现')

# ---------- ⑤ 眩晕：晕着不动也不咬 ----------
rep("""            # ---- 目标 → 追 ----""",
"""            # ---- 目标 → 追 ----""", '占位2')

io.open(P, 'w', encoding='utf-8', newline='\n').write(t)
print('world.py 第二批改好')
