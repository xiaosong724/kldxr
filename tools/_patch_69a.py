# -*- coding: utf-8 -*-
"""第 69 轮 ② 弓的投射物

【用户要的】弓应该是远程（现在前几轮都是"近战刺" ✗ 一直没做 ✓）

【设计】
  服务器：弓攻击 → 生成一支箭（位置/方向/伤害/剩余寿命）
          每 tick 推进 → 撞到僵尸就结算（含暴击/词条 ✓）→ 命中或超射程就消失
  协议：快照加 'ar'（箭列表 [id,x,z,yaw] ✓ 新键、append-only ✓）
  客户端：画一支细长箭 ✓ 按快照位置摆 ✓ 消失了就收掉 ✓

  ★ 箭的伤害在【发射时】就定下来（含暴击判定 ✓）——
    不然射手死了/换武器了，空中那支箭的伤害就没依据了 ✗
  ★ 命中判定用【线段】而不是点 ✗ —— 箭一 tick 走 0.9 米，
    僵尸半径才 0.5 米，只用端点判定会【穿过】僵尸（高速穿透 ✗）
"""
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


# ---------------- ① 箭的常量 + 容器 ----------------
rep("REVIVE_INVULN = 1.5",
    """REVIVE_INVULN = 1.5

# ★★ 第 69 轮：箭（弓的投射物）★★
ARROW_SPEED = 26.0        # 米/秒（比僵尸快得多，但不至于一帧穿过一片 ✓）
ARROW_HIT_R = 0.75        # 命中半径（僵尸体积约 0.5 + 一点余量 ✓）
ARROW_MAX = 60            # 同时在飞的箭上限（防刷 ✗）""", '箭常量')

rep("        self.mobs = {}",
    """        self.mobs = {}
        # ★ 第 69 轮：在飞的箭（只在 tick 线程动 ✓）
        self.arrows = {}
        self._arrow_id = 0""", '箭容器')

# ---------------- ② 发射：弓走投射物，不走近战扇形 ----------------
rep("""        # ★ 这把武器的机制（按品阶加成 ✓）
        fx = weapons.fx_of(wlook, wtier)""",
"""        # ★★ 第 69 轮：弓 = 远程投射物（不走下面的近战扇形 ✗）★★
        if wlook in weapons.RANGED:
            if len(self.arrows) < ARROW_MAX:
                self._arrow_id += 1
                _atk = self._atk_of(p)
                _dv, _crit = mobs.roll_damage(
                    _atk, crit_pt=_T.get('crit_pt', 0.0),
                    crit_dmg=_T.get('crit_dmg', 0.0))
                self.arrows[str(self._arrow_id)] = {
                    'id': self._arrow_id,
                    'x': p.x, 'z': p.z, 'yaw': p.yaw,
                    'dx': math.sin(p.yaw), 'dz': math.cos(p.yaw),
                    'dmg': _dv, 'crit': bool(_crit),
                    'life': reach / ARROW_SPEED,      # 飞完射程就落地 ✓
                    'by': p.cid,
                }
            return

        # ★ 这把武器的机制（按品阶加成 ✓）
        fx = weapons.fx_of(wlook, wtier)""", '弓走投射物')

# ---------------- ③ 每 tick 推进 + 命中结算 ----------------
rep("""    def _mob_tick(self, dt):""",
"""    def _arrow_tick(self, dt):
        \"\"\"箭的推进与命中（第 69 轮 ✓ 只在 tick 线程跑）

        ★ 命中判定用【线段】扫过（起点 → 终点）✗ 不是看终点一个点
          箭一 tick 走 26×0.033 = 0.86 米，僵尸半径 0.5 米
          只看终点的话高速箭会【穿过】僵尸 ✗（实测过：打不中 ✓）
        \"\"\"
        if not self.arrows:
            return
        step = ARROW_SPEED * dt
        hr2 = ARROW_HIT_R * ARROW_HIT_R
        for a in list(self.arrows.values()):
            x0, z0 = a['x'], a['z']
            a['x'] = x0 + a['dx'] * step
            a['z'] = z0 + a['dz'] * step
            a['life'] -= dt
            hit = None
            for m in self.mobs.values():
                if m.hp <= 0:
                    continue
                # 点到线段的距离（箭这一段轨迹 ✓）
                vx, vz = a['x'] - x0, a['z'] - z0
                wx, wz = m.x - x0, m.z - z0
                L2 = vx * vx + vz * vz
                u = 0.0 if L2 <= 1e-9 else max(0.0, min(1.0, (wx * vx + wz * vz) / L2))
                cx, cz = x0 + vx * u, z0 + vz * u
                if (m.x - cx) ** 2 + (m.z - cz) ** 2 <= hr2:
                    hit = m
                    break
            if hit is not None:
                shooter = self.players.get(a['by'])
                dv = int(a['dmg'])
                hit.hp -= dv
                if shooter is not None:
                    self._add_pend(shooter.cid, 'mhits',
                                   {'mid': hit.mid, 'dmg': dv, 'crit': bool(a['crit']),
                                    'arrow': True,
                                    'x': round(hit.x, 2), 'z': round(hit.z, 2)})
                else:
                    self._add_pend(None, 'mhits',
                                   {'mid': hit.mid, 'dmg': dv, 'crit': bool(a['crit']),
                                    'arrow': True,
                                    'x': round(hit.x, 2), 'z': round(hit.z, 2)})
                if hit.hp <= 0:
                    hit.hp = 0
                    if shooter is not None:
                        self._mob_died(shooter, hit)
                self.arrows.pop(a['id'] and str(a['id']), None)
                continue
            if a['life'] <= 0:
                self.arrows.pop(str(a['id']), None)

    def _mob_tick(self, dt):""", '箭推进')

# 挂进主循环
rep("""        self._mob_tick(dt)""", """        self._mob_tick(dt)
        self._arrow_tick(dt)      # ★ 第 69 轮：箭（要在僵尸移动之后算 ✓）""", '挂进主循环')

# ---------------- ④ 进快照 ----------------
rep("""        return {'t': 'w', 'd': {'mobs': mobs_out,""",
    """        return {'t': 'w', 'd': {'mobs': mobs_out, 'ar': arrows_out,""", '快照带箭')

io.open(P, 'w', encoding='utf-8', newline='\n').write(t)
print('world.py 改好')
