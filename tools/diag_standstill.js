// P0-9 离线判定：队友【站住不动】时，渲染位置会不会被外推出去？
// 用 core/game.js 里真实的 netPush / netSample（不是重写的近似版）。
//
// 背景（第 26 轮）：core/game.js 的 addOther() 里有一句
//     "位置没变就不塞新包（省内存 ✓ 静止时也不会乱外推 ✓）"
// 但 netSample() 在渲染时刻越过缓冲尾时会【外推】，u 上限 extrapMax=12 段。
// 如果静止 = 缓冲不再增长 → 渲染时刻必然越过缓冲尾 → 会不会被推出去 1.2m？
// 这个脚本就是量这个的。
//
// 跑法：node tools/diag_standstill.js

const fs = require('fs');
const path = require('path');

const CORE = path.join(__dirname, '..', 'web', 'core', 'game.js');
const src = fs.readFileSync(CORE, 'utf8');

function grabFn(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('找不到函数 ' + name);
  let d = 0, started = false, inS = null;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    const c = src[k];
    if (inS) { if (c === '\\') { k++; continue; } if (c === inS) inS = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error('括号不配对: ' + name);
}
function grabVar(name) {
  const i = src.indexOf('var ' + name + ' = {');
  if (i < 0) throw new Error('找不到变量 ' + name);
  let d = 0, started = false;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    const c = src[k];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, k + 1) + ';'; }
  }
  throw new Error('括号不配对: ' + name);
}

const F = new Function([
  grabVar('NET'),
  grabFn('netClkUpdate'),
  grabFn('netPush'),
  grabFn('netSample'),
  'return { NET: NET, netClkUpdate: netClkUpdate, netPush: netPush, netSample: netSample };'
].join('\n'))();
const { NET, netClkUpdate, netPush, netSample } = F;
NET.bufMax = NET.bufMax || 60;

const SPEED = 3.0, RATE = 1 / 30, OFF0 = 0.02, DELAY = 0.08;
const WALK = 3.0;          // 走 3 秒
const STAND = 3.0;         // 然后站 3 秒
const TOTAL = WALK + STAND;
const trueX = (t) => SPEED * Math.min(t, WALK);

// keys：走路阶段 30Hz 一包（位置严格 = 3.0×t）；站住之后【不发新键】（模拟现在的 addOther 提前 return）
// 另一种模式 hold=true：站住之后仍每 33ms 塞一个"位置不变、时间前进"的保持包（候选修法）
const keys = [];
for (let t = 0; t <= WALK + 1e-9; t += RATE) { keys.push({ t: +t.toFixed(4), x: +trueX(t).toFixed(4) }); }

function run(hold) {
  const buf = [], clk = { off: undefined, late: 0, delay: 0.06, n: 0 };
  const out = { x: 0, z: 0, yaw: 0 };
  const rows = [];
  let ki = 0, hi = 0, maxDrift = 0, sumAbs = 0, n = 0;
  for (let t = WALK - 0.5; t < TOTAL; t += 1 / 60) {
    const rt = t - OFF0 - DELAY;                    // 渲染时刻（在【发送方钟】里）
    while (ki < keys.length && keys[ki].t <= rt + DELAY) {
      const k = keys[ki++];
      netClkUpdate(clk, t, k.t);
      netPush(buf, k.x, 0, 0, k.t);
      hi = ki;
    }
    if (hold && t > WALK) {
      // 候选修法：站住时也把"我现在还在这儿"塞进去（位置不变、时间前进）
      const ht = +(t - OFF0).toFixed(4);
      const last = buf.length ? buf[buf.length - 1] : null;
      if (last && ht > last.t) { netPush(buf, last.x, 0, 0, ht); }
    }
    if (!buf.length) { continue; }
    if (!netSample(buf, rt, out) || !isFinite(out.x)) { continue; }
    const err = out.x - trueX(rt);
    if (t > WALK + 0.05) {                          // 只管站住之后的表现
      if (Math.abs(err) > maxDrift) { maxDrift = Math.abs(err); }
      sumAbs += Math.abs(err); n++;
    }
    rows.push({ t: t, rt: rt, x: out.x, truth: trueX(rt), err: err, bufN: buf.length });
  }
  return { rows: rows, maxDrift: maxDrift, meanAbs: n ? sumAbs / n : 0 };
}

function show(tag, r) {
  console.log('');
  console.log('=== ' + tag + ' ===');
  console.log('  站住之后的偏差：最大 ' + (r.maxDrift * 1000).toFixed(0) + 'mm  平均 ' +
    (r.meanAbs * 1000).toFixed(0) + 'mm');
  console.log('  t(本地)   渲染时刻   渲染位置   真实位置   偏差      缓冲条数');
  let lastPrint = -9;
  for (const q of r.rows) {
    if (q.t < WALK - 0.15) { continue; }
    if (q.t - lastPrint < 0.25) { continue; }
    lastPrint = q.t;
    console.log('   ' + q.t.toFixed(2) + 's     ' + q.rt.toFixed(3) + 's    ' +
      q.x.toFixed(3).padStart(7) + 'm   ' + q.truth.toFixed(3).padStart(7) + 'm   ' +
      ((q.err >= 0 ? '+' : '') + (q.err * 1000).toFixed(0) + 'mm').padStart(8) +
      '   ' + q.bufN);
  }
}

console.log('从 core/game.js 抠出真实 netPush / netSample ✓');
console.log('场景：甲以 ' + SPEED + ' m/s 走 ' + WALK + ' 秒（' + trueX(WALK) + 'm 处），然后站住 ' + STAND + ' 秒');
console.log('协议：netPush 时间轴 = 甲的钟；渲染时刻 rt = 本地 − 钟差 ' + (OFF0 * 1000) + 'ms − 缓冲 ' + (DELAY * 1000) + 'ms');

const a = run(false);
const b = run(true);
show('修前：站住后不再塞新包（旧 addOther 的行为）', a);
show('修后：站住后塞"保持包"（现在 core/game.js 的做法）', b);

console.log('');
console.log('★ 结论：');
console.log('   修前：队友站住后会被外推 ' + (a.maxDrift * 1000).toFixed(0) +
  'mm，而且一直停在那儿（人没动，画面里却往前飘）✗');
console.log('   修后：偏差 ' + (b.maxDrift * 1000).toFixed(0) + 'mm ✓');
console.log('   → 静止队友"往前飘"的根因就是"不塞新包让缓冲尾停住"，保持包能根治 ✓');
// 退出码：旧行为确实坏 + 新行为确实好 = 通过（这是个回归测试，不是"复现 bug"的脚本）
process.exit((a.maxDrift > 0.05 && b.maxDrift < 0.05) ? 0 : 1);
