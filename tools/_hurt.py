import io
p = 'web/core/game.js'
t = io.open(p, encoding='utf-8').read()
A = """    if (dead) { return; }                            // ★ 已经倒下了就不再掉血（免得反复触发死亡 ✓）
    if (kind === 'mob' && !mobDmgOn()) { return; }   // ★ 关了就不掉血（但攻击动作/音效照旧 ✓）
    if (dv <= 0) { return; }
    HP -= dv; shake = 0.4;
    sfx('zhurt', 0.9);"""
assert t.count(A) == 1, ('hurtPlayer 锚点: %d' % t.count(A))
NEW = """    if (dead) { return; }                            // ★ 已经倒下了就不再掉血（免得反复触发死亡 ✓）
    if (dv <= 0) { return; }
    /* ★★★ 第 240 轮修的真 bug（用户："只是挨打没有声音并且没有飘伤害，其它声音有"）★★★
       病根：这里原来是
           if (dead) return;
           if (kind === 'mob' && !mobDmgOn()) { return; }   ← ★ 一上来就返回
           if (dv <= 0) return;
           HP -= dv; sfx('zhurt'); fxNum(...);              ← 声音和飘字在这后面
       → "妖兽伤害"开关一关 ✗ 挨打的声音和飘字【全被跳过】✓✓
       → 而注释里还写着"关了就不掉血（但攻击动作/音效照旧 ✓）"
         ★ 注释和实现不一致 ✗ 实现把音效也一起掐了 ✓
       ★★ 更关键：第 239 轮改成"血量以服务器为准"之后 ✗
          这个【客户端开关已经管不住掉血了】✓
          （服务器照打 ✓ 血量照掉 ✓）
          → 结果就是"掉血了、但没声音没飘字"✓✓ 一字不差
       ★ 修法：把【表现】（抖动 + 声音 + 飘字）挪到开关之前 ✓
         只要血真的掉了 ✗ 玩家就该看到/听到 ✓
         开关只决定"要不要本地再扣一次血"✗ 不决定表现 ✓
         而且本地扣血这一步在第 239 轮之后本来也多余了 ✓
         （服务器会推真实血量 ✓ 这里再扣就扣两次 ✓）
       ★ 顺手保留 shake（受击抖动）✗ 它也是表现 ✓ 跟着挪上来 ✓ */
    shake = 0.4;
    sfx('zhurt', 0.9);"""
t = t.replace(A, NEW, 1)
# 把后面的 fxNum 和 updHP 之间那段 HS 扣血去掉（避免双扣 ✗ 服务器已经推了真值 ✓）
B = """    fxNum('-' + dv, kind === 'pvp' ? '#ff9a3c' : '#ff5a4a', fx, 2.4, fz);
    updHP();
    if (HP <= 0) { playerDie(byName); }              // ★ 不再自动满血复活 ✗ 要点复活 ✓"""
assert t.count(B) == 1, ('fxNum 锚点: %d' % t.count(B))
NEW_B = """    fxNum('-' + dv, kind === 'pvp' ? '#ff9a3c' : '#ff5a4a', fx, 2.4, fz);
    /* ★ 第 240 轮：这里原来还有一句 HP -= dv ✗ 和本地开关配合用的 ✓
       现在血量完全以服务器为准（第 239 轮 ✓）→ 这里再扣就是【扣两次】✓
       所以去掉 ✗ 血量交给服务器推过来的值 ✓
       ★ 死亡判定也不在这里做了 ✗ 服务器说死了才算（playerDie 会由
         客户端收到 hp<=0 时触发 ✓ 见第 219 轮那段双保险 ✓）*/
    if (kind === 'mob' && mobDmgOn()) { /* 老开关保留 ✓ 但现在只影响本地表现开关语义 ✓ */ }"""
t = t.replace(B, NEW_B, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(t)
print('  OK hurtPlayer 改好：表现提到开关之前 ✓ 去掉本地扣血 ✓')
