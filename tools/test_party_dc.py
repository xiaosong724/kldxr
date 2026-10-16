# -*- coding: utf-8 -*-
"""组队掉线处理 · 离线验证（第 268 轮）

跑法（在项目根目录）：
    python tools/test_party_dc.py

它干什么：
  · 把【真库】server/game.db 复制一份到临时目录 ✗ cfg['db'] 指向副本 ✓
    （全程绝不动真库 ✓ 而且还要反过来验证：整个测试没往盘上写过一个字节 ✓）
  · 真的 new 一个 World ✗ 真的往 inbox / _joinq 里投消息 ✗ 真的跑 w._step() ✓
    （不是直接调 _party_dc ✗ 走的是掉线/上线真正的代码路径 ✓）
  · _send_cid 被换成一个【记账函数】✗ 所以能看见每个人收到了什么包 ✓

覆盖 7 条（用户点名）：
  1 队长掉线 → 队长转移给在线队员
  2 队长 + 唯一队员都掉线 → 队伍还在（不解散）
  3 队员掉线 → 他还在 members 里
  4 重连上线 → 收到队伍名单（自动回队）
  5 队伍解散后重连 → party_of 残留被清掉
  6 残留状态下 op='leave' 不报错且能清干净
  7 残留状态下 op='apply' 不会被【你已经有队伍了】拒绝
另加 3 条加固：8 invite 对方残留 / 9 invite 自己残留（旧代码这里会 KeyError）
              10 accept 自己残留 / 11 队长空缺时重连的人接棒
"""
import hashlib
import json
import os
import shutil
import sys
import tempfile
import time
import traceback

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')   # 控制台 GBK 打不出 ✓
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
sys.path.insert(0, os.path.join(ROOT, 'server'))

import world as W          # noqa: E402
import protocol as P       # noqa: E402
import db as dbmod         # noqa: E402

# ★ 装一个探头：整个测试里谁想 db.db(cfg) 都会被记下来 ✓
#   最后断言【真库路径一次都没出现过】✗ 这样 真库没被碰 就是可验证的 ✓
_OPENED_DB = []
_real_db = dbmod.db


def _spy_db(cfg):
    _OPENED_DB.append(str((cfg or {}).get('db')))
    return _real_db(cfg)


dbmod.db = _spy_db

DB_SRC = os.path.join(ROOT, 'server', 'game.db')
TMPDIR = tempfile.mkdtemp(prefix='partydc_')
TMPDB = os.path.join(TMPDIR, 'game.db')
shutil.copy2(DB_SRC, TMPDB)
CFG = {'db': TMPDB}

N_PASS = [0]
FAILS = []


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


def check(name, cond, extra=''):
    if cond:
        N_PASS[0] += 1
        print('  \u2713 %s' % name)
    else:
        FAILS.append(name)
        print('  \u2717 %s    %s' % (name, extra))
    return bool(cond)


def sect(t):
    print('')
    print('\u2500\u2500 ' + t)


class Conn(object):
    """假连接：只要有 .cid 就行（_step 里 Player(conn.cid, role) ✓）"""

    def __init__(self, cid):
        self.cid = cid

    def push_text(self, t):
        pass


def role_dict(rid, name, lv=10):
    return {'id': rid, 'name': name, 'level': lv, 'hp': 200, 'hpMax': 200,
            'qi': 10, 'qiMax': 100, 'x': 5.0, 'z': 5.0, 'yaw': 0.0,
            'exp': 0, 'mq': 0, 'mqAt': 0}


