# -*- coding: utf-8 -*-
"""补上 _intent_ 包装方法（分发器按 _intent_<t> 找）。"""
import io

p = 'server/world.py'
s = io.open(p, encoding='utf-8').read()

WRAP = '''    def _intent_house_info(self, p, d):
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

'''

anchor = "    def _intent_pick(self, p, d):"
if anchor not in s:
    raise SystemExit('anchor missing')
if '_intent_house_info' not in s:
    s = s.replace(anchor, WRAP + anchor, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('wrappers added')
