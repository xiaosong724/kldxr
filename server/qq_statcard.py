# -*- coding: utf-8 -*-
"""QQ 群「x 名字」属性查询面板生成器

用法：
    from qq_statcard import render_stat_card
    png_bytes = render_stat_card('fangou')

设计目标：
  · 一个竖屏手机比例的面板（750 宽 ✗ 高度按内容自适应）
  · 属性 / 装备 / 技能全部来自服务器权威数据 ✗ 不自己算 ✓
  · 图标和游戏里一致：
      武器  → 按零件数据画矩形/圆（同 weaponIconSvg）
      防具  → ARMOR_ICON（龙鳞胸甲，用户第 125 轮钦定）
      技能  → 直接从 web/icons.js 导出的 PNG（tools/export_icons_pure.js）
  · 品阶显示 1~12（内部 0~11，显示时 +1）
"""
import io
import json
import math
import os
import re
import sqlite3
import sys

# ── 路径 ──
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)                    # C:\mc\xiuxian-2d
_SKILL_ICONS = os.path.join(_ROOT, 'docs', 'shots', 'skill_icons')
_TOOLS = os.path.join(_ROOT, 'tools')
if _TOOLS not in sys.path:
    sys.path.insert(0, _TOOLS)

from PIL import Image, ImageDraw, ImageFont          # noqa: E402
from game_icons import draw_weapon_icon             # noqa: E402
from game_special_icons import draw_armor_icon      # noqa: E402


# ══════════════════════════════════════════════════════════════
# 游戏里的常量（从源码里抄过来的 ✗ 保证一致）
# ══════════════════════════════════════════════════════════════

LOOT_COL = [0xbfa88a, 0x8fd28a, 0x8fc4ff, 0xc08fff, 0xffd83d, 0xff9a5c,
            0xff6a5c, 0xff5cf0, 0x5cf0ff, 0xffffff, 0xe0b830, 0xff3b30]

SKILL_CN = {
    'blackhole': '黑洞', 'swordrain': '万剑', 'earthsplit': '地裂', 'icefield': '冰封',
    'thunder': '雷霆', 'bloodrage': '血怒', 'gale': '疾风', 'shield': '护盾',
    'timestop': '时停', 'bloodslash': '燃血斩', 'judgement': '天罚', 'arrowrain': '箭雨',
    'firestorm': '烈焰', 'blink': '跳跃', 'plague': '病毒',
    'clone': '分身', 'tank': '坦克', 'shadowstep': '影袭', 'thunderbolt': '雷引',
    'thorns': '荆棘', 'splitarrow': '分裂箭', 'berserk': '暴走', 'undying': '不灭',
    'bloodthirst': '嗜血', 'burn': '灼烧',
    'cdcut': '冷却', 'skillcrit': '技暴', 'omnivamp': '吸血', 'skilldmg': '技伤',
    'qiflow': '灵气', 'skillten': '韧性', 'chain': '连锁', 'masterA': '主精通',
    'masterB': '被精通', 'thrifty': '节能', 'skdur': '持续', 'skrange': '范围',
    'extra_crit': '暴击',
}

KIND_LABEL = {'A': '主动', 'B': '被动释放', 'C': '被动加成'}
KIND_COL = {'A': (255, 216, 61), 'B': (192, 132, 252), 'C': (142, 224, 168)}
KIND_MAX = 15

# 属性面板的行排序（key → 中文名 ✗ 从服务端 _stat_sheet 来的 k 字段）
# ★ 2026-10-25：分组名以服务端 _stat_sheet 的 grp 字段为准
#   实际是 生存 / 输出 / 手感 / 副加 ✗ 不是"附加"✓
STAT_GROUPS = [('生存', (126, 224, 138)), ('输出', (255, 160, 100)),
               ('手感', (140, 195, 255)), ('副加', (192, 160, 255))]

# 配色
BG_TOP, BG_BOT = (18, 22, 30), (26, 32, 42)
C_TEXT, C_DIM, C_DIMMER = (228, 236, 246), (150, 164, 180), (100, 114, 130)
C_ACCENT, C_LINE = (255, 216, 61), (48, 58, 70)
C_GREEN, C_BLUE, C_PURPLE = (126, 224, 138), (140, 195, 255), (192, 140, 255)


