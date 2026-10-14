# -*- coding: utf-8 -*-
"""世界：世界状态 + tick 线程（P0-6）

★★ 线程纪律 —— 这是整个架构的地基（方案 §13.5）★★

    世界状态（玩家 / 以后的怪物 / 掉落 / 弹道…）**只允许 tick 线程读写**
    网络线程只做两件事：
      ① 把玩家意图丢进 inbox 队列（线程安全的 queue.Queue）
      ② 从 fanout 批量把快照交给各自的连接（走 loop.call_soon_threadsafe）

    → 天生没有锁竞争，也不用给世界状态加任何锁 ✓
    → tick 再慢（以后加僵尸 AI）也不会让人收不到 / 发不出消息 ✓

    DB 读写同样不在 tick 线程里（一次磁盘 IO 就能把整个世界卡住），
    统一丢进 saves 队列，由存档线程慢慢落盘。

数据流：
    网络线程 ──post_*──▶ inbox/saves ──▶ tick线程(step) ──fanout──▶ 网络线程 ──▶ socket
"""

import math
import queue
import random
import threading
import time

import drops
import mobs
import weapons
import worldgen
import protocol as P

TICK_HZ = 30
TICK_DT = 1.0 / TICK_HZ
VIEW = 60.0                     # 视野半径（与旧客户端一致）
MAX_DRAIN = 4000                # 单个 tick 最多处理多少条意图（防止一条洪水把 tick 打饿）
MAX_INTENT_PER_TICK = 90        # 单连接每 tick 的意图上限（30Hz 正常也就 30 条，3 倍冗余）
SPAWN_SAFE = 20.0               # 出生点/安全区半径：这里不刷怪（方案 §2.1 末日堡垒）


def now_s():
    return time.time()


class Player(object):
    """一个已进入世界的玩家。★ 只有 tick 线程碰"""
    __slots__ = ('cid', 'role', 'x', 'z', 'yaw', 'ct', 'hp', 'qi', 'atk',
                 'intents', 'joined', 'name', 'role_id', 'warned', 'atkT', 'lastMe',
                 'weapon', 'weaponItemId')   # ★ 手上那把武器（第 47 轮）

    def __init__(self, cid, role):
        self.cid = cid
        self.role = role
        self.name = role.get('name') or '?'
        self.role_id = role.get('id')
        self.x = float(role.get('x') or 0.0)
        self.z = float(role.get('z') or 0.0)
        self.yaw = float(role.get('yaw') or 0.0)
        self.ct = 0.0
        self.hp = int(role.get('hp') or 0)
        self.qi = int(role.get('qi') or 0)
        self.atk = 0
        self.atkT = 0.0          # ★ 挥刀冷却（服务器自己也算一份，防连点刷伤害）
        self.lastMe = None       # ★ 上次推给他的 exp/等级（变了才推，省带宽）
        self.intents = 0
        self.joined = now_s()
        self.warned = set()      # 已经提示过"还没实现"的消息类型（别刷屏）
        # ★★ 手上那把武器（第 47 轮）★★
        #   由 net.py 在登录时查出来放进 role['weapon'] ✓
        #   查不到就发一把【默认单手剑】—— 数值正好等于以前写死的 2.4/1.05/0.62，
        #   所以"还没有武器"的老角色手感一点没变 ✓ 不会让人觉得改坏了 ✓
        self.weapon = role.get('weapon') or weapons.make_weapon('sword', 0, 1.0, 1)
        self.weaponItemId = role.get('weaponItemId')     # 背包里的那件（默认武器是 None ✓）


