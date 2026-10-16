# -*- coding: utf-8 -*-
"""账号系统：注册 / 登录 / token 校验 / 退出

设计要点（对应 docs/方案.md §15.1 P0-3）：
  · 密码 PBKDF2-SHA256 + 每账号独立盐 → **绝不存明文**
  · token 落库（tokens 表），走 X-Token 头
  · **一个账号同时只有一个有效 token** —— 新登录踢掉旧的
    （否则同一角色能在两台设备同时在线，等于可以刷）
  · 登录失败有退避：同一名字连续失败多次要等一会儿（挡暴力破解）

对外暴露的都是 (ok, data_or_error) 形式，HTTP 层只负责翻译成状态码。
"""

import hashlib
import os
import re
import secrets
import threading
import time

import db as dbmod
import value as valuemod   # round304c: 全服货架装载要一个上限常量（纯字典 ✗ 无副作用 ✓）
import weapons

# ---------------------------------------------------------------- 参数

PBKDF2_ROUNDS = 200_000          # Python 的 pbkdf2_hmac 是 C 实现，约 60~80ms，可接受
TOKEN_TTL_MS = 30 * 24 * 3600 * 1000    # token 有效期 30 天
NAME_RE = re.compile(r'^[0-9A-Za-z_\u4e00-\u9fa5-]{2,10}$')
PW_MIN, PW_MAX = 6, 64

MAX_FAIL = 5                     # 连续失败几次开始退避
FAIL_WINDOW = 60.0               # 退避观察窗口（秒）
FAIL_COOLDOWN = 30.0             # 退避时长（秒）

# 首次进游戏送几点天赋，让新手一进来就能加点（炼气 1 级）
START_TALENT = 3
SKILL_PAGES = 4                  # 方案 §6.1：初始 4 页
PAGE_ACTIVES = 4                 # 每页 4 主动
PAGE_PASSIVES = 5                # 每页 5 被动

_fail_lock = threading.Lock()
_fails = {}                      # name(lower) -> [失败时间戳...]


# ---------------------------------------------------------------- 内部

def _hash_pw(password, salt_hex):
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'),
                             bytes.fromhex(salt_hex), PBKDF2_ROUNDS)
    return dk.hex()


def _new_salt():
    return os.urandom(16).hex()


def _new_token():
    return secrets.token_urlsafe(32)


def _norm_name(name):
    return (name or '').strip()


def _check_name(name):
    if not name:
        return '请填写游戏名'
    if not NAME_RE.match(name):
        return '游戏名只能 2~10 个中英文、数字、下划线或短横线'
    return None


def _check_pw(pw):
    if not pw:
        return '请填写密码'
    if len(pw) < PW_MIN:
        return '密码至少 %d 位' % PW_MIN
    if len(pw) > PW_MAX:
        return '密码最多 %d 位' % PW_MAX
    return None


def _fail_state(name):
    """返回还差多少秒才能再试；0 = 可以试"""
    k = name.lower()
    now = time.time()
    with _fail_lock:
        arr = [t for t in _fails.get(k, []) if now - t < FAIL_WINDOW]
        _fails[k] = arr
        if len(arr) >= MAX_FAIL:
            wait = FAIL_COOLDOWN - (now - arr[-1])
            if wait > 0:
                return wait
        return 0


def _fail_add(name):
    k = name.lower()
    now = time.time()
    with _fail_lock:
        arr = [t for t in _fails.get(k, []) if now - t < FAIL_WINDOW]
        arr.append(now)
        _fails[k] = arr


def _fail_clear(name):
    with _fail_lock:
        _fails.pop(name.lower(), None)


def _issue_token(c, account_id):
    """发新 token。★ 先把该账号的旧 token 全删掉（单点在线）"""
    c.execute('DELETE FROM tokens WHERE account_id=?', (account_id,))
    tk = _new_token()
    now = dbmod.now_ms()
    c.execute('INSERT INTO tokens(token, account_id, created_at, last_seen) VALUES(?,?,?,?)',
              (tk, account_id, now, now))
    return tk