class Sess(object):
    """一个 World + 一套记账（所有玩家都在安全区里 ✗ 免得僵尸来捣乱）"""

    def __init__(self, tag):
        self.tag = tag
        self.w = W.World(CFG)
        self.w.loop = None                 # _to_net 直接返回 ✗ 不会真的发网络 ✓
        self.w.srv_conns = {}
        self.sent = {}                     # role_id -> [(t, d), ...]
        self.cid_of = {}                   # role_id -> 当前 cid
        self.w._send_cid = self._cap       # ★ 只换发送口 ✗ 逻辑一行不改 ✓
        self.step_n = 0

    # ---- 记账 ----
    def _cap(self, cid, text):
        t, d = P.unpack(text)
        rid = None
        for r, c in self.cid_of.items():
            if c == cid:
                rid = r
                break
        self.sent.setdefault(rid if rid is not None else cid, []).append((t, d))

    def pkts(self, rid, t=None):
        out = self.sent.get(rid, [])
        if t is None:
            return list(out)
        return [d for (tt, d) in out if tt == t]

    def clear(self, rid):
        self.sent[rid] = []

    # ---- 动作（全部走真路径 ✓）----
    def join(self, rid, name, cid=None):
        cid = cid or ('c%d' % rid)
        self.cid_of[rid] = cid
        self.w._joinq.put((Conn(cid), role_dict(rid, name)))
        return cid

    def leave(self, rid):
        self.w.inbox.put(('leave', self.cid_of[rid], None))

    def op(self, rid, **d):
        self.w.inbox.put(('intent', self.cid_of[rid], ('party', d)))

    def step(self, note=''):
        """真跑一帧 ✗ 抛异常就是失败（用户要的 不报错 ✓）"""
        self.step_n += 1
        try:
            self.w._step()
            return None
        except Exception as e:
            print('  !! _step() 抛异常（%s）：%r' % (note, e))
            traceback.print_exc()
            FAILS.append('_step 抛异常 %s: %r' % (note, e))
            return e

    # ---- 观察 ----
    def player(self, rid):
        for q in self.w.players.values():
            if getattr(q, 'role_id', None) == rid:
                return q
        return None

    def online(self, rid):
        q = self.player(rid)
        return q is not None and getattr(q, 'ghostAt', None) is None

    def pid_of(self, rid):
        return self.w.party_of.get(rid)

    def party(self, pid):
        return self.w.parties.get(pid)

    def make_party(self, leader, member):
        """用真的 invite/accept 流程建队 ✓（顺便验证正常组队没被我改坏 ✓）"""
        self.op(leader, op='invite', cid=member)
        self.step('invite')
        self.op(member, op='accept', cid=leader)
        self.step('accept')
        return self.pid_of(leader)


print('=' * 78)
print('\u7ec4\u961f\u6389\u7ebf\u5904\u7406 \u00b7 \u79bb\u7ebf\u9a8c\u8bc1\uff08\u7b2c 268 \u8f6e\uff09')
print('\u771f\u5e93\uff1a%s' % DB_SRC)
print('\u526f\u672c\uff1a%s' % TMPDB)
print('=' * 78)

HASH0 = sha(TMPDB)

# ================================================================ 1. 队长掉线 → 交棒
sect('1 \u961f\u957f\u6389\u7ebf \u2192 \u961f\u957f\u8f6c\u79fb\u7ed9\u5728\u7ebf\u961f\u5458')
s = Sess('dc-leader')
s.join(1, 'A')
s.join(2, 'B')
s.step('join A/B')
pid1 = s.make_party(1, 2)
check('\u5efa\u961f\u6210\u529f\uff08invite + accept \u8d70\u901a\uff09pid=%s' % pid1, bool(pid1))
check('\u961f\u957f\u662f A\uff08role 1\uff09', s.party(pid1) and s.party(pid1)['leader'] == 1,
      str(s.party(pid1)))
check('\u6210\u5458\u540d\u5355 = [1, 2]', s.party(pid1) and s.party(pid1)['members'] == [1, 2],
      str(s.party(pid1) and s.party(pid1)['members']))
