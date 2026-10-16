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
RATE_LIMIT = {'move': 60, 'atk': 10, 'chat': 5}
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
        # ★ round304v：一键整理（★ 要写库 ✗ 在网络线程做 ✓ 和 equip 同一类 ✓）
        if t == 'bagsort':
            import auth as authmod4
            role = self.authed.get(conn.cid) or {}
            _ok, _r = authmod4.bag_sort(self.cfg, role.get('id'))
            if not _ok:
                conn.push_text(P.pack('notice', text=str(_r)))
                return
            role['bag'] = _r                    # ★ 顺手把登录那份快照也换掉 ✓
            # ★ 客户端拉背包走的是 HTTP /api/bag ✗ 这里没有那条下行 ✓
            #   → 只用 notice 告诉它"去重拉"✗ 客户端认那个尾巴就会刷新 ✓
            conn.push_text(P.pack(
                'notice', text='背包已整理：武器 → 防具 → 材料，同品阶高的在前（背包已更新）'))
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
        except Exception as _e:
            # ★ 第 162 轮：不再静默吞异常 ✗
            #   （这个 pass 让一个 NameError 隐藏了两轮 ✗ 白查了很久 ✓）
            print('  [ws] 登录装载失败（武器/防具/天赋/魔气）：%r' % (_e,))

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

        conn.push_text(P.pack('welcome',
                              role=role,
                              ver=P.PROTOCOL_VERSION,
                              ts=round(time.time(), 3),
                              cfg={'tickHz': TICK_HZ, 'view': VIEW}))
        print('  [ws] %s 进入世界（在线 %d）' % (role.get('name'), len(self.srv_conns)))
        # ★ 真正把他放进世界是 tick 线程的事
        self.world.post_join(conn, role)
