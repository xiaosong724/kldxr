# -*- coding: utf-8 -*-
"""网络层：asyncio 侧的 WebSocket 回调

职责只有三件（别的都归 World 的 tick 线程）：
  ① 认证：hello → 校验 token → 拿角色 → 发 welcome
     （这里会碰 DB，但登录是低频操作，卡一下事件循环可以接受；
       高频的东西一律丢 World 的队列，绝不在这里做）
  ② 把已认证玩家的意图转给 World.post_intent（线程安全入队）
  ③ 维护「连接 ↔ 账号」映射，实现单点在线

★ 这个类里的东西**只有网络线程碰**（srv_conns / by_account / authed），
  世界状态在 World 里、只有 tick 线程碰 —— 两边井水不犯河水，不用加锁。
"""

import time

import auth as authmod
import protocol as P
from world import TICK_HZ, VIEW


# ============================================================================
# ★★★ 第 228 轮：按连接限流（防包洪水 DoS）★★★
#
# 为什么需要：
#   post_intent() 就是一句 inbox.put(...) ✗ 而 inbox 是【无界队列】✓
#   → 一个人每秒发几千个包 → 队列涨 + tick 变慢 → 所有人卡 ✓
#   （这是【可用性】攻击 ✗ 比作弊严重：作弊影响公平 ✗ 卡服所有人都玩不了 ✓）
#
# ★ 为什么放在这一层（net.py）而不是 tick 里：
#   inbox 里【同时装着玩家意图和管理页操作】✗
#   要是等 tick 再去限制 ✗ 队列已经涨起来了 ✓ 治标不治本 ✓
#
# ★ 阈值按客户端【真实频率】定（不是拍脑袋 ✓）：
#     客户端 netSync() 是 30Hz（代码注释里写着 ✓）→ move 给 60（2 倍余量）
#     攻击冷却 0.62 秒（理论最多 1.6/秒）→ atk 给 10
#     chat 给 5 · 其它给 20
#
# ★★ 超标只【丢包 + 记一笔】✗ 绝不踢人 ✓
#    网络抖动时正常玩家也会瞬间超 ✗ 踢了就掉线 ✓ 那个体验比被攻击还糟 ✓
#
# ★ 实现故意用【最笨的写法】：一个字典 + 每秒清零 ✗ 不做滑动窗口 ✓
#   这是热路径（每个包都过）✗ 开销必须最小 ✓
# ============================================================================
# ★ round463c：move 60 → 80（客户端 30Hz netSync 实测发 61~62 次/秒 ✗
#   一直在刷“频率超限”日志（只丢包不踢人 ✗ 但日志噪音大 ✓）✓
RATE_LIMIT = {'move': 80, 'atk': 10, 'chat': 5}
RATE_LIMIT_DEFAULT = 20
_rate_state = {}          # cid -> {'sec': 秒, 'n': {类型: 次数}, 'bad': 累计超限}


def _rate_ok(cid, t):
    """True = 放行 / False = 这次丢掉"""
    import time as _t
    now = int(_t.time())
    st = _rate_state.get(cid)
    if st is None or st['sec'] != now:
        st = {'sec': now, 'n': {}, 'bad': (st or {}).get('bad', 0)}
        _rate_state[cid] = st
    n = st['n'].get(t, 0) + 1
    st['n'][t] = n
    lim = RATE_LIMIT.get(t, RATE_LIMIT_DEFAULT)
    if n > lim:
        st['bad'] += 1
        if st['bad'] == 1 or st['bad'] % 500 == 0:
            print('[ac] 频率超限：连接 %s 发 %s 到 %d 次/秒（上限 %d，累计超 %d 次）'
                  % (cid, t, n, lim, st['bad']))
        return False
    return True




def _dup_cards(cfg, rid):
    """★ round530：{皮肤key: 可以拿来改的重复卡张数}（同 key 第 2 张起才算 ✓）"""
    import json as _j
    import db as _db
    cnt = {}
    try:
        with _db.db(cfg) as c:
            # ★ 2026-10-22：把 stack 一起查出来（皮肤卡会堆叠，重复张数按 stack 算）
            rows = c.execute('SELECT item_json, stack FROM items WHERE role_id=?'
                             ' AND in_storage=0', (int(rid),)).fetchall()
    except Exception:
        return {}
    for r in rows:
        try:
            it = _j.loads(r[0] if not hasattr(r, 'keys') else r['item_json'])
        except Exception:
            continue
        if it.get('kind') == 'skin':
            k = str(it.get('key') or '')
            # ★ 2026-10-22：皮肤卡会堆叠了 → 重复张数要按 stack 累加，不是按行数
            try:
                st = int((r['stack'] if hasattr(r, 'keys') else 1) or 1)
            except Exception:
                st = 1
            cnt[k] = cnt.get(k, 0) + max(1, st)
    return dict((k, v - 1) for k, v in cnt.items() if v > 1)