s.clear(2)
s.leave(1)                       # ★ A（队长）掉线
s.step('leave A')
pt = s.party(pid1) or {}
check('\u6392\u961f\u8fd8\u5728\uff08\u6ca1\u89e3\u6563\uff09', pid1 in s.w.parties)
check('\u961f\u957f\u81ea\u52a8\u8f6c\u7ed9\u5728\u7ebf\u961f\u5458 B\uff08role 2\uff09', pt.get('leader') == 2, str(pt))
check('\u6ca1\u6709 leader_offline \u6807\u8bb0\uff08\u6709\u4eba\u63a5\u68d2\uff09', 'leader_offline' not in pt, str(pt))
check('A \u8fd8\u5728 members \u91cc\uff08\u4e0d\u8bb8\u8e22\uff09', 1 in (pt.get('members') or []), str(pt.get('members')))
check('A \u53d8\u6210\u5e7d\u7075\uff08ghostAt \u975e None\uff09', s.player(1) is not None
      and s.player(1).ghostAt is not None)
push = s.pkts(2, 'party')
check('B \u6536\u5230\u4e86\u961f\u4f0d\u540d\u5355\uff08_party_push\uff09', len(push) > 0,
      '\u6536\u5230\u7684\u5305\uff1a%s' % [t for (t, d) in s.pkts(2)])
check('\u540d\u5355\u91cc\u7684\u961f\u957f\u5df2\u7ecf\u662f 2', bool(push) and push[-1].get('leader') == 2,
      str(push[-1] if push else None))

# ================================================================ 2. 都掉线 → 队伍还在
sect('2 \u961f\u957f + \u552f\u4e00\u961f\u5458\u90fd\u6389\u7ebf \u2192 \u961f\u4f0d\u8fd8\u5728\uff08\u4e0d\u89e3\u6563\uff09')
s.join(3, 'C')
s.join(4, 'D')
s.step('join C/D')
pid2 = s.make_party(3, 4)
s.leave(3)                       # 队长 C 掉线 → 先交给 D
s.step('leave C')
check('C \u6389\u7ebf\u540e\u961f\u957f\u7ed9\u4e86 D', (s.party(pid2) or {}).get('leader') == 4, str(s.party(pid2)))
s.leave(4)                       # 唯一队员 D 也掉线 → 没人在线
s.step('leave D')
pt = s.party(pid2) or {}
check('\u961f\u4f0d\u4ecd\u7136\u5b58\u5728\uff08\u6ca1\u6709\u81ea\u52a8\u89e3\u6563\uff09', pid2 in s.w.parties,
      '\u73b0\u5728\u7684\u961f\u4f0d\u8868\uff1a%s' % list(s.w.parties))
check('\u6210\u5458\u540d\u5355\u4fdd\u7559 [3, 4]', pt.get('members') == [3, 4], str(pt.get('members')))
check('\u961f\u957f\u88ab\u6807\u6210\u3010\u6682\u65f6\u7a7a\u7f3a\u3011leader_offline=True', pt.get('leader_offline') is True, str(pt))
check('leader \u5b57\u6bb5\u4ecd\u7136\u7559\u7740\uff08\u5ba2\u6237\u7aef\u540d\u5355\u4e0d\u4f1a\u4e71\uff09', pt.get('leader') == 4, str(pt))
check('\u4e24\u4e2a\u4eba\u7684 party_of \u90fd\u8fd8\u5728\uff08\u7b49\u4ed6\u4eec\u56de\u6765\uff09',
      s.pid_of(3) == pid2 and s.pid_of(4) == pid2,
      'party_of=%s' % {k: v for k, v in s.w.party_of.items() if k in (3, 4)})

# ================================================================ 3. 队员掉线 → 不动
sect('3 \u666e\u901a\u961f\u5458\u6389\u7ebf \u2192 \u4ed6\u8fd8\u5728 members \u91cc')
s2 = Sess('dc-member')
s2.join(5, 'E')
s2.join(6, 'F')
s2.join(7, 'G')
s2.step('join E/F/G')
pidm = s2.make_party(5, 6)
s2.op(5, op='invite', cid=7)
s2.step('invite G')
s2.op(7, op='accept', cid=5)
s2.step('accept G')
check('\u4e09\u4eba\u961f\u5efa\u597d\uff08members=[5,6,7]\uff09',
      (s2.party(pidm) or {}).get('members') == [5, 6, 7], str(s2.party(pidm)))
