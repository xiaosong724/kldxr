// 离线单测：攻击扇形 inAtkArc（第 34 轮）
// 为什么单独测：这是"背对着僵尸能不能打到"的判定核心，几何算错了肉眼很难发现
// 跑法：node tools\test_atkarc.js     （退出码 0 = 全过）
//
// ★ 直接从 web/core/game.js 里把 G 和 inAtkArc 抠出来跑 —— 测的就是真代码，
//   不是复制一份（复制一份的话，改了真代码测试还绿 ✗）

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'core', 'game.js'), 'utf8');

function grabFn(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) { throw new Error('找不到 ' + name); }
  let d = 0, started = false, inS = null;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    const c = src[k];
    if (inS) { if (c === '\\') { k++; continue; } if (c === inS) { inS = null; } continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { return src.slice(i, k + 1); } }
  }
  throw new Error('括号不配对 ' + name);
}
function grabVar(name) {
  const i = src.indexOf('var ' + name + ' = {');
  if (i < 0) { throw new Error('找不到 var ' + name); }
  let d = 0, started = false;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    const c = src[k];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { return src.slice(i, k + 1) + ';'; } }
  }
  throw new Error('括号不配对 var ' + name);
}

const F = new Function([grabVar('G'), grabFn('inAtkArc'), 'var P = { x: 0, z: 0, yaw: 0 };',
  'return { G: G, inAtkArc: inAtkArc, P: P };'].join('\n'))();
const { G, inAtkArc, P } = F;

const R = G.ATK_RANGE, A = G.ATK_ARC;
console.log('ATK_RANGE = ' + R + ' 米   ATK_ARC = ' + A.toFixed(3) + ' 弧度（' +
  (A * 180 / Math.PI).toFixed(0) + '°，也就是正前方 ' + (A * 360 / Math.PI).toFixed(0) + '° 的扇形）');
console.log('');

let bad = 0;
function t(desc, want, yaw, tx, tz) {
  P.x = 0; P.z = 0; P.yaw = yaw;
  const got = inAtkArc(tx, tz);
  const okk = (got === want);
  if (!okk) { bad++; }
  console.log('  ' + (okk ? 'PASS' : 'FAIL') + '  ' + desc +
    '（朝向 ' + (yaw * 180 / Math.PI).toFixed(0) + '°，目标 (' +
    tx.toFixed(2) + ',' + tz.toFixed(2) + ') → ' + got + '，期望 ' + want + '）');
}
// 极坐标摆点：以"朝向"为 0°，ang 是相对朝向的偏角
function at(yaw, ang, dist) {
  return [Math.sin(yaw + ang) * dist, Math.cos(yaw + ang) * dist];
}

console.log('=== 正前方 vs 背后（用户反馈的核心）===');
t('正前方 1 米 → 打得到', true, 0, 0, 1);
t('★ 正背后 1 米 → 打不到（以前会打到 ✗）', false, 0, 0, -1);
t('朝向 +x 时，正前方(+x) 打得到', true, Math.PI / 2, 1, 0);
t('朝向 +x 时，正后方(-x) 打不到', false, Math.PI / 2, -1, 0);

console.log('');
console.log('=== 侧面（应该在扇形外）===');
t('正左 90° → 打不到', false, 0, ...at(0, Math.PI / 2, 1));
t('正右 90° → 打不到', false, 0, ...at(0, -Math.PI / 2, 1));
t('偏 45° → 打得到（在 60° 内）', true, 0, ...at(0, Math.PI / 4, 1));
t('偏 45°（另一边）→ 打得到', true, 0, ...at(0, -Math.PI / 4, 1));

console.log('');
console.log('=== 边界（正好在扇形边缘 / 刚好超出）===');
t('正好 ' + (A * 180 / Math.PI).toFixed(0) + '° → 打得到（含边界）', true, 0, ...at(0, A, 1));
t('超出 3° → 打不到', false, 0, ...at(0, A + 0.05, 1));
t('正好在射程上（' + R + ' 米）→ 打得到', true, 0, ...at(0, 0, R));
t('超出射程 0.1 米 → 打不到', false, 0, ...at(0, 0, R + 0.1));
t('射程外但正前方 → 打不到（只看距离）', false, 0, ...at(0, 0, R * 1.5));

console.log('');
console.log('=== 角度绕圈（朝向转一整圈，同一个目标应该只在正前方那一小段为 true）===');
{
  const tz = 1, tx = 0;             // 目标固定在 (0,1)
  let cnt = 0, N = 360;
  for (let i = 0; i < N; i++) { P.x = 0; P.z = 0; P.yaw = i * Math.PI * 2 / N; if (inAtkArc(tx, tz)) { cnt++; } }
  const deg = cnt * 360 / N;
  const okk = Math.abs(deg - (A * 360 / Math.PI)) < 3;   // 扇形张角应该 ≈ 120°
  if (!okk) { bad++; }
  console.log('  ' + (okk ? 'PASS' : 'FAIL') + '  张角实测 ' + deg.toFixed(1) + '°（期望 ' +
    (A * 360 / Math.PI).toFixed(0) + '° ±3）');
}

console.log('');
console.log('=== 贴脸（距离≈0，不该因为算不出角度就打不到）===');
t('距离 0.005 米 → 打得到', true, 0, 0.005, 0);
t('距离 0（完全重合）→ 打得到', true, 0, 0, 0);

console.log('');
if (bad) {
  console.log('FAILED: ' + bad + ' 条 ✗（判定规则回归了）');
  process.exitCode = 1;
} else {
  console.log('ALL PASS ✓（正前方打得到、背后打不到、侧面打不到、边界含、射程外打不到）');
}