def _new_role(c, account_id, name):
    """建角色 + 4 个空技能页"""
    now = dbmod.now_ms()
    cur = c.execute(
        'INSERT INTO roles(account_id, name, level, exp, hp, qi, x, z, yaw,'
        ' talent_free, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        (account_id, name, 1, 0, 0, 0, 0.0, 0.0, 0.0, START_TALENT, now, now))
    role_id = cur.lastrowid
    for i in range(SKILL_PAGES):
        c.execute('INSERT INTO skill_pages(role_id, page_index, actives, passives)'
                  ' VALUES(?,?,?,?)', (role_id, i, '[]', '[]'))
    return role_id


def role_public(row):
    """把 roles 行转成可以发给客户端的样子（不含敏感字段）"""
    if row is None:
        return None
    return {
        'id': row['id'],
        'name': row['name'],
        'level': row['level'],
        'exp': row['exp'],
        'hp': row['hp'],
        'qi': row['qi'],
        'x': row['x'],
        'z': row['z'],
        'yaw': row['yaw'],
        'talentFree': row['talent_free'],
        'playedAt': row['updated_at'],
        # ★★★ 第 164 轮修的真 bug（用户：刷新一下就没了）★★★
        #   这里是【挑过字段】的（只给客户端该看的 ✓ 设计正确 ✗）
        #   但魔气漏了 → 网络层拿到的 role 里根本没有 mq ✗
        #   → settle(None, ...) = 0 → 每次登录/刷新都从 0 开始 ✗✓
        #     （表现：管理页设了也有 ✓ 但刷新就没了 ✗）
        #   ★ 为什么难查：库里有（我查了库 ✓）内存里也能设（who 查了 ✓）
        #     就这个中间层偷偷把它丢了 ✗（和客户端那个映射层一个毛病 ✗）
        'mq': int(row['mq'] or 0),
        'mqAt': int(row['mq_at'] or 0),
        # round302: gold was missing here and that made the whole gold system
        # session-only - Player() reads this dict, so without the key every login
        # started from 0 (and the db value was never read at all).
        # Exactly the same trap as the 'mq' line above: row[col] exists, but this
        # picking layer drops it.
        'gold': int(row['gold'] or 0),
    }


# ---------------------------------------------------------------- 对外接口

def register(cfg, name, password):
    """注册 → (True, {'token':…, 'role':…}) / (False, '错误说明')"""
    name = _norm_name(name)
    err = _check_name(name) or _check_pw(password)
    if err:
        return False, err

    salt = _new_salt()
    ph = _hash_pw(password, salt)
    now = dbmod.now_ms()
    try:
        with dbmod.db(cfg) as c:
            if c.execute('SELECT id FROM accounts WHERE name=? COLLATE NOCASE',
                         (name,)).fetchone():
                return False, '这个游戏名已经被用了'
            cur = c.execute(
                'INSERT INTO accounts(name, pass_hash, salt, created_at, last_login)'
                ' VALUES(?,?,?,?,?)', (name, ph, salt, now, None))
            acc_id = cur.lastrowid
            _new_role(c, acc_id, name)
            tk = _issue_token(c, acc_id)
            row = c.execute('SELECT * FROM roles WHERE account_id=?', (acc_id,)).fetchone()
            return True, {'token': tk, 'role': role_public(row), 'fresh': True}
    except Exception as e:
        return False, '注册失败：%s' % e


def login(cfg, name, password):
    """登录 → (True, {'token':…, 'role':…}) / (False, '错误说明')"""
    name = _norm_name(name)
    if not name or not password:
        return False, '请填写游戏名和密码'

    wait = _fail_state(name)
    if wait > 0:
        return False, '失败次数太多，请 %.0f 秒后再试' % wait

    with dbmod.db(cfg) as c:
        row = c.execute('SELECT * FROM accounts WHERE name=? COLLATE NOCASE',
                        (name,)).fetchone()
        # ★ 账号不存在 / 密码错，返回同一句话（不泄露"这个名字存在"）
        if not row or row['banned']:
            _fail_add(name)
            return False, '游戏名或密码不对'
        if not secrets.compare_digest(_hash_pw(password, row['salt']), row['pass_hash']):
            _fail_add(name)
            return False, '游戏名或密码不对'

        _fail_clear(name)
        now = dbmod.now_ms()
        c.execute('UPDATE accounts SET last_login=? WHERE id=?', (now, row['id']))
        tk = _issue_token(c, row['id'])
        role = c.execute('SELECT * FROM roles WHERE account_id=?', (row['id'],)).fetchone()
        if role is None:                       # 老账号没有角色就补一个
            _new_role(c, row['id'], row['name'])
            role = c.execute('SELECT * FROM roles WHERE account_id=?', (row['id'],)).fetchone()
        return True, {'token': tk, 'role': role_public(role), 'fresh': False}


def check_token(cfg, token):
    """校验 token → (True, {'account':…, 'role':…}) / (False, '错误说明')"""
    if not token:
        return False, '缺少登录凭证'
    now = dbmod.now_ms()
    with dbmod.db(cfg) as c:
        t = c.execute('SELECT * FROM tokens WHERE token=?', (token,)).fetchone()
        if not t:
            return False, '登录已失效，请重新登录'
        if t['created_at'] and now - t['created_at'] > TOKEN_TTL_MS:
            c.execute('DELETE FROM tokens WHERE token=?', (token,))
            return False, '登录已过期，请重新登录'
        c.execute('UPDATE tokens SET last_seen=? WHERE token=?', (now, token))
        acc = c.execute('SELECT * FROM accounts WHERE id=?', (t['account_id'],)).fetchone()
        if not acc or acc['banned']:
            return False, '账号不可用'
        role = c.execute('SELECT * FROM roles WHERE account_id=?', (acc['id'],)).fetchone()
        return True, {'account': acc, 'role': role}


def logout(cfg, token):
    """退出：删掉这个 token"""
    if not token:
        return False, '缺少登录凭证'
    with dbmod.db(cfg) as c:
        c.execute('DELETE FROM tokens WHERE token=?', (token,))
    return True, {'ok': True}


# ---------------------------------------------------------------- 背包 / 装备（第 47 轮）

# 分类顺序（★ 一键整理用 ✗ 和 value.CAT_ORDER 是一个口径 ✓）
_SORT_CAT = {'weapon': 0, 'armor': 1, None: 2}
#   同一类里再按"小类"排（★ 用户："按分类和种类品质进行排序"✓）
_SORT_KIND = {
    'dagger': 0, 'sword': 1, 'saber': 2, 'staff': 3, 'spear': 4, 'axe': 5,
    'hammer': 6, 'bow': 7, 'armor': 0, 'helmet': 1, 'boots': 2,
}


def bag_sort(cfg, role_id):
    """一键整理：给背包排个序 ✗ 把顺序写进 items.slot_index ✓

    ★★ round304v（用户："增加一个一键整理的按钮，按分类和种类品质进行排序"）★★
    ★ 顺序规则（都是"一眼能找到"优先 ✓）：
        ① 大类：武器 → 防具 → 材料 → 其它
        ② 小类：剑/刀/棍…（武器）· 甲/盔/靴（防具）· 材料按名字
        ③ 品质：同一小类里【品阶高的在前】✗ 同阶按物品等级 ✓
        ④ 品阶等级都一样：按名字（稳定 ✗ 不会每次整理都变顺序 ✓）
    ★ 为什么用 slot_index 而不是每次读的时候现算：
        现算的话玩家【自己摆的顺序】就没了 ✗ 而且"整理"这个词本身就是"存下来"✓
      （slot_index 这个列一直在写 -1 ✗ 但从来没人读 ✓ 正好拿来用 ✓）
    ★ 线程：这是【读 + 写库】✗ 所以只能在网络线程调 ✓（见 net.py ✓）
    返回 (ok, 新的背包列表 / 错误说明) ✓
    """
    import json
    try:
        with dbmod.db(cfg) as c:
            rows = c.execute(
                'SELECT id, item_json, stack FROM items'
                ' WHERE role_id=? AND in_storage=0', (role_id,)).fetchall()
            items = []
            for rid, js, stack in rows:
                try:
                    it = json.loads(js)
                except Exception:
                    continue
                if not isinstance(it, dict):
                    continue
                items.append((int(rid), it, int(stack or 1)))
            def _key(rec):
                rid, it, _st = rec
                slot = it.get('slot') or None
                cat = _SORT_CAT.get(slot, 3) if slot else 2
                # ★ 武器的"小类"在 look 里（sword/staff/axe… ✓）✗ 不是 kind
                #   （kind 只有材料才有 ✓ 自测抓到的：拿 kind 当小类会把所有武器
                #     都归成同一类 ✗ 于是品阶高的反而排到后面 ✓）
                kind = str(it.get('look') or it.get('kind') or '')
                return (cat,
                        _SORT_KIND.get(kind, 50),
                        -int(it.get('tier') or 0),
                        -int(it.get('itemLv') or 0),
                        str(it.get('name') or ''),
                        rid)
            items.sort(key=_key)
            n = 0
            for idx, rec in enumerate(items):
                c.execute('UPDATE items SET slot_index=? WHERE id=? AND role_id=?',
                          (idx, rec[0], role_id))
                n += 1
        #   整理完读一次（顺序就是刚写的那个 ✓ 和面板看到的完全一致 ✓）
        return True, bag_of(cfg, role_id)
    except Exception as e:
        return False, '整理失败：%r' % (e,)


def bag_of(cfg, role_id, cap=2000):
    """读【背包】（in_storage=0）里的东西 → [{id, item}, ...]（新的在前 ✓）

    ★ 只读，不改状态 —— 所以走 HTTP 就行，不用占 tick 线程 ✓
    ★ cap 是保险：背包再多也不会一次全发给客户端（省流量 + 免得面板卡）✓

    ★★★ 第 236 轮修的真 bug（用户："fangou 的武器和防具在背包里都看不到了"）★★★
      原来 cap = 60 ✗ 而 SQL 是 ORDER BY id DESC LIMIT 60 ✓
      → 只发【最新的 60 件】✗
      → 用户挂机刷怪，背包 797 件 ✓
      → 他身上那两件装备（一件 id=465 很老 ✓）根本不在发送范围里 ✓✓
      → 表现：背包里看不到 ✗ 但装备照常生效 ✓✓ 一字不差
      ★ 为什么以前没人发现：正常玩背包很难超过 60 件 ✗
        是挂机刷怪把数据量打上去之后才暴露的 ✓
      ★ 上限提到 2000：够用（他 797 件 ✓）而且数据量还能接受
        （800 件 × 每件约 300 字节 ≈ 240KB ✗ 局域网/手机上 1~2 秒内 ✓）
      ★★ 更好的做法是【服务器分页】（一次只取一页 35 件 ✓）
         但那要改协议 ✗ 现在先不动 ✗ 记在这里以后再优化 ✓
    """
    import json
    out = []
    try:
        with dbmod.db(cfg) as c:
            # ★ round304v：整理过的按 slot_index 排 ✗ 没整理过的还是"新的在前"✓
            #   （一条 ORDER BY 就够 ✗ 不用加列不用迁移 ✓）
            rows = c.execute(
                'SELECT id, item_json, stack FROM items WHERE role_id=? AND in_storage=0'
                ' ORDER BY (slot_index IS NULL), slot_index, id DESC LIMIT ?',
                (role_id, int(cap))).fetchall()
    except Exception:
        return out
    for rid, js, stack in rows:
        try:
            it = json.loads(js)
        except Exception:
            continue
        if isinstance(it, dict):
            # ★ 第 74 轮：老武器（第 59 轮之前掉的）没有 dur/durMax
            #   → 读到就补上 ✓ 不然背包里那条"耐久"根本不显示 ✗
            weapons.ensure_dur(it)
            # ★ 第 54 轮：把数量带上（材料会堆叠 ✓ 武器永远是 1 ✓）
            out.append({'id': rid, 'item': it, 'stack': int(stack or 1)})
    return out


def pending_gold_of(cfg, role_id):
    """未入账的金币 → [{'id': n, 'amount': n, 'why': 'sell'}, ...]

    round302: written by the 'gain' intent when the player was offline, and until
    now NOTHING ever read it back - the rows piled up as done=0 forever, so offline
    income simply never arrived (the live db still had a stale row for role 927).

    Same pattern as weapon_of(): read on the NETWORK thread at login (it may do disk
    IO), hand the list to the tick thread, which credits it through _gain_gold() and
    queues the done=1 update. The tick thread itself never touches the db.
    """
    out = []
    try:
        with dbmod.db(cfg) as c:
            rows = c.execute(
                'SELECT id, amount, why FROM pending_gold'
                ' WHERE role=? AND done=0 ORDER BY id', (role_id,)).fetchall()
    except Exception:
        return out
    for pid, amount, why in rows:
        out.append({'id': int(pid), 'amount': int(amount or 0), 'why': str(why or '')})
    return out


# ---------------------------------------------------------------- 装备（第 47 轮）

def weapon_of(cfg, role_id):
    """读出这个角色【已装备的武器】→ (weapon 字典 或 None, item_id 或 None)

    ★ 为什么放在这里（而不是 tick 线程）：tick 线程【不许碰磁盘】✗
      装备是罕见操作，在网络线程（asyncio）里查库 ✓ 再把结果丢给 tick 线程 ✓
    ★ 查不到就返回 None —— World 那边会用一把【默认单手剑】兜底 ✓
      （数值 = 以前写死的 2.4/1.05/0.62，所以老角色手感不变 ✓）
    """
    import json
    try:
        with dbmod.db(cfg) as c:
            row = c.execute(
                'SELECT i.id, i.item_json FROM equipment e JOIN items i ON i.id = e.item_id'
                ' WHERE e.role_id=? AND e.slot=?', (role_id, 'weapon')).fetchone()
    except Exception:
        return None, None
    if not row:
        return None, None
    try:
        w = json.loads(row[1])
    except Exception:
        return None, None
    if not isinstance(w, dict) or w.get('slot') != 'weapon':
        return None, None
    weapons.ensure_dur(w)            # ★ 第 74 轮：老武器补耐久 ✓
    return w, row[0]


def talents_of(cfg, role_id):
    """读天赋加点（第 114 轮，方案 docs/天赋方案.md §6）

    ★ 线程纪律：这个方法【只在网络线程调】✓（登录时装载 ✓ 或处理加点 intent 前 ✓）
      tick 线程只读内存里的 Player.tal ✗ 从不碰 DB ✓（铁律 ✓）
    """
    out = {}
    try:
        with dbmod.db(cfg) as c:
            for stat, pts in c.execute(
                    'SELECT stat, points FROM talents WHERE role_id=?', (role_id,)):
                try:
                    n = int(pts or 0)
                except Exception:
                    continue
                if n > 0:
                    out[str(stat)] = n
    except Exception:
        return {}
    return out


def talent_set(cfg, role_id, stat, points):
    """写一个属性的点数（points<=0 就删行 ✓ 不留垃圾行 ✓ 方案 §9）"""
    with dbmod.db(cfg) as c:
        if int(points or 0) <= 0:
            c.execute('DELETE FROM talents WHERE role_id=? AND stat=?', (role_id, stat))
        else:
            c.execute('INSERT INTO talents(role_id, stat, points) VALUES(?,?,?) '
                      'ON CONFLICT(role_id, stat) DO UPDATE SET points=excluded.points',
                      (role_id, stat, int(points)))
        c.commit()
    return True


def talent_reset(cfg, role_id):
    """洗点：全清 ✓"""
    with dbmod.db(cfg) as c:
        c.execute('DELETE FROM talents WHERE role_id=?', (role_id,))
        c.commit()
    return True


def armor_of(cfg, role_id):
    """读出这个角色【已装备的防具】→ (armor 字典 或 None, item_id 或 None)

    ★ 踩过的坑：我一开始写成 _equipped(cfg, role_id, 'armor') ✗
      可 _equipped() 这个函数【根本不存在】✗（凭印象写的 ✗）
      → /api/bag 直接抛异常 → 空响应 ERR_EMPTY_RESPONSE
      → 背包永远是空的 → 一次崩掉 11 条 UI 断言 ✗
    ★ 照 weapon_of 的写法重写（结构完全一样 ✓ 只是 slot 不同 ✓）
    """
    import json
    try:
        with dbmod.db(cfg) as c:
            row = c.execute(
                'SELECT i.id, i.item_json FROM equipment e JOIN items i ON i.id = e.item_id'
                ' WHERE e.role_id=? AND e.slot=?', (role_id, 'armor')).fetchone()
    except Exception:
        return None, None
    if not row:
        return None, None
    try:
        ar = json.loads(row[1])
    except Exception:
        return None, None
    if not isinstance(ar, dict) or ar.get('slot') != 'armor':
        return None, None
    return ar, row[0]


def market_rows_of(cfg, role_id, all_sellers=True):
    """读出【在售】的上架单 → [(lid, seller, price, item_json, ts, expire, stack, qty), ...]

    ★★ round304r：列的【顺序】必须和 market.load_rows 解包的一模一样 ★★
      自测抓到的真 bug（是用户先看出来的："买家的数量滑条不出来"）：
        这里原来写成 ... ts, expire, qty ✗（第 6 位是 expire、第 7 位是 qty）
        而 load_rows 按 ... ts, expire, stack, qty 解包 ✓
        → expire 被当成 stack、qty 被当成 expire ✗
        → 买家看到的所有上架单【qty 永远是 1】✗（所以数量滑条根本不出现 ✓）
          而且 row['stack'] 变成了毫秒时间戳（脏值 ✗ 界面没用到所以一直没露 ✓）
      ★ 教训：这种"位置对不上"的错【不会报错】✗ 只会安静地给出错数据 ✓
        所以离线测试里必须有"这个数一定等于那个数"的断言（已加 ✓）
      ★ 修法：让【两边的列顺序一致】（这里 ts, expire, qty ✗ load_rows 那边
        必须按 7 列解包、stack 固定当 1 ✓）
      ★★ 我第一版修错了，值得记下来：我以为"少读了一列 stack"✗ 就往 SELECT 里
         加了一列 stack ✓ 结果 sqlite 直接报 no such column: stack ✓
         —— listings 表【本来就没有 stack 列】（物品本身是整份 JSON ✗ 没有单独列 ✓）
         ★ 教训：改 SQL 之前先看一眼【表结构】（PRAGMA table_info ✓ 一条命令 ✓）
           我凭印象改 ✗ 白跑一轮 ✓

    round304b: 交易所的货架要在内存里（tick 线程不许读库 ✗），
    所以由【网络线程】把库读出来，交给 tick 只做内存装配（和 weapon_of 同一个套路 ✓）。

    round304c: all_sellers=True（默认）读【全服在售】✗ 不再只读自己的 ✓
      ★ 为什么必须全量：内存货架就是"别人也能看见"的唯一来源 ✓
        只装自己的话 ✗ 面板一打开是空的 ✓（自测当场就是这个现象 ✓）
      ★ 代价：每次读都在网络线程扫一遍 listings ✗
        预期量级几百~几千行（方案 v9 §9）✗ 一次全表读完全可接受 ✓
      ★ 什么时候读：① 登录时 ② 玩家点开交易所时（低频 ✗ 见 net.py ✓）
    ★ state='on' 才算货架上的（sold/cancelled/expired 是历史 ✗ 不进内存 ✓）
    """
    import json
    out = []
    try:
        with dbmod.db(cfg) as c:
            if all_sellers:
                # ★ round304l：qty 一起读（还剩几个 ✓ 买家可以只买一部分 ✓）
                rows = c.execute(
                    "SELECT lid, seller, price, item_json, ts, expire, qty"
                    " FROM listings WHERE state='on' ORDER BY lid LIMIT ?",
                    (int(valuemod.MKT_SHELF_MAX),)).fetchall()
            else:
                rows = c.execute(
                    "SELECT lid, seller, price, item_json, ts, expire, qty"
                    " FROM listings WHERE seller=? AND state='on' ORDER BY lid",
                    (int(role_id),)).fetchall()
    except Exception:
        return out
    for rec in rows:
        lid, seller, price, js, ts, expire = (rec[0], rec[1], rec[2], rec[3],
                                              rec[4], rec[5])
        qty = rec[6] if len(rec) > 6 else 1
        try:
            it = json.loads(js)
        except Exception:
            continue
        if not isinstance(it, dict):
            continue
        out.append((int(lid), int(seller), int(price), js, int(ts or 0),
                    int(expire or 0), max(1, int(qty or 1))))
    return out


def equip_armor(cfg, role_id, item_id):
    """穿上防具（★ 同样【没有等级门槛】✓ 高级防具只是发挥不出来 ✓）"""
    if not item_id:
        return False, '没指定装备'
    import json
    # ★★ 第 101 轮修的真 bug：这里原来写的是 db(...) ✗
    #   而本模块里 db 是以 dbmod 的名字导入的 ✓ → NameError ✗
    #   → 异常发生在【网络线程】处理穿戴那一步 → 连接被掐断 ✗
    #   → 用户看到的就是"一穿戴就断开连接"✓✓
    #   （第 67 轮我写这段时太赶了 ✗ 还留了 self.cfg if False else cfg 这种垃圾 ✗ 一并清掉 ✓）
    with dbmod.db(cfg) as c:
        row = c.execute('SELECT item_json FROM items WHERE id=? AND role_id=?',
                        (int(item_id), role_id)).fetchone()
        if not row:
            return False, '背包里没有这件装备'
        try:
            it = json.loads(row[0])
        except Exception:
            return False, '这件装备的数据坏了'
        if (it or {}).get('slot') != 'armor':
            return False, '这不是防具'
        c.execute('DELETE FROM equipment WHERE role_id=? AND slot=?', (role_id, 'armor'))
        c.execute('INSERT INTO equipment (role_id, slot, item_id) VALUES (?,?,?)',
                  (role_id, 'armor', int(item_id)))
    return True, it


def unequip_armor(cfg, role_id):
    with dbmod.db(cfg) as c:      # ★ 第 101 轮：同上（原来也是 db ✗）
        c.execute('DELETE FROM equipment WHERE role_id=? AND slot=?', (role_id, 'armor'))
    return True, None


def sell_item(cfg, role_id, item_id):
    """Sell one stack to the system. Returns (ok, price_or_reason, item_name).

    \u2605\u2605 Server-authoritative (same rule as equip_weapon):
        the client only says "sell item id=N"; whether it is his, whether it is
        still in the bag, whether it is locked - all decided here from the db.

    \u2605\u2605 This function does NOT touch roles.gold on purpose.
        Gold is memory-authoritative (see docs v3 section 1); writing the db here
        would be overwritten by the tick thread\u0027s periodic full save.
        The caller posts a (\u0027gain\u0027, ...) intent instead, and the tick
        thread credits it - online immediately, offline via pending_gold.
    """
    import json
    try:
        iid = int(item_id)
    except Exception:
        return False, '\u53c2\u6570\u4e0d\u5bf9', ''
    try:
        with dbmod.db(cfg) as c:
            row = c.execute(
                'SELECT item_json, stack FROM items'
                ' WHERE id=? AND role_id=? AND in_storage=0',
                (iid, role_id)).fetchone()
            if not row:
                return False, '\u80cc\u5305\u91cc\u6ca1\u6709\u8fd9\u4ef6\u4e1c\u897f', ''
            try:
                it = json.loads(row[0])
            except Exception:
                return False, '\u8fd9\u4ef6\u4e1c\u897f\u574f\u4e86', ''
            if not isinstance(it, dict):
                return False, '\u8fd9\u4ef6\u4e1c\u897f\u574f\u4e86', ''
            # \u2605 \u9501\u5b9a\u4e2d\uff08\u4ea4\u6613\u6240\u4e0a\u67b6\u4e2d\uff09\u4e0d\u80fd\u5356
            if it.get('locked_by') or it.get('locked'):
                return False, '\u8fd9\u4ef6\u4e1c\u897f\u6b63\u5728\u4ea4\u6613\u6240\u4e0a\u67b6\uff0c\u4e0d\u80fd\u5356', ''
            n = max(1, int(row[1] or 1))
            try:
                import value as valuemod
                price = int(valuemod.value_of(it, n))
            except Exception:
                return False, '\u7b97\u4e0d\u51fa\u4ef7\u683c', ''
            if price <= 0:
                return False, '\u8fd9\u4ef6\u4e1c\u897f\u5356\u4e0d\u4e86\u94b1', ''
            # \u2605 \u4e00\u6761 DELETE \u5c31\u591f\uff08\u91d1\u5e01\u4e0d\u5199\u5e93 \u2717 \u6240\u4ee5\u4e0d\u9700\u8981\u591a\u8bed\u53e5\u4e8b\u52a1\uff09
            cur = c.execute('DELETE FROM items WHERE id=? AND role_id=? AND in_storage=0',
                            (iid, role_id))
            if cur.rowcount != 1:
                return False, '\u7269\u54c1\u72b6\u6001\u5df2\u53d8\u5316\uff0c\u8bf7\u91cd\u8bd5', ''
            c.commit()
        name = str(it.get('name') or '\u7269\u54c1')
        return True, price, name
    except Exception as e:
        return False, '\u5356\u51fa\u5931\u8d25\uff1a%r' % (e,), ''



def equip_weapon(cfg, role_id, item_id, role_level):
    """装上一件武器 → (True, weapon 字典) / (False, 原因)

    ★★ 服务器权威 ★★
       客户端只是说"我要装背包里 id=N 的那件" ✗
       是不是他的、是不是武器、等级够不够、真实数值是多少 —— 一律这里查库判定 ✓
       不然改个包就能宣布"我手里是系数 99 的神器"✗（和伤害、掉率一个道理 ✓）
    """
    import json
    try:
        iid = int(item_id)
    except Exception:
        return False, '参数不对'
    try:
        with dbmod.db(cfg) as c:
            row = c.execute('SELECT item_json FROM items WHERE id=? AND role_id=? AND in_storage=0',
                            (iid, role_id)).fetchone()
            if not row:
                return False, '背包里没有这件东西'
            try:
                w = json.loads(row[0])
            except Exception:
                return False, '这件东西坏了'
            if not isinstance(w, dict) or w.get('slot') != 'weapon':
                return False, '这不是武器'
            if w.get('broken'):
                return False, '这件武器已损坏，不能使用'
            # ★★ 第 53 轮：不再拦"等级不够" ★★
            #   用户要求：能装、能看、能打，只是发挥不出最大伤害 ✓
            #   限制伤害那条在 weapons.mastery_of + §7.5 封顶里做 ✓（不在穿的时候拦 ✗）
            now = dbmod.now_ms()
            c.execute('INSERT OR REPLACE INTO equipment(role_id, slot, item_id) VALUES(?,?,?)',
                      (role_id, 'weapon', iid))
            c.execute('UPDATE roles SET updated_at=? WHERE id=?', (now, role_id))
        return True, w
    except Exception as e:
        return False, '穿上失败：%s' % e


def unequip_weapon(cfg, role_id):
    """脱下武器 → (True, None) / (False, 原因)"""
    try:
        with dbmod.db(cfg) as c:
            c.execute('DELETE FROM equipment WHERE role_id=? AND slot=?', (role_id, 'weapon'))
            c.execute('UPDATE roles SET updated_at=? WHERE id=?', (dbmod.now_ms(), role_id))
        return True, None
    except Exception as e:
        return False, '脱下失败：%s' % e


def kick_account(cfg, account_id):
    """把某个账号的 token 全清掉（改密码 / 封号 / 强制下线用）"""
    with dbmod.db(cfg) as c:
        c.execute('DELETE FROM tokens WHERE account_id=?', (account_id,))
    return True, {'ok': True}