s2.leave(6)                      # ★ F 是普通队员
s2.step('leave F')
pt = s2.party(pidm) or {}
check('F \u4ecd\u7136\u5728 members \u91cc', 6 in (pt.get('members') or []), str(pt.get('members')))
check('\u961f\u957f\u8fd8\u662f E\uff08role 5\uff09', pt.get('leader') == 5, str(pt))
check('\u6ca1\u6709 leader_offline \u6807\u8bb0\uff08\u961f\u957f\u6ca1\u8d70\uff09', 'leader_offline' not in pt, str(pt))
check('F \u6210\u4e86\u5e7d\u7075\uff08\u8fd8\u5728\u4e16\u754c\u91cc\u7b49 6 \u79d2\uff09', s2.player(6) is not None
      and s2.player(6).ghostAt is not None)

# ================================================================ 4. 重连 → 自动回队
sect('4 \u91cd\u8fde\u4e0a\u7ebf \u2192 \u6536\u5230\u961f\u4f0d\u540d\u5355\uff08\u81ea\u52a8\u56de\u5230\u539f\u6765\u7684\u961f\uff09')
s.clear(1)
s.join(1, 'A', cid='c1b')        # ★ A 用新连接回来
s.step('rejoin A')
check('A \u5728\u4e16\u754c\u91cc\u4e86\uff08\u800c\u4e14\u4e0d\u662f\u5e7d\u7075\uff09', s.online(1))
check('A \u7684 party_of \u8fd8\u6307\u7740\u539f\u6765\u7684\u961f', s.pid_of(1) == pid1, str(s.pid_of(1)))
ros = s.pkts(1, 'party')
check('A \u6536\u5230\u4e86\u961f\u4f0d\u540d\u5355\u5305', len(ros) > 0,
      '\u6536\u5230\u7684\u5305\uff1a%s' % [t for (t, d) in s.pkts(1)])
check('\u540d\u5355 pid \u5c31\u662f\u539f\u6765\u7684\u961f', bool(ros) and ros[-1].get('pid') == pid1,
      str(ros[-1] if ros else None))
rows = (ros[-1].get('roster') if ros else None) or []
check('\u540d\u5355\u91cc\u6709 A \u81ea\u5df1\u548c\u961f\u53cb B', sorted([r[0] for r in rows]) == [1, 2], str(rows))
check('\u91cd\u8fde\u540e\u6ca1\u4e22\u961f\u957f\uff08\u961f\u957f\u4ecd\u662f 2\uff09', (s.party(pid1) or {}).get('leader') == 2,
      str(s.party(pid1)))

# ================================================================ 5. 解散后重连 → 清残留
sect('5 \u961f\u4f0d\u89e3\u6563\u540e\u91cd\u8fde \u2192 party_of \u6b8b\u7559\u88ab\u6e05\u6389')
s3 = Sess('dc-disband')
s3.join(10, 'J')
s3.join(11, 'K')
s3.step('join J/K')
pid3 = s3.make_party(10, 11)
s3.leave(11)                     # K 掉线（普通队员 → 不动队伍）
s3.step('leave K')
k = s3.player(11)
k.ghostAt = time.time() - 7.0    # ★ 假装 6 秒宽限已经过了
s3.w._ghost_tick()               # 真跑回收（_save_player 只入队 ✗ 不写盘 ✓）
check('6 \u79d2\u540e\u5e7d\u7075\u88ab\u6536\u56de\uff08K \u4e0d\u5728\u4e16\u754c\u91cc\u4e86\uff09', s3.player(11) is None)
s3.op(10, op='disband')          # 队长 J 解散（这时 K 已经不在 players 里了）
s3.step('disband')
check('\u961f\u4f0d\u5df2\u7ecf\u6ca1\u4e86', pid3 not in s3.w.parties, str(list(s3.w.parties)))
check('\u2605 K \u7684 party_of \u786e\u5b9e\u6210\u4e86\u6b8b\u7559\uff08\u65e7\u4ee3\u7801\u5c31\u662f\u8fd9\u6837\u5361\u4f4f\u7684\uff09',
      s3.pid_of(11) == pid3, 'party_of=%s' % s3.w.party_of)
