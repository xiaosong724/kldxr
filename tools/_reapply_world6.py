# -*- coding: utf-8 -*-
"""重新应用本轮服务端改动 · 第 6 部分：把住宅/冰箱/打工/点单 的方法体插进 World。

只为中文注释避免乱码，方法体里的中文一律放进 print/字符串常量里并用英文注释。
"""
import io

p = 'server/world.py'
s = io.open(p, encoding='utf-8').read()

C = {
    'HOUSE_SEND': '''    def _send_houses(self, p):
        try:
            lst = [housemod.public(h) for h in self.houses.values()]
            self._send_cid(p.cid, P.pack('houses', list=lst))
        except Exception as e:
            print('[house] send failed: %r' % (e,))

    def _broadcast_houses(self):
        for q in list(self.players.values()):
            self._send_houses(q)

    def _house_log(self, h, buyer, seller, kind, days, amount, refund, premium):
        try:
            self.post_save(
                'INSERT INTO house_logs(house_id,buyer_id,seller_id,kind,days,amount,refund,premium,ts)'
                ' VALUES(?,?,?,?,?,?,?,?,?)',
                (str(h.get('id')), int(buyer or 0), int(seller or 0), str(kind),
                 int(days or 0), int(amount or 0), int(refund or 0), int(premium or 0),
                 housemod.now_ms()))
        except Exception as e:
            print('[house] log failed: %r' % (e,))

    def _save_house(self, h):
        try:
            self.post_save(
                'UPDATE houses SET owner_id=?, owner_name=?, paid_day=?, started_at=?, expires_at=?, updated_at=? WHERE id=?',
                (int(h.get('owner_id') or 0) or None, h.get('owner_name') or '',
                 int(h.get('paid_day') or 0), int(h.get('started_at') or 0),
                 int(h.get('expires_at') or 0), housemod.now_ms(), str(h.get('id'))))
        except Exception as e:
            print('[house] save failed: %r' % (e,))

    def _pay_seller(self, seller_id, amount, why):
        if int(amount or 0) <= 0:
            return
        for q in list(self.players.values()):
            if int(getattr(q, 'role_id', 0) or 0) == int(seller_id):
                self._gain_gold(q, int(amount), why)
                return
        try:
            self.post_save('INSERT INTO pending_gold(role, amount, why, ts, done) VALUES(?,?,?,?,0)',
                           (int(seller_id), int(amount), str(why), housemod.now_ms()))
        except Exception as e:
            print('[house] refund pending failed: %r' % (e,))

    def _house_near_ok(self, p, hid):
        h = town.near_house(p.x, p.z)
        return bool(h and str(h.get('id')) == str(hid))

    def _house_send(self, p, hid=None):
        h = None
        if hid:
            h = self.houses.get(str(hid))
        else:
            near = town.near_house(p.x, p.z)
            if near:
                h = self.houses.get(str(near.get('id')))
        if not h:
            self._send_cid(p.cid, P.pack('house', ok=0, msg='NO_HOUSE'))
            return
        self._send_cid(p.cid, P.pack('house', ok=1, id=h['id'], list=[housemod.public(h)]))

    def _house_buy(self, p, d):
        hid = str((d or {}).get('id') or '')
        want = int((d or {}).get('days') or 1)
        h = self.houses.get(hid)
        if not h:
            self._send_cid(p.cid, P.pack('house', ok=0, msg='NO_HOUSE'))
            return
        if not self._house_near_ok(p, hid):
            self._send_cid(p.cid, P.pack('house', ok=0, msg='NOT_NEAR'))
            return
        owner = int(h.get('owner_id') or 0)
        me = int(getattr(p, 'role_id', 0) or 0)
        if owner != me:
            for other in self.houses.values():
                if int(other.get('owner_id') or 0) == me and str(other.get('id')) != hid:
                    self._send_cid(p.cid, P.pack('house', ok=0, msg='ONE_HOUSE_ONLY'))
                    return
        okq, msg, cost, total, rem, premium, refund, paid_day = housemod.quote(h, me, want)
        if not okq:
            self._send_cid(p.cid, P.pack('house', ok=0, msg=msg))
            return
        if int(getattr(p, 'gold', 0) or 0) < cost:
            self._send_cid(p.cid, P.pack('house', ok=0, msg='NOT_ENOUGH_GOLD'))
            return
        seller = owner if owner and owner != me else 0
        if seller:
            for q in list(self.players.values()):
                if int(getattr(q, 'role_id', 0) or 0) == seller and getattr(q, 'sleepHouse', '') == hid:
                    self._force_wake(q)
        p.gold = int(getattr(p, 'gold', 0) or 0) - cost
        p.goldDirty = True
        now = housemod.now_ms()
        if seller:
            self._pay_seller(seller, refund, 'buyout')
            self._house_log(h, me, seller, 'buyout', total, cost, refund, premium)
        elif owner == me:
            self._house_log(h, me, me, 'renew', total, cost, 0, 0)
        else:
            self._house_log(h, me, 0, 'purchase', total, cost, 0, 0)
        if not int(h.get('started_at') or 0):
            h['started_at'] = now
        h['owner_id'] = me
        h['owner_name'] = p.name
        h['paid_day'] = int(paid_day or h.get('price_day') or 0)
        h['expires_at'] = now + total * housemod.DAY_MS
        h['updated_at'] = now
        self._save_house(h)
        self._send_cid(p.cid, P.pack('house', ok=1, id=hid, msg='OK', list=[housemod.public(h)]))
        self._broadcast_houses()

    def _house_leave(self, p, d):
        hid = str((d or {}).get('id') or '')
        h = self.houses.get(hid)
        if not h:
            self._send_cid(p.cid, P.pack('house', ok=0, msg='NO_HOUSE'))
            return
        me = int(getattr(p, 'role_id', 0) or 0)
        if int(h.get('owner_id') or 0) != me:
            self._send_cid(p.cid, P.pack('house', ok=0, msg='NOT_YOURS'))
            return
        self._force_wake(p)
        rem = housemod.remaining_days(h.get('expires_at'))
        refund = int(rem * int(h.get('paid_day') or 0) * 0.5)
        h['owner_id'] = 0
        h['owner_name'] = ''
        h['paid_day'] = 0
        h['started_at'] = 0
        h['expires_at'] = 0
        h['updated_at'] = housemod.now_ms()
        self._save_house(h)
        self._gain_gold(p, refund, 'leave')
        self._house_log(h, 0, me, 'leave', rem, 0, refund, 0)
        try:
            import fridge as _frm
            _frm.clear(self.cfg, hid)
        except Exception:
            pass
        self._send_cid(p.cid, P.pack('house', ok=1, id=hid, msg='LEFT %d' % refund,
                                     list=[housemod.public(h)]))
        self._broadcast_houses()

    def _house_sleep(self, p, d):
        hid = str((d or {}).get('id') or '')
        h = self.houses.get(hid)
        if not h:
            self._send_cid(p.cid, P.pack('house', ok=0, msg='NO_HOUSE'))
            return
        if int(h.get('owner_id') or 0) != int(getattr(p, 'role_id', 0) or 0):
            self._send_cid(p.cid, P.pack('house', ok=0, msg='NOT_YOURS'))
            return
        lay = next((x for x in town.HOUSES if str(x.get('id')) == hid), None)
        if not lay:
            self._send_cid(p.cid, P.pack('house', ok=0, msg='NO_LAYOUT'))
            return
        bx, bz = town.house_bed(lay)
        if (p.x - bx) ** 2 + (p.z - bz) ** 2 > 2.6 * 2.6:
            self._send_cid(p.cid, P.pack('house', ok=0, msg='NOT_NEAR_BED'))
            return
        p.sleepHouse = hid
        p.sleepAcc = 0.0
        p.x = bx
        p.z = bz
        p.seat = -1
        self._send_cid(p.cid, P.pack('sleep_state', on=1, id=hid, x=bx, z=bz))
        for q in list(self.players.values()):
            if q is not p:
                try:
                    self._send_cid(q.cid, P.pack('sleep_state', on=1, id=hid, x=bx, z=bz))
                except Exception:
                    pass

    def _force_wake(self, p):
        if not getattr(p, 'sleepHouse', ''):
            return
        p.sleepHouse = ''
        try:
            self._send_cid(p.cid, P.pack('sleep_state', on=0, x=p.x, z=p.z))
        except Exception:
            pass

    def _house_wake(self, p):
        if not getattr(p, 'sleepHouse', ''):
            return
        hid = p.sleepHouse
        lay = next((x for x in town.HOUSES if str(x.get('id')) == hid), None)
        p.sleepHouse = ''
        if lay:
            p.x = float(lay['x0']) + 3.2
            p.z = float(lay['z0']) + 2.2
        self._send_cid(p.cid, P.pack('sleep_state', on=0, x=p.x, z=p.z))

    def _sleep_tick(self):
        for p in list(self.players.values()):
            if not getattr(p, 'sleepHouse', ''):
                continue
            p.sleepAcc = float(getattr(p, 'sleepAcc', 0) or 0) + TICK_DT
            if p.sleepAcc < 1.0:
                continue
            p.sleepAcc -= 1.0
            hpm = self._hp_max(p)
            p.hp = min(hpm, int(p.hp or 0) + max(1, int(round(hpm * 0.01))))
            try:
                qm = self._qi_max(p)
                p.qi = min(qm, int(p.qi or 0) + max(1, int(round(qm * 0.01))))
            except Exception:
                pass

    def _house_expire_tick(self):
        now = housemod.now_ms()
        changed = False
        for h in list(self.houses.values()):
            exp = int(h.get('expires_at') or 0)
            if not exp or exp > now:
                continue
            old = int(h.get('owner_id') or 0)
            h['owner_id'] = 0
            h['owner_name'] = ''
            h['paid_day'] = 0
            h['started_at'] = 0
            h['expires_at'] = 0
            h['updated_at'] = now
            self._save_house(h)
            self._house_log(h, 0, old, 'expire', 0, 0, 0, 0)
            try:
                import fridge as _frm
                _frm.clear(self.cfg, h.get('id'))
            except Exception:
                pass
            for q in list(self.players.values()):
                if int(getattr(q, 'role_id', 0) or 0) == old:
                    if getattr(q, 'sleepHouse', '') == h.get('id'):
                        self._force_wake(q)
                    try:
                        self._send_cid(q.cid, P.pack('notice', text='HOUSE_EXPIRED'))
                    except Exception:
                        pass
            changed = True
        if changed:
            self._broadcast_houses()

''',
    'SHOP': '''    def _shop_ok(self, p, sid):
        s = shopmod.shop_by_id(sid)
        if not s:
            return None
        if not town.in_town(p.x, p.z):
            return None
        if (p.x - s['x']) ** 2 + (p.z - s['z']) ** 2 > 3.2 * 3.2:
            return None
        return s

    def _shop_open(self, p, d):
        sid = str((d or {}).get('id') or '')
        s = self._shop_ok(p, sid)
        if not s:
            self._send_cid(p.cid, P.pack('shop', ok=0, msg='COME_CLOSER'))
            return
        self._send_cid(p.cid, P.pack('shop', ok=1, id=s['id'], name=s['name'],
                                     gold=int(getattr(p, 'gold', 0) or 0), items=s['items']))

    def _shop_buy(self, p, d):
        sid = str((d or {}).get('id') or '')
        key = str((d or {}).get('item') or '')
        s = self._shop_ok(p, sid)
        if not s:
            self._send_cid(p.cid, P.pack('shop', ok=0, msg='COME_CLOSER'))
            return
        item = next((x for x in s['items'] if x.get('key') == key), None)
        if not item:
            self._send_cid(p.cid, P.pack('shop', ok=0, msg='NO_ITEM'))
            return
        price = int(item.get('price') or 0)
        if int(getattr(p, 'gold', 0) or 0) < price:
            self._send_cid(p.cid, P.pack('shop', ok=0, msg='NOT_ENOUGH_GOLD'))
            return
        p.gold = int(getattr(p, 'gold', 0) or 0) - price
        p.goldDirty = True
        use = {}
        for k in ('hp_pct', 'qi_pct', 'exp'):
            if item.get(k):
                use[k] = item[k]
        it = {'name': item.get('name') or key, 'kind': 'food', 'tier': 0,
              'icon': item.get('icon') or 'FOOD', 'model': item.get('model') or 'cup',
              'desc': item.get('desc') or '', 'use': use}
        try:
            self.post_save(
                'INSERT INTO items(role_id, in_storage, slot_index, stack, item_json, created_at)'
                ' VALUES(?,0,-1,1,?,?)',
                (int(p.role_id), __import__('json').dumps(it, ensure_ascii=False),
                 housemod.now_ms()))
        except Exception as e:
            print('[shop] add item failed: %r' % (e,))
        self._send_cid(p.cid, P.pack('shop', ok=1, id=sid, name=s['name'],
                                     gold=int(p.gold), items=s['items'],
                                     bagsig=housemod.now_ms(), msg='BOUGHT'))

    def _use_food(self, p, d):
        d = d or {}
        hpm = self._hp_max(p)
        qm = self._qi_max(p)
        hp = int(round(hpm * float(d.get('hp_pct') or 0)))
        qi = int(round(qm * float(d.get('qi_pct') or 0)))
        if hp:
            p.hp = min(hpm, int(p.hp or 0) + hp)
        if qi:
            p.qi = min(qm, int(p.qi or 0) + qi)
        exp = int(d.get('exp') or 0)
        if exp:
            self._gain_exp(p, exp)
        self._send_cid(p.cid, P.pack('eatfx', name=d.get('name') or 'FOOD',
                                     model=d.get('model') or 'cup', hp=hp, qi=qi))

    def _fridge_house(self, p, hid):
        h = self.houses.get(str(hid))
        if not h:
            return None, 'NO_HOUSE'
        if int(h.get('owner_id') or 0) != int(getattr(p, 'role_id', 0) or 0):
            return None, 'OWNER_ONLY'
        if not self._house_near_ok(p, hid):
            return None, 'NOT_NEAR'
        return h, ''

    def _fridge_open(self, p, d):
        hid = str((d or {}).get('id') or '')
        h, msg = self._fridge_house(p, hid)
        if not h:
            self._send_cid(p.cid, P.pack('fridge', ok=0, msg=msg, house=hid))
            return
        try:
            import fridge as frimod
            data = frimod.public(self.cfg, hid, h.get('owner_id'), getattr(p, 'role_id', 0))
            data['ok'] = 1
            self._send_cid(p.cid, P.pack('fridge', **data))
        except Exception as e:
            print('[fridge] send failed: %r' % (e,))

    def _work_slot_free(self, sid, slot):
        for q in list(self.players.values()):
            if getattr(q, 'jobShop', '') == sid and getattr(q, 'job', '') == slot:
                return False
        return True

    def _work_start(self, p, d):
        sid = str((d or {}).get('id') or '')
        slot = str((d or {}).get('slot') or '')
        s = shopmod.shop_by_id(sid)
        if not s:
            self._send_cid(p.cid, P.pack('work', ok=0, msg='NO_SHOP'))
            return
        if (p.x - s['x']) ** 2 + (p.z - s['z']) ** 2 > 4.6 * 4.6:
            self._send_cid(p.cid, P.pack('work', ok=0, msg='COME_CLOSER'))
            return
        if getattr(p, 'job', ''):
            self._send_cid(p.cid, P.pack('work', ok=0, msg='ALREADY_WORKING'))
            return
        if not self._work_slot_free(sid, slot):
            self._send_cid(p.cid, P.pack('work', ok=0, msg='SLOT_TAKEN'))
            return
        try:
            _ok, _msg = workmod.start(self.cfg, p.role_id, sid, slot)
            if not _ok:
                self._send_cid(p.cid, P.pack('work', ok=0, msg='SLOT_TAKEN'))
                return
        except Exception as _we:
            print('[work] start db failed: %r' % (_we,))
        p.job = slot
        p.jobShop = sid
        p.jobT = 0.0
        p.jobAcc = 0.0
        p.seat = -1
        self._send_cid(p.cid, P.pack('work', ok=1, id=sid, slot=slot, on=1, msg='WORK_STARTED'))
        self._send_cid(p.cid, P.pack('notice', text='WORK_STARTED'))

    def _work_stop(self, p):
        if not getattr(p, 'job', ''):
            return
        self._work_settle(p)
        try:
            workmod.stop(self.cfg, p.role_id)
        except Exception as _we2:
            print('[work] stop db failed: %r' % (_we2,))
        p.job = ''
        p.jobShop = ''
        p.jobT = 0.0
        p.jobAcc = 0.0
        self._send_cid(p.cid, P.pack('work', ok=1, on=0, msg='WORK_STOPPED'))

    def _job_step(self, p, d):
        if not getattr(p, 'job', ''):
            return
        try:
            p.jobT = float((d or {}).get('t') or 0)
        except Exception:
            p.jobT = 0.0
        for q in list(self.players.values()):
            if q is p:
                continue
            try:
                self._send_cid(q.cid, P.pack('jobstep', cid=p.cid, job=p.job, t=p.jobT,
                                             x=round(p.x, 2), z=round(p.z, 2)))
            except Exception:
                pass

    def _work_settle(self, p):
        if not getattr(p, 'job', ''):
            return 0
        hours = float(getattr(p, 'jobAcc', 0.0) or 0.0)
        n_h = int(hours)
        if n_h <= 0:
            return 0
        p.jobAcc = hours - n_h
        lvl = int((p.role or {}).get('level') or 1)
        exp = workmod.hourly_exp(lvl) * n_h
        pay = workmod.hourly_pay() * n_h
        self._gain_exp(p, int(exp))
        self._gain_gold(p, int(pay), 'work')
        try:
            workmod.settle(self.cfg, p.role_id, p.jobShop, p.job, lvl, n_h, pay, exp)
        except Exception as _se:
            print('[work] settle db failed: %r' % (_se,))
        self._send_cid(p.cid, P.pack('worksettle', hours=n_h, exp=int(exp), pay=int(pay)))

    def _work_tick(self):
        for p in list(self.players.values()):
            if not getattr(p, 'job', ''):
                continue
            p.jobAcc = float(getattr(p, 'jobAcc', 0.0) or 0.0) + TICK_DT
            if p.jobAcc >= 3600.0:
                self._work_settle(p)

    def _job_done(self, p, d):
        if not getattr(p, 'job', ''):
            return
        n = int(self.jobRound.get(p.cid, 0)) + 1
        self.jobRound[p.cid] = n
        self._send_cid(p.cid, P.pack('jobround', n=n))

    def _order_shop_near(self, p):
        for s in shopmod.shop_list():
            if not s.get('served'):
                continue
            if (p.x - s['x']) ** 2 + (p.z - s['z']) ** 2 <= 4.6 * 4.6:
                return s
        return None

    def _order_open(self, p, d):
        s = self._order_shop_near(p)
        if not s:
            self._send_cid(p.cid, P.pack('order', ok=0, msg='NOT_IN_SHOP'))
            return
        if int(getattr(p, 'seat', -1)) < 0:
            self._send_cid(p.cid, P.pack('order', ok=0, msg='SIT_FIRST'))
            return
        self._send_cid(p.cid, P.pack('order', ok=1, id=s['id'], name=s['name'], items=s['items']))

    def _order_buy(self, p, d):
        s = self._order_shop_near(p)
        if not s:
            self._send_cid(p.cid, P.pack('order', ok=0, msg='NOT_IN_SHOP'))
            return
        if int(getattr(p, 'seat', -1)) < 0:
            self._send_cid(p.cid, P.pack('order', ok=0, msg='SIT_FIRST'))
            return
        key = str((d or {}).get('item') or '')
        item = next((x for x in s['items'] if x.get('key') == key), None)
        if not item:
            self._send_cid(p.cid, P.pack('order', ok=0, msg='NO_ITEM'))
            return
        price = int(item.get('price') or 0)
        if int(getattr(p, 'gold', 0) or 0) < price:
            self._send_cid(p.cid, P.pack('order', ok=0, msg='NOT_ENOUGH_GOLD'))
            return
        p.gold = int(getattr(p, 'gold', 0) or 0) - price
        p.goldDirty = True
        use = {}
        for k in ('hp_pct', 'qi_pct'):
            if item.get(k):
                use[k] = item[k]
        it = {'name': item.get('name') or key, 'kind': 'food', 'tier': 0,
              'icon': item.get('icon') or 'FOOD', 'model': item.get('model') or 'plate',
              'desc': item.get('desc') or '', 'use': use}
        try:
            self.post_save(
                'INSERT INTO items(role_id, in_storage, slot_index, stack, item_json, created_at)'
                ' VALUES(?,0,-1,1,?,?)',
                (int(p.role_id), __import__('json').dumps(it, ensure_ascii=False),
                 housemod.now_ms()))
        except Exception as e:
            print('[order] add item failed: %r' % (e,))
        self._send_cid(p.cid, P.pack('order', ok=1, id=s['id'], name=s['name'],
                                     items=s['items'], msg='SERVED'))
        self._send_cid(p.cid, P.pack('notice', text='SERVED'))

''',
}

anchor = "    def _handle_intent(self, p, t, d):"
if anchor not in s:
    raise SystemExit('no anchor')
block = C['HOUSE_SEND'] + C['SHOP'] + anchor
s = s.replace(anchor, block, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('part6 ok', len(s))
