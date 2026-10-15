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
        except Exception:
            pass

        self.authed[conn.cid] = role
        self.by_account[acc_id] = conn.cid

        conn.push_text(P.pack('welcome',
                              role=role,
                              ver=P.PROTOCOL_VERSION,
                              ts=round(time.time(), 3),
                              cfg={'tickHz': TICK_HZ, 'view': VIEW}))
        print('  [ws] %s 进入世界（在线 %d）' % (role.get('name'), len(self.srv_conns)))
        # ★ 真正把他放进世界是 tick 线程的事
        self.world.post_join(conn, role)