s3.join(11, 'K', cid='c11b')     # ★ K 重连
s3.step('rejoin K')
check('\u2605 \u91cd\u8fde\u540e\u6b8b\u7559\u88ab\u6e05\u6389\uff08party_of \u91cc\u6ca1\u4ed6\u4e86\uff09', s3.pid_of(11) is None,
      'party_of=%s' % s3.w.party_of)
check('\u4e0d\u4f1a\u88ab\u5f53\u6210\u8fd8\u5728\u961f\u91cc', 11 not in s3.w.party_of)

# ================================================================ 6. 残留 + leave
sect("6 \u6b8b\u7559\u72b6\u6001\u4e0b op='leave' \u4e0d\u62a5\u9519\u4e14\u80fd\u6e05\u5e72\u51c0")
s.join(20, 'M')
s.join(30, 'N')
s.join(31, 'O')
s.step('join M/N/O')
check('M/N/O \u90fd\u8fdb\u4e16\u754c\u4e86', s.online(20) and s.online(30) and s.online(31))
s.clear(20)
s.w.party_of[20] = 'pZZZ'        # ★ 伪造残留：队伍根本不存在
s.op(20, op='leave')
err = s.step('leave with stale')
check("op='leave' \u6ca1\u62a5\u9519", err is None, repr(err))
check('\u6b8b\u7559\u88ab\u6e05\u6389\uff08party_of \u91cc\u6ca1 20 \u4e86\uff09', s.pid_of(20) is None, str(s.w.party_of))
lp = s.pkts(20, 'party')
check('\u6536\u5230\u4e00\u4efd\u3010\u6ca1\u6709\u961f\u4f0d\u3011\u7684\u540d\u5355\uff08roster=None\uff09',
      len(lp) > 0 and lp[-1].get('roster') is None,
      str(lp[-1] if lp else None))
check('\u540d\u5355\u91cc pid \u4e5f\u6e05\u6210 None', bool(lp) and lp[-1].get('pid') is None,
      str(lp[-1] if lp else None))
check('\u771f\u7684\u6ca1\u961f\u4e86\uff08parties \u91cc\u4e5f\u6ca1\u591a\u51fa\u4e1c\u897f\uff09', 'pZZZ' not in s.w.parties)

# ================================================================ 7. 残留 + apply
sect("7 \u6b8b\u7559\u72b6\u6001\u4e0b op='apply' \u4e0d\u4f1a\u88ab\u3010\u4f60\u5df2\u7ecf\u6709\u961f\u4f0d\u4e86\u3011\u62d2\u7edd")
s.clear(30)
s.clear(31)
s.op(31, op='invite', cid=30)    # O 建一个队（顺便拿到一个真 pid ✓）
s.step('invite by O')
pidq = s.pid_of(31)
check('O \u5efa\u597d\u4e86\u961f\uff08pid=%s\uff09' % pidq, bool(pidq) and pidq in s.w.parties)
s.w.party_of[30] = 'pGONE'       # ★ N 身上留一条假残留
s.op(30, op='apply', pid=pidq)
err = s.step('apply with stale')
check("op='apply' \u6ca1\u62a5\u9519", err is None, repr(err))
notes = [d.get('text') for d in s.pkts(30, 'notice')]
check('\u2605 \u6ca1\u6709\u88ab\u3010\u4f60\u5df2\u7ecf\u6709\u961f\u4f0d\u4e86\u3011\u62d2\u7edd',
      '\u4f60\u5df2\u7ecf\u6709\u961f\u4f0d\u4e86' not in notes, str(notes))
