# -*- coding: utf-8 -*-
"""第 225 轮改了血量上限公式后，老角色的当前血量还是小值 → 一次性补满

★ 为什么：
  第 225 轮把"生命上限"从写死的 200 改成按等级算（100 + 22L + 0.6L²）
  → 63 级的上限从 249 涨到 3883 ✓
  ★ 但【当前血量】没跟着动 ✗ 还是老公式时代存下来的两百多 ✓
  → 结果：顶着 3883 的上限、实际只有 250 血 ✓
  → 63 级僵尸一口约 400 伤害 ✗ → ★ 一口就死 ✓✓
  → 用户："我击杀一个僵尸后就死亡了"✓✓

★ 做法：把所有角色的当前血量补到"按新公式算的上限"✓
  （等于给所有人一次免费满血 ✗ 一次性 ✓ 之后就走正常逻辑 ✓）
  ★ 只补【没满的】✗ 已满的跳过 ✓
  ★ 真改之前自动备份 ✓
"""
import json, os, sqlite3, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'server'))
import mobs  # noqa: E402

dry = '--dry' in sys.argv
p = os.path.normpath(os.path.join(ROOT, 'server', 'game.db'))
print('  存档：%s' % p)

if not dry:
    r = subprocess.run([sys.executable, os.path.join(ROOT, 'server', 'backup_db.py')],
                       cwd=os.path.join(ROOT, 'server'), capture_output=True, text=True,
                       encoding='utf-8', errors='ignore')
    print('  备份：' + (r.stdout or '').strip().split('\n')[0][:90])
    if r.returncode != 0:
        print('  ✗ 备份失败 ✗ 中止')
        sys.exit(1)

c = sqlite3.connect(p)
rows = c.execute('SELECT id, name, level, hp FROM roles').fetchall()
n_fix = n_ok = n_dead = 0
sample = []
for rid, name, lv, hp in rows:
    mx = mobs.level_hp(int(lv or 1))
    cur = int(hp or 0)
    if cur >= mx:
        n_ok += 1
        continue
    if not dry:
        c.execute('UPDATE roles SET hp=? WHERE id=?', (mx, rid))
    n_fix += 1
    if len(sample) < 8:
        sample.append('     %-12s %-3d 级  %s → %d' % (name, lv or 1, cur, mx))
if not dry:
    c.commit()
c.close()
for s in sample:
    print(s)
print()
print('  %s：补满 %d 个角色 · 本来就是满的 %d 个'
      % ('【只看，没改】' if dry else '★ 已改', n_fix, n_ok))
