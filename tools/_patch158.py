# -*- coding: utf-8 -*-
"""第 158 轮：魔气配置持久化（用户："管理页面里面的设置会保存，而不是重启就恢复了"）

设计：
  · 存哪：复用现成的 meta 表（key/value ✓ 不用加表 ✗ 不用迁移 ✓）
      key = 'mq_tune'，value = JSON（只有【和默认不一样的】才存 ✓ 省得存一堆默认值 ✓）
  · 谁写：★ HTTP 层写（第 154 轮的教训：写库放 HTTP 层 ✓ 所见即所得 ✓）
      tick 线程那边【只广播一句提示】✗ 不再改 TUNE ✓
      → 单一写者 ✓ 不会"谁后写谁赢"✓
  · 谁读：服务器启动时读一次 ✓（在 tick 起来之前 ✓ 所以不违反线程纪律 ✓）
  · 恢复默认：把 meta 里那行删掉 ✓ 重启也不会回来 ✓
"""
import io
import re

# ==================== ① mq.py：apply_tune / changed_tune ====================
P = 'server/mq.py'
t = io.open(P, encoding='utf-8').read()
A = "def reset_tune():"
assert t.count(A) == 1, t.count(A)
t = t.replace(A, '''def _doc_of(k):
    for kk, doc, kind, lo, hi in TUNE_DOC:
        if kk == k:
            return doc, kind, lo, hi
    return None, None, None, None


def apply_tune(src):
    """把一份配置套进去（校验 + 夹范围 ✓ 未知键忽略 ✓）

    ★ 返回 (套用了几项, 报错说明) ✗ 不抛异常 ✓
      （管理页传错东西不该把服务器带崩 ✓）
    """
    n = 0
    bad = []
    if not isinstance(src, dict):
        return 0, 'not a dict'
    for k, v in src.items():
        if k == 'exp_tiers':
            try:
                tiers = [[int(a), float(b)] for a, b in v]
                TUNE['exp_tiers'] = tiers
                n += 1
            except Exception:
                bad.append(k)
            continue
        doc, kind, lo, hi = _doc_of(k)
        if doc is None:
            continue                       # 未知键：忽略 ✓（以后删过配置也不会炸 ✓）
        try:
            val = float(v) if kind == 'float' else int(float(v))
        except Exception:
            bad.append(k)
            continue
        val = max(lo, min(hi, val))
        TUNE[k] = val
        n += 1
    return n, (','.join(bad) if bad else '')


def changed_tune():
    """只挑【和默认不一样】的项（存库用 ✓ 默认值不存 ✓）

    ★ 为什么：以后改默认值，老库里的配置不会把新默认"顶回去"✗
      （存全量的话，我改了默认值、老库还存着旧默认 ✓ 就永远生效不了 ✓）
    """
    dflt = {
        'kill_gain': KILL_GAIN, 'killed_loss': KILLED_LOSS, 'decay_per_hour': DECAY_PER_HOUR,
        'mq_max': MQ_MAX, 'dmg_per_point': DMG_PER_POINT, 'dmg_cap': DMG_CAP,
        'steal_base': STEAL_BASE, 'steal_per_2': STEAL_PER_2, 'steal_cap': STEAL_CAP,
        'worn_steal_pct': WORN_STEAL_PCT, 'gold_loss': GOLD_LOSS,
        'pair_cooldown': PAIR_COOLDOWN, 'level_gap_max': LEVEL_GAP_MAX, 'safe_r': SAFE_R,
        'exp_tiers': [[501, 0.15], [200, 0.10], [100, 0.08], [0, 0.05]],
    }
    out = {}
    for k, dv in dflt.items():
        cv = TUNE.get(k)
        if cv is None:
            continue
        if isinstance(dv, float):
            if abs(float(cv) - dv) > 1e-9:
                out[k] = cv
        else:
            if cv != dv:
                out[k] = cv
    return out


def reset_tune():''')
io.open(P, 'w', encoding='utf-8', newline='\n').write(t)
print('  OK mq.py：apply_tune / changed_tune')

# ==================== ② app.py：启动读 + 改动后写 ====================
P2 = 'server/app.py'
t2 = io.open(P2, encoding='utf-8').read()

