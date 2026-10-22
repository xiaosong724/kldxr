# -*- coding: utf-8 -*-
"""round466 第二部分：世界逻辑（捡起时自动卖 + 设置意图）"""
import io

p = 'server/world.py'
s = io.open(p, encoding='utf-8').read()


def rep(old, new, tag):
    global s
    assert s.count(old) == 1, (tag, s.count(old))
    s = s.replace(old, new, 1)
    print('  ok:', tag)


# ① 捡东西：先判断"要不要自动卖"
rep("""        it = e['item']
        # \u2605 \u7b2c 250 \u8f6e\uff08\u7528\u6237\u8981\u6c42\uff09\uff1a\u637f\u5230 5 \u9636\u53ca\u4ee5\u4e0a\u8981\u64ad\u62a5""",
    """        it = e['item']
        # \u2605\u2605\u2605 round466\uff08\u7528\u6237\uff1a"\u589e\u52a0\u88c5\u5907\u81ea\u52a8\u51fa\u552e\uff0c\u53ef\u4ee5\u8bbe\u7f6e\u4f4e\u4e8e\u591a\u5c11\u9636\u83b7\u53d6\u540e\u81ea\u52a8\u51fa\u552e"\uff09\u2605\u2605\u2605
        #   \u5728\u3010\u637f\u8d77\u90a3\u4e00\u523b\u3011\u5c31\u5356\u6389 \u2717 \u4e0d\u8fdb\u80cc\u5305 \u2713
        #   \u2605 \u53ea\u5bf9\u88c5\u5907\uff08\u6b66\u5668/\u9632\u5177\uff09\u751f\u6548 \u2717 \u6750\u6599\u4e0d\u5356 \u2713
        #   \u2605 \u4ef7\u683c\u7528 value.value_of\uff08\u548c\u80cc\u5305\u91cc\u5356\u7cfb\u7edf\u540c\u4e00\u5957\u516c\u5f0f \u2713\uff09
        try:
            _as = int((p.role or {}).get('autosell') or 0)
        except Exception:
            _as = 0
        if _as > 0 and it.get('slot') in ('weapon', 'armor'):
            _tier_no = int(it.get('tier') or 0) + 1          # 0 \u57fa \u2192 \u663e\u793a\u5c42\u6570 \u2713
            if _tier_no < _as:
                try:
                    import value as _vm
                    _price = int(_vm.value_of(it, 1))
                except Exception:
                    _price = 0
                if _price > 0:
                    self._gain_gold(p, _price, '\u81ea\u52a8\u51fa\u552e')
                    self.loot.pop(lid, None)
                    self._send_cid(p.cid, P.pack(
                        'notice',
                        text='\u81ea\u52a8\u51fa\u552e\uff1a%s\uff08%d \u9636\uff09\u2192 +%d \u91d1\u5e01'
                             % (it.get('name') or '\u88c5\u5907', _tier_no, _price)))
                    return
        # \u2605 \u7b2c 250 \u8f6e\uff08\u7528\u6237\u8981\u6c42\uff09\uff1a\u637f\u5230 5 \u9636\u53ca\u4ee5\u4e0a\u8981\u64ad\u62a5""",
    'pick autosell')

# ② 设置意图
rep("""        elif t == 'statask':""",
    """        elif t == 'autosell':
            # \u2605 round466\uff1a\u8bbe\u7f6e\u81ea\u52a8\u51fa\u552e\u9608\u503c\uff080 = \u5173 \u2717 1~12 = \u4f4e\u4e8e\u8fd9\u4e48\u591a\u9636\u5c31\u5356\uff09\u2713
            try:
                _n = int(d.get('tier') or 0)
            except Exception:
                _n = 0
            _n = max(0, min(12, _n))
            p.role['autosell'] = _n
            self.post_save('UPDATE roles SET autosell=?, updated_at=? WHERE id=?',
                           (_n, dbmod.now_ms(), p.role_id))
            self._send_cid(p.cid, P.pack(
                'notice',
                text=('\u81ea\u52a8\u51fa\u552e\u5df2\u5f00\u542f\uff1a\u4f4e\u4e8e %d \u9636\u7684\u88c5\u5907\u637f\u8d77\u5c31\u5356' % _n)
                     if _n > 0 else '\u81ea\u52a8\u51fa\u552e\u5df2\u5173\u95ed'))
        elif t == 'statask':""",
    'autosell intent')

io.open(p, 'w', encoding='utf-8').write(s)
print('world 改完')
