# -*- coding: utf-8 -*-
"""起服务器并把 stdout/stderr 写进 _run.log（★ 服务端 print 是排查的关键 ✓）

★ 为什么不用 pwsh 的 Tee-Object：它在这个环境里不生成文件 ✗
★ 为什么每行都 flush：不刷的话日志卡在缓冲区 ✗ 排查时看不到最新的 ✓
"""
import builtins
import io
import os
import runpy
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, '_run.log')

_f = io.open(LOG, 'a', encoding='utf-8', buffering=1)


class Tee(object):
    def __init__(self, *fs):
        self.fs = fs

    def write(self, s):
        for x in self.fs:
            try:
                x.write(s)
                x.flush()
            except Exception:
                pass
        return len(s)

    def flush(self):
        for x in self.fs:
            try:
                x.flush()
            except Exception:
                pass


sys.stdout = Tee(_f, sys.__stdout__)
sys.stderr = Tee(_f, sys.__stderr__)
_real_print = builtins.print


def _print(*a, **kw):
    kw['flush'] = True
    _real_print(*a, **kw)


builtins.print = _print

sys.path.insert(0, HERE)
os.chdir(HERE)
_real_print('--- start ---', flush=True)
runpy.run_path(os.path.join(HERE, 'app.py'), run_name='__main__')
