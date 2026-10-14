# -*- coding: utf-8 -*-
"""闸门：core/ 里不许出现浏览器全局对象（P0-8 验收标准）

为什么：微信 / 抖音小游戏**没有 DOM**。core 必须干干净净，
将来上小程序时只换 platform/ 一层，core 一行都不用改（方案 §1.3）。

跑法：python tools\\check_core_dom.py
退出码：0 = 干净；1 = 有违规
"""

import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORE = os.path.join(ROOT, 'web', 'core')

# 禁止出现在 core/ 里的东西（浏览器 / 平台专有）
BANNED = [
    (r'\bdocument\s*\.', 'document.'),
    (r'\bwindow\s*\.', 'window.'),
    (r'\blocalStorage\b', 'localStorage'),
    (r'\bsessionStorage\b', 'sessionStorage'),
    (r'\bgetElementById\b', 'getElementById'),
    (r'\bcreateElement\b', 'createElement'),
    (r'\baddEventListener\b', 'addEventListener'),
    (r'\bnew\s+Audio\b', 'new Audio'),
    (r'\bAudioContext\b', 'AudioContext'),
    (r'\bnew\s+WebSocket\b', 'new WebSocket'),
    (r'\bnew\s+XMLHttpRequest\b', 'XMLHttpRequest'),
    (r'\bnavigator\s*\.', 'navigator.'),
    (r'\blocation\s*\.', 'location.'),
    (r'\binnerHTML\b', 'innerHTML'),
    (r'\brequestAnimationFrame\b', 'requestAnimationFrame'),
    (r'\boffsetParent\b', 'offsetParent'),
    (r'\.style\s*\.', '.style.（直接改 DOM 样式）'),
    (r'\.textContent\b', '.textContent（直接改 DOM 文本）'),
    (r'\.parentNode\b', '.parentNode（直接操作 DOM 树）'),
    (r'\.appendChild\b', '.appendChild'),
    (r'\.classList\b', '.classList'),
]


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

    if not os.path.isdir(CORE):
        print('✗ 找不到目录：%s' % CORE)
        return 1

    bad = []
    files = 0
    for fn in sorted(os.listdir(CORE)):
        if not fn.endswith('.js'):
            continue
        files += 1
        path = os.path.join(CORE, fn)
        lines = io.open(path, encoding='utf-8').read().split('\n')
        in_block_comment = False
        for i, l in enumerate(lines, 1):
            # 粗略跳过注释行（/* */ 和 //）——注释里提到这些词是允许的
            s = l.strip()
            if in_block_comment:
                if '*/' in s:
                    in_block_comment = False
                continue
            if s.startswith('/*'):
                if '*/' not in s:
                    in_block_comment = True
                continue
            if s.startswith('//') or s.startswith('*'):
                continue
            code = re.sub(r'//.*$', '', l)
            for pat, name in BANNED:
                if re.search(pat, code):
                    bad.append((fn, i, name, s[:90]))

    print('检查 %s  （%d 个 js 文件）' % (CORE, files))
    if not bad:
        print('✓ core/ 里 0 处浏览器全局对象 —— 分层达标')
        return 0
    print('✗ 发现 %d 处违规：' % len(bad))
    for fn, i, name, s in bad:
        print('  %s:%d  [%s]  %s' % (fn, i, name, s))
    print()
    print('  → 这些应该搬到 web/platform/web.js，core 里通过 UI.* 调用')
    return 1


if __name__ == '__main__':
    sys.exit(main())