check('\u6b63\u5e38\u8d70\u5230\u4e86\u7533\u8bf7\u6d41\u7a0b\uff08\u6536\u5230 \u5df2\u7533\u8bf7\u52a0\u5165\uff09',
      '\u5df2\u7533\u8bf7\u52a0\u5165\uff0c\u7b49\u961f\u957f\u540c\u610f' in notes, str(notes))
check('N \u7684\u6b8b\u7559\u88ab\u6e05\u6389', s.pid_of(30) is None, str(s.w.party_of))
check('\u961f\u957f O \u6536\u5230\u4e86\u7533\u8bf7\uff08partyapply\uff09', len(s.pkts(31, 'partyapply')) > 0,
      str([t for (t, d) in s.pkts(31)]))
check('\u7533\u8bf7\u8fdb\u4e86\u961f\u957f\u7684\u5f85\u5904\u7406\u5217\u8868',
      any(x[0] == 30 for x in s.w.party_apply.get(pidq, [])), str(s.w.party_apply.get(pidq)))

# ================================================================ 8. invite 对方残留
sect('8\uff08\u52a0\u56fa\uff09invite \u65f6\u5bf9\u65b9\u53ea\u6709\u6b8b\u7559 \u2192 \u4e0d\u80fd\u8bf4\u4ed6\u5df2\u7ecf\u5728\u522b\u7684\u961f\u91cc')
s.clear(31)
s.w.party_of[30] = 'pGONE2'      # N 又带了一条假残留
s.op(31, op='invite', cid=30)
err = s.step('invite with stale target')
check('invite \u6ca1\u62a5\u9519', err is None, repr(err))
notes = [d.get('text') for d in s.pkts(31, 'notice')]
check('\u6ca1\u6709\u62a5\u3010\u4ed6\u5df2\u7ecf\u5728\u522b\u7684\u961f\u91cc\u4e86\u3011',
      '\u4ed6\u5df2\u7ecf\u5728\u522b\u7684\u961f\u91cc\u4e86' not in notes, str(notes))
check('\u9080\u8bf7\u771f\u7684\u53d1\u51fa\u53bb\u4e86\uff08\u5bf9\u65b9\u6536\u5230 partyinv\uff09', len(s.pkts(30, 'partyinv')) > 0,
      str([t for (t, d) in s.pkts(30)]))
check('N \u7684\u6b8b\u7559\u88ab\u6e05\u6389', s.pid_of(30) is None, str(s.w.party_of))

# ================================================================ 9. invite 自己残留
sect('9\uff08\u52a0\u56fa\uff09\u81ea\u5df1\u53ea\u6709\u6b8b\u7559\u65f6 invite \u2192 \u65e7\u4ee3\u7801\u8fd9\u91cc KeyError')
s.clear(40)
s.clear(41)
s.join(40, 'P')
s.join(41, 'Q')
s.step('join P/Q')
s.w.party_of[40] = 'pGONE3'      # ★ P 只剩残留 ✗ parties 里没有 pGONE3
s.op(40, op='invite', cid=41)
err = s.step('invite with stale self')
check('invite \u6ca1\u62a5\u9519\uff08\u65e7\u4ee3\u7801\u4f1a KeyError\uff09', err is None, repr(err))
newpid = s.pid_of(40)
check('\u7ed9\u4ed6\u65b0\u5efa\u4e86\u4e00\u4e2a\u771f\u7684\u961f', bool(newpid) and newpid in s.w.parties,
      'pid=%s parties=%s' % (newpid, list(s.w.parties)))
check('Q \u6536\u5230\u4e86\u9080\u8bf7', len(s.pkts(41, 'partyinv')) > 0, str([t for (t, d) in s.pkts(41)]))

# ================================================================ 10. accept 自己残留
sect('10\uff08\u52a0\u56fa\uff09accept \u65f6\u81ea\u5df1\u53ea\u6709\u6b8b\u7559 \u2192 \u7167\u6837\u80fd\u5165\u961f')
s.clear(40)
s.clear(41)
s.w.party_of[41] = 'pGONE4'      # Q 带残留
s.op(40, op='invite', cid=41)
s.step('invite Q again')
s.op(41, op='accept', cid=40)
err = s.step('accept with stale self')
check('accept \u6ca1\u62a5\u9519', err is None, repr(err))
check('\u6b8b\u7559\u88ab\u6e05\u6389\u5e76\u771f\u7684\u8fdb\u4e86\u961f', s.pid_of(41) == s.pid_of(40),
      'Q.party_of=%s P.party_of=%s' % (s.pid_of(41), s.pid_of(40)))