class World(object):
    def __init__(self, cfg):
        self.cfg = cfg
        self.loop = None
        self.running = False

        # ---- 跨线程队列 ----
        self.inbox = queue.Queue()      # 网络线程 → tick 线程
        self.saves = queue.Queue()      # 任何线程 → 存档线程
        self._joinq = queue.Queue()     # 认证通过的人（网络线程放，tick 消费）

        # ---- 世界状态（★ 只有 tick 线程读写）----
        self.players = {}               # cid -> Player
        self.mobs = {}                  # mid -> mobs.Mob（P2：僵尸也归 tick 线程独占 ✓）
        self.mob_seq = 0
        self.loot = {}                  # lid -> {'x','z','item','ttl'}（P2 第二刀：地上掉的 ✓）
        self.loot_seq = 0
        self.role_seq = 0               # 给"公共妖兽"发号用（也用 mob_seq，这里只做语义区分）
        self._spawn_acc = 0.0           # 刷怪节流
        self.pvp = False                # ★ PvP 总开关（服务器权威；客户端只是请求开/关 ✓）
        self._pend = {}                 # cid -> {'hurts': [...], 'mhits': [...], 'me': {...}}
        # ★ 本 tick 的治疗事件（第 46 轮）：[[医生x, 医生z, 目标x, 目标z, 回了多少], ...]
        #   医生一多，玩家必须能看出【谁给谁回了多少】✗ → 所以发事件、客户端画连线+数字 ✓
        self.heals = []
        # ★★ 第 48 轮：后台管理 ★★
        #   admin_stat = 给管理页看的【只读快照】，每隔十几 tick 换一个新 dict
        #   （HTTP 线程读它：读一次引用是安全的 ✓ 绝不让 HTTP 线程直接遍历世界状态 ✗）
        self.admin_stat = {'tick': 0, 'online': 0, 'mobs': 0, 'loot': 0, 'players': []}
        self._admin_acc = 0
        self.srv_conns = {}             # ★ 由 net.Net 填：连接表（只在 asyncio 循环里访问）
        self.tick_count = 0
        self.tick_ms = 0.0              # 上一帧耗时
        self.tick_max_ms = 0.0          # 历史峰值（排查卡顿）
        self.dropped_intents = 0

        self._th = None
        self._saver = None

    # ============================================================ 网络线程调用

    def post_join(self, conn, role):
        """认证通过：入队，等 tick 线程把他放进世界"""
        self._joinq.put((conn, role))

    def post_leave(self, cid):
        self.inbox.put(('leave', cid, None))

    def post_intent(self, cid, t, d):
        self.inbox.put(('intent', cid, (t, d)))

    def post_admin(self, act, payload=None):
        """HTTP 线程（管理页）→ tick 线程 的管理操作

        ★ 和玩家意图走同一个 inbox ✓ 所以照样是【只有 tick 线程改世界状态】✓
        """
        self.inbox.put(('admin', None, (act, payload or {})))

    def _publish_admin(self):
        """每十几 tick 发布一次给管理页看的快照（只读 ✓）

        ★ 为什么是"发布"而不是"直接查"：世界状态只有 tick 线程能碰 ✗
          HTTP 线程直接遍历 players/mobs 就是数据竞争 ✗
          这里换一个新 dict，HTTP 那边读引用 —— 安全又便宜 ✓
        """
        ps = []
        for q in self.players.values():
            ps.append({'name': q.name, 'level': int(q.role.get('level') or 1),
                       'hp': int(q.hp), 'x': round(q.x, 1), 'z': round(q.z, 1),
                       'weapon': ((q.weapon or {}).get('name') or '（默认单手剑）')})
        self.admin_stat = {
            'tick': self.tick_count, 'online': len(self.players),
            'mobs': len(self.mobs), 'loot': len(self.loot),
            'tickMs': round(self.tick_ms, 3), 'tickMaxMs': round(self.tick_max_ms, 3),
            'dropped': self.dropped_intents, 'pendingSave': self.saves.qsize(),
            'players': ps,
        }

    def post_save(self, sql, params=()):
        self.saves.put((sql, params))

    # ============================================================ tick 线程

    def start(self, loop):
        """启动 tick 线程 + 存档线程"""
        self.loop = loop
        self.running = True
        self._th = threading.Thread(target=self._run, name='world-tick', daemon=True)
        self._th.start()
        self._saver = threading.Thread(target=self._run_saver, name='world-saver', daemon=True)
        self._saver.start()
        return self._th

    def stop(self):
        self.running = False

    def _run(self):
        next_t = time.perf_counter()
        while self.running:
            t0 = time.perf_counter()
            try:
                self._step()
            except Exception as e:
                print('  [tick] 出错：%r' % e)
            dt = (time.perf_counter() - t0) * 1000.0
            self.tick_ms = dt
            if dt > self.tick_max_ms:
                self.tick_max_ms = dt
            # 固定步长：落后了就重置基准，不追帧（追帧会让延迟越积越大）
            next_t += TICK_DT
            slp = next_t - time.perf_counter()
            if slp > 0:
                time.sleep(slp)
            else:
                next_t = time.perf_counter()

    def _step(self):
        # ① 新人入世
        while True:
            try:
                conn, role = self._joinq.get_nowait()
            except queue.Empty:
                break
            self.players[conn.cid] = Player(conn.cid, role)

        # ② 处理意图（有上限，防一条连接把 tick 打饿）
        n = 0
        while n < MAX_DRAIN:
            try:
                kind, cid, payload = self.inbox.get_nowait()
            except queue.Empty:
                break
            n += 1
            if kind == 'admin':
                # ★ 管理操作（第 48 轮）：没有 cid，走单独一支 ✓
                try:
                    self._handle_admin(payload[0], payload[1])
                except Exception:
                    pass
                continue
            if kind == 'leave':
                p = self.players.pop(cid, None)
                if p:
                    self._save_player(p)
            else:
                p = self.players.get(cid)
                if p is None:
                    continue
                p.intents += 1
                if p.intents > MAX_INTENT_PER_TICK:
                    self.dropped_intents += 1
                    continue
                self._handle_intent(p, payload[0], payload[1])

        # ③ 僵尸：刷怪 / 回收 / AI（P2 第一刀）
        #    ★ 和玩家一样【只在 tick 线程跑】→ 一张快照发出去时，世界是"冻结"的 ✓
        self._mob_tick(TICK_DT)
        self._loot_tick(TICK_DT)          # ★ 地上掉的也归 tick 线程管 ✓
        for p in self.players.values():
            if p.atkT > 0:
                p.atkT -= TICK_DT

        # ④ 生成快照并批量交给网络线程（一次跨线程调用，不是每个玩家一次）
        if self.players:
            batch = []
            for p in self.players.values():
                d = {'ts': round(now_s(), 3), 'players': self._snapshot_for(p)}
                ms = self._mobs_for(p)
                if ms:
                    d['mobs'] = ms
                lt = self._loot_for(p)          # ★ 地上掉的（第 38 轮）
                if lt:
                    d['loot'] = lt
                # ★ 本 tick 攒的反馈：hurts=我挨的打，mhits=我打中僵尸（弹伤害数字用）✓
                pend = self._pend.get(p.cid)
                if pend:
                    if pend.get('hurts'):
                        d['hurts'] = pend['hurts']
                    if pend.get('mhits'):
                        d['mhits'] = pend['mhits']
                if pend and pend.get('me'):
                    d['me'] = pend['me']          # 升级/涨经验了才带 ✓
                # ★ 治疗事件（第 46 轮）：只发这个玩家看得见的（别把全图的都塞给他 ✗）
                if self.heals:
                    hv = []
                    v2 = mobs.MOB_VIEW * mobs.MOB_VIEW
                    for he in self.heals:
                        if (he[2] - p.x) ** 2 + (he[3] - p.z) ** 2 <= v2:
                            hv.append(he)
                    if hv:
                        d['heals'] = hv
                batch.append((p.cid, P.pack_str('world', d)))
            self._to_net(self._fanout, batch)
        self._pend = {}
        self.heals = []                       # ★ 治疗事件每 tick 清空（第 46 轮）

        # ⑤ 重置每 tick 的计数
        for p in self.players.values():
            p.intents = 0
        self.tick_count += 1
        # ★ 第 48 轮：每 15 tick 发一次管理页快照（15 × 33ms ≈ 半秒，够实时了 ✓）
        self._admin_acc += 1
        if self._admin_acc >= 15:
            self._admin_acc = 0
            self._publish_admin()

    def _handle_intent(self, p, t, d):
        if t == 'move':
            p.x = _f(d.get('x'), p.x)
            p.z = _f(d.get('z'), p.z)
            p.yaw = _f(d.get('yaw'), p.yaw)
            p.ct = _f(d.get('t'), p.ct)
            if 'hp' in d:
                p.hp = int(_f(d.get('hp'), p.hp))
            if 'qi' in d:
                p.qi = int(_f(d.get('qi'), p.qi))
            # ★★ 第 39 轮：客户端上报的 atk 【不再采信】★★
            #    攻击力由服务器按角色等级自己算（mobs.player_atk，方案 §4.5）——
            #    以前直接存客户端的值，改个包就能一刀秒天秒地 ✗
            #    （客户端那边照旧发这个字段，服务器只是不理它了 ✓）
        elif t == 'ping':
            self._send_cid(p.cid, P.pack('pong', t=d.get('t'), st=round(now_s(), 3)))
        elif t == 'chat':
            txt = str(d.get('text') or '')[:200]
            if txt:
                self._to_net(self._broadcast, P.pack_str(
                    'chat', {'from': p.name, 'text': txt, 'ch': d.get('ch') or 'world'}))
        elif t == 'atk':
            self._intent_atk(p, d)
        elif t == 'pick':
            self._intent_pick(p, d)           # ★ 捡东西（第 38 轮）
        elif t == 'spawn':
            # ★★ 第 48 轮：这个能力【搬到管理页】了 ✗ ★★
            #   以前任何玩家发一个 spawn 就能自己刷一堆怪（还能指定职业/等级/清场）✗
            #   要临时给玩家用，只能改 config 的 allow_player_debug=true（本地调试用 ✓）
            if not (self.cfg or {}).get('allow_player_debug'):
                if 'spawn' not in p.warned:
                    p.warned.add('spawn')
                    self._send_cid(p.cid, P.pack('error', msg='刷怪已移到管理页（/admin）'))
                return
            self._debug_spawn(p, int(_f(d.get('n'), 5)), bool(d.get('clear')),
                              d.get('kind') or None,
                              d.get('lv'))
        elif t == 'giveweapon':
            # ★ 同上：发武器也搬到管理页了 ✗（玩家端默认不给 ✓）
            if not (self.cfg or {}).get('allow_player_debug'):
                if 'giveweapon' not in p.warned:
                    p.warned.add('giveweapon')
                    self._send_cid(p.cid, P.pack('error', msg='发武器已移到管理页（/admin）'))
                return
            # ★ 调试：直接往背包里塞一件武器（打开背包就能穿）★
            #   为什么要这个：装备栏还没做的时候，玩家/测试【没法验证武器手感】✗
            #   有了它，双击一下就能立刻试"匕首快 / 斧头慢" ✓
            import json
            import db as dbmod
            lv = max(1, int(p.role.get('level') or 1))
            w = weapons.roll_weapon(lv + 6, lv)
            w['reqLevel'] = 1                     # 调试给的就不卡等级了 ✓
            self.post_save(
                'INSERT INTO items(role_id, in_storage, slot_index, stack, item_json, created_at)'
                ' VALUES(?,0,-1,1,?,?)',
                (p.role_id, json.dumps(w, ensure_ascii=False), dbmod.now_ms()))
            self._send_cid(p.cid, P.pack('notice',
                                         text='调试：背包里多了一件【%s】—— 打开背包就能穿上 ✓' % w['name']))
        elif t == 'equipset':
            # ★ 第 47 轮：网络线程已经查库 + 校验完了，这里只换内存里的引用 ✓
            #   （tick 线程不许碰磁盘 ✗ 所以查库那步在 net.py 做）
            w = d.get('weapon')
            p.weapon = w or weapons.make_weapon(weapons.DEFAULT_TYPE, 0, 1.0, 1)
            p.weaponItemId = d.get('itemId')
            bb = (w or {}).get('base') or {}
            self._send_cid(p.cid, P.pack('notice', text=(
                '装上：%s（%d 阶）攻速 ×%.2f 射程 %.1f 米'
                % (w.get('name'), w.get('tier') or 0, bb.get('atkSpeed') or 1.0,
                   bb.get('reach') or 2.4)) if w else '卸下武器（换回默认单手剑）'))
            # ★ 把新的武器告诉客户端 —— 客户端的挥刀冷却/射程预测要跟着换 ✓
            self._send_cid(p.cid, P.pack('weapon', w=w or None))
        elif t == 'pvp':
            self.pvp = bool(d.get('on')) if 'on' in d else self.pvp
            self._broadcast(P.pack('notice', text='PvP 已%s' % ('开' if self.pvp else '关')))
        elif t in ('skill', 'team', 'revive', 'dead', 'respawn'):
            # 这些要等 P3/P4 的世界规则。
            # ★ 只提示一次（不然每挥一刀都弹一句，把玩家烦死）
            if t not in p.warned:
                p.warned.add(t)
                self._send_cid(p.cid, P.pack('error', msg='%s 还没实现' % t))

    # ============================================================ 僵尸（P2 第一刀）

    def _mob_tick(self, dt):
        """刷怪 / 回收 / 追击 / 咬人 —— ★ 只在 tick 线程里跑"""
        if not self.players:
            if self.mobs:
                self.mobs.clear()       # 没人了 → 全收掉（省 CPU；下次来的是新世界 ✓）
            return
        ps = list(self.players.values())

        # ---- ① 刷怪（节流 + 上限）----
        self._spawn_acc += dt
        if self._spawn_acc >= mobs.SPAWN_INTERVAL:
            self._spawn_acc = 0.0
            for _ in range(mobs.SPAWN_PER_TRY):
                if len(self.mobs) >= mobs.MOB_CAP and not self._evict_far():
                    break
                self._spawn_one(ps)

        # ---- ② 每只僵尸：找最近的【活着的】玩家 → 追 / 咬；没目标就漫无目的地散开 ----
        #   ★★ 死掉的玩家不算目标（第 37 轮，用户反馈"玩家死后僵尸还在攻击"）★★
        #      hp<=0 就当他不存在 → 僵尸立刻失去目标，转去漫游散开 ✓
        #      但"消失计时"仍然用【所有】玩家算距离（尸体旁边也算有人，怪不该凭空消失 ✓）
        live = [q for q in ps if int(q.hp or 0) > 0]
        away2 = mobs.AWAY_DIST * mobs.AWAY_DIST
        agg2 = mobs.AGGRO * mobs.AGGRO
        for m in list(self.mobs.values()):
            if m.hp <= 0:
                m.deadT += dt
                if m.deadT >= mobs.MOB_KEEP_DEAD:
                    self.mobs.pop(m.mid, None)
                continue
            near, nd2 = None, None
            for q in live:
                dx = q.x - m.x
                dz = q.z - m.z
                d2 = dx * dx + dz * dz
                if nd2 is None or d2 < nd2:
                    nd2 = d2
                    near = q
            # ★ 消失计时（用户要求）：离所有玩家都超过 20 米 → 开始计时；
            #   连续 60 秒都这样 → 自然消失 ✓（有人靠近就清零 ✓）
            allnd2 = None
            for q in ps:
                d2 = (q.x - m.x) ** 2 + (q.z - m.z) ** 2
                if allnd2 is None or d2 < allnd2:
                    allnd2 = d2
            if allnd2 is None or allnd2 > away2:
                m.awayT += dt
            else:
                m.awayT = 0.0
            if m.awayT >= mobs.AWAY_GRACE:
                self.mobs.pop(m.mid, None)
                continue
            if m.atkT > 0:
                m.atkT -= dt
            # ★ 挥爪动画：衰减到 -1（没在攻击时必须是 -1，不然客户端会一直摆攻击姿势 ✗）
            if m.atkAnim >= 0:
                m.atkAnim -= dt
                if m.atkAnim < 0:
                    m.atkAnim = -1.0
            if m.healCd > 0:                 # ★ 被治疗冷却（第 46 轮）—— 衰减到 0 才能再被治 ✓
                m.healCd -= dt
            if near is not None and nd2 <= agg2:
                # ---- 有目标：追 / 咬（外卖残血时改成逃，见下）----
                m.tgt = near.cid
                d = math.sqrt(nd2) if nd2 > 0 else 0.0
                # ★ 外卖骑手：残血就逃（方案 §3.3"移速最快，会逃跑"）
                if m.kind == '外卖' and m.fleeT <= 0 and m.hp < m.mhp * mobs.FLEE_HP:
                    m.fleeT = mobs.FLEE_TIME
                if m.fleeT > 0:
                    m.fleeT -= dt
                    m.yaw = math.atan2(m.x - near.x, m.z - near.z)   # 背对着人 ✓
                    step = m.spd * dt
                    self._move_mob(m, math.sin(m.yaw) * step, math.cos(m.yaw) * step)
                    continue
                m.yaw = math.atan2(near.x - m.x, near.z - m.z)
                if d > mobs.CONTACT:
                    step = m.spd * dt
                    if step > d - mobs.CONTACT:
                        step = max(0.0, d - mobs.CONTACT)
                    self._move_mob(m, math.sin(m.yaw) * step, math.cos(m.yaw) * step)
                    m.windT = 0.0            # ★ 走开了就取消蓄力（重新贴身要重新起手 ✓）
                else:
                    # ★★ 僵尸的起手（第 41 轮，方案 §5.1）★★
                    #   用户反馈"贴近了就算直接打，应该慢一点点" ✓
                    #   现在是：贴到身前 → 蓄力 WINDUP 秒 → 咬 → 收招 RECOVER 秒
                    #   客户端从"开始蓄力"这一刻就抬手（atkAnim 给满）→ 有前摇可看 ✓
                    if m.atkT <= 0 and m.windT <= 0:
                        m.windT = mobs.windup_of(m.kind)
                        m.atkAnim = mobs.ATK_ANIM
                    if m.windT > 0:
                        m.windT -= dt
                        if m.windT <= 0:
                            m.windT = 0.0
                            m.atkT = mobs.RECOVER      # 咬完收招，之后才能重新起手 ✓
                            self._mob_bite(m, near)
            else:
                # ---- 没目标：漫无目的地散开（用户要求）----
                #      ★ 玩家死后没有目标时，僵尸就散开了 ✓
                m.tgt = None
                self._mob_wander(m, dt)

        # ---- ③ 僵尸之间不要堆在一起（用户要求）----
        self._mob_separate(dt)

        # ---- ④ 职业行为（第 40 轮，方案 §3.3）----
        self._mob_heal(dt)          # 医生给周围僵尸回血 ✓

    def _mob_heal(self, dt):
        """医生：定期把周围僵尸的血拉回来（方案 §3.3"给周围僵尸回血"）

        ★ 第 46 轮重写（用户反馈"治疗效果看不出关联 + 医生一多就打不动僵尸"）：
          ① 一只僵尸【同一个周期内只会被治疗一次】（m.healCd ✓）——
             所以医生多只是"能同时救更多不同的僵尸"，不是"同一只被奶更多次" ✓
             （原来是每个医生各自结算 → 线性叠加 ✗ 几个医生就能把僵尸奶成不死 ✗）
          ② 每次治疗都记一条事件发下去 → 客户端能画出"医生 → 僵尸"的连线和数字 ✓
             原来只在服务器内部改血量 ✗ 玩家完全看不出来谁给谁回了多少 ✗
        ★ 只在 tick 线程跑 ✓ 量很小 ✓
        """
        medics = [m for m in self.mobs.values() if m.hp > 0 and m.kind == '医生']
        if not medics:
            return
        r2 = mobs.HEAL_R * mobs.HEAL_R
        for doc in medics:
            doc.healT -= dt
            if doc.healT > 0:
                continue
            doc.healT = mobs.HEAL_PERIOD * (0.85 + random.random() * 0.3)   # 别整齐划一 ✓
            hurt = []
            for m in self.mobs.values():
                if m.hp <= 0 or m is doc:
                    continue
                if m.hp >= m.mhp * mobs.HEAL_MAX_HP:
                    continue                    # 血还很足的不奶（别浪费 ✓）
                if m.healCd > 0:
                    continue                    # ★★ 关键：这只刚被治过，别的医生也插不上 ✓★
                if (m.x - doc.x) ** 2 + (m.z - doc.z) ** 2 > r2:
                    continue
                hurt.append(m)
            if not hurt:
                continue
            hurt.sort(key=lambda m: m.hp / float(m.mhp or 1))   # 先奶最惨的 ✓
            for m in hurt[:mobs.HEAL_MAX_TARGETS]:
                add = max(1, int(round(m.mhp * mobs.HEAL_PCT)))
                before = m.hp
                m.hp = min(m.mhp, m.hp + add)
                real = m.hp - before
                if real <= 0:
                    continue
                m.healCd = mobs.HEAL_PERIOD     # ★ 这一只下个周期前不再被任何人治 ✓
                # ★ 治疗事件：[医生x, 医生z, 目标x, 目标z, 回了多少] → 客户端画连线+数字 ✓
                self.heals.append([round(doc.x, 2), round(doc.z, 2),
                                   round(m.x, 2), round(m.z, 2), real])

    def _move_mob(self, m, dx, dz):
        """僵尸移动 —— ★ 会被建筑挡住（第 41 轮，用户要求"僵尸不应该穿墙"）

        · 分轴尝试（和客户端 blocked() 一个思路）：能走 x 就走 x、能走 z 就走 z
          → 贴着墙【滑】过去 ✓ 不会一头顶死在那里 ✗
        · **工人可以穿过去** —— 用户明确说了"建筑工除外" ✓（能钻废墟抄近路，算个职业特色）
        ★ 判定用的是【服务端自己算的】建筑（worldgen），不是客户端上传的 ✗
          所以改包说"我这边没有墙"没用 ✓
        """
        if m.kind == '工人':
            m.x += dx
            m.z += dz
            return
        hw = mobs.MOB_BODY / 2.0
        nx = m.x + dx
        if not worldgen.blocked(nx, m.z, hw, hw):
            m.x = nx
        nz = m.z + dz
        if not worldgen.blocked(m.x, nz, hw, hw):
            m.z = nz

    def _mob_wander(self, m, dt):
        """没目标时的漫游：过一会儿换个方向，慢慢挪 ✓"""
        m.wT -= dt
        if m.wT <= 0:
            m.wT = mobs.WANDER_EVERY * (0.6 + random.random() * 0.8)   # 别整齐划一 ✓
            a = random.random() * math.pi * 2
            m.wx = math.sin(a)
            m.wz = math.cos(a)
        sp = m.spd * mobs.WANDER_SPEED * dt
        self._move_mob(m, m.wx * sp, m.wz * sp)
        m.yaw = math.atan2(m.wx, m.wz)

    def _mob_separate(self, dt):
        """两只僵尸靠太近就慢慢推开 —— ★ 渐进推，不是瞬移（瞬移会看得一抖 ✗）

        60 只 → 1770 对/帧，30Hz 下也就几万次乘法，可以忽略 ✓
        （真到几百只再上空间网格，方案 §13.2 有现成的 SGrid 思路 ✓）
        """
        ms = [m for m in self.mobs.values() if m.hp > 0]
        sep = mobs.SEP_DIST
        sep2 = sep * sep
        lim = mobs.SEP_SPEED * dt
        for i in range(len(ms)):
            a = ms[i]
            for j in range(i + 1, len(ms)):
                b = ms[j]
                dx = b.x - a.x
                dz = b.z - a.z
                d2 = dx * dx + dz * dz
                if d2 >= sep2 or d2 < 1e-9:
                    continue
                d = math.sqrt(d2)
                push = min((sep - d) * 0.5, lim)
                if push <= 0:
                    continue
                ux = dx / d
                uz = dz / d
                a.x -= ux * push
                a.z -= uz * push
                b.x += ux * push
                b.z += uz * push

    def _evict_far(self):
        """僵尸满了 → 把"离所有玩家最远"的那只收掉，腾一个位置出来 ✓

        ★ 为什么需要这个（第 35 轮踩的坑）：
          原来的规则是"离所有玩家都超过 140 米才回收"。
          于是老玩家附近刷满 60 只之后，**新来的玩家周围一只都刷不出来** ✗
          （僵尸都堆在别人那边不动，上限却已经占满了）
          现在改成"满了就淘汰最远的" → 人口永远跟着玩家跑 ✓
        """
        if not self.players:
            return False
        worst, wd = None, -1.0
        for m in self.mobs.values():
            if m.hp <= 0:
                continue
            try:
                dmin = min((q.x - m.x) ** 2 + (q.z - m.z) ** 2 for q in self.players.values())
            except ValueError:
                return False
            if dmin > wd:
                wd = dmin
                worst = m
        if worst is None:
            return False
        self.mobs.pop(worst.mid, None)
        return True

    def _near_count(self, x, z, r):
        """这个点周围 r 米内有多少只活僵尸（每人上限 8 只要用 ✓）"""
        r2 = r * r
        n = 0
        for m in self.mobs.values():
            if m.hp > 0 and (m.x - x) ** 2 + (m.z - z) ** 2 <= r2:
                n += 1
        return n

    def _spawn_one(self, ps):
        """在一个随机玩家周围刷一只（等级按方案 §3.1 抽）

        ★ 每人上限（用户要求）：只在"周围还没到 8 只"的玩家附近刷 ✓
        """
        cand = [q for q in ps
                if self._near_count(q.x, q.z, mobs.MOB_NEAR_R) < mobs.MOB_PER_PLAYER]
        if not cand:
            return
        p = random.choice(cand)
        ang = random.random() * math.pi * 2
        dist = mobs.SPAWN_MIN + random.random() * (mobs.SPAWN_MAX - mobs.SPAWN_MIN)
        x = p.x + math.sin(ang) * dist
        z = p.z + math.cos(ang) * dist
        if x * x + z * z < SPAWN_SAFE * SPAWN_SAFE:
            return                       # 安全区里不刷（方案 §2.1 末日堡垒）✓
        # 组队时：以刷新点 SPAWN_TEAM_R 内【随机一个】队员的等级为准（§3.1）✓
        near = [q for q in ps if (q.x - x) ** 2 + (q.z - z) ** 2 <= mobs.SPAWN_TEAM_R ** 2]
        base = (random.choice(near) if near else p).role.get('level', 1) or 1
        self.mob_seq += 1
        self.mobs[str(self.mob_seq)] = mobs.Mob(self.mob_seq, mobs.roll_level(base), x, z)

    def _find_player(self, name):
        """按名字找在线玩家（管理页用 ✓ 找不到返回 None）"""
        if not name:
            return None
        for q in self.players.values():
            if q.name == name:
                return q
        return None

    def _handle_admin(self, act, d):
        """管理页的操作（第 48 轮）—— ★ 只有 tick 线程会进来 ✓

        ★ 管理页通过 HTTP 进来，但真正改世界状态的是这里（tick 线程）✓
          所以"只有 tick 线程碰世界"这条规矩没破 ✓
        """
        if act == 'notify':
            q = self._find_player(d.get('name'))
            if q is not None:
                self._send_cid(q.cid, P.pack('notice', text=str(d.get('text') or '')[:120]))
            return
        if act == 'say':
            txt = str(d.get('text') or '')[:80]
            if txt:
                self._broadcast(P.pack('notice', text='[管理] ' + txt))
            return
        q = self._find_player(d.get('name'))
        if q is None:
            return
        if act == 'spawn':
            n = max(0, min(int(d.get('n') or 5), mobs.MOB_CAP))
            self._debug_spawn(q, n, bool(d.get('clear')), d.get('kind') or None, d.get('lv'))
            if n:
                self._send_cid(q.cid, P.pack('notice',
                                             text='管理员在你附近放了 %d 只僵尸' % n))
        # ★ give 不在这里做 —— 它是【写库】，放在 HTTP 层（离线玩家也能收到 ✓）
        #   见 app.py 的 _admin_give()
        elif act == 'kick':
            self._send_cid(q.cid, P.pack('kick', code='admin', msg='管理员把你请下线了'))
        elif act == 'heal':
            q.hp = int(q.role.get('hpMax') or 200)     # 满血（管理页的"救一下"✓）
            self._send_cid(q.cid, P.pack('notice', text='管理员把你治好了'))

    def _debug_spawn(self, p, n, clear, kind=None, lv=None):
        """调试：在我附近直接刷 n 只 / 清空（不做安全区判断 —— 就是要能立刻试 ✓）

        ★ 第 46 轮加了 kind：可以指定职业（不指定就随机 ✓）
          为什么需要：验证"医生的治疗"这类【按职业】的行为时，
          随机刷可能刷半天刷不出医生 ✗ 测试和调试都不该靠运气 ✓
        """
        if clear:
            self.mobs.clear()
            return
        n = max(0, min(int(n), mobs.MOB_CAP))
        for _ in range(n):
            # ★ 调试刷怪不受上限"挡住"：满了就淘汰最远的那只腾位置 ✓
            #   （以前这里是 break → 上限被远处的僵尸占满时，调试按钮点了没反应 ✗）
            if len(self.mobs) >= mobs.MOB_CAP and not self._evict_far():
                break
            ang = random.random() * math.pi * 2
            dist = 3.0 + random.random() * 6.0
            self.mob_seq += 1
            # ★ 第 46 轮加了 lv：可以指定等级（不指定就按玩家等级随机 ✓）
            #   为什么需要：验证"打残 → 医生回血"时，怪的血量必须落在
            #   【一刀打不死、但能打到 85% 以下】那个区间里 —— 随机刷做不到 ✓
            _lv = int(lv) if lv else mobs.roll_level(p.role.get('level', 1) or 1)
            self.mobs[str(self.mob_seq)] = mobs.Mob(
                self.mob_seq, _lv, p.x + math.sin(ang) * dist, p.z + math.cos(ang) * dist,
                kind=kind)

    def _mob_bite(self, m, p):
        """僵尸咬玩家 —— 伤害由服务器算（§5：僵尸和人走同一套公式）

        ★ 挥爪动画【不在这里】点 —— 已经在"开始蓄力"那一刻点了（第 41 轮）✓
          那样才有前摇可看：抬手 → 咬 → 收招 ✓ 在这里再点一次会把动画重置，看着像抖一下 ✗
        """
        dv, crit = mobs.roll_damage(m.atk)
        p.hp = max(0, int(p.hp) - dv)
        self._add_pend(p.cid, 'hurts', {'dmg': dv, 'x': round(m.x, 2), 'z': round(m.z, 2),
                                        'by': m.kind, 'kind': 'mob', 'crit': bool(crit)})

    def _atk_of(self, p):
        """玩家的攻击力 —— ★★ 服务器算，不看客户端报什么（第 39 轮 + 第 47 轮接武器）★★

        方案 §4.5 固有属性：攻击 = 10 + 3L + 0.08L²
        方案 §7.5 接武器：攻击 = 固有 + (固有 × 武器系数 + 武器平伤)，装备贡献封顶 60% ✓
        ★ 客户端只在切换武器时【上报意图】，具体是哪把、系数多少 —— 一律服务器说了算 ✓
        """
        lv = int(p.role.get('level') or 1)
        inherent = mobs.player_atk(lv)
        w = p.weapon or {}
        base = w.get('base') or {}
        coeff = float(base.get('coeff') or 1.0)
        # ★ 第 51 轮：用【物品自己的等级】算平伤加成 ✓（原来错用了玩家等级 ✗）
        # ★ 第 53 轮：等级不够不是"不能装"，而是【发挥度打折】✓
        return weapons.player_atk_with(inherent, w.get('look'), coeff,
                                       w.get('tier') or 0, int(w.get('itemLv') or 1),
                                       weapons.mastery_of(w, lv))

    def _intent_atk(self, p, d):
        """玩家挥了一刀 —— ★★ 服务器算伤害（客户端只报"我挥了"，不报打中谁）★★

        为什么不信任客户端报的目标：那样改个包就能隔空打死别人 / 怪 ✗
        服务器自己按【攻击者的权威位置 + 朝向】重算一遍扇形里的目标 ✓
        规则和客户端那条完全一样（mobs.in_front / ATK_RANGE / ATK_ARC）—— 两边常量必须一致 ✓

        ★ 协议里还留着 mid / uid 字段，但这里【故意不看】—— 一律以服务器的扇形为准 ✓
          （客户端传什么都改变不了打中谁，最多只是"我挥了"这个事实）
        """
        if p.atkT > 0:
            return
        # ★★ 第 47 轮：冷却 / 射程 / 攻击弧 全部按【手上那把武器】算（方案 §5.1 / §7.4）★★
        #   以前这三个是写死的常量（= 单手剑）—— 现在匕首就快而短、长枪就慢而长 ✓
        wlook = (p.weapon or {}).get('look') or weapons.DEFAULT_TYPE
        p.atkT = weapons.interval_of(wlook)
        reach = weapons.reach_of(wlook)
        arc = weapons.arc_of(wlook)
        # ① 僵尸：扇形里的全打（一刀扫一片 ✓）
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
                self._mob_died(p, m)
        # ② 玩家：只有 PvP 开着才打得到（服务器权威开关 ✓，不是客户端说了算）
        if self.pvp:
            for q in self.players.values():
                if q is p:
                    continue
                if not mobs.in_front(p.x, p.z, p.yaw, q.x, q.z, reach, arc):
                    continue
                dv, _ = mobs.roll_damage(self._atk_of(p))
                self._add_pend(q.cid, 'hurts', {'dmg': dv, 'x': round(p.x, 2),
                                                'z': round(p.z, 2), 'by': p.name, 'pvp': 1})

    def _mob_died(self, p, m):
        """僵尸死了 → 给击杀者经验 → 够就升级 → 落库"""
        role = p.role
        role['exp'] = int(role.get('exp') or 0) + int(m.exp)
        ups = 0
        while ups < 100:
            lv = int(role.get('level') or 1)
            need = mobs.level_up_need(lv)
            if int(role.get('exp') or 0) < need:
                break
            role['exp'] = int(role.get('exp') or 0) - need
            role['level'] = lv + 1
            ups += 1
        level = int(role.get('level') or 1)
        # 注意：me 是【单个对象】，不是数组 —— 客户端读的是 d.me.lv / d.me.exp ✗
        # （踩过：一开始用 _add_pend 存成了数组，客户端拿到 d.me.lv = undefined ✗）
        e = self._pend.get(p.cid)
        if e is None:
            e = self._pend[p.cid] = {}
        e['me'] = {'lv': level, 'exp': int(role.get('exp') or 0),
                   'need': mobs.level_up_need(level)}
        if ups:
            self._send_cid(p.cid, P.pack('notice', text='升到 %d 级！' % level, level=level))
        self._save_role(p)
        # ★ 掉落（第 38 轮）：地上生成一件，走过去自动捡 ✓
        self._roll_loot(p, m)

    def _roll_loot(self, p, m):
        """僵尸死了 roll 掉落（方案 §8：每次击杀【逐项独立】roll ✓）

        ★ 第 47 轮：材料和装备各 roll 一次 —— 所以一次击杀有可能两样都掉 ✓
          （§8 开头那句"全部概率到身上"就是这个意思 ✓）
        """
        klv = int(p.role.get('level') or 1)
        it = drops.roll_drop(m.lv, klv)
        self._drop_one(p, m, it)
        eq = drops.roll_equip(m.lv, klv)          # ★ 装备类（独立 roll）
        self._drop_one(p, m, eq)

    def _drop_one(self, p, m, it):
        """把一件掉落物放到地上（it 为 None 就什么都不做 ✓）"""
        if not it:
            return
        self.loot_seq += 1
        lid = str(self.loot_seq)
        # ★ 装备的坐标稍微错开一点 —— 不然和材料叠在同一点，捡的时候看不出来哪件是哪件 ✗
        ox = 0.0 if it.get('slot') != 'weapon' else 0.7
        self.loot[lid] = {'x': m.x + ox, 'z': m.z, 'item': it, 'ttl': drops.DROP_TTL}
        self._send_cid(p.cid, P.pack('notice', text='掉落：%s（%d 阶）走过去自动捡 ✓'
                                     % (it['name'], it['tier'])))

    def _loot_tick(self, dt):
        """地上物：倒计时 + 过期收掉（不清理的话服务器越积越多 ✗）"""
        for lid in list(self.loot.keys()):
            e = self.loot[lid]
            e['ttl'] -= dt
            if e['ttl'] <= 0:
                self.loot.pop(lid, None)

    def _loot_for(self, p):
        """发给客户端的地上物：范围内、最近的优先、最多 LOOT_SEND_CAP 件
           格式 [id, x, z, name, tier]（和 mobs 一样是紧凑数组 ✓）"""
        if not self.loot:
            return None
        v2 = drops.LOOT_VIEW * drops.LOOT_VIEW
        cand = []
        for lid, e in self.loot.items():
            d2 = (e['x'] - p.x) ** 2 + (e['z'] - p.z) ** 2
            if d2 <= v2:
                cand.append((d2, lid, e))
        if not cand:
            return None
        if len(cand) > drops.LOOT_SEND_CAP:
            cand.sort(key=lambda it: it[0])
            cand = cand[:drops.LOOT_SEND_CAP]
        return [[lid, round(e['x'], 2), round(e['z'], 2), e['item']['name'], e['item']['tier']]
                for _, lid, e in cand]

    def _intent_pick(self, p, d):
        """捡东西 —— ★ 服务器判距离（客户端说捡到了不算数 ✓）"""
        lid = str(d.get('id') or '')
        e = self.loot.get(lid)
        if not e:
            return
        if (e['x'] - p.x) ** 2 + (e['z'] - p.z) ** 2 > drops.PICK_RANGE ** 2:
            return                      # 太远 → 不认（防"隔空捡"✗）
        it = e['item']
        self.loot.pop(lid, None)
        self.loot_seq += 1
        import json
        import db as dbmod
        # ★★ 第 54 轮：不再直接 INSERT ★★
        #   材料要堆叠（同名同阶合到一行 ✓），武器不堆叠 ✓
        #   但"查一下有没有同类的"要读库 ✗ → tick 线程不许碰磁盘 ✗
        #   → 把整件事交给存档线程（它收到 'PICK' 自己决定 +1 还是新建 ✓）
        self.post_save('PICK', (p.role_id, json.dumps(it, ensure_ascii=False),
                                dbmod.now_ms()))
        self._send_cid(p.cid, P.pack('notice', text='拾取：%s（%d 阶）' % (it['name'], it['tier'])))

    def _add_pend(self, cid, key, item):
        """攒本 tick 要给某个玩家的反馈（hurts / mhits / me）"""
        e = self._pend.get(cid)
        if e is None:
            e = self._pend[cid] = {}
        lst = e.get(key)
        if lst is None:
            lst = e[key] = []
        if len(lst) < 24:                # 一条快照最多带 24 条（防刷屏 + 防包太大 ✓）
            lst.append(item)

    def _mobs_for(self, p):
        """发视野内的僵尸（近的优先，最多 MOB_RENDER_CAP 只 —— 方案 §3.2）"""
        if not self.mobs:
            return None                  # ★ 返回 None = 快照里干脆不带这个字段 ✓
        v2 = mobs.MOB_VIEW * mobs.MOB_VIEW
        cand = []
        for m in self.mobs.values():
            dx = m.x - p.x
            dz = m.z - p.z
            d2 = dx * dx + dz * dz
            if d2 <= v2:
                cand.append((d2, m))
        if not cand:
            return None
        if len(cand) > mobs.MOB_RENDER_CAP:
            cand.sort(key=lambda it: it[0])
            cand = cand[:mobs.MOB_RENDER_CAP]
        return [m.wire() for _, m in cand]

    def _save_role(self, p):
        """经验 / 等级落库（只入队 ✓ 写盘交给存档线程）"""
        import db as dbmod
        self.post_save('UPDATE roles SET level=?, exp=?, updated_at=? WHERE id=?',
                       (int(p.role.get('level') or 1), int(p.role.get('exp') or 0),
                        dbmod.now_ms(), p.role_id))

    # ============================================================ 发给网络线程

    def _to_net(self, fn, *args):
        """从 tick 线程往 asyncio 循环里投任务。循环已经关了就算了"""
        if self.loop is None:
            return
        try:
            self.loop.call_soon_threadsafe(fn, *args)
        except Exception:
            pass

    def _send_cid(self, cid, text):
        self._to_net(self._send_one, cid, text)

    def _send_one(self, cid, text):
        """★ 在 asyncio 循环里执行"""
        conn = self.srv_conns.get(cid) if self.srv_conns else None
        if conn:
            conn.push_text(text)

    def _fanout(self, batch):
        """★ 在 asyncio 循环里执行：把这一 tick 的快照推给各自的连接"""
        conns = self.srv_conns
        for cid, text in batch:
            c = conns.get(cid)
            if c:
                c.push_text(text)

    def _broadcast(self, text):
        """★ 在 asyncio 循环里执行"""
        for c in list(self.srv_conns.values()):
            c.push_text(text)

    # ============================================================ 快照

    def _snapshot_for(self, p):
        """只发接收者视野内的玩家（方案 §13.2 兴趣管理的第一步）"""
        out = []
        v2 = VIEW * VIEW
        for o in self.players.values():
            if o is p:
                continue
            dx = o.x - p.x
            dz = o.z - p.z
            if dx * dx + dz * dz > v2:
                continue
            out.append({
                'id': o.role_id,
                'n': o.name,
                'x': round(o.x, 3),
                'z': round(o.z, 3),
                'y': round(o.yaw, 3),
                't': round(o.ct, 3),      # ★ 对方自己的钟 → 客户端做插值时间轴
                'hp': o.hp,
                'lv': (o.role or {}).get('level', 1),
                'atk': o.atk,
            })
        return out

    # ============================================================ 存档线程

    def _save_player(self, p):
        """只入队，不写盘 —— 写盘交给存档线程"""
        import db as dbmod
        self.post_save(
            'UPDATE roles SET x=?, z=?, yaw=?, hp=?, qi=?, updated_at=? WHERE id=?',
            (p.x, p.z, p.yaw, p.hp, p.qi, dbmod.now_ms(), p.role_id))

    def _run_saver(self):
        import db as dbmod
        while self.running:
            batch = []
            try:
                # 攒一小会儿再一起写，减少磁盘次数
                end = time.time() + 0.5
                while time.time() < end and len(batch) < 200:
                    try:
                        batch.append(self.saves.get(timeout=0.1))
                    except queue.Empty:
                        if batch:
                            break
            except Exception:
                pass
            if not batch:
                continue
            try:
                with dbmod.db(self.cfg) as db:
                    for sql, params in batch:
                        if sql == 'PICK':
                            # ★★ 材料堆叠（第 54 轮）★★
                            #   武器/装备：永远新建一行（不堆叠 ✓）
                            #   材料：同名同阶就 +1（只在【背包里】合并 ✓ 仓库不混 ✗）
                            self._save_pick(db, params)
                            continue
                        db.execute(sql, params)
            except Exception as e:
                print('  [save] 落盘失败：%r' % e)

    def _save_pick(self, db, params):
        """把捡到的一件东西落库：材料堆叠、装备单开（★ 只有存档线程会进来 ✓）"""
        role_id, js, now = params[0], params[1], params[2]
        import json
        try:
            it = json.loads(js)
        except Exception:
            return
        is_equip = bool(it.get('slot'))          # 武器/防具 → 不堆叠 ✓
        if not is_equip:
            # 同名同阶的材料（且必须是【材料】：slot 为空 ✓）→ stack + 1
            cur = db.execute(
                "UPDATE items SET stack = stack + 1"
                " WHERE role_id=? AND in_storage=0"
                "   AND json_extract(item_json,'$.name')=?"
                "   AND json_extract(item_json,'$.tier')=?"
                "   AND json_extract(item_json,'$.slot') IS NULL",
                (role_id, it.get('name'), it.get('tier') or 0))
            try:
                n = cur.rowcount
            except Exception:
                n = 0
            if n:
                return
        db.execute(
            'INSERT INTO items(role_id, in_storage, slot_index, stack, item_json, created_at)'
            ' VALUES(?,0,-1,1,?,?)',
            (role_id, js, now))

    # ============================================================ 状态（自检用）

    def stats(self):
        return {
            'online': len(self.players),
            'mobs': len(self.mobs),          # ★ P2：现在世界上有多少只僵尸（排查用 ✓）
            'tick': self.tick_count,
            'tickMs': round(self.tick_ms, 3),
            'tickMaxMs': round(self.tick_max_ms, 3),
            'dropped': self.dropped_intents,
            'pendingSave': self.saves.qsize(),
            'inbox': self.inbox.qsize(),
        }


def _f(v, dflt=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return dflt