# 启动时读
B = "        if act == 'give':\n            return self._admin_give(payload)"
assert t2.count(B) == 1, t2.count(B)
NEW_B = '''        # ★★ 第 158 轮（用户："设置会保存，而不是重启就恢复了"）★★
        #   ★ 为什么写库放在 HTTP 层：第 154 轮的教训 ——
        #     写库放 tick 线程那边会有"异步 + 可能被吞"的问题 ✗
        #     表现就是"接口返回 200 但值没变"✓ 这里必须所见即所得 ✓
        #   ★ tick 那边只广播一句提示 ✗ 不再改 TUNE ✓（单一写者 ✓）
        if act == 'mqcfg':
            import mq as _mqm
            if payload.get('reset'):
                _mqm.reset_tune()
                saved = {}
            else:
                n, bad = _mqm.apply_tune(payload)
                if bad:
                    return self._send(400, {'ok': False, 'error': '这些值不对：' + bad})
                saved = _mqm.changed_tune()
            try:
                with dbmod.db(self.cfg) as c:
                    if saved:
                        c.execute("INSERT OR REPLACE INTO meta(k, v) VALUES('mq_tune', ?)",
                                  (json.dumps(saved, ensure_ascii=False),))
                    else:
                        c.execute("DELETE FROM meta WHERE k='mq_tune'")
                    c.commit()
            except Exception as e:
                return self._send(500, {'ok': False, 'error': '存库失败：' + str(e)})
            if self.world:
                self.world.post_admin('mqcfg', {'done': 1})
            return self._send(200, {'ok': True, 'act': act, 'saved': saved})
        if act == 'give':
            return self._admin_give(payload)'''
t2 = t2.replace(B, NEW_B)

# 启动装载（放在创建 world 之前 ✓）
C = "        self.world = World("
assert t2.count(C) >= 1, ('world 创建锚点: %d' % t2.count(C))
i = t2.find(C)
t2 = t2[:i] + '''        # ★ 第 158 轮：启动时把存过的魔气配置读进来 ✓
        #   ★ 放在 World 之前 ✗ tick 还没起来 ✓ 所以不碰"只有 tick 改世界"那条规矩 ✓
        try:
            import mq as _mqm0
            with dbmod.db(self.cfg) as _c:
                _row = _c.execute("SELECT v FROM meta WHERE k='mq_tune'").fetchone()
            if _row and _row[0]:
                _n, _bad = _mqm0.apply_tune(json.loads(_row[0]))
                print('[mq] 已装载魔气配置 %d 项%s' % (_n, ('（有问题的项：%s）' % _bad) if _bad else ''))
        except Exception as _e:
            print('[mq] 装载魔气配置失败（用默认值继续）：%s' % _e)
''' + t2[i:]
io.open(P2, 'w', encoding='utf-8', newline='\n').write(t2)
print('  OK app.py：启动装载 + mqcfg 落库')

# ==================== ③ world.py：tick 那边不再改 TUNE ====================
P3 = 'server/world.py'
t3 = io.open(P3, encoding='utf-8').read()
D = """        if act == 'mqcfg':
            if d.get('reset'):
                mqmod.reset_tune()
                self._broadcast(P.pack('notice', text='[管理] 魔气配置已恢复默认'))
                return
            changed = []
            for k, _doc, _kind, _lo, _hi in mqmod.TUNE_DOC:
                if k not in d or d.get(k) is None:
                    continue
                try:
                    v = float(d.get(k)) if _kind == 'float' else int(d.get(k))
                except Exception:
                    continue
                v = max(_lo, min(_hi, v))
                mqmod.TUNE[k] = v
                changed.append(k)
            if changed:
                self._broadcast(P.pack(
                    'notice', text='[管理] 魔气配置已更新（%d 项）' % len(changed)))
            return"""
assert t3.count(D) == 1, ('tick mqcfg 锚点: %d' % t3.count(D))
t3 = t3.replace(D, """        if act == 'mqcfg':
            # ★ 第 158 轮：改配置的活【全在 HTTP 层做完了】✗（含落库 ✓）
            #   这里只负责广播一句提示 ✓（世界里的东西只有 tick 能广播 ✓）
            if d.get('done'):
                self._broadcast(P.pack(
                    'notice', text='[管理] 魔气配置已更新并保存（重启也在）'))
            return""")
io.open(P3, 'w', encoding='utf-8', newline='\n').write(t3)
print('  OK world.py：tick 只广播提示')

# ==================== ④ 管理页：把"重启会回默认"那句改对 ====================
P4 = 'web/admin.html'
t4 = io.open(P4, encoding='utf-8').read()
E = '<h2>魔气设置 <span class="tip">（改完点应用，立刻生效 ✗ 重启会回默认 ✓）</span></h2>'
if t4.count(E) != 1:
    m2 = re.search(r'<h2>魔气设置 <span class="tip">[^<]*</span></h2>', t4)
    assert m2, '管理页那句话找不到'
    E = m2.group(0)
t4 = t4.replace(E, '<h2>魔气设置 <span class="tip">（改完点应用：立刻生效 ✓ 并且会保存 ✓ 重启也在 ✓）</span></h2>')
io.open(P4, 'w', encoding='utf-8', newline='\n').write(t4)
print('  OK admin.html：文案改成"会保存 ✓"')
print('  DONE')
