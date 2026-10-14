// 纯离线判定：netPush / netSample 本身有没有问题
// 不连服务器 —— 喂理想数据，看输出是否精确线性。
// 跑法：node tools/diag_sample.js

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'core', 'game.js'), 'utf8');

function grabFn(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('找不到 ' + name);
  let d = 0, started = false, inS = null;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    const c = src[k];
    if (inS) { if (c === '\\') { k++; continue; } if (c === inS) inS = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error('括号不配对 ' + name);
}
function grabVar(name) {
  const i = src.indexOf('var ' + name + ' = {');
  let d = 0, started = false;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    const c = src[k];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, k + 1) + ';'; }
  }
}
const F = new Function([grabVar('NET'), grabFn('netPush'), grabFn('netSample'), grabFn('netRenderAt'),
  'return {NET:NET, netPush:netPush, netSample:netSample, netRenderAt:netRenderAt};'].join('\n'))();
const { NET, netPush, netSample, netRenderAt } = F;
console.log('NET.bufMax =', NET.bufMax, ' bufMin =', NET.bufMin, ' rate =', NET.rate);

const SPEED = 3.0;

function run(tag, keyGaps, renderStep) {
  const buf = [];
  const out = { x: 0, z: 0, yaw: 0 };
  // 建键：从 t=100 开始，间隔按 keyGaps 依次给，位置严格 = SPEED*t
  let t = 100, ki = 0;
  const keys = [];
  for (let i = 0; i < 400; i++) {
    keys.push({ t: t, x: SPEED * t });
    t += keyGaps[ki++ % keyGaps.length];
  }
  const tEnd = keys[keys.length - 1].t;
  let prev = null, prevT = 0, kp = 0;
  const vs = [];
  const FIX = 0.08;
  for (let rt = keys[0].t + 0.3; rt < tEnd - 0.2; rt += renderStep) {
    // 把 rt+delay 之前的键都推进缓冲（模拟"到点了才收到"）
    while (kp < keys.length && keys[kp].t <= rt + FIX) {
      netPush(buf, keys[kp].x, 0, 0, keys[kp].t);
      kp++;
    }
    if (!netSample(buf, rt, out)) continue;
    if (prev !== null && rt - prevT > 0.0005) vs.push((out.x - prev) / (rt - prevT));
    prev = out.x; prevT = rt;
  }
  const m = vs.reduce((a, b) => a + b, 0) / vs.length;
  const sd = Math.sqrt(vs.reduce((a, b) => a + (b - m) * (b - m), 0) / vs.length);
  let worst = 0, worstI = -1;
  for (let i = 0; i < vs.length; i++) { const e = Math.abs(vs[i] - SPEED); if (e > worst) { worst = e; worstI = i; } }
  console.log('  ' + tag);
  console.log('      速度均值 ' + m.toFixed(4) + ' m/s（理想 ' + SPEED + '）  σ=' +
    (sd * 1000).toFixed(3) + 'mm/s  最大偏差 ' + (worst * 1000).toFixed(1) + 'mm/s  帧数 ' + vs.length);
  return { m, sd, worst, vs };
}

console.log('');
console.log('=== 喂理想数据（位置严格 = 3.0×t），只看采样数学 ===');
run('① 键间隔恒 33.3ms，渲染恒 1/60', [1 / 30], 1 / 60);
run('② 键间隔恒 33.3ms，渲染恒 1/120（更密）', [1 / 30], 1 / 120);
run('③ 键间隔 33/39/67ms 交替（模拟服务端采样后）', [1 / 30, 0.039, 0.067, 1 / 30, 0.045], 1 / 60);
run('④ 键间隔 33.3ms，但每 10 个漏一个（模拟被采样吃掉）',
  [1 / 30, 1 / 30, 1 / 30, 1 / 30, 1 / 30, 1 / 30, 1 / 30, 1 / 30, 1 / 30, 2 / 30], 1 / 60);
console.log('');
console.log('判读：只要 σ 明显不为 0，就说明 netPush/netSample 本身有问题（和数据无关）');

/* ============ netRenderAt：钟差被大幅重估时必须快速追上 ============
   为什么单独测这条：渲染时刻 rt 是"限速"推进的（一帧最多偏 10%），
   这是为了消掉钟差/缓冲来回动带来的位置跳变 ✓
   但钟差偶尔会【被大幅重估】—— 最典型的是服务端新玩家的第一个 ct 是 0
   （world.py 里 Player.__init__: self.ct = 0.0），第一个包算出来的钟差能偏几十秒，
   第二个包才修正。这时还按 10%/帧去追 = 差 60 秒要 600 秒才补完
   → 表现是"能看到这个人，但他钉在原地不动" ✗
   兜底：偏差超过 NET.rtSnap 就直接对齐 ✓ 下面就是验这个。 */
console.log('');
console.log('=== netRenderAt：钟差从"坏"被修正后，多久能追上 ===');
(function () {
  const o = { clk: { off: 300, delay: 0.06 } };   // 第一包：钟差偏了 300 秒（服务端 ct=0 的效果）
  let t = 0;
  netRenderAt(o, t, 1 / 60);                       // 锚在这个错位置上
  o.clk.off = 0.05;                                // 第二包：钟差修正 → want 一下前跳 ~300 秒
  let converged = -1;
  for (let i = 0; i < 3600; i++) {                 // 最多模拟 60 秒
    t += 1 / 60;
    const rt = netRenderAt(o, t, 1 / 60);
    const want = t - o.clk.off - o.clk.delay;
    if (Math.abs(want - rt) < 0.02) { converged = (i + 1) / 60; break; }
  }
  if (converged < 0) {
    console.log('  FAIL  追不上（模拟 60 秒后还没对齐，实际偏差 ' +
      (Math.abs((t - o.clk.off - o.clk.delay) - o.rtS)).toFixed(1) + ' 秒）✗');
    process.exitCode = 1;
  } else if (converged > 0.5) {
    console.log('  FAIL  追得太慢（用了 ' + converged.toFixed(2) + ' 秒；应该 < 0.5 秒）✗');
    process.exitCode = 1;
  } else {
    console.log('  PASS  0.2 秒内就对齐了（用了 ' + converged.toFixed(3) +
      ' 秒）✓ —— 没有兜底的话要追 3000 秒，等于永远钉住 ✗');
  }
})();
console.log('');
console.log('判读：第二条要是 FAIL，说明 NET.rtSnap 兜底失效了（钟差一被重估，队友就会僵住）');
