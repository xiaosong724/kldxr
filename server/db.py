# -*- coding: utf-8 -*-
"""末日丧尸 × 组队修仙 · 独立版 —— 数据库层

· SQLite，和原 2D 后端一个路子：零依赖、免运维、易备份
· 用 PRAGMA user_version 做版本管理：新版本只往后追加迁移，不动老库
· 物品 / 技能这类「内容会一直长」的东西，主体存 JSON
  （接口驱动 → 以后加字段不用改表结构 ✓ 见 docs/方案.md §6.6 §7.1）
"""

import os
import sqlite3
import time

# ============================================================ 版本与迁移

SCHEMA_VERSION = 3   # ★ 第 149 轮：魔气值（迁移 v3 在下面 MIGRATIONS 定义之后）

# 每个版本一组 SQL。**新版本往后追加，不要改历史版本** ✓
MIGRATIONS = {
    1: [
        # ---------------- 账号 ----------------
        """CREATE TABLE IF NOT EXISTS accounts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL COLLATE NOCASE UNIQUE,   -- 唯一游戏名（大小写不敏感）
            pass_hash   TEXT    NOT NULL,                          -- PBKDF2-SHA256
            salt        TEXT    NOT NULL,
            created_at  INTEGER NOT NULL,
            last_login  INTEGER,
            banned      INTEGER NOT NULL DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS tokens (
            token       TEXT    PRIMARY KEY,
            account_id  INTEGER NOT NULL,
            created_at  INTEGER NOT NULL,
            last_seen   INTEGER
        )""",
        "CREATE INDEX IF NOT EXISTS idx_tokens_acct ON tokens(account_id)",

        # ---------------- 角色 ----------------
        # 一个账号一个角色（结构上留了 account_id 索引，以后要多角色也不用改表）
        """CREATE TABLE IF NOT EXISTS roles (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id    INTEGER NOT NULL UNIQUE,
            name          TEXT    NOT NULL,                 -- 角色名（默认同账号名）
            level         INTEGER NOT NULL DEFAULT 1,       -- 炼气 N 级（1 ~ 无上限）
            exp           INTEGER NOT NULL DEFAULT 0,       -- 当前等级已攒经验
            hp            INTEGER NOT NULL DEFAULT 0,       -- 当前血量（0 表示按公式满值）
            qi            INTEGER NOT NULL DEFAULT 0,       -- 当前灵气
            x             REAL    NOT NULL DEFAULT 0,       -- 位置
            z             REAL    NOT NULL DEFAULT 0,
            yaw           REAL    NOT NULL DEFAULT 0,
            talent_free   INTEGER NOT NULL DEFAULT 0,       -- 未分配天赋点
            -- ★ 第 149 轮：魔气值（方案 docs/魔气与PVP夺取方案.md §8.1）
            mq            INTEGER NOT NULL DEFAULT 0,       -- 魔气值
            mq_at         INTEGER NOT NULL DEFAULT 0,       -- 上次自然衰减的结算时刻（毫秒）
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL
        )""",

        # 天赋加点（一行一个属性，投入点数无上限 ✓ 见方案 §4.3）
        """CREATE TABLE IF NOT EXISTS talents (
            role_id     INTEGER NOT NULL,
            stat        TEXT    NOT NULL,                  -- 属性 key，见方案 §4.2
            points      INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (role_id, stat)
        )""",

        # ---------------- 物品 ----------------
        # 背包与仓库同一张表，用 in_storage 区分（仓库只在堡垒里能开）
        # item_json = 整个物品（id/tier/base/affixes/effect/look/ext …）
        """CREATE TABLE IF NOT EXISTS items (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            role_id       INTEGER NOT NULL,
            in_storage    INTEGER NOT NULL DEFAULT 0,      -- 0=背包  1=仓库
            slot_index    INTEGER NOT NULL DEFAULT -1,     -- 格子号（-1 = 未指定）
            stack         INTEGER NOT NULL DEFAULT 1,      -- 堆叠数量
            item_json     TEXT    NOT NULL,
            created_at    INTEGER NOT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_items_owner ON items(role_id, in_storage)",

        # 已穿戴（只有武器 + 防具两栏 ✓ 见方案 §7）
        """CREATE TABLE IF NOT EXISTS equipment (
            role_id     INTEGER NOT NULL,
            slot        TEXT    NOT NULL,                  -- weapon | armor
            item_id     INTEGER NOT NULL,
            PRIMARY KEY (role_id, slot)
        )""",

        # ---------------- 技能 ----------------
        # 同名不同阶 = 同一个技能的不同品质，升阶即替换（靠 role_id+skill_id 唯一约束）
        """CREATE TABLE IF NOT EXISTS role_skills (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            role_id     INTEGER NOT NULL,
            skill_id    TEXT    NOT NULL,                  -- 指向技能定义（数据驱动）
            tier        INTEGER NOT NULL DEFAULT 0,        -- 品阶 0~11（凡品→神品）
            level       INTEGER NOT NULL DEFAULT 1,        -- 技能等级 1~20
            learned_at  INTEGER NOT NULL,
            UNIQUE (role_id, skill_id)
        )""",
        # 技能页：每页 4 主动 + 5 被动，共 4 页（见方案 §6.1）
        """CREATE TABLE IF NOT EXISTS skill_pages (
            role_id     INTEGER NOT NULL,
            page_index  INTEGER NOT NULL,                  -- 0~3
            actives     TEXT    NOT NULL DEFAULT '[]',     -- JSON 数组，最多 4 个 skill_id
            passives    TEXT    NOT NULL DEFAULT '[]',     -- JSON 数组，最多 5 个 skill_id
            PRIMARY KEY (role_id, page_index)
        )""",

        # ---------------- 组队 ----------------
        """CREATE TABLE IF NOT EXISTS teams (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            leader_role_id  INTEGER NOT NULL,
            created_at      INTEGER NOT NULL
        )""",
        # role_id 唯一 → 一个人只能在一个队里 ✓ 上限 3 人由业务层保证
        """CREATE TABLE IF NOT EXISTS team_members (
            team_id     INTEGER NOT NULL,
            role_id     INTEGER NOT NULL UNIQUE,
            joined_at   INTEGER NOT NULL,
            PRIMARY KEY (team_id, role_id)
        )""",

        # ---------------- 记录类（限频用） ----------------
        # PvP 夺取经验：单次 ≤ 本级 25%，每分钟 ≤ 50%（见方案 §11.1）→ 靠这张表统计
        """CREATE TABLE IF NOT EXISTS pvp_log (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            killer_role   INTEGER NOT NULL,
            victim_role   INTEGER NOT NULL,
            exp_stolen    INTEGER NOT NULL DEFAULT 0,
            items_stolen  INTEGER NOT NULL DEFAULT 0,
            ts            INTEGER NOT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_pvp_killer ON pvp_log(killer_role, ts)",
        # 组队分享经验：单次 ≤ 3%，每分钟 ≤ 15%（见方案 §10.2）
        """CREATE TABLE IF NOT EXISTS exp_share_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            role_id     INTEGER NOT NULL,
            amount      INTEGER NOT NULL,
            ts          INTEGER NOT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_share_role ON exp_share_log(role_id, ts)",

        # ---------------- 杂项 ----------------
        """CREATE TABLE IF NOT EXISTS meta (
            k   TEXT PRIMARY KEY,
            v   TEXT
        )""",
    ],
}

# ★ 版本 2（第 55 轮）：把历史上【重复的材料行】合并成一行
#
#   为什么需要：材料堆叠是第 54 轮才做的 ✓
#   在那之前捡的每份材料都单独占一行（实测有个角色背包里 13 行"破布"✗）
#   新捡的会自动堆 ✓ 但老行不会自己合并 ✗ → 这里做一次性整理 ✓
#
#   ★ 只动【材料】（item_json 里没有 slot 字段的 ✓）
#     武器/防具一律不碰 ✓（装备永远一件一行 ✓）
#   ★ 合并键 = role_id + in_storage + 名字 + 品阶（和别人、别的阶都不混 ✓）
#   ★ 保留 id 最小的那行，把总数写进去，其余删掉 ✓
#   ★ 踩过的坑：DELETE 的子查询必须【按同一套键】GROUP BY ✗
#     不然"名字相同但品阶不同"的行也会被删 ✗
MIGRATIONS[2] = [
    """UPDATE items SET stack = (
        SELECT SUM(b.stack) FROM items b
         WHERE b.role_id = items.role_id
           AND b.in_storage = items.in_storage
           AND json_extract(b.item_json,'$.name') = json_extract(items.item_json,'$.name')
           AND json_extract(b.item_json,'$.tier') = json_extract(items.item_json,'$.tier')
           AND json_extract(b.item_json,'$.slot') IS NULL)
      WHERE json_extract(items.item_json,'$.slot') IS NULL
        AND items.id = (
            SELECT MIN(c.id) FROM items c
             WHERE c.role_id = items.role_id
               AND c.in_storage = items.in_storage
               AND json_extract(c.item_json,'$.name') = json_extract(items.item_json,'$.name')
               AND json_extract(c.item_json,'$.tier') = json_extract(items.item_json,'$.tier')
               AND json_extract(c.item_json,'$.slot') IS NULL)""",
    """DELETE FROM items
      WHERE json_extract(item_json,'$.slot') IS NULL
        AND id NOT IN (
            SELECT MIN(id) FROM items
             WHERE json_extract(item_json,'$.slot') IS NULL
             GROUP BY role_id, in_storage,
                      json_extract(item_json,'$.name'),
                      json_extract(item_json,'$.tier'))""",
]


# ============================================================ 工具

def now_ms():
    """毫秒时间戳（全项目统一用它，别混用秒）"""
    return int(time.time() * 1000)


def connect(cfg):
    """连数据库。WAL + busy_timeout：多线程 / 外部工具同时读也不会互相锁死"""
    path = cfg['db']
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    c = sqlite3.connect(path, timeout=5.0)
    c.row_factory = sqlite3.Row
    try:
        c.execute('PRAGMA journal_mode=WAL')
        c.execute('PRAGMA synchronous=NORMAL')
        c.execute('PRAGMA foreign_keys=ON')
    except Exception:
        pass
    return c


class _Db(object):
    """with db(cfg) as c: ...  —— 出块自动 commit，出错自动 rollback + 抛出"""

    def __init__(self, cfg):
        self.cfg = cfg
        self.c = None

    def __enter__(self):
        self.c = connect(self.cfg)
        return self.c

    def __exit__(self, exc_type, exc, tb):
        try:
            if exc_type is None:
                self.c.commit()
            else:
                self.c.rollback()
        finally:
            self.c.close()
        return False


def db(cfg):
    return _Db(cfg)


# ============================================================ 建表 / 迁移

def current_version(c):
    return int(c.execute('PRAGMA user_version').fetchone()[0])


# ★ ★ 第 149 轮：魔气值——老库补两列 ★★
#   ★ 为什么不能只改建表语句：
#     CREATE TABLE IF NOT EXISTS 对【已经存在】的表什么都不做 ✗
#     → 老库永远不会有 mq/mq_at → 一读就报 no such column ✗
#   ★ SQLite 的 ALTER TABLE ADD COLUMN 重复执行会报错 ✗
#     而迁移是按 user_version 走的 ✓ 只会跑一次 ✓ 所以直接 ALTER 是安全的 ✓
#   ★ 我第一版把它插在 MIGRATIONS 定义之前 ✗ → NameError ✗（已修 ✓）
MIGRATIONS[3] = [
    "ALTER TABLE roles ADD COLUMN mq    INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE roles ADD COLUMN mq_at INTEGER NOT NULL DEFAULT 0",
]


def ensure_tables(cfg):
    """幂等：可重复调用。返回 (起始版本, 结束版本, 本次执行了几条 SQL)"""
    c = connect(cfg)
    try:
        v0 = current_version(c)
        ran = 0
        for ver in sorted(MIGRATIONS.keys()):
            if ver <= v0:
                continue
            for sql in MIGRATIONS[ver]:
                c.execute(sql)
                ran += 1
            c.execute('PRAGMA user_version=%d' % ver)
        c.commit()
        # 记一下建库时间 / 版本，方便排查
        c.execute('INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)',
                  ('schema_version', str(SCHEMA_VERSION)))
        c.execute('INSERT OR IGNORE INTO meta(k, v) VALUES(?, ?)',
                  ('created_at', str(now_ms())))
        c.commit()
        return v0, current_version(c), ran
    finally:
        c.close()


def table_names(cfg):
    """列出所有业务表（自检 / 排查用）"""
    c = connect(cfg)
    try:
        rows = c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
        return [r['name'] for r in rows]
    finally:
        c.close()


if __name__ == '__main__':
    # 单独跑一下就能建库（python db.py）
    import json
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, 'config.json'), encoding='utf-8') as f:
        cfg = json.load(f)
    cfg['db'] = cfg['db'].replace('${HERE}', here)
    v0, v1, n = ensure_tables(cfg)
    print('建表完成：版本 %d → %d，执行 %d 条 SQL' % (v0, v1, n))
    print('数据库：%s' % cfg['db'])
    print('表：%s' % '、'.join(table_names(cfg)))
