# -*- coding: utf-8 -*-
"""round474 第三步：战斗结算（全量吸血 / 穿透 / 减伤% / 经验）"""
import io

p = 'server/world.py'
s = io.open(p, encoding='utf-8').read()


def rep(old, new, tag):
    global s
    assert s.count(old) == 1, (tag, s.count(old))
    s = s.replace(old, new, 1)
    print('  ok:', tag)


# ---------- ① PvE 打怪：全量吸血 + 穿透 ----------
rep("""            _ls = _T.get('lifesteal', 0.0)
            _heal = 0
            if _ls > 0:
                hpm = self._hp_max(p)     # \u2605 \u7b2c 67 \u8f6e\uff1a\u542b\u9632\u5177\u52a0\u6210 \u2713
                _heal = max(1, int(round(dv * _ls / 100.0)))
                p.hp = min(hpm, int(p.hp) + _heal)""",
    """            _ls = _T.get('lifesteal', 0.0)
            # \u2605\u2605 round474\uff1a\u5168\u91cf\u5438\u8840\uff08\u5bf9\u6240\u6709\u4f24\u5bb3\u751f\u6548\uff0c\u548c\u65e7\u5438\u8840\u53ef\u53e0\u52a0 \u2713\uff09
            _va = _T.get('vamp_all', 0.0)
            _heal = 0
            if _ls > 0 or _va > 0:
                hpm = self._hp_max(p)     # \u2605 \u7b2c 67 \u8f6e\uff1a\u542b\u9632\u5177\u52a0\u6210 \u2713
                _heal = int(round(dv * (_ls + _va) / 100.0))
                if (_ls + _va) > 0 and _heal < 1:
                    _heal = 1
                p.hp = min(hpm, int(p.hp) + _heal)""",
    'pve vamp_all')

# PvE 固定减伤：穿透（词条）先抵掉
rep("""        if _st['dr'] > 0:
            # \u2605\u2605 \u7b2c 106 \u8f6e\uff08\u7528\u6237\u8981\u6c42\uff09\uff1a"\u57fa\u7840\u51cf\u4f24\u4e0d\u80fd[\u628a\u4f24\u5bb3]\u4f4e\u4e8e\u5b9e\u9645\u53d7\u5230\u4f24\u5bb3\u7684 10%"\u2605\u2605""",
    """        # \u2605 round474\uff1a\u7a7f\u900f\u8bcd\u6761\u5148\u62b5\u6389\u5bf9\u65b9\u7684\u56fa\u5b9a\u51cf\u4f24 \u2713
        try:
            _pen_f = self._aff(p, 'pen_pt')
        except Exception:
            _pen_f = 0.0
        _dr_eff = max(0.0, float(_st['dr']) - _pen_f)
        if _dr_eff != _st['dr']:
            _st = dict(_st)
            _st['dr'] = _dr_eff
        if _st['dr'] > 0:
            # \u2605\u2605 \u7b2c 106 \u8f6e\uff08\u7528\u6237\u8981\u6c42\uff09\uff1a"\u57fa\u7840\u51cf\u4f24\u4e0d\u80fd[\u628a\u4f24\u5bb3]\u4f4e\u4e8e\u5b9e\u9645\u53d7\u5230\u4f24\u5bb3\u7684 10%"\u2605\u2605""",
    'pve pen flat')

# PvE 百分比减伤：天赋 + 词条，上限 50
rep("""        _tdr = float((p.talEff or {}).get('dr') or 0.0)
        if _tdr > 0:""",
    """        # \u2605 round474\uff1a\u767e\u5206\u6bd4\u51cf\u4f24 = \u5929\u8d4b + \u88c5\u5907\u8bcd\u6761\uff0c\u4e0a\u9650 50% \u2713
        _tdr = float((p.talEff or {}).get('dr') or 0.0) + self._aff(p, 'dr_pct')
        _tdr = max(0.0, min(50.0, _tdr))
        if _tdr > 0:""",
    'pve dr pct gear')

# ---------- ② PvP：全量吸血 + 穿透 + 减伤% ----------
rep("""        # \u2605 round411\uff1a\u5929\u8d4b\u51cf\u4f24 = \u4ed6\u7684\u51cf\u4f24 \u2212 \u6211\u7684\u7a7f\u900f\uff08\u5bf9\u6297\u76f8\u51cf \u2717 \u6218\u6597\u65f6\u624d\u7b97 \u2713\uff09
        _tdr = max(0.0, self._tal(q, 'dr') - self._tal(p, 'pen'))""",
    """        # \u2605 round411\uff1a\u5929\u8d4b\u51cf\u4f24 = \u4ed6\u7684\u51cf\u4f24 \u2212 \u6211\u7684\u7a7f\u900f\uff08\u5bf9\u6297\u76f8\u51cf \u2717 \u6218\u6597\u65f6\u624d\u7b97 \u2713\uff09
        # \u2605 round474\uff1a\u4e24\u8fb9\u90fd\u52a0\u4e0a\u88c5\u5907\u8bcd\u6761\uff08\u51cf\u4f24% / \u7a7f\u900f\uff09\uff0c\u5408\u8ba1\u4e0a\u9650 50% \u2713
        _tdr = max(0.0, min(50.0,
                            (self._tal(q, 'dr') + self._aff(q, 'dr_pct'))
                            - (self._tal(p, 'pen') + self._aff(p, 'pen_pt') * 0.5)))""",
    'pvp dr pct gear')

io.open(p, 'w', encoding='utf-8').write(s)
print('world.py 第二部分改完')