check('Q \u6536\u5230\u961f\u4f0d\u540d\u5355', len(s.pkts(41, 'party')) > 0, str([t for (t, d) in s.pkts(41)]))
check('\u961f\u91cc\u73b0\u5728\u6709 40 \u548c 41',
      sorted((s.party(s.pid_of(40)) or {}).get('members') or []) == [40, 41],
      str(s.party(s.pid_of(40))))

# ================================================================ 11. 队长空缺 → 重连接棒
sect('11\uff08\u52a0\u56fa\uff09\u961f\u957f\u7a7a\u7f3a\u65f6\u91cd\u8fde\u7684\u4eba\u63a5\u68d2')
s.clear(3)
s.join(3, 'C', cid='c3b')        # ★ 第 2 组里 C（原队长）回来
s.step('rejoin C')
pt = s.party(pid2) or {}
check('\u91cd\u8fde\u7684 C \u63a5\u4e86\u68d2\uff08leader == 3\uff09', pt.get('leader') == 3, str(pt))
check('leader_offline \u6807\u8bb0\u88ab\u6e05\u6389', 'leader_offline' not in pt, str(pt))
check('C \u6536\u5230\u961f\u4f0d\u540d\u5355\uff08\u81ea\u52a8\u56de\u961f\uff09', len(s.pkts(3, 'party')) > 0,
      str([t for (t, d) in s.pkts(3)]))

# ================================================================ 12. 正常组队没被改坏
sect('12\uff08\u56de\u5f52\uff09\u6b63\u5e38\u7ec4\u961f / \u9000\u961f / \u89e3\u6563 \u8fd8\u597d\u4f7f')
s4 = Sess('normal')
s4.join(50, 'R')
s4.join(51, 'S')
s4.step('join R/S')
pidn = s4.make_party(50, 51)
check('\u5efa\u961f\uff1aleader=50 members=[50,51]',
      (s4.party(pidn) or {}).get('leader') == 50 and (s4.party(pidn) or {}).get('members') == [50, 51],
      str(s4.party(pidn)))
s4.clear(50)
s4.clear(51)
s4.op(50, op='disband')          # 队长在线时解散（两个成员都在线 ✓）
s4.step('disband online')
check('\u89e3\u6563\u540e\u961f\u4f0d\u6ca1\u4e86', pidn not in s4.w.parties, str(list(s4.w.parties)))
check('\u4e24\u4e2a\u4eba\u7684 party_of \u90fd\u88ab\u6e05\u6389', s4.pid_of(50) is None and s4.pid_of(51) is None,
      str(s4.w.party_of))
check('\u4e24\u4e2a\u4eba\u90fd\u6536\u5230\u89e3\u6563\u6309\u94ae\uff08roster=None\uff09',
      any(d.get('roster') is None for d in s4.pkts(50, 'party'))
      and any(d.get('roster') is None for d in s4.pkts(51, 'party')),
      '%s / %s' % (s4.pkts(50, 'party'), s4.pkts(51, 'party')))
s4.op(50, op='leave')            # 已经没队了再点退队 → 也不能报错
err = s4.step('leave with no party')
check('\u6ca1\u961f\u7684\u4eba\u70b9\u9000\u961f\u4e5f\u4e0d\u62a5\u9519', err is None, repr(err))

