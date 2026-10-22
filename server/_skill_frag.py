    def _sk_val(self, p, key):
        """{key: tier} → 数值（没装 = 0）"""
        b = getattr(p, 'skBuff', None) or {}
        t = b.get(key)
        if not t:
            return 0.0
        r = self.SK_BUFF_RANGE.get(key)
        if not r:
            return 0.0
        lo, hi = r
        if hi <= lo:
            return lo
        k = (int(t) - 1) / 4.0
        return lo + (hi - lo) * k

    def _skill_profile(self, p):
        """★ 性能：同一 tick 内多次技能伤害共用一份攻击/增伤/暴击快照"""
        _tk = int(getattr(self, 'tick_count', 0) or 0)
        if int(getattr(p, 'skProfTick', -1) or -1) == _tk and p.skProf is not None:
            return p.skProf
        base = self._atk_of(p)
        mul = 1.0 + self._sk_val(p, 'skilldmg') + self._sk_val(p, 'masterA')
        can_crit = (self._sk_val(p, 'skillcrit') > 0)
        _t = affixes.totals((p.weapon or {}).get('affixes'))
        prof = (base, mul, can_crit,
                _t.get('crit_pt', 0.0) + self._tal(p, 'crit') + self._sk_val(p, 'extra_crit'),
                _t.get('crit_dmg', 0.0) + self._tal(p, 'critdmg'))
        p.skProf = prof
        p.skProfTick = _tk
        return prof

    def _skill_damage(self, p, defn, x, z, radius):
        import skills as skm
        mult = float(defn.get('dmg') or 0.0)
        if mult <= 0 or radius <= 0:
            return 0
        _tot = 0
        base, _mul, can_crit, _crit_pt, _crit_dmg = self._skill_profile(p)
        for m in list(self.mobs.values()):
            if m.hp <= 0:
                continue
            if (m.x - x) ** 2 + (m.z - z) ** 2 > radius * radius:
                continue
            dmg = base * mult
            crit = False
            if can_crit:
                dv, crit = mobs.roll_damage(
                    base, crit_pt=_crit_pt, crit_dmg=_crit_dmg)
                dmg = max(1, int(round(dv * mult * _mul)))
            else:
                dmg = max(1, int(round(dmg * _mul)))
            if m.kind == '保安' and random.random() < mobs.BLOCK_CHANCE:
                dmg = max(1, int(round(dmg * mobs.BLOCK_MUL)))
            dmg = self._mob_defense(p, m, dmg, False)
            if dmg <= 0:
                continue
            self._record_mob_damage(m, p, dmg)
            m.hp -= dmg
            _tot += dmg
            m.freezeT = 0.0          # ★ round584：受伤破冰
            self._report_hit(p, m.mid, dmg, crit, m.x, m.z,
                             {'back': False, 'mb': None, 'heal': 0, 'sk': 1})
            if m.hp <= 0:
                m.hp = 0
                self._mob_died(p, m)
                self._sk_chain_kill(p)
        # 打玩家（PvP 全额）
        try:
            dv2 = max(1, int(round(self._atk_of(p) * mult * _mul)))
            _tot += self._aoe_players(p, x, z, radius, dv2, src='skill', is_skill=True)
        except Exception as e:
            print('[skill] pvp 失败：%r' % (e,))
        return _tot

    def _line_skill(self, p, tx, tz, length, width, mult, knock=0.0):
        """★ round581（A3 地裂）：从自己朝落点方向的一条直线伤害"""
        _dmul = 1.0 + self._sk_val(p, 'skdur')
        dx, dz = tx - p.x, tz - p.z
        d = math.hypot(dx, dz)
        if d < 0.01:
            dx, dz, d = math.sin(p.yaw), math.cos(p.yaw), 1.0
        ux, uz = dx / d, dz / d
        hits = []
        for m in list(self.mobs.values()):
            if m.hp <= 0:
                continue
            rx, rz = m.x - p.x, m.z - p.z
            fwd = rx * ux + rz * uz
            lat = abs(rx * uz - rz * ux)
            if 0 <= fwd <= length and lat <= width * 0.5:
                hits.append(('m', m))
        for q in list(self.players.values()):
            if q is p or int(q.hp or 0) <= 0:
                continue
            if not self._pvp_ok(p, q)[0]:
                continue
            rx, rz = q.x - p.x, q.z - p.z
            fwd = rx * ux + rz * uz
            lat = abs(rx * uz - rz * ux)
            if 0 <= fwd <= length and lat <= width * 0.5:
                hits.append(('p', q))
        for c in list(self.clones.values()):
            if int(c.get('hp') or 0) <= 0:
                continue
            _co = self.players.get(c.get('owner'))
            if _co is None or not self._can_hit_player(p, _co):
                continue
            rx, rz = c['x'] - p.x, c['z'] - p.z
            fwd = rx * ux + rz * uz
            lat = abs(rx * uz - rz * ux)
            if 0 <= fwd <= length and lat <= width * 0.5:
                hits.append(('c', c))
        dmg = dict(dmg=float(mult), can_crit=True, radius=0.1)
        for kind, obj in hits:
            _ox = obj['x'] if kind == 'c' else obj.x
            _oz = obj['z'] if kind == 'c' else obj.z
            self._skill_damage(p, dmg, _ox, _oz, 0.1)
            # ★ 地裂：每秒 5% 目标最大生命，持续 5 秒
            try:
                if kind == 'm':
                    _mhp = int(getattr(obj, 'mhp', 0) or 0)
                elif kind == 'p':
                    _mhp = int(self._hp_max(obj))
                else:
                    _mhp = int(obj.get('hpMax') or obj.get('hp') or 1)
                _dot = max(1, int(round(_mhp * 0.05)))
                self._earth_dots.append({
                    'kind': kind, 'obj': obj, 'by': p.cid, 'dmg': _dot,
                    'next': now_s() + 1.0, 'until': now_s() + 5.01 * _dmul})
            except Exception:
                pass
            if knock > 0:
                if kind == 'm':
                    _km = self._mob_control_mul(obj)
                    obj.x += ux * knock * _km
                    obj.z += uz * knock * _km
                elif kind == 'c':
                    obj['x'] += ux * knock
                    obj['z'] += uz * knock
                else:
                    self._send_cid(obj.cid, P.pack('fx', kind='kb',
                                                  dx=round(ux * knock, 2),
                                                  dz=round(uz * knock, 2)))

    def _cone_skill(self, p, radius, half_deg, mult):
        """★ round581（A10 燃血斩）：面朝扇形伤害，返回实际总伤害（吸血用）"""
        _cos = math.cos(math.radians(half_deg))
        _fx, _fz = math.sin(p.yaw), math.cos(p.yaw)
        hits = []
        for m in list(self.mobs.values()):
            if m.hp <= 0:
                continue
            rx, rz = m.x - p.x, m.z - p.z
            dd = math.hypot(rx, rz)
            if dd > radius or dd < 0.01:
                continue
            if (rx * _fx + rz * _fz) / dd >= _cos:
                hits.append(('m', m))
        for q in list(self.players.values()):
            if q is p or int(q.hp or 0) <= 0:
                continue
            if not self._pvp_ok(p, q)[0]:
                continue
            rx, rz = q.x - p.x, q.z - p.z
            dd = math.hypot(rx, rz)
            if dd > radius or dd < 0.01:
                continue
            if (rx * _fx + rz * _fz) / dd >= _cos:
                hits.append(('p', q))
        for c in list(self.clones.values()):
            if int(c.get('hp') or 0) <= 0:
                continue
            _co = self.players.get(c.get('owner'))
            if _co is None or not self._can_hit_player(p, _co):
                continue
            rx, rz = c['x'] - p.x, c['z'] - p.z
            dd = math.hypot(rx, rz)
            if dd > radius or dd < 0.01:
                continue
            if (rx * _fx + rz * _fz) / dd >= _cos:
                hits.append(('c', c))
        dmg = dict(dmg=float(mult), can_crit=True, radius=0.1)
        _tot = 0
        for kind, obj in hits:
            _ox = obj['x'] if kind == 'c' else obj.x
            _oz = obj['z'] if kind == 'c' else obj.z
            _tot += (self._skill_damage(p, dmg, _ox, _oz, 0.1) or 0)
        return _tot

    def _later_skill_tick(self):
        """到点的技能伤害（tick 每帧跑一次 ✓）"""
        if not getattr(self, '_later_skill', None):
            return
        _now = now_s()
        keep = []
        for it in self._later_skill:
            due, cid, key, x, z = it
            if _now < due:
                keep.append(it)
                continue
            p = self.players.get(cid)
            if p is None:
                continue
            try:
                import skills as skm
                d = skm.BY_KEY.get(key)
                if not d:
                    continue
                rad = float(d.get('radius') or 0) * (1.0 + self._sk_val(p, 'skrange'))
                if key == 'icefield':
                    self._icefield(p, x, z, rad)
                    continue
                if key == 'timestop':
                    self._timestop(p, x, z, rad, 6.0 * _dmul)
                    continue
                self._skill_damage(p, d, x, z, rad)
                # ★ round582（A11 天罚）：8 米内击倒 1 秒
                if key == 'judgement':
                    _r2j = rad * rad
                    for _m in self.mobs.values():
                        if _m.hp > 0 and (_m.x - x) ** 2 + (_m.z - z) ** 2 <= _r2j:
                            _cmj = self._mob_control_mul(_m)
                            if _cmj > 0:
                                _m.stunT = max(float(getattr(_m, 'stunT', 0) or 0), 1.0 * _cmj)
                    for _q in self.players.values():
                        if _q is p or int(_q.hp or 0) <= 0:
                            continue
                        if (_q.x - x) ** 2 + (_q.z - z) ** 2 <= _r2j:
                            _q.downT = 1.0
                    for _c in self.clones.values():
                        if int(_c.get('hp') or 0) > 0 and (_c['x'] - x) ** 2 + (_c['z'] - z) ** 2 <= _r2j:
                            _c['freezeT'] = max(float(_c.get('freezeT') or 0), 1.0)
            except Exception as e:
                print('[skill] 延迟伤害失败：%r' % (e,))
        self._later_skill = keep

    def _icefield(self, p, x, z, rad):
        """★ round581（A4 冰封领域）：50% 冻结 5 秒；没冻住的吃 120%"""
        _atk = dict(dmg=1.20, can_crit=True, radius=0.1)
        _r2 = rad * rad
        for m in list(self.mobs.values()):
            if m.hp <= 0 or (m.x - x) ** 2 + (m.z - z) ** 2 > _r2:
                continue
            _cm = self._mob_control_mul(m)
            if _cm > 0 and random.random() < 0.5:
                m.freezeT = 5.0 * _cm
            else:
                self._skill_damage(p, _atk, m.x, m.z, 0.1)
        for q in list(self.players.values()):
            if q is p or int(q.hp or 0) <= 0:
                continue
            if not self._pvp_ok(p, q)[0]:
                continue
            if (q.x - x) ** 2 + (q.z - z) ** 2 > _r2:
                continue
            if random.random() < 0.5:
                q.freezeT = 5.0
                self._send_cid(q.cid, P.pack('notice', text='被冰封：5 秒不能移动'))
            else:
                self._aoe_players(p, q.x, q.z, 0.1, int(self._atk_of(p) * 1.2),
                                  src='skill', is_skill=True)
        for c in list(self.clones.values()):
            if int(c.get('hp') or 0) <= 0:
                continue
            _co = self.players.get(c.get('owner'))
            if _co is None or not self._can_hit_player(p, _co):
                continue
            if (c['x'] - x) ** 2 + (c['z'] - z) ** 2 > _r2:
                continue
            if random.random() < 0.5:
                c['freezeT'] = 5.0
            else:
                self._clone_damage(c, int(self._atk_of(p) * 1.2), p, False)

    def _timestop(self, p, x, z, rad, dur=6.0):
        """★ round587（A9 时间凝滞）：10 米内减速 70% 6 秒 + 10% 伤害"""
        _r2 = rad * rad
        for m in list(self.mobs.values()):
            if m.hp > 0 and (m.x - x) ** 2 + (m.z - z) ** 2 <= _r2:
                _mcm = self._mob_control_mul(m)
                if _mcm > 0:
                    m.slowT = dur * _mcm
                    m.slowMul = 0.3
        for q in list(self.players.values()):
            if q is p or int(q.hp or 0) <= 0:
                continue
            if not self._pvp_ok(p, q)[0]:
                continue
            if (q.x - x) ** 2 + (q.z - z) ** 2 <= _r2:
                q.slowT = dur
                q.slowMul = 0.3
        for c in list(self.clones.values()):
            if int(c.get('hp') or 0) <= 0:
                continue
            _co = self.players.get(c.get('owner'))
            if _co is None or not self._can_hit_player(p, _co):
                continue
            if (c['x'] - x) ** 2 + (c['z'] - z) ** 2 <= _r2:
                c['slowT'] = dur
                c['slowMul'] = 0.3
        self._skill_damage(p, dict(dmg=0.10, can_crit=False, radius=rad), x, z, rad)

    def _skill_cast(self, p, d):
        import skills as skm
        key = str(d.get('key') or '')
        if not skm.valid(key) or skm.KIND.get(key) != 'A':
            return
        # ★ round583：冰封期间不能放技能
        if float(getattr(p, 'freezeT', 0) or 0) > 0:
            self._send_cid(p.cid, P.pack('notice', text='被冰封：不能攻击'))
            return
        defn = skm.BY_KEY[key]
        # 装在第一排（A 类 5 槽）里才能放
        if key not in (getattr(p, 'skLoad', {}) or {}).get('A', []):
            self._send_cid(p.cid, P.pack('notice', text='先把它装配到技能栏'))
            return
        # 冷却
        cd_left = float((getattr(p, 'skCd', {}) or {}).get(key) or 0)
        if cd_left > 0.05:
            self._send_cid(p.cid, P.pack('notice', text='技能冷却中（%.1f 秒）' % cd_left))
            return
        # 灵气
        qi_cost = int(defn.get('qi') or 0)
        if int(p.qi or 0) < qi_cost:
            self._send_cid(p.cid, P.pack('notice', text='灵气不够（要 %d）' % qi_cost))
            return

        # ★ round559b：半径/持续时间先算出来（安全区那段要用）
        radius = float(defn.get('radius') or 0) * (1.0 + self._sk_val(p, 'skrange'))
        dur_fx = float(defn.get('dur') or 1.0) * (1.0 + self._sk_val(p, 'skdur'))
        _dmul = 1.0 + self._sk_val(p, 'skdur')

        # 落点：客户端传了就校验距离 ✗ 没传就自动选最近的怪 ✓
        rng = float(defn.get('range') or 0)
        x = d.get('x'); z = d.get('z')
        tgt = None
        if x is None or z is None:
            best, bd = None, 1e9
            lim = (rng if rng > 0 else 12.0) ** 2
            for m in self.mobs.values():
                if m.hp <= 0:
                    continue
                dd = (m.x - p.x) ** 2 + (m.z - p.z) ** 2
                if dd < bd and dd <= lim:
                    bd, best = dd, m
            # ★ round574（用户："技能也要能打到非队友玩家"）
            #   ★ 只在【附近没有怪】时才看玩家 ✓（有怪优先打怪 ✓ 和用户确认一致）
            #   ★ 能不能打走 _pvp_ok：PvP 开关 / 队友 / 安全区 / 等级差 全部同一套 ✓
            if best is None:
                for _q in self.players.values():
                    if _q is p or int(_q.hp or 0) <= 0:
                        continue
                    if not self._can_hit_player(p, _q):
                        continue
                    dd = (_q.x - p.x) ** 2 + (_q.z - p.z) ** 2
                    if dd < bd and dd <= lim:
                        bd, best = dd, _q
            # ★ round575：没怪、也没可打的玩家时，再看【敌方分身】
            if best is None:
                _bd2 = bd
                for _c in self.clones.values():
                    _co = self.players.get(_c.get('owner'))
                    if _co is None or int(_c.get('hp') or 0) <= 0:
                        continue
                    if abs(_c['x']) <= mqmod.SAFE_HALF and abs(_c['z']) <= mqmod.SAFE_HALF:
                        continue
                    if not self._can_hit_player(p, _co):
                        continue
                    dd = (_c['x'] - p.x) ** 2 + (_c['z'] - p.z) ** 2
                    if dd < _bd2 and dd <= lim:
                        _bd2, best = dd, _c
            if best is None:
                x, z = p.x, p.z          # 没目标 → 以自己为中心
            elif isinstance(best, dict):
                x, z = best['x'], best['z']
                tgt = best
            else:
                x, z = best.x, best.z
                tgt = best
        else:
            x, z = float(x), float(z)
            if rng > 0:
                dx, dz = x - p.x, z - p.z
                dist = math.hypot(dx, dz)
                if dist > rng:          # ★ 防改包丢远处：夹到射程边界
                    x = p.x + dx / dist * rng
                    z = p.z + dz / dist * rng

        # ★ round583：自身 buff/开关类技能不选落点（否则会被“最近目标在安全区”卡住）
        if key in ('bloodrage', 'gale', 'shield', 'plague', 'bloodslash'):
            x, z = p.x, p.z
            tgt = None

        # ★★★ round562（用户："安全区内不能放技能，也不可以把技能放到安全区内"）
        #   → 站城里放：拒绝；落点在城里：拒绝（不再偷偷推到区外 ✓）
        if abs(p.x) <= mqmod.SAFE_HALF and abs(p.z) <= mqmod.SAFE_HALF:
            self._send_cid(p.cid, P.pack('notice', text='安全区内不能放技能'))
            return
        if abs(x) <= mqmod.SAFE_HALF and abs(z) <= mqmod.SAFE_HALF:
            self._send_cid(p.cid, P.pack('notice', text='不能把技能放进安全区'))
            return

        # ★ round552：被动加成（C 类）在这里生效
        qi_cost = int(round(qi_cost * (1.0 - self._sk_val(p, 'thrifty'))))
        cd_cut = min(0.6, self._sk_val(p, 'cdcut'))          # 乘算，总上限 60%
        cd_final = max(1.5, float(defn.get('cd') or 0) * (1.0 - cd_cut))
        # 扣灵气 + CD
        p.qi = max(0, int(p.qi or 0) - qi_cost)
        p.skCd[key] = cd_final
        self._send_cid(p.cid, P.pack('qi', q=int(p.qi)))
        self._send_cid(p.cid, P.pack('skillcd', cd=dict((k, round(v, 2)) for k, v in p.skCd.items())))

        # 特效广播（自己和别人都看同一套 ✓）
        # ★ 特效广播：同屏所有人都收到【同一条 skillfx】（含自己 ✓）
        #   ★ seed 一起发 ✗ 每个人粒子/落点一致 ✓
        _fx = dict(k=defn.get('vfx') or 'none', x=round(x, 2), z=round(z, 2),
                   r=round(radius, 2), yaw=round(p.yaw, 3), dur=round(dur_fx, 2),
                   seed=random.randint(1, 999999), by=p.role_id)
        if key == 'swordrain':
            _fx['n'] = 12       # ★ round585：万剑 12 把（视觉同步）
        if key != 'thunder':
            for _q in self.players.values():
                if (_q.x - p.x) ** 2 + (_q.z - p.z) ** 2 <= 1600.0:
                    self._send_cid(_q.cid, P.pack('skillfx', **_fx))

        # ★ round583：技能音效也按距离同步（客户端 sfxAt 再衰减）
        try:
            _snd_map = {'blackhole': 'strong', 'judgement': 'strong',
                        'thunder': 'thunder', 'icefield': 'thunder',
                        'timestop': 'strong', 'firestorm': 'strong',
                        'swordrain': 'swing', 'arrowrain': 'swing',
                        'earthsplit': 'swing', 'bloodslash': 'swing',
                        'blink': 'strong', 'plague': 'strong'}
            self._snd_near(x, z, _snd_map.get(key, 'strong'), 0.85)
        except Exception:
            pass

        # ★ round580：自身 buff / 护盾类主动（不吃伤害，只挂状态）
        if key == 'bloodrage':
            _bd = 15.0 * _dmul
            p.skTA['bloodrage'] = _bd
            p.skProfTick = -1
            self._send_cid(p.cid, P.pack('notice', text='血怒：攻击 +40%%、受伤 +20%%（%d 秒）' % round(_bd)))
            return
        if key == 'gale':
            _gd = 20.0 * _dmul
            p.skTA['gale'] = _gd
            self._send_cid(p.cid, P.pack('notice', text='疾风步：移速 +80%%、闪避 +30%%（%d 秒）' % round(_gd)))
            return
        if key == 'plague':
            p.plagueOn = not bool(getattr(p, 'plagueOn', False))
            p.plagueAcc = 0.0
            p.plagueMoveT = 0.0
            p.plagueX = p.x
            p.plagueZ = p.z
            self._send_cid(p.cid, P.pack(
                'notice', text='病毒扩散：已开启' if p.plagueOn else '病毒扩散：已关闭'))
            return
        if key == 'shield':
            p.skShield = max(1.0, float(self._atk_of(p)) * 5.0)
            _sd = 30.0 * _dmul
            p.skShieldT = _sd
            self._send_cid(p.cid, P.pack('notice',
                                         text='灵能护盾：吸收 %d 点伤害（%d 秒）' % (int(p.skShield), round(_sd))))
            return
        # ★ round581：地裂（直线 + 击退）、燃血斩（扇形 + 吸血）
        if key == 'earthsplit':
            self._line_skill(p, x, z, 8.0, 3.5, 1.50, knock=3.0)
            return
        if key == 'bloodslash':
            _dmg_total = self._cone_skill(p, 4.0, 90.0, 1.80)
            if _dmg_total > 0:
                _heal = max(1, int(round(_dmg_total * 0.50)))
                p.hp = min(self._hp_max(p), int(p.hp or 0) + _heal)
                self._send_cid(p.cid, P.pack('notice', text='燃血斩吸血 +%d' % _heal))
            return
        # ★ round580：多段主动（每段独立结算/独立暴击）
        _now0 = now_s()
        if key == 'swordrain':
            _n = max(1, int(round(12 * _dmul)))
            for _i in range(_n):
                _a = random.random() * math.pi * 2
                _rr = math.sqrt(random.random()) * 6.0
                self._later_hits.append(
                    (_now0 + 0.15 + _i * 0.24,
                     p.cid, x + math.sin(_a) * _rr, z + math.cos(_a) * _rr,
                     0.60, 2.0, True, 'swordrain'))
            return
        if key == 'arrowrain':
            _n = max(1, int(round(12 * _dmul)))
            for _i in range(_n):
                _a = random.random() * math.pi * 2
                _rr = math.sqrt(random.random()) * 10.0
                self._later_hits.append(
                    (_now0 + 0.60 + _i * (2.0 / 12.0),
                     p.cid, x + math.sin(_a) * _rr, z + math.cos(_a) * _rr,
                     0.70, 2.0, True, 'arrowrain'))
            return
        if key == 'firestorm':
            _n = max(1, int(round(8 * _dmul)))
            for _i in range(_n):
                self._later_hits.append(
                    (_now0 + 0.5 + _i * 0.5, p.cid, x, z, 0.40, 5.0, True, 'firestorm'))
            return
        if key == 'thunder':
            _pts = []
            for _m in self.mobs.values():
                if _m.hp > 0 and (_m.x - p.x) ** 2 + (_m.z - p.z) ** 2 <= 225.0:
                    _pts.append((_m.x, _m.z))
            for _q in self.players.values():
                if _q is p or int(_q.hp or 0) <= 0:
                    continue
                if not self._can_hit_player(p, _q):
                    continue
                if (_q.x - p.x) ** 2 + (_q.z - p.z) ** 2 <= 225.0:
                    _pts.append((_q.x, _q.z))
            for _c in self.clones.values():
                _co = self.players.get(_c.get('owner'))
                if _co is None or not self._can_hit_player(p, _co):
                    continue
                if (_c['x'] - p.x) ** 2 + (_c['z'] - p.z) ** 2 <= 225.0:
                    _pts.append((_c['x'], _c['z']))
            if _pts:
                _n = max(1, int(round(5 * _dmul)))
                for _i in range(_n):
                    _pp = random.choice(_pts)
                    _hx = _pp[0] + random.uniform(-0.6, 0.6)
                    _hz = _pp[1] + random.uniform(-0.6, 0.6)
                    # ★ round584（用户）：每道雷落在被选中目标的脚下，而不是全挤在中心
                    _tf = dict(k='thunder', x=round(_hx, 2), z=round(_hz, 2),
                               r=0, yaw=0, dur=0.35, n=1,
                               seed=random.randint(1, 999999), by=p.role_id)
                    for _q in self.players.values():
                        if (_q.x - _hx) ** 2 + (_q.z - _hz) ** 2 <= 1600.0:
                            self._send_cid(_q.cid, P.pack('skillfx', **_tf))
                    self._later_hits.append(
                        (_now0 + 0.4 + _i * 0.30, p.cid, _hx, _hz,
                         1.20, 2.5, True, 'thunder'))
            else:
                # 没目标 → 退回灵气/CD（不然白白空放）
                p.qi = min(self._qi_max(p), int(p.qi or 0) + qi_cost)
                p.skCd.pop(key, None)
                self._send_cid(p.cid, P.pack('qi', q=int(p.qi)))
                self._send_cid(p.cid, P.pack(
                    'skillcd', cd=dict((k, round(v, 2)) for k, v in p.skCd.items())))
                self._send_cid(p.cid, P.pack('notice', text='雷霆万钧：15 米内没有目标'))
            return

        # ★ round580（A14 空间跳跃）：真正把人挪到落点（客户端权威 → 发 tp ✓）
        if key == 'blink':
            p.x, p.z = float(x), float(z)
            self._send_cid(p.cid, P.pack('tp', x=round(p.x, 2), z=round(p.z, 2)))

        # ★★ round561（用户："黑洞应该播完动画再造成伤害"）
        #   → 伤害压进队列 ✗ 到点再结算 ✓（delay 由 skills.py 的 delay 字段给）
        try:
            _delay = float(defn.get('delay') or 0.0)
        except Exception:
            _delay = 0.0
        if _delay > 0.01:
            self._later_skill.append((now_s() + _delay, p.cid, key, x, z))
            # ★ round562：吸力（黑洞）+ 其它"拉人"技能
            # ★★ round563（用户："黑洞要在这 1 秒里就吸过来，1 秒后才炸"）
            #   → 吸力从【施法瞬间】开始 ✓ 到【伤害生效那一刻】结束 ✓
            _pull = float(defn.get('pull') or 0.0)
            if _pull > 0:
                _now = now_s()
                self._pulls.append({'due': _now, 'until': _now + _delay,
                                    'x': x, 'z': z, 'r': radius, 'str': _pull,
                                    'by': p.cid})
            return

        # 伤害
        mult = float(defn.get('dmg') or 0.0)
        if mult > 0 and radius > 0:
            base, _mul, can_crit, _crit_pt, _crit_dmg = self._skill_profile(p)
            n_hit = 0
            for m in list(self.mobs.values()):
                if m.hp <= 0:
                    continue
                if (m.x - x) ** 2 + (m.z - z) ** 2 > radius * radius:
                    continue
                dmg = base * mult
                crit = False
                if can_crit:
                    dv, crit = mobs.roll_damage(
                        base, crit_pt=_crit_pt, crit_dmg=_crit_dmg)
                    dmg = max(1, int(round(dv * mult * _mul)))
                else:
                    dmg = max(1, int(round(dmg * _mul)))
                if m.kind == '保安' and random.random() < mobs.BLOCK_CHANCE:
                    dmg = max(1, int(round(dmg * mobs.BLOCK_MUL)))
                dmg = self._mob_defense(p, m, dmg, False)
                if dmg <= 0:
                    continue
                self._record_mob_damage(m, p, dmg)
                m.hp -= dmg
                m.freezeT = 0.0          # ★ round584：受伤破冰
                n_hit += 1
                self._report_hit(p, m.mid, dmg, crit, m.x, m.z,
                                 {'back': False, 'mb': None, 'heal': 0, 'sk': 1})
                if m.hp <= 0:
                    m.hp = 0
                    self._mob_died(p, m)
                    self._sk_chain_kill(p)
            if n_hit == 0 and tgt is None:
                pass
        # 打玩家（PvP 全额 ✓ 用户定）
        if mult > 0 and radius > 0:
            try:
                base2 = self._atk_of(p)
                dv2 = max(1, int(round(base2 * mult)))
                self._aoe_players(p, x, z, radius, dv2, src='skill', is_skill=True)
            except Exception as e:
                print('[skill] pvp 失败：%r' % (e,))

    # ---- 技能的伤害结算（可延迟调用）----

    def _mob_evt(self, m, kind, rng=None):
        try:
            data = {'mid': m.mid, 'kind': str(kind), 'x': round(m.x, 2),
                    'z': round(m.z, 2), 'yaw': round(m.yaw, 3)}
            _r = float(rng if rng is not None else (1000.0 if int(m.rank) >= 2 else 100.0))
            for q in self.players.values():
                if (q.x - m.x) ** 2 + (q.z - m.z) ** 2 <= _r * _r:
                    self._send_cid(q.cid, P.pack('mobevt', **data))
        except Exception:
            pass

    def _mob_zone_create(self, m, sk, radius):
        try:
            now = now_s()
            zone = {'x': float(m.castX), 'z': float(m.castZ), 'r': float(radius),
                    'until': now + 6.0, 'next': now + 0.45,
                    'atk': float(m.atk), 'name': m.name, 'rank': int(m.rank),
                    'pen': float(getattr(m, 'pen_pt', 0.0) or 0.0),
                    'sk': dict(sk)}
            self._mob_zones.append(zone)
            data = {'x': round(zone['x'], 2), 'z': round(zone['z'], 2),
                    'r': zone['r'], 'dur': 6.0, 'rank': zone['rank']}
            for q in self.players.values():
                if (q.x - zone['x']) ** 2 + (q.z - zone['z']) ** 2 <= 1000.0 * 1000.0:
                    self._send_cid(q.cid, P.pack('mobzone', **data))
        except Exception:
            pass

    def _mob_summon(self, m, n):
        cap = 6
        have = sum(1 for x in self.mobs.values()
                   if getattr(x, 'summoner', None) == m.mid)
        n = max(0, min(n, cap - have))
        for _ in range(n):
            self.mob_seq += 1
            ang = random.random() * math.pi * 2
            d = random.uniform(1.5, 3.5)
            x = m.x + math.sin(ang) * d
            z = m.z + math.cos(ang) * d
            add = mobs.Mob(self.mob_seq, max(1, m.lv - 2), x, z)
            add.owner = None
            add.summoner = m.mid
            self.mobs[str(self.mob_seq)] = add

    def _snd_near(self, x, z, name, vol=1.0, exclude=None):
        """★ round583/584：30 米内的玩家收到音效（客户端每 2 米一档衰减）"""
        try:
            for q in self.players.values():
                if exclude is not None and q.cid == exclude:
                    continue
                if (q.x - x) ** 2 + (q.z - z) ** 2 > 900.0:   # 30 米外听不到
                    continue
                self._send_cid(q.cid, P.pack('snd', name=name,
                                             x=round(x, 2), z=round(z, 2),
                                             v=round(float(vol), 3)))
        except Exception:
            pass

    def _clone_damage(self, c, dmg, attacker=None, crit=False):
        """★ round575：分身被打 —— 扣它自己的血；归零就走 _clone_despawn（客户端淡出 ✓）

        ★ attacker：玩家普攻/技能打的分身 → 给他弹伤害数字 ✓
                   僵尸咬的传 None ✗ 不给谁弹（血条会掉 ✓）
        """
        if not c:
            return
        cid = c.get('id')
        c['hp'] = max(0, int(c.get('hp') or 0) - max(1, int(dmg)))
        c['freezeT'] = 0.0        # ★ round584：受伤破冰
        if attacker is not None:
            try:
                self._add_pend(attacker.cid, 'mhits',
                               {'mid': 'clone:' + str(cid), 'dmg': int(dmg),
                                'crit': bool(crit), 'clone': 1,
                                'x': round(c['x'], 2), 'z': round(c['z'], 2)})
            except Exception:
                pass
        if int(c['hp']) <= 0 and cid:
            self._clone_despawn(cid)

    def _aff(self, p, key):
        """★ round474：读一个词条的【武器 + 防具】合计值 ✓

        ★ 为什么要合并：新加的词条分散在两个部位上（经验在防具 ✓）
          而战斗里只想"问一句有没有"✗ 不想分两次写 ✓
        ★ 坏掉的装备不算 ✓
        """
        tot = 0.0
        for it in ((p.weapon or None), (p.armor or None)):
            if not isinstance(it, dict) or it.get('broken'):
                continue
            try:
                tot += float(affixes.totals(it.get('affixes')).get(key, 0.0) or 0.0)
            except Exception:
                pass
        return tot

    def _mob_control_mul(self, m):
        try:
            return float(mob_ranks.cfg(int(getattr(m, 'rank', 0) or 0)).get('control_mul', 1.0))
        except Exception:
            return 1.0

    def _mob_defense(self, p, m, dmg, allow_dodge=True):
        """玩家打精英/Boss：命中/穿透 vs 怪物闪避/减伤。"""
        try:
            if int(getattr(m, 'rank', 0) or 0) <= 0:
                return dmg
            hit = self._aff(p, 'hit_pt') + self._tal(p, 'hit')
            if allow_dodge and random.random() * 100.0 < pve_combat.dodge_chance(
                    m.dodge_pt, hit, 50.0):
                self._add_pend(p.cid, 'mhits', {
                    'mid': m.mid, 'dmg': 0, 'dodge': 1, 'crit': False,
                    'x': round(m.x, 2), 'z': round(m.z, 2)})
                return 0
            pen = self._aff(p, 'pen_pt') + self._tal(p, 'pen')
            dr = pve_combat.effective_dr(m.dr_pct, pen)
            return pve_combat.mitigate(dmg, dr, m.dr_flat)
        except Exception:
            return dmg

    def _record_mob_damage(self, m, p, dmg):
        try:
            if p is None or dmg <= 0:
                return
            cid = str(getattr(p, 'cid', '') or '')
            if not cid:
                return
            m.dmgBy[cid] = int(m.dmgBy.get(cid, 0)) + int(dmg)
            m.dmgTotal = int(getattr(m, 'dmgTotal', 0) or 0) + int(dmg)
        except Exception:
            pass

    def _tank_reset(self, p, save=True):
        """★ round577：坦克引擎重置（方案 §3 B2：死亡或离线 1 小时完全恢复）"""
        try:
            _had = int(getattr(p, 'skTankN', 0) or 0) > 0 or int(getattr(p, 'skTankHp', 0) or 0) > 0
            p.skTankHp = 0
            p.skTankBase = 0
            p.skSize = 1.0
            p.skTankN = 0
            p.tankAt = 0
            if hasattr(p, 'plagueOn'):
                p.plagueOn = False
            if _had and save:
                self.post_save(
                    'UPDATE roles SET sk_tank_hp=0, sk_tank_base=0, sk_tank_size=1.0, '
                    'sk_tank_n=0, sk_tank_at=0 WHERE id=?', (int(p.role_id),))
                self._send_cid(p.cid, P.pack(
                    'notice', text='坦克引擎层数已清空（死亡重置）'))
        except Exception as e:
            print('[skill] 坦克重置失败：%r' % (e,))

    def _has_b(self, p, key):
        try:
            return key in self._sk_b_list(p)
        except Exception:
            return False