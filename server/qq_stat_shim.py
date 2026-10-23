# -*- coding: utf-8 -*-
"""把【数据库里的一个角色】包装成 world._stat_sheet 能吃的对象

为什么需要这个：
  world._stat_sheet(q) 要的是【在线玩家对象】✗
    它需要 q.role / q.weapon / q.armor / q.talEff / q.skBuff
  而 QQ 群查询的是【离线玩家】✗ 没有在线对象 ✓
  → 造一个轻量替身（shim）✗ 从数据库把这几样填上 ✓
  → 直接复用服务端的权威公式 ✗ 不自己重算 ✓✓
"""
import json
import sqlite3


class RoleShim(object):
    """只实现 _stat_sheet 需要的那几个属性"""

    __slots__ = ('role', 'weapon', 'armor', 'talEff', 'talRaw', 'skBuff',
                 'skTankHp', 'skTankBase', 'skSize', 'skTankN',
                 'plagueOn', 'cid', 'name', 'level', 'hp', 'qi',
                 'mq', 'qiMaxC')

    def __init__(self):
        self.role = {}
        self.weapon = {}
        self.armor = None
        self.talEff = {}
        self.talRaw = {}      # ★ _hp_max / _atk_of 要读它
        self.skBuff = {}
        self.mq = 0           # ★ _atk_of 要读（魔气等级）
        self.qiMaxC = 0       # ★ _qi_max 要读（灵气上限加成）
        self.skTankHp = 0
        self.skTankBase = 0
        self.skSize = 1.0
        self.skTankN = 0
        self.plagueOn = False
        self.cid = ''
        self.name = ''
        self.level = 1
        self.hp = 0
        self.qi = 0


def build_shim(db_path, role_name):
    """按角色名从数据库造一个 shim ✗ 查不到返回 None"""
    c = sqlite3.connect(db_path)
    c.row_factory = sqlite3.Row
    try:
        row = c.execute('SELECT * FROM roles WHERE name=?', (str(role_name),)).fetchone()
        if row is None:
            return None
        rid = row['id']

        s = RoleShim()
        s.name = row['name']
        s.level = int(row['level'] or 1)
        s.hp = int(row['hp'] or 0)
        s.qi = int(row['qi'] or 0)
        s.cid = 'qq-%s' % rid
        # ★ role 字典：兼容服务端各处 .get('level') / .get('name') 的写法
        s.role = dict(row)
        s.role['level'] = s.level
        s.role['name'] = s.name

        # 装备
        for x in c.execute('SELECT slot, item_id FROM equipment WHERE role_id=?', (rid,)):
            it = c.execute('SELECT item_json FROM items WHERE id=?', (x['item_id'],)).fetchone()
            if not it:
                continue
            try:
                obj = json.loads(it['item_json'])
            except Exception:
                continue
            if x['slot'] == 'weapon':
                s.weapon = obj
            elif x['slot'] == 'armor':
                s.armor = obj

        # 天赋（talents 表：stat + points）
        for x in c.execute('SELECT stat, points FROM talents WHERE role_id=?', (rid,)):
            try:
                v = float(x['points'] or 0)
                s.talEff[str(x['stat'])] = v
                s.talRaw[str(x['stat'])] = v   # ★ 离线没有对抗相减 ✗ 用原始值 ✓
            except Exception:
                pass
        try:
            s.mq = int(row['mq'] or 0)
        except Exception:
            pass

        # 技能加点（skill_load 只有 key ✗ 等级从 skill_pages 或默认 1）
        try:
            for x in c.execute('SELECT key, kind FROM skill_load WHERE role_id=?', (rid,)):
                pass
        except Exception:
            pass

        # 坦克引擎层数（如果有）
        try:
            s.skTankHp = int(row['sk_tank_hp'] or 0)
            s.skTankBase = int(row['sk_tank_base'] or 0)
            s.skSize = float(row['sk_tank_size'] or 1.0)
            s.skTankN = int(row['sk_tank_n'] or 0)
        except Exception:
            pass

        return s
    finally:
        c.close()


def stat_sheet_for(world, db_path, role_name):
    """用服务端的 _stat_sheet 算属性 ✗ 返回 list（失败返回 None）"""
    shim = build_shim(db_path, role_name)
    if shim is None:
        return None
    try:
        return world._stat_sheet(shim)
    except Exception as e:
        try:
            print('[qqstat] _stat_sheet 失败：%r' % (e,))
        except Exception:
            pass
        return None
