# -*- coding: utf-8 -*-
"""重新应用本轮的服务端改动（上一次补丁把文件编码弄坏了，已 git checkout 还原）。

改动：
  A. 常量：TOWN_R / 镇内清怪
  B. 导入：houses / shops / work
  C. World.__init__：住宅加载 + 镇内地形覆盖清理
  D. Player 字段：sleep / job
  E. 意图分支：house/order/work/fridge
  F. 方法：住宅、冰箱、打工、点单
  G. tick：house_expire / sleep / work
  H. 快照：seat/sleep/job
  I. 登录：houses 下发 + 默认出生点
"""
import io

p = 'server/world.py'
s = io.open(p, encoding='utf-8').read()


def rep(old, new, cnt=1):
    global s
    if old not in s:
        print('!! missing anchor:', old[:60].replace('\n', '\\n'))
        return False
    s = s.replace(old, new, cnt)
    return True


# A. 常量
rep("SPAWN_SAFE = 20.0               # 出生点/安全区半径：这里不刷怪（方案 §2.1 末日堡垒）",
    "SPAWN_SAFE = 250.0              # 小镇安全区半径：这里不刷怪\nTOWN_R = 250.0                  # 镇内怪物一律回收")

# ② 镇内清怪（在 mob_tick 的 awayT 判定前）
rep("""            if m.awayT >= _away_lim:
                self.mobs.pop(m.mid, None)
                continue""",
    """            # 镇内不刷新怪物：走进安全区的怪物直接回收
            if abs(m.x) <= TOWN_R and abs(m.z) <= TOWN_R:
                self.mobs.pop(m.mid, None)
                continue
            if m.awayT >= _away_lim:
                self.mobs.pop(m.mid, None)
                continue""")

rep("""        if town.in_town(x, z) or (x * x + z * z < SPAWN_SAFE * SPAWN_SAFE):
            return                       # 安全区里不刷（方案 §2.1 末日堡垒）✓""",
    """        if town.in_town(x, z) or (abs(x) <= SPAWN_SAFE and abs(z) <= SPAWN_SAFE):
            return                       # 安全区里不刷（方形 500×500）""")

# B. 导入
rep("import worldgen\n", "import worldgen\nimport houses as housemod\nimport shops as shopmod\nimport work as workmod\n")

# C. World.__init__
rep("""    def __init__(self, cfg):
        self.cfg = cfg
        self.loop = None""",
    """    def __init__(self, cfg):
        self.cfg = cfg
        self.houses = {}
        try:
            housemod.ensure_seed(cfg)
            self.houses = housemod.load_all(cfg)
        except Exception as _he:
            print('[house] load failed: %r' % (_he,))
        try:
            with dbmod.db(cfg) as _hc:
                _hc.execute('DELETE FROM terrain_fluid WHERE abs(x)<=250 AND abs(z)<=250')
                _hc.execute('DELETE FROM terrain_damage WHERE abs(x)<=250 AND abs(z)<=250')
                _hc.commit()
        except Exception as _tc:
            print('[town] clean terrain overrides failed: %r' % (_tc,))
        self.jobRound = {}
        self.loop = None""")

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('part1 ok', len(s))
