import io
p = 'server/world.py'
t = io.open(p, encoding='utf-8').read()
# ① 删掉重复的 _tune_sig（保留第 224 轮那行 ✓）
D1 = "        self._tune_sig = None     # 第 216 轮：管理员设置的指纹（变了就存 ✓）\n"
assert t.count(D1) == 1, 'D1=%d' % t.count(D1)
t = t.replace(D1, '')
# ② 删掉重复的 tick 调用（保留带原注释的那行 ✓）
D2 = "            self._admin_tune_check()\n            self._admin_tune_check()   # ★ 第 168 轮（用户 #5）：收回超时的幽灵 ✓\n"
assert t.count(D2) == 1, 'D2=%d' % t.count(D2)
t = t.replace(D2, "            self._admin_tune_check()   # ★ 第 224 轮：管理员设置变了就排队存 ✓\n"
                  "            self._ghost_tick()   # ★ 第 168 轮（用户 #5）：收回超时的幽灵 ✓\n")
# ③ 检查方法有没有重复定义
n1 = t.count("    def _admin_tune_save(self):")
n2 = t.count("    def _admin_tune_check(self):")
n3 = t.count("self._tune_sig = None")
print('  _admin_tune_save 定义 %d 次 · _admin_tune_check 定义 %d 次 · _tune_sig 初始化 %d 次' % (n1, n2, n3))
assert n1 == 1 and n2 == 1 and n3 == 1, '还有重复 ✗'
io.open(p, 'w', encoding='utf-8', newline='\n').write(t)
print('  OK 重复清干净了')