def _font(sz, bold=False):
    # ★ 本地 Windows 用微软雅黑 ✗ 云端 Linux 用 Noto CJK ✓
    if bold:
        cands = ['C:/Windows/Fonts/msyhbd.ttc', 'C:/Windows/Fonts/simhei.ttf',
                 '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
                 '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc']
    else:
        cands = ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf',
                 '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
                 '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
                 '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc']
    for p in cands:
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            continue
    return ImageFont.load_default()


def _tier_col(tier):
    t = max(0, min(11, int(tier or 0)))
    h = LOOT_COL[t]
    return ((h >> 16) & 255, (h >> 8) & 255, h & 255)


def _fmt(n):
    try:
        return format(int(round(float(n))), ',')
    except Exception:
        return str(n)


def _need_exp(lv):
    """和 mobs.level_up_need 一致：K(L) = 6 + 1.3L"""
    L = max(1, int(lv))
    k = 6.0 + 1.3 * L
    mob = 10.0 + 4.0 * L + 0.12 * L * L
    return int(round(k * mob))


# ══════════════════════════════════════════════════════════════
# 数据读取
# ══════════════════════════════════════════════════════════════

def load_role_data(db_path, qq_or_name):
    """按 QQ 号或角色名查一个角色的渲染所需数据"""
    c = sqlite3.connect(db_path)
    c.row_factory = sqlite3.Row
    try:
        row = None
        # 先按名字
        row = c.execute('SELECT * FROM roles WHERE name=?', (str(qq_or_name),)).fetchone()
        if row is None:
            # 再按 QQ 号（roles 表有没有 qq 列视版本而定）
            try:
                row = c.execute('SELECT * FROM roles WHERE qq=?', (str(qq_or_name),)).fetchone()
            except Exception:
                row = None
        if row is None:
            return None
        rid = row['id']

        eq = {}
        for x in c.execute('SELECT slot, item_id FROM equipment WHERE role_id=?', (rid,)):
            it = c.execute('SELECT item_json FROM items WHERE id=?', (x['item_id'],)).fetchone()
            if it:
                try:
                    eq[x['slot']] = json.loads(it['item_json'])
                except Exception:
                    pass

        load = {'A': [], 'B': [], 'C': []}
        for x in c.execute('SELECT kind, slot, key FROM skill_load WHERE role_id=? '
                           'ORDER BY kind, slot', (rid,)):
            k = str(x['kind'] or '').upper()
            if k in load and x['key']:
                load[k].append(x['key'])

        return {
            'id': rid,
            'name': row['name'],
            'level': int(row['level'] or 1),
            'exp': int(row['exp'] or 0),
            'gold': int(row['gold'] or 0),
            'hp': int(row['hp'] or 0),
            'equip': eq,
            'skills': load,
        }
    finally:
        c.close()


# ══════════════════════════════════════════════════════════════
# 渲染
# ══════════════════════════════════════════════════════════════