class Net(object):
    def __init__(self, cfg, world):
        self.cfg = cfg
        self.world = world
        self.srv_conns = {}          # ★ 网络线程独占：cid -> WSConn
        self.by_account = {}         # ★ 网络线程独占：account_id -> cid
        self.authed = {}             # ★ 网络线程独占：cid -> 角色 dict
        world.srv_conns = self.srv_conns

    # ======================================================== 连接生命周期

    async def on_open(self, conn):
        self.srv_conns[conn.cid] = conn

    async def on_close(self, conn, exc):
        self.srv_conns.pop(conn.cid, None)
        self.authed.pop(conn.cid, None)
        for aid, cid in list(self.by_account.items()):
            if cid == conn.cid:
                self.by_account.pop(aid, None)
        self.world.post_leave(conn.cid)

    # ======================================================== 消息

    async def on_message(self, conn, text):
        t, d = P.unpack(text)
        if t is None:
            return conn.push_text(P.pack('error', msg=d))

        # ---- 还没认证：只收 hello ----
        if conn.cid not in self.authed:
            if t != 'hello':
                return conn.push_text(P.pack('error', msg='请先发送 hello 认证'))
            return await self._hello(conn, d)

        # ---- 已认证 ----
        if t == 'hello':
            return conn.push_text(P.pack('error', msg='已经认证过了'))
        err = P.check_c2s(t, d)
        if err:
            return conn.push_text(P.pack('error', msg=err))
        # ★★ round304c：打开交易所 = "给我最新的一份"（★ 要读库 ✗ 所以在这一层做 ✓）★★
        #   ★ 为什么不能让 tick 自己去读：tick 线程不许碰磁盘（铁律 ✓）
        #   ★ 为什么不复用 lists：lists 是【纯内存浏览】✗ 它读的是 tick 手里的货架 ✓
        #     而货架会过期/会被人买走 ✗ 玩家还可能刚捡了东西想上架 ✓
        #     → 所以"打开面板"这条必须有【重新读库】的语义 ✓ 单独一条 mktopen ✓
        #   ★ 两步都读：① 全服在售（别人的商品）② 他现在的背包（上架要用 item id ✓）
        #     这两样正是"面板一打开是空的"和"刚捡的东西挂不上去"的解药 ✓
        if t == 'mktopen':
            role = self.authed.get(conn.cid) or {}
            rid = role.get('id')
            rows, bag = [], []
            try:
                import auth as authmod5
                rows = authmod5.market_rows_of(self.cfg, rid)      # 全服在售 ✓
                bag = authmod5.bag_of(self.cfg, rid)              # 他此刻的背包 ✓
            except Exception as e:
                print('  [ws] 交易所装载失败：%r' % (e,))
            self.world.post_intent(conn.cid, 'mktopen', {'rows': rows, 'bag': bag,
                                                         'req': d or {}})
            return
        # ★ 高频消息一律入队，交给 tick 线程 —— 这里绝不碰世界状态
        # ★★ 第 47 轮：装备是【罕见操作 + 要查库】→ 在网络线程做，tick 线程不碰磁盘 ✓
        #   服务器自己查这件是不是他的、是不是武器、等级够不够（见 auth.equip_weapon ✓）
        if t in ('equiparmor', 'unequiparmor'):
            import auth as authmod4
            role = self.authed.get(conn.cid) or {}
            if t == 'equiparmor':
                _ok2, _r2 = authmod4.equip_armor(self.cfg, role.get('id'),
                                                 (d or {}).get('itemId'))
            else:
                _ok2, _r2 = authmod4.unequip_armor(self.cfg, role.get('id'))
            if not _ok2:
                conn.push_text(P.pack('notice', text=str(_r2)))
                return
            self.world.post_intent(conn.cid, 'armorset',
                                   {'armor': _r2, 'itemId': int((d or {}).get('itemId') or 0)})
            return
        # ★★★ round538：技能系统（学习/装配/遗忘/用书 —— 都是 DB 操作 ✗ 网络线程做 ✓）
        # ★ round549：主动技能释放 → 交给 tick 线程（CD/灵气/伤害都在那儿算）
        if t == 'skillcast':
            self.world.post_intent(conn.cid, 'skillcast', d or {})
            return
        # ★ 2026-10-22：'useskin' 加进来 —— 皮肤卡的处理写在这个分支里面，
        #   不加的话包进不来（之前看着"有实现"，其实永远走不到）
        if t in ('skillask', 'skilllearn', 'skillforget', 'skillload', 'useskillbook',
                 'useitem', 'useskin'):
            import json as _j
            import skills as skm
            import db as _db
            dbmod = _db        # ★ 本文件里名字不一致 ✗ 统一一下 ✓
            role = self.authed.get(conn.cid) or {}
            rid = int(role.get('id') or 0)
            if not rid:
                return


            def _auto_equip(key, kind):
                """★ round558（用户："学习后界面的技能格要立刻显示"）
                学了就自动塞进该类的第一个空格 ✗ 不用再手动装 ✓
                （5 个槽都满了就不动 ✓）"""
                try:
                    with _db.db(self.cfg) as c5:
                        if c5.execute('SELECT 1 FROM skill_load WHERE role_id=? AND key=?',
                                      (rid, key)).fetchone():
                            return
                        used = set(int(r['slot']) for r in c5.execute(
                            'SELECT slot FROM skill_load WHERE role_id=? AND kind=?', (rid, kind)))
                        for i in range(skm.LIMIT_LOAD):
                            if i not in used:
                                c5.execute('INSERT OR REPLACE INTO skill_load'
                                           '(role_id,kind,slot,key) VALUES(?,?,?,?)',
                                           (rid, kind, i, key))
                                c5.commit()
                                return
                except Exception as e:
                    print('[skill] 自动装配失败：%r' % (e,))
            def _send_state(msg=None):
                with _db.db(self.cfg) as c:
                    learn = {}
                    for r in c.execute('SELECT key, kind, tier FROM skill_learn WHERE role_id=?',
                                       (rid,)):
                        learn[r['key']] = {'kind': r['kind'], 'tier': int(r['tier'] or 1)}
                    load = {'A': [None] * skm.LIMIT_LOAD, 'B': [None] * skm.LIMIT_LOAD,
                            'C': [None] * skm.LIMIT_LOAD}
                    for r in c.execute('SELECT kind, slot, key FROM skill_load WHERE role_id=?',
                                       (rid,)):
                        k2 = str(r['kind'] or '')
                        s2 = int(r['slot'] or 0)
                        if k2 in load and 0 <= s2 < skm.LIMIT_LOAD:
                            load[k2][s2] = r['key']
                conn.push_text(P.pack('skillok', defs=skm.to_client(), learn=learn,
                                      load=load, err=msg))

            if t == 'skillask':
                _send_state()
                return

            if t == 'skilllearn':
                key = str((d or {}).get('key') or '')
                if not skm.valid(key):
                    conn.push_text(P.pack('skillerr', msg='没有这个技能'))
                    return
                kind = skm.KIND[key]
                try:
                    tier = max(1, min(skm.tier_max(key), int((d or {}).get('tier') or 1)))
                except Exception:
                    tier = 1
                with _db.db(self.cfg) as c:
                    n = c.execute('SELECT COUNT(*) FROM skill_learn WHERE role_id=? AND kind=?',
                                  (rid, kind)).fetchone()[0]
                    has = c.execute('SELECT 1 FROM skill_learn WHERE role_id=? AND key=?',
                                    (rid, key)).fetchone()
                    if has:
                        conn.push_text(P.pack('skillerr', msg='已经学过了'))
                        return
                    if n >= skm.LIMIT_LEARN:
                        conn.push_text(P.pack('skillerr',
                                              msg='这一类的技能已学满 %d 个，先遗忘一个' % skm.LIMIT_LEARN))
                        return
                    c.execute('INSERT INTO skill_learn(role_id,key,kind,tier,at) VALUES(?,?,?,?,?)',
                              (rid, key, kind, tier, dbmod.now_ms()))
                    c.commit()
                _send_state('学会了：' + skm.NAME.get(key, key) + '（请手动装配）')
                return

            if t == 'skillforget':
                key = str((d or {}).get('key') or '')
                if not skm.valid(key):
                    conn.push_text(P.pack('skillerr', msg='没有这个技能'))
                    return
                with _db.db(self.cfg) as c:
                    if c.execute('SELECT 1 FROM skill_load WHERE role_id=? AND key=?',
                                 (rid, key)).fetchone():
                        conn.push_text(P.pack('skillerr', msg='先把它从技能栏卸下，再遗忘'))
                        return
                    c.execute('DELETE FROM skill_learn WHERE role_id=? AND key=?', (rid, key))
                    c.commit()
                _send_state('已遗忘：' + skm.NAME.get(key, key) + '（不返还）')
                return

            if t == 'skillload':
                kind = str((d or {}).get('kind') or '')
                try:
                    slot = int((d or {}).get('slot'))
                except Exception:
                    slot = -1
                if kind not in ('A', 'B', 'C') or slot < 0 or slot >= skm.LIMIT_LOAD:
                    conn.push_text(P.pack('skillerr', msg='槽位不对'))
                    return
                key = str((d or {}).get('key') or '')

                def _push_load():
                    """★ round578：装配/卸下都立刻推给 tick（含 C 类 buff）"""
                    try:
                        with _db.db(self.cfg) as c2:
                            _ld = {'A': [None] * skm.LIMIT_LOAD,
                                   'B': [None] * skm.LIMIT_LOAD,
                                   'C': [None] * skm.LIMIT_LOAD}
                            for r in c2.execute(
                                    'SELECT kind, slot, key FROM skill_load WHERE role_id=?',
                                    (rid,)):
                                _kk = str(r['kind'] or '')
                                _ss = int(r['slot'] or 0)
                                if _kk in _ld and 0 <= _ss < skm.LIMIT_LOAD:
                                    _ld[_kk][_ss] = r['key']
                            _bf = {}
                            for r in c2.execute(
                                    'SELECT key FROM skill_load WHERE role_id=? AND kind=?',
                                    (rid, 'C')):
                                _ck2 = str(r['key'] or '')
                                if not _ck2:
                                    continue
                                _tr = c2.execute(
                                    'SELECT tier FROM skill_learn WHERE role_id=? AND key=?',
                                    (rid, _ck2)).fetchone()
                                _bf[_ck2] = int((_tr['tier'] if _tr else 1) or 1)
                        self.world.post_intent(conn.cid, 'skillsync',
                                               {'load': _ld, 'buff': _bf})
                    except Exception:
                        pass

                with _db.db(self.cfg) as c:
                    if not key:
                        c.execute('DELETE FROM skill_load WHERE role_id=? AND kind=? AND slot=?',
                                  (rid, kind, slot))
                        c.commit()
                        _push_load()
                        _send_state('已卸下')
                        return
                    if not skm.valid(key) or skm.KIND[key] != kind:
                        conn.push_text(P.pack('skillerr', msg='技能类型不对'))
                        return
                    if not c.execute('SELECT 1 FROM skill_learn WHERE role_id=? AND key=?',
                                     (rid, key)).fetchone():
                        conn.push_text(P.pack('skillerr', msg='你还没学这个技能'))
                        return
                    # 同一个技能不能占两个槽
                    c.execute('DELETE FROM skill_load WHERE role_id=? AND key=?', (rid, key))
                    c.execute('INSERT OR REPLACE INTO skill_load(role_id,kind,slot,key) VALUES(?,?,?,?)',
                              (rid, kind, slot, key))
                    c.commit()
                self.world.post_intent(conn.cid, 'skillloaded', {'kind': kind, 'key': key})
                _push_load()
                _send_state('已装配：' + skm.NAME.get(key, key))
                return

            if t in ('fridge_open', 'fridge_put', 'fridge_take'):
                hid = str((d or {}).get('id') or '')
                # 动态房屋（已放置的建筑）：转给 World 统一处理
                if str(hid).startswith('obj'):
                    self.world.post_intent(conn.cid, t, d)
                    return
                import fridge as _frm
                with _db.db(self.cfg) as c:
                    hrow = c.execute('SELECT id, owner_id FROM houses WHERE id=? LIMIT 1',
                                     (hid,)).fetchone()
                    if not hrow:
                        conn.push_text(P.pack('fridge', ok=0, msg='住宅不存在', house=hid))
                        return
                    owner = int(hrow['owner_id'] or 0)
                    if owner != int(rid):
                        conn.push_text(P.pack('fridge', ok=0, msg='只有房主能打开这里的冰箱', house=hid))
                        return
                    if t == 'fridge_open':
                        pass
                    elif t == 'fridge_put':
                        iid = int((d or {}).get('iid') or 0)
                        row = c.execute('SELECT item_json, stack FROM items WHERE id=? AND role_id=?'
                                        ' AND in_storage=0', (iid, rid)).fetchone()
                        if not row:
                            conn.push_text(P.pack('notice', text='背包里没有这件东西'))
                            return
                        it = _j.loads(row['item_json'])
                        if it.get('kind') != 'food':
                            conn.push_text(P.pack('notice', text='冰箱只放饮料和食品'))
                            return
                        st = int((row['stack'] if hasattr(row, 'keys') else row[1]) or 1)
                        ok, msg = _frm.put_item(c, hid, it, 1)
                        if not ok:
                            conn.push_text(P.pack('notice', text=msg))
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
                            conn.push_text(P.pack('notice', text='这一格是空的'))
                            return
                        c.execute('INSERT INTO items(role_id, in_storage, slot_index, stack, item_json, created_at)'
                                  ' VALUES(?,0,-1,?,?,?)',
                                  (rid, st, _j.dumps(it, ensure_ascii=False), dbmod.now_ms()))
                        c.commit()
                conn.push_text(P.pack('bagrefresh'))
                data = _frm.public(self.cfg, hid, owner, rid)
                data['ok'] = 1
                data['msg'] = ('已放入冰箱' if t == 'fridge_put' else ('已取出' if t == 'fridge_take' else ''))
                conn.push_text(P.pack('fridge', **data))
                return

            if t == 'useitem':
                iid = int((d or {}).get('iid') or 0)
                with _db.db(self.cfg) as c:
                    row = c.execute('SELECT item_json, stack FROM items WHERE id=? AND role_id=?'
                                    ' AND in_storage=0', (iid, rid)).fetchone()
                    if not row:
                        conn.push_text(P.pack('notice', text='背包里没有这件东西'))
                        return
                    it = _j.loads(row['item_json'])
                    if it.get('kind') != 'food':
                        conn.push_text(P.pack('notice', text='这件东西不能吃'))
                        return
                    use = it.get('use') or {}
                    _st = int((row['stack'] if hasattr(row, 'keys') else row[1]) or 1)
                    if _st > 1:
                        c.execute('UPDATE items SET stack = stack - 1 WHERE id=? AND role_id=?',
                                  (iid, rid))
                    else:
                        c.execute('DELETE FROM items WHERE id=? AND role_id=?', (iid, rid))
                    c.commit()
                conn.push_text(P.pack('bagrefresh'))
                self.world.post_intent(conn.cid, 'usefood',
                                       {'name': it.get('name') or '食物',
                                        'hp_pct': float(use.get('hp_pct') or 0),
                                        'qi_pct': float(use.get('qi_pct') or 0),
                                        'exp': int(use.get('exp') or 0)})
                return

            # ★★★ 2026-10-22（用户："皮肤卡没有堆叠，堆叠后使用多少消耗多少"）★★★
            #   病根：客户端一直在发 useskin，但【服务端从来没有这个分支】——
            #   包被丢掉 → 卡还在背包、皮肤也没解锁（用起来完全没反应）。
            #   这里补上：核对这张卡确实是他的、key 对得上，扣 1 张（不是整堆），
            #   写 skin_unlocks，并顺手换上。
            if t == 'useskin':
                import skins as skmod2
                iid = int((d or {}).get('iid') or 0)
                want = str((d or {}).get('key') or '')
                with _db.db(self.cfg) as c:
                    row = c.execute('SELECT item_json, stack FROM items WHERE id=? AND role_id=?'
                                    ' AND in_storage=0', (iid, rid)).fetchone()
                    if not row:
                        conn.push_text(P.pack('notice', text='背包里没有这张皮肤卡'))
                        return
                    it = _j.loads(row['item_json'])
                    if it.get('kind') != 'skin':
                        conn.push_text(P.pack('notice', text='这不是皮肤卡'))
                        return
                    key = str(it.get('key') or '')
                    if want and want != key:
                        conn.push_text(P.pack('notice', text='这张卡不是那个皮肤'))
                        return
                    if not skmod2.NAME.get(key):
                        conn.push_text(P.pack('notice', text='皮肤卡坏了'))
                        return
                    # ★ 一次只用 1 张（堆叠的卡不会被一次吃掉）
                    _st = int((row['stack'] if hasattr(row, 'keys') else row[1]) or 1)
                    if _st > 1:
                        c.execute('UPDATE items SET stack = stack - 1 WHERE id=? AND role_id=?',
                                  (iid, rid))
                    else:
                        c.execute('DELETE FROM items WHERE id=? AND role_id=?', (iid, rid))
                    c.execute('INSERT OR IGNORE INTO skin_unlocks(role_id,key,at) VALUES(?,?,?)',
                              (rid, key, dbmod.now_ms()))
                    # 顺手换上（和以前的体验一致）
                    c.execute('UPDATE roles SET skin=? WHERE id=?', (key, rid))
                    c.commit()
                    # ★ 内存里的 role 也要改 —— 别人的【世界快照】读的就是它的 skin / skcMap
                    try:
                        role['skin'] = key
                    except Exception:
                        pass
                    _left = max(0, _st - 1)
                conn.push_text(P.pack('bagrefresh'))
                _nm2 = skmod2.NAME.get(key, key)
                _txt2 = ('已解锁并换上：%s%s' % (
                    _nm2, ('（这张卡还剩 %d 张）' % _left) if _left > 0 else ''))
                # ★ 2026-10-22：客户端要靠这条 notice 弹提示（和 round506 的文案一致）
                conn.push_text(P.pack('notice', text=_txt2))
                _send_state(_txt2)
                return

            if t == 'useskillbook':
                iid = int((d or {}).get('iid') or 0)
                with _db.db(self.cfg) as c:
                    row = c.execute('SELECT item_json, stack FROM items WHERE id=? AND role_id=?'
                                    ' AND in_storage=0', (iid, rid)).fetchone()
                    if not row:
                        conn.push_text(P.pack('skillerr', msg='背包里没有这本书'))
                        return
                    it = _j.loads(row['item_json'])
                    if it.get('kind') != 'skillbook':
                        conn.push_text(P.pack('skillerr', msg='这不是技能书'))
                        return
                    key = str(it.get('key') or '')
                    if not skm.valid(key):
                        conn.push_text(P.pack('skillerr', msg='技能书坏了'))
                        return
                    kind = skm.KIND[key]
                    tier = int(it.get('tier') or 1)
                    if c.execute('SELECT 1 FROM skill_learn WHERE role_id=? AND key=?',
                                 (rid, key)).fetchone():
                        conn.push_text(P.pack('skillerr', msg='已经学过了'))
                        return
                    n = c.execute('SELECT COUNT(*) FROM skill_learn WHERE role_id=? AND kind=?',
                                  (rid, kind)).fetchone()[0]
                    if n >= skm.LIMIT_LEARN:
                        conn.push_text(P.pack('skillerr',
                                              msg='这一类的技能已学满 %d 个，先遗忘一个' % skm.LIMIT_LEARN))
                        return
                    _st = int((row['stack'] if hasattr(row, 'keys') else row[1]) or 1)
                    if _st > 1:
                        c.execute('UPDATE items SET stack = stack - 1 WHERE id=? AND role_id=?',
                                  (iid, rid))
                    else:
                        c.execute('DELETE FROM items WHERE id=? AND role_id=?', (iid, rid))
                    c.execute('INSERT INTO skill_learn(role_id,key,kind,tier,at) VALUES(?,?,?,?,?)',
                              (rid, key, kind, tier, dbmod.now_ms()))
                    c.commit()
                conn.push_text(P.pack('bagrefresh'))
                _send_state('学会了：' + skm.NAME.get(key, key) + '（请手动装配）')
                return

        # ★★ round510：皮肤自定义（要读/写库 ✗ 都在网络线程做 ✓）
        if t in ('skincustomask', 'skincustom'):
            import skin_custom as scmod
            import skins as skmod
            import db as dbmod2
            role = self.authed.get(conn.cid) or {}
            rid = role.get('id')
            if t == 'skincustomask':
                _out = {}
                try:
                    for _k, _v in scmod.all_of(self.cfg, rid).items():
                        _cv = scmod.to_client(_v, skmod.GENDER.get(_k, 'f'))
                        if _cv:
                            _out[_k] = _cv
                except Exception:
                    pass
                conn.push_text(P.pack('skincustomok', custom=_out,
                                      cards=_dup_cards(self.cfg, rid)))
                return
            # ---- 确认更换 ----
            _sk = str((d or {}).get('skin') or '')
            _f = str((d or {}).get('field') or '')
            _val = (d or {}).get('value')
            _unlocked = False
            _worn = False
            try:
                with dbmod2.db(self.cfg) as _c:
                    _unlocked = bool(_c.execute(
                        'SELECT 1 FROM skin_unlocks WHERE role_id=? AND key=?',
                        (rid, _sk)).fetchone())
                    _row = _c.execute('SELECT skin FROM roles WHERE id=?', (rid,)).fetchone()
                    _worn = (str((_row[0] if _row else '') or '') == _sk)
            except Exception:
                _unlocked = False
            # ★ round528：这条【只在客户端拦】✗ 服务端不拦 ✓
            #   原因：换装是 post_save 异步写的 ✗ 这里立刻读库可能还是旧值 ✓
            #   （刚换上就点自定义 → 被误拒 ✗ 踩到了 ✓）
            #   真正的约束在 UI：只有"使用中"的皮肤才给点「自定义」✓
            _ = _worn
            _ok, _res = scmod.apply(self.cfg, rid, skmod.GENDER.get(_sk, 'f'),
                                    _sk, _unlocked, _f, _val)
            if not _ok:
                conn.push_text(P.pack('notice', text=str(_res)))
                return
            # 成功：全套自定义发回去 + 交给 tick 更新内存/让客户端重画
            _out = {}
            try:
                for _k, _v in scmod.all_of(self.cfg, rid).items():
                    _cv = scmod.to_client(_v, skmod.GENDER.get(_k, 'f'))
                    if _cv:
                        _out[_k] = _cv
            except Exception:
                pass
            conn.push_text(P.pack('skincustomok', custom=_out, skin=_sk,
                                  cards=_dup_cards(self.cfg, rid)))
            self.world.post_intent(conn.cid, 'customset', {'skin': _sk, 'data': _res})
            return
        # ★ round304v：一键整理（★ 要写库 ✗ 在网络线程做 ✓ 和 equip 同一类 ✓）
        if t == 'bagsort':
            import auth as authmod4
            role = self.authed.get(conn.cid) or {}
            _ok, _r = authmod4.bag_sort(self.cfg, role.get('id'))
            if not _ok:
                conn.push_text(P.pack('notice', text=str(_r)))
                return
            role['bag'] = _r                    # ★ 顺手把登录那份快照也换掉 ✓
            # ★★ round507：整理的结果【直接把顺序发回来】✗ 不再让客户端重拉整包 ✓
            #   原来：notice"（背包已更新）"→ 客户端 bagFetch → 647KB ✓✓ 白花一秒
            #   现在：只发一个 id 数组（1420 件 ≈ 9KB，gzip 后 ~2KB）✓
            _ids = []
            try:
                _ids = [int(x.get('id')) for x in (_r or []) if x.get('id') is not None]
            except Exception:
                _ids = []
            conn.push_text(P.pack('bagsortok', ids=_ids))
            conn.push_text(P.pack(
                'notice', text='背包已整理：武器 → 防具 → 材料，同品阶高的在前'))
            return
        # fridge: db side here (network thread)
        if t in ('fridge_open', 'fridge_put', 'fridge_take'):
            hid = str((d or {}).get('id') or '')
            if str(hid).startswith('obj'):
                self.world.post_intent(conn.cid, t, d)
                return
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

        # ★★ round424：头顶称号选哪个榜（要写库 ✗ 和 bagsort 同一类 ✓）
        if t == 'ranktitle':
            import auth as authmod_rk
            import rankboard as rb
            role = self.authed.get(conn.cid) or {}
            _b = str((d or {}).get('board') or '')
            if _b and _b not in rb.KEYS:
                conn.push_text(P.pack('notice', text='不认识的排行榜'))
                return
            _ok, _err = authmod_rk.set_title_board(self.cfg, role.get('id'), _b)
            if not _ok:
                conn.push_text(P.pack('notice', text=str(_err)))
                return
            role['titleBoard'] = _b
            # ★ 让 tick 立刻换掉内存里那份（下一帧快照就带上新称号 ✓）
            self.world.post_intent(conn.cid, 'ranktitle', {'board': _b})
            # ★ 回执：带上当前名次算出来的文本（让界面立刻显示 ✓）
            _txt, _medal = '', 0
            try:
                _rm = (self.world.rank_map or {}).get(role.get('id')) or {}
                _txt, _medal = rb.title_text(_rm, _b)
            except Exception:
                pass
            conn.push_text(P.pack('ranktitleok', board=_b, text=_txt, medal=_medal))
            return
        if t in ('equip', 'unequip'):
            import auth as authmod3
            role = self.authed.get(conn.cid) or {}
            if t == 'equip':
                _ok, _r = authmod3.equip_weapon(self.cfg, role.get('id'),
                                                (d or {}).get('itemId'), role.get('level'))
            else:
                _ok, _r = authmod3.unequip_weapon(self.cfg, role.get('id'))
            if not _ok:
                conn.push_text(P.pack('notice', text=str(_r)))
                return
            if t == 'equip':
                self.world.post_intent(conn.cid, 'equipset',
                                       {'weapon': _r, 'itemId': int((d or {}).get('itemId') or 0)})
            else:
                self.world.post_intent(conn.cid, 'equipset', {'weapon': None, 'itemId': None})
            return
        # ★ 第 228 轮：限流（超标就丢包 ✗ 不踢人 ✓）
        if not _rate_ok(conn.cid, t):
            return
        self.world.post_intent(conn.cid, t, d)

    # ======================================================== 认证

    async def _hello(self, conn, d):
        ver = d.get('ver')
        if ver is not None:
            try:
                v = int(ver)
            except (TypeError, ValueError):
                v = -1
            if v != P.PROTOCOL_VERSION:
                conn.push_text(P.pack('kick', code='ver',
                                      msg='版本不匹配：服务端 v%d，客户端 v%s'
                                          % (P.PROTOCOL_VERSION, ver)))
                return await conn.close(1000, 'ver')

        ok, r = authmod.check_token(self.cfg, (d.get('token') or '').strip())
        if not ok:
            conn.push_text(P.pack('kick', code='auth', msg=r))
            return await conn.close(1000, 'auth')

        acc_id = r['account']['id']

        # ★ 单点在线：同一账号已有连接 → 踢掉旧的
        old_cid = self.by_account.get(acc_id)
        if old_cid is not None and old_cid != conn.cid:
            oc = self.srv_conns.get(old_cid)
            if oc:
                oc.push_text(P.pack('kick', code='dup', msg='这个账号在别处登录了'))
                await oc.close(1000, 'dup')

        role = authmod.role_public(r['role'])
        if role is None:
            conn.push_text(P.pack('kick', code='norole', msg='角色数据缺失，请重新登录'))
            return await conn.close(1000, 'norole')
        # ★ 第 38 轮：welcome 里顺便带上"升下一级还要多少经验"——
        #   客户端那条蓝色经验条一进游戏就得有数，不能等打死第一只怪 ✗
        #   （need 由服务器算，见 server/mobs.py level_up_need ✓ 别让客户端自己猜）
        try:
            import mobs as mobsmod
            role['need'] = mobsmod.level_up_need(role.get('level') or 1)
        except Exception:
            pass

        # ★★ 第 47 轮：顺手把【已装备的武器】读出来一起下发 ★★
        #   读库放在这里（网络线程），不放进 tick 线程 —— tick 线程不许碰磁盘 ✗
        #   读不到就【不下发】，World 那边会用一把默认单手剑兜底 ✓
        #   （默认剑的数值 = 以前写死的 2.4/1.05/0.62，所以老角色手感不变 ✓）
        try:
            import auth as authmod2
            _w, _wid = authmod2.weapon_of(self.cfg, role.get('id'))
            if _w:
                role['weapon'] = _w
                role['weaponItemId'] = _wid
            # ★★★ 第 108 轮修的真 bug（用户："重新进游戏后要重新穿戴防具才有效"）★★★
            #   这里原来【只挂了武器】✗ 防具从来没读 ✗
            #   → 重进之后 p.armor = None → 减伤/生命加成本来就是按 p.armor 算的 ✗
            #   → 全都没了 ✓ 必须当场再穿一次才有 ✓✓ 和用户描述一字不差 ✓
            _a, _aid = authmod2.armor_of(self.cfg, role.get('id'))
            if _a:
                role['armor'] = _a
                role['armorItemId'] = _aid
            # round302: 离线期间的入账（卖东西给系统时人不在线 ✗ 走 pending_gold ✓）
            #   读库放这里（网络线程允许 IO ✓）✗ tick 线程拿到后走 _gain_gold 入账 ✓
            #   ★ 不这么做的话这些钱永远到不了玩家手里（done=0 一直躺着 ✓）
            try:
                _pg = authmod2.pending_gold_of(self.cfg, role.get('id'))
                if _pg:
                    role['pendingGold'] = _pg
            except Exception:
                pass
            # ★ 第 114 轮：天赋也在这里装载 ✓（方案 §5 第 1 条 ✓）
            #   role['talents'] = {stat: points} ✓ role['talentFree'] = 推导值 ✓
            # ★ 第 149 轮：魔气值 —— 登录时装载 + 算一次自然衰减 ✓
            #   ★ 衰减就在这里算（用“上次结算时刻”现算 ✓）
            #     离线 10 小时回来 → 自动掉 10 点 ✓ 不需要任何定时器 ✓
            import mq as _mq
            # ★★ 第 162 轮修的真 bug（用户：刷新一下页面就没了）★★
            #   这里原来写的是 dbmod.now_ms() ✗
            #   而 net.py 【没有 import db】✗ → NameError ✗
            #   → 而这整段被 try/except 包着 ✗ 异常被静默吞掉 ✗
            #   → role['mq'] 永远设不上 ✗ → 客户端每次登录都是 0 ✗✓
            #   ★ 和第 155 轮 world.py 那个是【同一个错】✗
            #     我把 dbmod 用在了没导入它的文件里 ✗ 而且两次都被 try 吞了 ✗
            #   ★ 改用本文件已有的 time → 毫秒 ✓
            _mq_now = int(time.time() * 1000)
            _mq_old = int(role.get('mq') or 0)
            _mq_v, _mq_at = _mq.settle(role.get('mq'), role.get('mq_at'), _mq_now)
            role['mq'] = _mq_v
            role['mqAt'] = _mq_at
            # ★★★ 第 163 轮修的真 bug（用户：刷新一下就没了）★★★
            #   原来的条件只看【mq_at 变没变】✗
            #   而 settle 在【不到一小时】时也会把 mq_at 推到 now ✗
            #   → 于是一次“没变化”的登录，也会把一份陈旧的 mq 原样写回库 ✗
            #   → 刚用管理页设好的 400 就被冲成 0 ✗✓
            #     （表现就是：设了也有用 ✓ 但一刷新就没了 ✗）
            #   ★ 修：只有【魔气真的被自然衰减了】才落库 ✓
            if _mq_v != _mq_old:
                # 衰减真的发生了 → 落库 ✓（没变就不写 ✗ 省一次 IO ✓）
                try:
                    import db as _dbmod   # ★ 第 162 轮：本文件没导入 db ✗ 现场导一下 ✓
                    with _dbmod.db(self.cfg) as _c:
                        _c.execute('UPDATE roles SET mq=?, mq_at=? WHERE id=?',
                                   (_mq_v, _mq_at, role.get('id')))
                        _c.commit()
                except Exception:
                    pass
            import talents as _tal
            _tp = authmod2.talents_of(self.cfg, role.get('id'))
            role['talents'] = _tp
            role['talentFree'] = _tal.free_points(role.get('level'), _tp)
            # ★★ round424：排行榜的计数器 + 头顶称号选择（读库在网络线程 ✓）
            #   ★ 不读就会「重启后击杀数归 0」" ✗ 和当年 mq / gold 同一个坑 ✓
            role['stats'] = authmod2.stats_of(self.cfg, role.get('id'))
            role['titleBoard'] = authmod2.title_board_of(self.cfg, role.get('id'))
        except Exception as _e:
            # ★ 第 162 轮：不再静默吞异常 ✗
            #   （这个 pass 让一个 NameError 隐藏了两轮 ✗ 白查了很久 ✓）
            print('  [ws] 登录装载失败（武器/防具/天赋/魔气）：%r' % (_e,))

        # ★ round549：登录时读一次技能装配（tick 线程不碰库 ✓）
        try:
            import db as _db3
            import skills as _skm3
            if 'id' in role:
                _ld3 = {'A': [None] * _skm3.LIMIT_LOAD, 'B': [None] * _skm3.LIMIT_LOAD,
                        'C': [None] * _skm3.LIMIT_LOAD}
                _lr = {}
                # ★ 两个查询放在【同一个 with 里】✗ 出来以后 c3 就关了（踩过 ✓）
                with _db3.db(self.cfg) as c3:
                    for r in c3.execute('SELECT kind, slot, key FROM skill_load WHERE role_id=?',
                                        (role['id'],)):
                        _kk3 = str(r['kind'] or '')
                        _ss3 = int(r['slot'] or 0)
                        if _kk3 in _ld3 and 0 <= _ss3 < _skm3.LIMIT_LOAD:
                            _ld3[_kk3][_ss3] = r['key']
                    for r in c3.execute('SELECT key, tier FROM skill_learn WHERE role_id=?',
                                        (role['id'],)):
                        _lr[str(r['key'])] = int(r['tier'] or 1)
                role['skLoad'] = _ld3
                role['skLearn'] = _lr
        except Exception as e:
            print('[skill] 载入装配失败：%r' % (e,))
        self.authed[conn.cid] = role
        self.by_account[acc_id] = conn.cid

        # ★★ round304b：交易所（方案 v3 §9 —— 读库在这层 ✗ tick 只拿内存 ✓）★★
        #   ★ 为什么在这里读：在线货架要在内存里 ✗ 而 tick 线程不许 IO ✓
        #   ★ 只读他【卖家=自己】的那些：别人的等他逛交易所时现发（浏览本来就是内存 ✓）
        #     ⚠ 这是个真缺口：内存货架初始只有自己上线时那一份 ✗
        #       所以"看别人的商品"要等做界面那一轮补一条【全量装载】✓（见文档下一步 ✓）
        try:
            _mr = authmod.market_rows_of(self.cfg, role.get('id'))
            role['mktRows'] = _mr
        except Exception as _me:
            print('  [ws] 货架装载失败（不影响进游戏）：%r' % (_me,))

        # ★★ round304b：背包快照（交易所的"这件是不是他的"就是这个 ✓）★★
        #   ★ 为什么要在这层读：上架校验在 tick 线程 ✗ 它不许查库 ✓
        #   ★ 载荷：item_json 里【没有】这个物品在 items 表里的 id ✗
        #     而背包接口发的 {'id': items.id, 'item': {...}} 外层 id 就是它 ✓
        #     → 交易所上架要的 iid 只能从这份快照里拿 ✓✓
        #   ★ 它【什么时候会变旧】：捡到新东西 / 卖系统 / 穿装备都不会更新它 ✗
        #     下一轮做界面时会改成"打开交易所时重发一份"✓（先记在这里 ✓）
        try:
            role['bag'] = authmod.bag_of(self.cfg, role.get('id'))
        except Exception as _be:
            print('  [ws] 背包装载失败（交易所会看不到东西）：%r' % (_be,))
            role['bag'] = []

        # ★ round409（用户："夺取的 CD 管理里改了，文案还写死 10 分钟"）
        #   → 把两个冷却一起发给客户端 ✗ 百科里的说明才显示得出真实值 ✓
        #   ★ 这里是【网络线程】✗ 读配置没问题（tick 线程才不许碰磁盘 ✓）
        try:
            import mq as _mqc
            _cd_pair = float(_mqc.cfg('pair_cooldown', _mqc.PAIR_COOLDOWN))
            _cd_steal = float(_mqc.cfg('steal_cooldown', _mqc.STEAL_COOLDOWN))
        except Exception:
            _cd_pair = 0.0
            _cd_steal = 0.0
        # ★ round496：有未读公告就随 welcome 一起发（网络线程读库 ✓ 不碰 tick ✓）
        _ann = None
        try:
            import announce as annmod
            _a = annmod.latest(self.cfg)
            if _a and int(_a['id']) > int(role.get('announceSeen') or 0):
                _ann = _a
        except Exception as _ae:
            print('[ann] 取公告失败: %r' % (_ae,))
        # ★★ round510：皮肤自定义（读库在这里 ✓ tick 不许碰盘）
        try:
            import skin_custom as scmod0
            import skins as skmod0
            _cmap = {}
            for _k, _v in scmod0.all_of(self.cfg, role.get('id')).items():
                _cv = scmod0.to_client(_v, skmod0.GENDER.get(_k, 'f'))
                if _cv:
                    _cmap[_k] = _cv
            role['skcMap'] = _cmap
        except Exception as _ce:
            print('[skin] 读自定义失败: %r' % (_ce,))
        try:
            import town as _tw
            if abs(float(role.get('x') or 0)) < 1 and abs(float(role.get('z') or 0)) < 1:
                role['x'], role['z'] = _tw.SPAWN
        except Exception:
            pass
        conn.push_text(P.pack('welcome',
                              role=role,
                              ann=_ann,
                              ver=P.PROTOCOL_VERSION,
                              ts=round(time.time(), 3),
                              boot=getattr(self.world, 'boot_ts', 0),
                              # ★ 2026-10-22（用户："怪的总上限按管理页面为准"）：
                              #   把管理页的僵尸上限一起下发，客户端不要再写死 60
                              mobCap=int(getattr(self.world, 'mob_cap', 0) or 0),
                              cfg={'tickHz': TICK_HZ, 'view': VIEW,
                                   'pairCd': _cd_pair, 'stealCd': _cd_steal}))
        print('  [ws] %s 进入世界（在线 %d）' % (role.get('name'), len(self.srv_conns)))
        # ★ 真正把他放进世界是 tick 线程的事
        self.world.post_join(conn, role)
