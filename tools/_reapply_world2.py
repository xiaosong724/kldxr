# -*- coding: utf-8 -*-
"""重新应用本轮服务端改动 · 第 2 部分（常量/清怪/玩家字段/意图分支/方法/tick/快照/登录）"""
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


# 镇内清怪
rep("""            if m.awayT >= mobs.AWAY_GRACE:
                self.mobs.pop(m.mid, None)
                continue""",
    """            # 镇内不刷新怪物：走进安全区的怪物直接回收
            if abs(m.x) <= TOWN_R and abs(m.z) <= TOWN_R:
                self.mobs.pop(m.mid, None)
                continue
            if m.awayT >= mobs.AWAY_GRACE:
                self.mobs.pop(m.mid, None)
                continue""", 'despawn')

rep("""        if x * x + z * z < SPAWN_SAFE * SPAWN_SAFE:
            return                       # 安全区里不刷（方案 §2.1 末日堡垒）✓""",
    """        if abs(x) <= SPAWN_SAFE and abs(z) <= SPAWN_SAFE:
            return                       # 安全区里不刷（方形 500x500）""", 'spawn_square')

# Player __slots__
rep("'seat', 'tpAt',", "'seat', 'tpAt', 'sleepHouse', 'sleepAcc', 'job', 'jobShop', 'jobT', 'jobAcc', 'jy',", 'slots')

# Player 字段初始化：挂在 self.seat 后面
rep("""        self.seat = -1          # ★ 坐着的椅子序号（-1 = 没坐）""",
    """        self.seat = -1          # 坐着的椅子序号（-1 = 没坐）
        self.sleepHouse = ''    # 正在睡的住宅 id
        self.sleepAcc = 0.0
        self.job = ''           # 打工岗位
        self.jobShop = ''
        self.jobT = 0.0
        self.jobAcc = 0.0
        self.jy = 0.0""", 'fields')

# 默认出生点
rep("""        self.x = float(role.get('x') or 0.0)
        self.z = float(role.get('z') or 0.0)""",
    """        self.x = float(role.get('x') or 0.0)
        self.z = float(role.get('z') or 0.0)
        if abs(self.x) < 1.0 and abs(self.z) < 1.0:
            self.x, self.z = town.SPAWN""", 'spawn_pos')

# 意图分支：挂在 move 分支之前
rep("""    def _handle_intent(self, p, t, d):
        if t == 'move':""",
    """    def _handle_intent(self, p, t, d):
        if t == 'move':
            if getattr(p, 'sleepHouse', ''):
                return""", 'move_guard')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('part2 ok:', ok, len(s))