def render_stat_card(db_path, qq_or_name, stats=None):
    """渲染属性面板 ✗ 返回 PNG bytes（查不到返回 None）

    stats: 服务端 _stat_sheet 的结果（list）✗ 不传就只画装备和技能
    """
    data = load_role_data(db_path, qq_or_name)
    if not data:
        return None

    W = 750
    M = 20
    CL, CR = M, W - M
    H_MAX = 2400

    img = Image.new('RGB', (W, H_MAX), BG_TOP)
    d = ImageDraw.Draw(img)

    F = lambda s: _font(s)
    FB = lambda s: _font(s, True)

    def fit(txt, fnt, maxw):
        if d.textlength(txt, font=fnt) <= maxw:
            return txt
        out = txt
        while out and d.textlength(out + '…', font=fnt) > maxw:
            out = out[:-1]
        return out + '…'

    # ── 头部 ──
    HEAD_H = 112
    d.rectangle([0, 0, W, HEAD_H], fill=(22, 28, 38))
    d.rectangle([0, HEAD_H - 3, W, HEAD_H], fill=C_ACCENT)
    d.text((22, 22), fit(data['name'], FB(38), 380), font=FB(38), fill=C_ACCENT)
    d.text((22, 68), 'Lv %d  ·  修仙者' % data['level'], font=F(19), fill=C_DIM)

    # 金币
    gt = _fmt(data['gold'])
    d.text((W - 22 - d.textlength('金币', font=F(14)), 14), '金币', font=F(14), fill=C_DIMMER)
    d.text((W - 22 - d.textlength(gt, font=FB(22)), 32), gt, font=FB(22), fill=C_ACCENT)
    # 经验 + 进度条
    need = _need_exp(data['level'])
    et = '%s / %s' % (_fmt(data['exp']), _fmt(need))
    d.text((W - 22 - d.textlength('经验', font=F(14)), 62), '经验', font=F(14), fill=C_DIMMER)
    d.text((W - 22 - d.textlength(et, font=F(15)), 61), et, font=F(15), fill=C_BLUE)
    bw, bx, by = 150, W - 22 - 150, 82
    d.rounded_rectangle([bx, by, bx + bw, by + 6], radius=3, fill=(40, 48, 58))
    pct = min(1.0, data['exp'] / max(1, need))
    d.rounded_rectangle([bx, by, bx + max(3, int(bw * pct)), by + 6], radius=3, fill=C_BLUE)

    y = HEAD_H + 12

    def sec(txt, yy, accent=C_ACCENT):
        d.rectangle([M, yy + 4, M + 3, yy + 19], fill=accent)
        d.text((M + 10, yy + 3), txt, font=FB(16), fill=accent)
        return yy + 23

    def two_col_row(yy, left, right):
        CW = (W - 2 * M - 14) // 2
        for i, item in enumerate((left, right)):
            if not item:
                continue
            cx = M + i * (CW + 14)
            name, val, col = item
            d.text((cx, yy), name, font=F(14), fill=C_DIM)
            vw = d.textlength(val, font=FB(14))
            d.text((cx + CW - vw, yy), val, font=FB(14), fill=col)

    # ── 属性（有服务端数据才画）──
    if stats:
        by_grp = {}
        for r in stats:
            by_grp.setdefault(r.get('grp') or '其它', []).append(r)

        def fmt_stat(r):
            u = r.get('unit') or ''
            v = r.get('v')
            if u == '×':
                return '×%g' % (round(float(v), 2))
            if u == '%':
                return '%g%%' % (round(float(v), 1))
            if u in ('秒', '米/秒', '刀/秒'):
                return '%g%s' % (round(float(v), 2), u)
            return _fmt(v)

        for gname, gcol in STAT_GROUPS:
            lst = by_grp.get(gname)
            if not lst:
                continue
            y = sec(gname, y, gcol)
            i = 0
            while i < len(lst):
                def mk(r):
                    return (r.get('n') or r.get('k'), fmt_stat(r), C_TEXT)
                two_col_row(y, mk(lst[i]), mk(lst[i + 1]) if i + 1 < len(lst) else None)
                y += 27
                i += 2
            y += 3

    # ── 装备 ──
    eq = data['equip']
    if eq:
        y += 14
        d.rectangle([0, y, W, y + 1], fill=C_LINE)
        y += 10
        y = sec('装备', y, C_PURPLE)

        EI = 78
        EI_X = CL + 12
        ETX = EI_X + EI + 14
        ETXT = CR - 12 - ETX

        for slot, it in (('武器', eq.get('weapon')), ('防具', eq.get('armor'))):
            if not it:
                continue
            tier = int(it.get('tier') or 0)
            col = _tier_col(tier)
            bases, affixes = [], []
            for bk, bv in (it.get('base') or {}).items():
                nm = {'hp': '生命', 'dr': '减伤', 'dodge': '闪避',
                      'atk': '攻击', 'crit': '暴击', 'critdmg': '爆伤'}.get(bk, bk)
                if isinstance(bv, (int, float)):
                    bases.append('%s +%s' % (nm, _fmt(bv)))
            for af in (it.get('affixes') or []):
                tx = af.get('text') or af.get('name')
                if tx:
                    affixes.append(tx)

            nrow = max(len(bases), len(affixes), 1)
            h = 10 + 28 + 22 + nrow * 22 + 12
            d.rounded_rectangle([CL, y, CR, y + h], radius=10,
                                fill=(28, 34, 44), outline=col + (255,), width=2)
            is_wpn = (slot == '武器')
            ic = (draw_weapon_icon(it.get('look') or 'sword', tier, EI) if is_wpn
                  else draw_armor_icon(EI, color=col))
            d.rounded_rectangle([EI_X, y + 10, EI_X + EI, y + 10 + EI], radius=8,
                                fill=(38, 36, 52), outline=col + (255,), width=2)
            img.paste(ic, (EI_X + 1, y + 11), ic)
            sw = d.textlength(slot, font=F(12))
            d.text((EI_X + (EI - sw) / 2, y + 12 + EI + 4), slot, font=F(12), fill=C_DIMMER)

            ty = y + 12
            d.text((ETX, ty), fit(it.get('name') or '?', FB(20), ETXT - 62), font=FB(20), fill=col)
            ilv = it.get('itemLv') or it.get('ilv') or 0
            ilt = 'Lv.%d' % int(ilv)
            iw = d.textlength(ilt, font=FB(15)) + 16
            ibx = CR - 14 - iw
            d.rounded_rectangle([ibx, ty - 2, ibx + iw, ty + 22], radius=7,
                                fill=(52, 46, 28), outline=(210, 180, 80), width=1)
            d.text((ibx + 8, ty), ilt, font=FB(15), fill=(255, 220, 120))
            ty += 28
            d.text((ETX, ty), '品阶 %d' % (tier + 1), font=F(14), fill=col)
            ty += 22
            CW = (ETXT - 12) // 2
            for k in range(nrow):
                cy = ty + k * 22
                if k < len(bases):
                    d.text((ETX, cy), fit(bases[k], F(14), CW - 6), font=F(14), fill=C_TEXT)
                if k < len(affixes):
                    d.text((ETX + CW + 12, cy), fit('◆ ' + affixes[k], F(14), CW - 6),
                           font=F(14), fill=(130, 195, 255))
            y += h + 10

    # ── 技能 ──
    sk = data['skills']
    total_sk = sum(len(v) for v in sk.values())
    if total_sk:
        y += 8
        d.rectangle([0, y, W, y + 1], fill=C_LINE)
        y += 10
        y = sec('技能（%d）' % total_sk, y, C_GREEN)

        SK, COLS, GAP = 80, 7, 14
        cell_w = (W - 2 * M) // COLS
        for kind in ('A', 'B', 'C'):
            keys = sk.get(kind) or []
            if not keys:
                continue
            kc = KIND_COL[kind]
            d.rectangle([M, y + 5, M + 3, y + 21], fill=kc)
            d.text((M + 9, y + 2), KIND_LABEL[kind], font=FB(16), fill=kc)
            d.text((M + 9 + d.textlength(KIND_LABEL[kind], font=FB(16)) + 10, y + 3),
                   '%d/%d' % (len(keys), KIND_MAX), font=F(14), fill=C_DIMMER)
            y += 28
            for i, key in enumerate(keys):
                cx = M + (i % COLS) * cell_w
                cy = y + (i // COLS) * (SK + 30 + GAP)
                fp = os.path.join(_SKILL_ICONS, '%s_%s.png' % (key, kind))
                if os.path.exists(fp):
                    ci = Image.open(fp).convert('RGBA').resize((SK, SK), Image.LANCZOS)
                    img.paste(ci, (cx + (cell_w - SK) // 2, cy), ci)
                else:
                    d.rounded_rectangle([cx + 4, cy, cx + 4 + SK, cy + SK],
                                        radius=8, fill=(40, 48, 58))
                nm = SKILL_CN.get(key, key)
                nw = d.textlength(nm, font=F(14))
                d.text((cx + (cell_w - nw) / 2, cy + SK + 7), nm, font=F(14),
                       fill=(200, 210, 225))
            rows = (len(keys) + COLS - 1) // COLS
            y += rows * (SK + 30 + GAP) + 10

    # ── 底部 ──
    FOOT_H = 40
    fy = y + 10
    d.rectangle([0, fy, W, fy + FOOT_H], fill=(20, 26, 34))
    d.rectangle([0, fy, W, fy + 1], fill=C_LINE)
    d.text((22, fy + 12), '群内发送「x %s」查询  ·  数据由服务器实时计算' % data['name'],
           font=F(13), fill=C_DIMMER)

    real_h = fy + FOOT_H
    out = img.crop((0, 0, W, real_h))
    buf = io.BytesIO()
    out.save(buf, 'PNG', optimize=True)
    return buf.getvalue()


if __name__ == '__main__':
    db = os.path.join(_HERE, 'game.db')
    png = render_stat_card(db, sys.argv[1] if len(sys.argv) > 1 else 'fangou')
    if png:
        out = os.path.join(_ROOT, 'docs', 'shots', 'qq_stat_test.png')
        with open(out, 'wb') as f:
            f.write(png)
        print('已生成:', out, len(png), 'bytes')
    else:
        print('查不到这个角色')
