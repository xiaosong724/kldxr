# -*- coding: utf-8 -*-
"""公告（round496）

★ 一条公告 = 一份 JSON（和 tools/poster_news.json 的 items 同构 ✓）
★ 状态：draft（草稿）/ live（已发布）/ retracted（已撤回，留档）
★ 已读：roles.announce_seen 记 id ✗ 只增不减 ✓
"""
import json

import db as dbmod

STATUS = ('draft', 'live', 'retracted')
ALLOW_TAGS = ('<b>', '</b>', '<br>', '<br/>', '<br />')


def _clean_text(s, maxlen=4000):
    """只允许 <b> <br>，其余尖括号转义（渲染器也会再转义一次 ✓ 双保险）"""
    t = str(s or '')[:maxlen]
    out = []
    i = 0
    low = t.lower()
    while i < len(t):
        if t[i] == '<':
            j = low.find('>', i)
            if j > 0:
                frag = low[i:j + 1]
                if frag in ALLOW_TAGS:
                    out.append(t[i:j + 1])
                    i = j + 1
                    continue
            out.append('&lt;')
            i += 1
        elif t[i] == '>':
            out.append('&gt;')
            i += 1
        else:
            out.append(t[i])
            i += 1
    return ''.join(out)


def _items(raw):
    """→ [{'tag':..,'t':..,'b':[..]}]（字段坏了就丢掉这一条 ✓ 不炸）"""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return []
    if not isinstance(raw, list):
        return []
    out = []
    for it in raw[:30]:
        if not isinstance(it, dict):
            continue
        t = _clean_text(it.get('t') or it.get('title') or '', 120)
        if not t:
            continue
        b = it.get('b') or it.get('bullets') or []
        if isinstance(b, str):
            b = [x for x in b.split('\n')]
        bl = [_clean_text(x, 300) for x in (b or []) if str(x).strip()][:8]
        out.append({'tag': _clean_text(it.get('tag') or '', 12), 't': t, 'b': bl})
    return out


def _row_to_dict(r):
    if r is None:
        return None
    keys = r.keys() if hasattr(r, 'keys') else []
    def g(k, d=''):
        return (r[k] if k in keys else d)
    try:
        items = json.loads(g('items_json', '[]') or '[]')
    except Exception:
        items = []
    return {
        'id': int(g('id', 0) or 0),
        'ver': g('ver', '') or '',
        'title': g('title', '') or '更 新 公 告',
        'date': g('date', '') or '',
        'headline': g('headline', '') or '',
        'badge': g('badge', '') or '',
        'foot': g('foot', '') or '',
        'items': items,
        'status': g('status', 'draft') or 'draft',
        'createdAt': int(g('created_at', 0) or 0),
        'updatedAt': int(g('updated_at', 0) or 0),
        'publishedAt': int(g('published_at', 0) or 0),
    }


def latest(cfg):
    """最新一条 live（没有就 None）"""
    try:
        with dbmod.db(cfg) as c:
            r = c.execute("SELECT * FROM announcements WHERE status='live'"
                          " ORDER BY id DESC LIMIT 1").fetchone()
        return _row_to_dict(r) if r else None
    except Exception:
        return None


def get(cfg, aid):
    try:
        with dbmod.db(cfg) as c:
            r = c.execute('SELECT * FROM announcements WHERE id=?', (int(aid),)).fetchone()
        return _row_to_dict(r) if r else None
    except Exception:
        return None


def list_all(cfg, include_dead=True):
    try:
        with dbmod.db(cfg) as c:
            if include_dead:
                rows = c.execute('SELECT * FROM announcements ORDER BY id DESC').fetchall()
            else:
                rows = c.execute("SELECT * FROM announcements WHERE status='live'"
                                 " ORDER BY id DESC").fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception:
        return []


def _fields(d):
    d = d or {}
    return {
        'ver': _clean_text(d.get('ver') or '', 20),
        'title': _clean_text(d.get('title') or '更 新 公 告', 60) or '更 新 公 告',
        'date': _clean_text(d.get('date') or '', 20),
        'headline': _clean_text(d.get('headline') or '', 80),
        'badge': _clean_text(d.get('badge') or '', 40),
        'foot': _clean_text(d.get('foot') or '', 800),
        'items_json': json.dumps(_items(d.get('items')), ensure_ascii=False),
    }


def create(cfg, data, publish=False):
    """新建 → 返回新 id（失败抛异常）"""
    f = _fields(data)
    now = dbmod.now_ms()
    st = 'live' if publish else 'draft'
    with dbmod.db(cfg) as c:
        cur = c.execute(
            'INSERT INTO announcements(ver,title,date,headline,badge,foot,items_json,'
            'status,created_at,updated_at,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            (f['ver'], f['title'], f['date'], f['headline'], f['badge'], f['foot'],
             f['items_json'], st, now, now, now if publish else None))
        c.commit()
        return int(cur.lastrowid)


def update(cfg, aid, data, status=None):
    """改内容 / 改状态 → (ok, err)

    ★ 部分更新：只改【传进来的字段】✗ 没传的保留原值 ✓
      （踩过的坑：只传 {'status':'retracted'} 会把标题/卡片全清空 ✓）
    """
    row = get(cfg, aid)
    if not row:
        return False, '没有这条公告'
    merged = dict(row)
    if isinstance(data, dict):
        for k in ('ver', 'title', 'date', 'headline', 'badge', 'foot'):
            if k in data:
                merged[k] = data[k]
        if 'items' in data:
            merged['items'] = data['items']
    f = _fields(merged)
    now = dbmod.now_ms()
    st = row['status']
    pub = row['publishedAt'] or None
    if status:
        if status not in STATUS:
            return False, '状态不对'
        st = status
        if status == 'live' and not pub:
            pub = now
    try:
        with dbmod.db(cfg) as c:
            c.execute('UPDATE announcements SET ver=?,title=?,date=?,headline=?,badge=?,'
                      'foot=?,items_json=?,status=?,updated_at=?,published_at=? WHERE id=?',
                      (f['ver'], f['title'], f['date'], f['headline'], f['badge'], f['foot'],
                       f['items_json'], st, now, pub, int(aid)))
            c.commit()
        return True, ''
    except Exception as e:
        return False, '保存失败：%r' % (e,)


def drop(cfg, aid):
    """只有草稿能删 ✓"""
    row = get(cfg, aid)
    if not row:
        return False, '没有这条公告'
    if row['status'] != 'draft':
        return False, '已发布/已撤回的不能删，只能撤回（留档）'
    try:
        with dbmod.db(cfg) as c:
            c.execute('DELETE FROM announcements WHERE id=?', (int(aid),))
            c.commit()
        return True, ''
    except Exception as e:
        return False, '删除失败：%r' % (e,)


def mark_seen(cfg, role_id, aid):
    """标记已读（只增不减 ✓ 防止倒退）"""
    try:
        with dbmod.db(cfg) as c:
            c.execute('UPDATE roles SET announce_seen=? WHERE id=? AND announce_seen<?',
                      (int(aid), int(role_id), int(aid)))
            c.commit()
        return True
    except Exception:
        return False


def unread_for(cfg, role_id, seen, latest_row=None):
    """有没有未读（latest_row 传进来就省一次查库 ✓）"""
    a = latest_row if latest_row is not None else latest(cfg)
    if not a:
        return None
    try:
        seen = int(seen or 0)
    except Exception:
        seen = 0
    return a if a['id'] > seen else None
