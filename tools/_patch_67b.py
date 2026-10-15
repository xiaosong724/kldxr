# -*- coding: utf-8 -*-
"""第 67 轮 ③ 防具接进世界：穿上/脱下 + 属性真生效 + 能掉落"""
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


rep("import affixes\nimport drops",
    "import affixes\nimport armor as armormod\nimport drops", 'import armor')

rep("                 'atkSeq')   # ★★ 第 66 轮：挥砍序号（别人靠它播动作 ✓）",
    "                 'atkSeq',   # ★★ 第 66 轮：挥砍序号（别人靠它播动作 ✓）\n"
    "                 'armor', 'armorItemId')   # ★ 第 67 轮：防具 ✓", 'slots')

rep("""        self.atkSeq = 0""",
"""        self.atkSeq = 0
        # ★ 第 67 轮：防具（穿着的那件 ✓）
        self.armor = role.get('armor') or None
        self.armorItemId = role.get('armorItemId')""", '玩家防具字段')

# ---------------- 生命上限（含防具 ✓）----------------
rep("""    def _break_weapon(self, p):""",
"""    def _hp_max(self, p):
        \"\"\"生命上限（角色基础 + 防具的 hp / hp%% ✓ 第 67 轮）

        ★ 一定要【一处算、处处用】✗
          以前 hpMax 散在好几处（role['hpMax'] or 200 ✗）
          加了防具之后再散着写，迟早出现"治疗治不满 / 复活半血"✗
        \"\"\"
        base = int((p.role or {}).get('hpMax') or 200)
        st = armormod.stats_of(p.armor)
        return max(1, int(round((base + st['hp']) * (1.0 + st['hp_pct'] / 100.0))))

    def _break_weapon(self, p):""", 'hp_max')

# ---------------- 穿防具 ----------------
rep("""        elif t == 'equipset':""",
"""        elif t == 'armorset':
            # ★ 第 67 轮：穿/脱防具（网络线程已经查库校验完了 ✓）
            p.armor = d.get('armor') or None
            p.armorItemId = d.get('itemId')
            nm = (p.armor or {}).get('name')
            self._send_cid(p.cid, P.pack('notice',
                                         text=('穿上：%s' % nm) if nm else '脱下防具'))
            self._send_cid(p.cid, P.pack('armor', a=p.armor or None,
                                         hpm=self._hp_max(p)))
        elif t == 'equipset':""", 'armorset 意图')

# ---------------- 挨打：闪避 / 减伤 / 受击回灵气 ----------------
rep("""        _w = p.weapon or {}
        _fx = weapons.fx_of(_w.get('look'), int(_w.get('tier') or 0))""",
"""        # ★★ 第 67 轮：防具在这里生效（闪避 → 固定减伤 → 受击回灵气 ✓）
        _st = armormod.stats_of(p.armor)
        if _st['dodge'] > 0 and random.random() < (_st['dodge'] / 100.0):
            # 闪开了：这一口完全没打到 ✓ 但也不回灵气（没被打到 ✓）
            self._send_cid(p.cid, P.pack('fx', kind='dodge'))
            return
        _w = p.weapon or {}
        _fx = weapons.fx_of(_w.get('look'), int(_w.get('tier') or 0))""", '闪避')

rep("""        if _fx and _fx['name'] == '招架' and random.random() < _fx['chance']:
            dv = max(1, int(round(dv * (1.0 - _fx['value']))))
            self._send_cid(p.cid, P.pack('fx', kind='parry'))""",
"""        if _fx and _fx['name'] == '招架' and random.random() < _fx['chance']:
            dv = max(1, int(round(dv * (1.0 - _fx['value']))))
            self._send_cid(p.cid, P.pack('fx', kind='parry'))
        # ★ 固定减伤（防具的 dr ✓）：至少挨 1 点（不然穿了甲就无敌了 ✗）
        if _st['dr'] > 0:
            dv = max(1, int(round(dv - _st['dr'])))
        # ★ 受击回灵气（词条 ✓）
        if _st['qi_hurt'] > 0:
            p.qi = min(int((p.role or {}).get('qiMax') or 100), int(p.qi) + int(_st['qi_hurt']))""",
    '固定减伤 + 回气')

# ---------------- 击杀回灵气 ----------------
rep("""    def _mob_died(self, p, m):""",
"""    def _mob_died(self, p, m):
        # ★ 第 67 轮：击杀回灵气（防具词条 ✓）
        try:
            _qi = armormod.stats_of(p.armor)['qi_kill']
            if _qi > 0:
                p.qi = min(int((p.role or {}).get('qiMax') or 100), int(p.qi) + int(_qi))
        except Exception:
            pass""", '击杀回气')

# ---------------- 复活 / 治疗用同一套上限 ----------------
rep("""            p.hp = int(p.role.get('hpMax') or 200)""",
    """            p.hp = self._hp_max(p)      # ★ 第 67 轮：含防具的加成 ✓""", '复活用 _hp_max')

# ---------------- 掉落：25% 概率出防具 ----------------
rep("""        it = drops.roll_drop(m.lv, klv, luck=_tb)""",
"""        it = drops.roll_drop(m.lv, klv, luck=_tb)
        # ★ 第 67 轮：掉到东西时有 25% 概率是【防具】✓
        #   （不然防具永远拿不到 ✗ 只能靠管理页发 ✗）
        if it and random.random() < 0.25:
            _tier_arm = max(0, min(11, int(it.get('tier') or 0)))
            it = {'name': it.get('name'), 'tier': _tier_arm, 'kind': 'armor',
                  'slot': 'armor',
                  'armor': armormod.make_armor(_tier_arm, max(1, klv // 4 + 1))}""",
    '掉落出防具')

io.open(P, 'w', encoding='utf-8', newline='\n').write(t)
print('world.py 防具接入完成')
