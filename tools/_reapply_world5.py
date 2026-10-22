# -*- coding: utf-8 -*-
"""重新应用本轮服务端改动 · 第 5 部分：意图分支 + 方法（住宅/冰箱/打工/点单）"""
import io

p = 'server/world.py'
s = io.open(p, encoding='utf-8').read()
ok = []


def rep(old, new, tag):
    global s
    if old not in s:
        print('!! MISSING', tag)
        return False
    s = s.replace(old, new, 1)
    ok.append(tag)
    return True


BRANCH_ANCHOR = """        elif t == 'move':
            self._intent_move(p, d)"""
if BRANCH_ANCHOR not in s:
    # fall back: put branches right before end of _handle_intent
    BRANCH_ANCHOR = "    def _intent_move(self, p, d):"
    BRANCH = '''    def _intent_house_info(self, p, d):
        self._house_send(p, (d or {}).get('id'))

    def _intent_house_buy(self, p, d):
        self._house_buy(p, d)

    def _intent_house_leave(self, p, d):
        self._house_leave(p, d)

    def _intent_house_sleep(self, p, d):
        self._house_sleep(p, d)

    def _intent_house_wake(self, p, d=None):
        self._house_wake(p)

    def _intent_shop_open(self, p, d):
        self._shop_open(p, d)

    def _intent_shop_buy(self, p, d):
        self._shop_buy(p, d)

    def _intent_usefood(self, p, d):
        self._use_food(p, d)

    def _intent_fridge_open(self, p, d):
        self._fridge_open(p, d)

    def _intent_order_open(self, p, d):
        self._order_open(p, d)

    def _intent_order_buy(self, p, d):
        self._order_buy(p, d)

    def _intent_work_start(self, p, d):
        self._work_start(p, d)

    def _intent_work_stop(self, p, d=None):
        self._work_stop(p)

    def _intent_jobstep(self, p, d):
        self._job_step(p, d)

    def _intent_jobdone(self, p, d):
        self._job_done(p, d)

''' + BRANCH_ANCHOR
    rep(BRANCH_ANCHOR, BRANCH, 'intent_wrappers')

# 分发：在 _handle_intent 里加分支（挂在 'move' 判断之前）
rep("""    def _handle_intent(self, p, t, d):
        if t == 'move':""",
    """    def _handle_intent(self, p, t, d):
        _TP = ('house_info', 'house_buy', 'house_leave', 'house_sleep', 'house_wake',
               'shop_open', 'shop_buy', 'usefood', 'fridge_open', 'order_open',
               'order_buy', 'work_start', 'work_stop', 'jobstep', 'jobdone')
        if t in _TP:
            getattr(self, '_intent_' + t)(p, d)
            return
        if t == 'move':""", 'dispatch')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('part5:', ok)