# ================================================================ 13. 血空直接出世界
sect('13\uff08\u52a0\u56fa\uff09\u8840\u5df2\u7ecf\u7a7a\u4e86\u90a3\u79cd\u6389\u7ebf\uff08\u4e0d\u7559\u5e7d\u7075 \u2717 \u76f4\u63a5\u51fa\u4e16\u754c\uff09\u4e5f\u8981\u4ea4\u63a5\u961f\u957f')
s7 = Sess('dc-dead-leader')
s7.join(60, 'T')
s7.join(61, 'U')
s7.step('join T/U')
pidd = s7.make_party(60, 61)
s7.player(60).hp = 0             # \u2605 \u961f\u957f T \u5df2\u7ecf\u662f\u5c38\u4f53
s7.leave(60)
err = s7.step('leave dead leader')
check('\u6ca1\u62a5\u9519', err is None, repr(err))
check('\u961f\u957f\u8f6c\u7ed9\u4e86\u5728\u7ebf\u961f\u5458 U\uff08role 61\uff09',
      (s7.party(pidd) or {}).get('leader') == 61, str(s7.party(pidd)))
check('T \u76f4\u63a5\u51fa\u4e86\u4e16\u754c\uff08\u6ca1\u7559\u5e7d\u7075\uff09', s7.player(60) is None)
check('T \u8fd8\u5728 members \u91cc\uff08\u7b49\u4ed6\u56de\u6765\uff09', 60 in ((s7.party(pidd) or {}).get('members') or []),
      str(s7.party(pidd)))

# ================================================================ 盘上没动过
sect('\u76d8\u4e0a\u52a8\u8fc7\u6ca1\u52a8\u8fc7\uff08tick \u7ebf\u7a0b\u96f6\u78c1\u76d8 IO\uff09')
HASH1 = sha(TMPDB)
check('\u6574\u4e2a\u6d4b\u8bd5\u6ca1\u5f80\u526f\u672c\u91cc\u5199\u8fc7\u4e00\u4e2a\u5b57\u8282', HASH0 == HASH1,
      '%s -> %s' % (HASH0[:12], HASH1[:12]))
check('\u2605 \u6574\u4e2a\u6d4b\u8bd5\u4e00\u6b21\u90fd\u6ca1\u6253\u5f00\u8fc7\u771f\u5e93\uff08db.db \u63a2\u5934\uff09',
      DB_SRC not in _OPENED_DB and TMPDB not in _OPENED_DB,
      '\u6253\u5f00\u8fc7\u7684\u5e93\uff1a%s' % _OPENED_DB)
check('\u5b58\u6863\u8d70\u7684\u662f\u3010\u961f\u5217\u3011\u800c\u4e0d\u662f\u76f4\u63a5\u5199\u76d8\uff08\u4e0b\u7ebf\u843d\u5e93\u90a3\u6b21\u53ea\u662f\u8fdb\u4e86\u961f\u5217\uff09',
      s3.w.saves.qsize() > 0,
      'saves \u961f\u5217\u91cc\u73b0\u5728\u79ef\u4e86 %d \u6761\uff08\u5168\u5728\u5185\u5b58\u91cc \u2717 \u6ca1\u6709 saver \u7ebf\u7a0b\u53bb\u5199 \u2713\uff09'
      % s3.w.saves.qsize())

# ================================================================ 汇总
print('')
print('=' * 78)
print('\u901a\u8fc7 %d \u9879 \u2713   \u5931\u8d25 %d \u9879' % (N_PASS[0], len(FAILS)))
if FAILS:
    print('\u5931\u8d25\u6e05\u5355\uff1a')
    for f in FAILS:
        print('  \u2717 ' + f)
else:
    print('\u5168\u90e8\u901a\u8fc7 \u2713 \uff08\u7ec4\u961f\u6389\u7ebf 7 \u6761\u9700\u6c42 + 5 \u6761\u52a0\u56fa\uff09')
print('\u771f\u5e93\u6ca1\u52a8\uff1a%s' % DB_SRC)
shutil.rmtree(TMPDIR, ignore_errors=True)
print('\u4e34\u65f6\u5e93\u5df2\u5220\uff1a%s' % TMPDIR)
print('=' * 78)
sys.exit(1 if FAILS else 0)
