# -*- coding: utf-8 -*-
"""重新应用本轮服务端改动 · 第 4 部分：快照/登录/tick"""
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


# 快照：坐姿/睡觉/打工
rep("""                'jy': round(getattr(o, 'jy', 0.0) or 0.0, 3),
                't': round(o.ct, 3),""",
    """                'jy': round(getattr(o, 'jy', 0.0) or 0.0, 3),
                'seat': int(getattr(o, 'seat', -1)),
                'sleep': 1 if getattr(o, 'sleepHouse', '') else 0,
                'job': getattr(o, 'job', ''),
                't': round(o.ct, 3),""", 'snapshot')

# 登录：下发住宅
rep("""            _np = Player(conn.cid, role)""",
    """            _np = Player(conn.cid, role)
            try:
                self._send_houses(_np)
            except Exception as _hse:
                print('[house] join send failed: %r' % (_hse,))""", 'join_houses')

# tick：住宅到期 / 睡眠 / 打工
rep("""        self._mob_tick(TICK_DT)""",
    """        try:
            self._house_expire_tick()
            self._work_tick()
            self._sleep_tick()
        except Exception as _tk:
            print('[tick] town systems failed: %r' % (_tk,))
        self._mob_tick(TICK_DT)""", 'tick')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('part4:', ok)
