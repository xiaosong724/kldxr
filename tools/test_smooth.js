// P0-9：双客户端平滑度测试
// ★ 用的是 core/game.js 里【真实的】插值函数（从文件里抠出来），喂真实服务器数据。
//
// 测试结构刻意模仿真实客户端：
//   一个自校正的驱动循环同时干三件事 —— 甲按 30Hz 发包 / 乙收包喂缓冲 / 乙按 60fps 渲染采样
//   （不用多个 setInterval：Node 的定时器在忙的时候会抖到几百毫秒，那是测试环境的问题，不是游戏的）
//
// 跑法：node tools/test_smooth.js

const fs = require('fs');
const path = require('path');

const CORE = path.join(__dirname, '..', 'web', 'core', 'game.js');
const src = fs.readFileSync(CORE, 'utf8');

// ---------------------------------------------------------------- 从 core 抠真实函数
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
  grabFn('netRenderAt'),
  grabFn('netPush'),
  grabFn('netSample'),
  'return { NET: NET, netClkUpdate: netClkUpdate, netRenderAt: netRenderAt, netPush: netPush, netSample: netSample };'
].join('\n'))();
const { NET, netClkUpdate, netRenderAt, netPush, netSample } = F;
NET.bufMax = NET.bufMax || 60;

console.log('从 core/game.js 抠出真实的插值函数 ✓');
console.log('  NET.rate=' + NET.rate + '  minMul=' + NET.minMul + '  maxDelay=' + NET.maxDelay +
  '  clkWarm=' + NET.clkWarm + '  jitFall=' + NET.jitFall + '  jitGain=' + NET.jitGain);
console.log('');

// ---------------------------------------------------------------- 客户端
const HTTP = 'http://127.0.0.1:8899';
const WSPORT = 8900;
const PW = 'abc123456';
const NA = '平滑测试甲', NB = '平滑测试乙';

async function post(p, b) {
  const r = await fetch(HTTP + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b)
  });
  let j = {}; try { j = await r.json(); } catch (e) { }
  return j;
}
class C {
  constructor() { this.q = []; }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket('ws://127.0.0.1:' + WSPORT + '/ws');
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('ws error'));
      this.ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        // ★ 到达时刻必须在这里取（= 真实客户端在 onmessage 里调 wsApplyWorld 的时刻 ✓）
        //   原来是在 drive() 的循环里取：同一批消息共用一个时间戳 →
        //   到达延迟被批次量化污染（实测 P95 白涨到 60ms、最大 858ms）→ 假的抖动 ✗
        this.q.push({ m: m, at: performance.now() / 1000 });
      };
    });
  }
  send(t, d) { this.ws.send(JSON.stringify({ t, d: d || {} })); }
  async wait(type, ms = 6000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const i = this.q.findIndex(x => x.m.t === type);
      if (i >= 0) return this.q.splice(i, 1)[0].m;
      await new Promise(r => setTimeout(r, 10));
    }
    return null;
  }
  close() { try { this.ws.close(); } catch (e) { } }
}

function stats(a) {
  if (!a.length) return { n: 0, mean: 0, sd: 0, max: 0, p95: 0 };
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  const v = a.reduce((x, y) => x + (y - m) * (y - m), 0) / a.length;
  const s = a.slice().sort((x, y) => x - y);
  return { n: a.length, mean: m, sd: Math.sqrt(v), max: s[s.length - 1], p95: s[Math.floor(s.length * 0.95)] };
}

const SPEED = 3.0, SEND_HZ = 30, DUR = 6.0;
// ★ 走完再【站住】STAND 秒，而且站住期间甲【照常按 30Hz 发包】（位置不变、t 继续前进）。
//   这才是真实产品的行为：core/game.js 的 netSync() 是无条件每 33ms 发一次 move 的 ✓
//   （早先的测试是"甲直接停止发包"→ 服务端只能重发同一个旧 t → 缓冲尾没有任何新时间可用，
//     那种场景谁也救不了，而且现实里不会发生 ✗ 它会假造出一大截抖动）
const STAND = 1.5;
const X0 = 500, Z0 = 500;

(async () => {
  const tokA = (await post('/api/register', { name: NA, password: PW })).token
    || (await post('/api/login', { name: NA, password: PW })).token;
  const tokB = (await post('/api/register', { name: NB, password: PW })).token
    || (await post('/api/login', { name: NB, password: PW })).token;
  if (!tokA || !tokB) { console.error('注册/登录失败'); process.exit(1); }

  const A = new C(); await A.connect();
  A.send('hello', { token: tokA, ver: 1 });
  if (!await A.wait('welcome')) { console.error('甲进不去'); process.exit(1); }
  const B = new C(); await B.connect();
  B.send('hello', { token: tokB, ver: 1 });
  if (!await B.wait('welcome')) { console.error('乙进不去'); process.exit(1); }

  A.send('move', { x: X0, z: Z0, yaw: 0, t: 0 });
  B.send('move', { x: X0 + 3, z: Z0, yaw: 0, t: 0 });
  await new Promise(r => setTimeout(r, 500));
  B.q.length = 0;
  console.log('两个客户端都已进入世界，开始测（甲匀速 ' + SPEED + ' m/s 走 ' + DUR + ' 秒）');

  // ---------------- 乙的插值状态（和 core 里的 other 对象一致）----------------
  const clk = { off: undefined, late: 0, delay: 0.06, n: 0 };
  const buf = [];
  const out = { x: 0, z: 0, yaw: 0 };
  const recv = [];          // 乙收到的甲的每一包 {x, t, now}
  const samples = [];       // 渲染采样 {t, x}
  const samplesA = [];      // 对照：按到达时刻排队
  const bufA = [];
  const outA = { x: 0, z: 0, yaw: 0 };
  let prevX = null, prevXA = null;
  let sent = 0;

  const t0 = performance.now() / 1000;
  const FRAME = 1 / 60;
  let sendTarget = t0;       // ★ 计划发送时刻（自校正，和 core 的 netStartLoop 一个套路）
  let lastTick = t0;
  let maxStall = 0;
  let running = true;

  function drive() {
    const now = performance.now() / 1000;
    const elapsed = now - t0;
    const tickGap = now - lastTick;
    if (tickGap > maxStall) { maxStall = tickGap; }
    lastTick = now;

    // ---- 甲：按【计划时刻】发包，间隔恒为 33.3ms。
    //   位置和钟都来自同一个计划时刻 → 两者绝对自洽 ✓
    //   （上一版按"距上次够久了就发"→ 实际只有 24Hz 且间隔抖 8.7ms，
    //     结果撞上 netPush 的间隔夹紧 [0.7×rate, 1.4×rate] → 时间轴被拉歪 ✗
    //     那是测试造出来的假象，不是游戏的）
    //   ★ 走满 DUR 之后【位置冻住但继续发包】（模拟站住），t 照常前进 —— 和 netSync 一致 ✓
    while (running && sendTarget - t0 <= DUR + STAND && sendTarget <= now + 0.005) {
      const walked = Math.min(sendTarget - t0, DUR);
      A.send('move', {
        x: +(X0 + SPEED * walked).toFixed(3), z: Z0, yaw: 0,
        t: +sendTarget.toFixed(4)
      });
      sent++;
      sendTarget += 1 / SEND_HZ;
    }

    // ---- 乙：收包 → 对齐钟 → 喂缓冲（就是 core 里 wsApplyWorld 干的事）----
    while (B.q.length) {
      const e = B.q.shift();
      const m = e.m;
      if (m.t !== 'world') continue;
      const p = (m.d.players || []).find(o => o.n === NA);
      if (!p) continue;
      if (!(p.t > 0)) continue;                   // ★ 丢掉入世界那一包的 t=0（服务端初始 ct），不然统计里多一个假间隔
      recv.push({ x: p.x, t: p.t, now: e.at });   // ★ e.at = 真正收到那一刻 ✓
      netClkUpdate(clk, e.at, p.t);           // ★ 对齐到【甲自己的钟】
      netPush(buf, p.x, p.z, p.y, p.t);      // ★ 按甲的钟排队
      netPush(bufA, p.x, p.z, p.y, e.at);    // 对照：按到达时刻排队
    }

    // ---- 乙：60fps 渲染采样（和 core 里 netUpdate 一个套路）----
    // ★ 记的是 (时刻, 位置)，最后算【速度 = Δx/Δt】——
    //   不能拿"每次 drive 调用的位移"当指标：Node 定时器实际间隔是 20ms 上下不是 16.7ms，
    //   那样量出来的位移会凭空偏大（指标被测试的节奏污染 ✗）
    if (buf.length && clk.off !== undefined) {
      const rt = now - clk.off - clk.delay;
      if (netSample(buf, rt, out) && isFinite(out.x)) {
        samples.push({ t: now, x: out.x });
      }
      const rtA = now - 0.07;               // 老做法：固定 70ms 缓冲
      if (netSample(bufA, rtA, outA) && isFinite(outA.x)) {
        samplesA.push({ t: now, x: outA.x });
      }
    }

    if (elapsed < DUR + STAND + 0.8) { setTimeout(drive, FRAME * 1000); }
    else { running = false; setTimeout(finish, 100); }
  }

  function finish() {
    // 只取"甲真的动了"的包（服务器每 tick 都重发当前坐标，会有重复）
    const uniq = [];
    for (const r of recv) { if (!uniq.length || r.t > uniq[uniq.length - 1].t) uniq.push(r); }

    const dSend = [];
    for (let i = 1; i < uniq.length; i++) dSend.push((uniq[i].t - uniq[i - 1].t) * 1000);
    const sSend = stats(dSend);

    const dPos = [];
    for (let i = 1; i < uniq.length; i++) dPos.push(uniq[i].x - uniq[i - 1].x);
    const sPos = stats(dPos);
    const idealDx = SPEED / SEND_HZ;

    console.log('');
    console.log('甲发出 ' + sent + ' 包；乙收到含甲的 world 包 ' + recv.length +
      ' 个，其中"甲真的动了"的新包 ' + uniq.length + ' 个');
    console.log('（测试循环自身最大停顿 ' + (maxStall * 1000).toFixed(0) +
      'ms —— 这是测试环境抖的，不是游戏的）');
    console.log('');
    console.log('① 甲上报间隔（服务端采样后，理想 33.3ms）: 均值 ' + sSend.mean.toFixed(1) +
      'ms  σ=' + sSend.sd.toFixed(1) + 'ms  P95=' + sSend.p95.toFixed(1) + 'ms  最大 ' + sSend.max.toFixed(0) + 'ms');
    // ★ 诊断：最大的几个"钟间隔"落在时间轴哪儿（走路段还是站住段）
    const gaps = [];
    for (let i = 1; i < uniq.length; i++) {
      gaps.push({ g: (uniq[i].t - uniq[i - 1].t) * 1000, at: uniq[i].t - t0 });
    }
    gaps.sort((a, b) => b.g - a.g);
    console.log('   最大 3 个钟间隔: ' + gaps.slice(0, 3).map(function (x) {
      return x.g.toFixed(0) + 'ms@' + x.at.toFixed(2) + 's';
    }).join('  ') + '   （走路 0~' + DUR + 's，站住 ' + DUR + '~' + (DUR + STAND) + 's）');
    console.log('② 每包位移（理想 ' + idealDx.toFixed(3) + 'm）            : 均值 ' + sPos.mean.toFixed(4) +
      'm  σ=' + sPos.sd.toFixed(5) + 'm  最大 ' + sPos.max.toFixed(3) + 'm');
    console.log('③ 时钟对齐后抖动缓冲 delay              : ' + (clk.delay * 1000).toFixed(1) +
      'ms（历史最大迟到 ' + (clk.late * 1000).toFixed(1) + 'ms）');
    // ★ 先只保留【钟严格前进】的键：服务端每 tick 会重发"当前状态"，
    //   重复包对回放和诊断都没有信息量（它们的 now − t 天然很大，会把统计全带歪 ✗）
    const pkts = [];
    for (const r of recv) { if (!pkts.length || r.t > pkts[pkts.length - 1].t) { pkts.push(r); } }
    const WARM = NET.clkWarm || 45;
    let off0 = Infinity;
    for (let i = 0; i < Math.min(WARM, pkts.length); i++) {
      const raw = pkts[i].now - pkts[i].t;
      if (raw < off0) { off0 = raw; }
    }
    // ★ 到达延迟必须只用【钟前进的键】统计：重复包带的是旧 t，now−t 天生几百毫秒 ✗
    const sDly = stats(pkts.map(r => (r.now - r.t) * 1000));
    console.log('③b 到达延迟（测试循环 now − 甲的钟，只算钟前进的键）: 均值 ' + sDly.mean.toFixed(1) +
      'ms  σ=' + sDly.sd.toFixed(1) + 'ms  P95=' + sDly.p95.toFixed(1) + 'ms  最大 ' + sDly.max.toFixed(0) + 'ms');

    // ============ ④ 离线回放对照（一次分清抖动来自哪儿）============
    // 同一批真实数据，用不同方式回放。回放用规整的 1/60 步进
    // （真实客户端 rAF 就是规整的），避免把测试环境自己的定时器抖动算进去 ✓

    /* ★ 判定实验的前置修正（P0-9 第 26 轮）：
       钟差基准原来用【首包】估 off0 = recv[0].now - recv[0].t。
       首包可能是陈旧重发包（迟到量能到 1 秒）→ off0 被抬歪
       → rt = t - off0 - FIX 整体被推到缓冲头之前 → 实测 340/357 帧"冻结" ✗
       这与 core 里的做法不一致：netClkUpdate 用【热身期最小延迟】当基准。
       这里改成同样的估法（最小延迟最接近真钟差 ✓）。 */

    /* ★ model 参数：是否忠实复刻 core/game.js 的 addOther()（决定"哪些包真的进了缓冲"）
         'all'      每个收到的包都塞（测试原来那套 —— 没有模拟产品，所以测不出产品的问题 ✗）
         'otherOld' 复刻【修前】的 addOther：位置没变就整个跳过 netPush
         'otherNew' 复刻【修后】的 addOther：位置没变也塞一个"保持包"（时间前进、位置不变） */
    function replay(mode, feed, src, model) {
      src = src || recv;
      feed = feed || 'arrival';
      model = model || 'all';
      const b = [], c = { off: undefined, late: 0, delay: 0.06, n: 0 };
      const out = { x: 0, z: 0, yaw: 0 };
      const vs = [];
      let pi = 0, prev = null, prevT = 0;
      const FIX = 0.08;                                          // 固定 80ms 缓冲
      const c0 = src[0].x - SPEED * src[0].t;                    // 理想直线 x = SPEED*t + c0
      // ★ 所有模式都在【同一个时间窗】里量（含甲最后停下来、服务端还在重发的那一段），
      //   否则窗口长短不同 → 数字没法互相比较 ✗
      const tStart = recv[0].now + 0.9;
      const tEnd = recv[recv.length - 1].now - 0.15;
      const at = (r) => (feed === 'send' ? r.t + off0 : r.now);   // 该键在回放时间轴上的喂入时刻
      const holder = { clk: c };   // ★ mode='adaptive' 用：netRenderAt 就作用在它身上（等价于 core 里的 o）
      let nFrozen = 0, nEmpty = 0, nOver = 0, minLead = 9, maxLead = -9;
      let nFeed = 0, nLate = 0;   // ★ nLate = 把键推进缓冲时，渲染时刻【已经越过】这个键的次数
      let lastFedT = -1e9;
      let prevRt = null, maxDRt = 0, nJump = 0;   // ★ 渲染时刻每帧跳多少（delay 一变 rt 就跳 → 位置就跳）
      let prevWant = null, maxDWant = 0;          // ★ 不限速的话 rt 会跳多少（对照）
      let maxErr = 0, sumErr = 0, nErr = 0;   // ★ 渲染位置和真值的偏差（站住那段就看这个）
      for (let t = tStart; t < tEnd; t += 1 / 60) {
        let rtPre;
        // ★ adaptive 的 rt 由 core 的 netRenderAt 给（含限速），rtPre 就用它上一帧的值
        if (mode === 'adaptive') { rtPre = holder.rtS === undefined ? t : holder.rtS; }
        else if (mode === 'arrival') { rtPre = t - FIX; }
        else { rtPre = t - off0 - FIX; }
        while (pi < src.length && at(src[pi]) <= t) {
          const r = src[pi++];
          nFeed++;
          const adv = r.t > lastFedT;      // ★ 是不是"钟前进"的键（重复包不算）
          lastFedT = r.t;
          // ★ 判定实验要量的就是这个：喂键节奏让新键落在"渲染时刻已经走过"的位置
          //   → netSample 的 shift 会立刻吃掉它 / netPush 的乱序保护会改写末条 → 缓冲尾被弄脏
          if (mode !== 'arrival' && r.t < rtPre && adv) { nLate++; }
          if (mode === 'arrival') {
            netPush(b, r.x, 0, 0, r.now);
          } else if (mode === 'line') {
            netPush(b, SPEED * r.t + c0, 0, 0, r.t);             // 位置强制落在直线上
          } else {
            netClkUpdate(c, t, r.t);                             // 按甲自己的钟对齐
            const lp = b.length ? b[b.length - 1] : null;
            const moved = !lp || Math.abs(lp.x - r.x) > 0.002;
            if (model === 'all') {
              netPush(b, r.x, 0, 0, r.t);
            } else if (moved || !lp || (model === 'otherNew' && r.t > lp.t + NET.rate * 0.5)) {
              netPush(b, r.x, 0, 0, r.t);
            }
          }
        }
        // ★ mode='adaptive' 的渲染时刻【直接调 core 的 netRenderAt】—— 和 netUpdate 是同一份代码 ✓
        //   （以前这里是测试自己重写的一行 rt = t - off - delay，测不出 core 的改动 ✗）
        //   注意：必须每帧都调一次（它会推进内部状态 rtS），所以放在 if (!b.length) 之前
        let rt;
        if (mode === 'adaptive') {
          // ★ 顺带记一下"如果不限速，rt 会跳多少"（= 限速要解决的问题有多大）
          const want = t - (c.off || 0) - (c.delay || 0.06);
          if (prevWant !== null) {
            const dw = Math.abs((want - prevWant) - 1 / 60);
            if (dw > maxDWant) { maxDWant = dw; }
          }
          prevWant = want;
          rt = netRenderAt(holder, t, 1 / 60);
        }
        else if (mode === 'arrival') { rt = t - FIX; }
        else { rt = t - off0 - FIX; }
        if (!b.length) { nEmpty++; continue; }
        // ★ 诊断：rt 相对缓冲首尾的位置（rt < b[0].t → netSample 会冻结在当前点 ✗）
        if (mode !== 'arrival') {
          const lead = rt - b[0].t;
          if (lead < minLead) { minLead = lead; }
          if (lead > maxLead) { maxLead = lead; }
          if (lead <= 0) { nFrozen++; }
          if (rt > b[b.length - 1].t) { nOver++; }
        }
        if (!netSample(b, rt, out) || !isFinite(out.x)) { continue; }
        // ★ 诊断：rt 每帧的推进量偏离"名义帧长 1/60"多少
        //   （rt 正常每帧前进 16.7ms；偏离 = 渲染时刻被拽了一下 → 位置就跳 → 速度尖峰）
        if (prevRt !== null) {
          const d = Math.abs((rt - prevRt) - 1 / 60);
          if (d > maxDRt) { maxDRt = d; }
          if (d > 0.002) { nJump++; }
        }
        prevRt = rt;
        // ★ 真值：甲在 DUR 秒内匀速走，之后站住不动（rt 已经是【甲的钟】里的时刻 ✓）
        const truth = X0 + SPEED * Math.max(0, Math.min(rt - t0, DUR));
        const err = out.x - truth;
        if (Math.abs(err) > maxErr) { maxErr = Math.abs(err); }
        sumErr += Math.abs(err); nErr++;
        // ★ 速度只在【走路阶段】统计：站住时真值速度是 0，混进来量的就不是"平滑度"了 ✗
        const walking = (rt - t0) > 0.2 && (rt - t0) < DUR - 0.05;
        if (walking && prev !== null && t - prevT > 0.0005) { vs.push((out.x - prev) / (t - prevT)); }
        prev = out.x; prevT = t;
      }
      const s = stats(vs);
      return {
        mean: s.mean, sd: s.sd, n: s.n, jit: s.mean ? s.sd / s.mean * 100 : 0,
        nFrozen: nFrozen, nEmpty: nEmpty, nOver: nOver,
        minLead: minLead, maxLead: maxLead, nFeed: nFeed, nLate: nLate, off0: off0,
        maxDRt: maxDRt, nJump: nJump, maxDWant: maxDWant,
        maxErr: maxErr, meanErr: nErr ? sumErr / nErr : 0, nErr: nErr
      };
    }

    const rProdOld = replay('adaptive', 'arrival', recv, 'otherOld');  // A  修前的真实产品行为
    const rProdNew = replay('adaptive', 'arrival', recv, 'otherNew');  // A* 修后的真实产品行为
    const rAdapt = replay('adaptive', 'arrival', recv, 'all');         // A' 每包都塞（不做位置去重）
    const rAdaptPk = replay('adaptive', 'arrival', pkts, 'all');       // A'' 同上但只喂钟前进的键
    const rAdaptS = replay('adaptive', 'send', recv, 'all');           // A''' 按发送时刻喂
    const rFixed = replay('fixed', 'arrival', recv);
    const rFixedS = replay('fixed', 'send', recv);
    const rLine = replay('line', 'arrival', pkts);
    const rLineS = replay('line', 'send', pkts);                       // ★ C' ← 判定实验的核心一行
    const rArr = replay('arrival', 'arrival', recv);

    function row(tag, r) {
      console.log('   ' + tag + ' 走路抖动 ' + r.jit.toFixed(1) + '%  (σ=' + (r.sd * 1000).toFixed(0) +
        'mm/s, 均值 ' + r.mean.toFixed(3) + ' m/s, ' + r.n + ' 帧)');
      console.log('        位置偏差（含站住那段）: 最大 ' + (r.maxErr * 1000).toFixed(0) +
        'mm  平均 ' + (r.meanErr * 1000).toFixed(0) + 'mm');
      console.log('        渲染时刻每帧跳变: 现在最大 ' + (r.maxDRt * 1000).toFixed(1) +
        'ms（超 2ms 的帧 ' + r.nJump + ' 个）' +
        (r.maxDWant !== undefined ? '；不限速的话会跳 ' + (r.maxDWant * 1000).toFixed(1) + 'ms' : ''));
      if (r.nFrozen !== undefined) {
        console.log('        诊断: 落在缓冲头之前 ' + r.nFrozen + ' 帧 / 缓冲空 ' +
          r.nEmpty + ' 帧 / 越过缓冲尾 ' + r.nOver + ' 帧；rt 距缓冲头 ' +
          (r.minLead * 1000).toFixed(0) + '~' + (r.maxLead * 1000).toFixed(0) + 'ms' +
          '；喂键 ' + r.nFeed + ' 次，其中键已被渲染时刻越过 ' + r.nLate + ' 次');
      }
    }
    console.log('④ 平滑度（甲恒速 ' + SPEED.toFixed(1) + ' m/s 走 ' + DUR + 's，然后站住 ' + STAND +
      's 但照常 30Hz 发包；离线回放，规整 1/60 步进）');
    console.log('   钟严格前进的键 ' + pkts.length + ' 个（原始 ' + recv.length + ' 个，含服务端重发的重复包）');
    console.log('   参考：热身期最小延迟 off0 = ' + (off0 * 1000).toFixed(1) + 'ms（只给 B/C/D 这些对照模式用）');
    console.log('   走路抖动 = 位置二阶导的稳定性（越小越顺）；位置偏差 = 和真值的距离（站住时最能暴露外推 ✗）');
    row('A  真实产品·修前（没动就不塞包）    :', rProdOld);
    row('A* 真实产品·修后（没动也塞保持包）  :', rProdNew);
    row("A' 每包都塞（不做位置去重）         :", rAdapt);
    row("A'' 只喂钟前进的键（原 A）         :", rAdaptPk);
    row("A''' 每包都塞 + 按发送时刻喂        :", rAdaptS);
    row('B  固定 80ms 缓冲（对照）          :', rFixed);
    row("B' 固定 80ms + 按发送时刻喂         :", rFixedS);
    row('C  位置强制落直线 + 固定 80ms      :', rLine);
    row("C' 强制落直线 + 按发送时刻喂  ★判定 :", rLineS);
    row('D  按到达时刻排队 + 固定 80ms（老做法）:', rArr);
    console.log('');
    console.log('   判读：C 好而 B 差 → 数据本身不自洽（位置和钟对不上）');
    console.log('         B 好而 A 差 → 自适应缓冲在动，是它引入了抖动');
    console.log('         C 也差       → 排队 / 采样本身有问题');
    console.log('         ★ C 差而 C\' 归零 → 喂键节奏是元凶（到达驱动推缓冲不可靠）');

    // ★ 验收看【真实产品行为·修后】（rProdNew）：它含钟对齐 + addOther 的位置去重/保持包 + 缓冲采样，
    //   是玩家真正看到的链路 ✓ 不看"每包都塞"那种理想喂法（那是测试自己造出来的 ✗）
    let fails = 0;
    function ok(c, m) { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fails++; }
    console.log('');
    ok(uniq.length >= 120, '收到足够多的新包（' + uniq.length + ' 个）');
    // 这条是"原始转发数据"的抖动：服务端 30Hz 采样会吃掉约 15% 的上报，
    // 键间隔变成 33~67ms 不匀 —— 这是已知结构性问题（见方案 §15.1 P0-9），
    // 但它不影响渲染平滑度（渲染已经能把不匀的键还原成匀速）。
    // 所以这里只报告，不当作失败。
    console.log('  INFO  服务端转发位移抖动 ' + (sPos.sd / idealDx * 100).toFixed(1) +
      '%（键间隔不匀，已知；不影响渲染平滑度）');
    console.log('  INFO  ★ 修前（没动就不塞包）: 走路抖动 ' + rProdOld.jit.toFixed(1) +
      '% / 最大位置偏差 ' + (rProdOld.maxErr * 1000).toFixed(0) + 'mm');
    console.log('  INFO  ★ 修后（没动也塞保持包）: 走路抖动 ' + rProdNew.jit.toFixed(1) +
      '% / 最大位置偏差 ' + (rProdNew.maxErr * 1000).toFixed(0) + 'mm');
    ok(rProdNew.n > 200, '走路阶段采样帧数够（' + rProdNew.n + ' 帧）');
    ok(rProdNew.jit < 15, '★ 走路速度抖动 <15%（实测 ' + rProdNew.jit.toFixed(1) + '%）');
    ok(rProdNew.maxErr < 0.25,
      '★ 位置偏差 <250mm（含站住那段；实测 ' + (rProdNew.maxErr * 1000).toFixed(0) + 'mm）');
    ok(rProdNew.sd <= rArr.sd * 1.05,
      '真实产品不差于到达时刻排队（' + (rProdNew.sd * 1000).toFixed(1) + 'mm/s vs ' +
      (rArr.sd * 1000).toFixed(1) + 'mm/s）');

    A.close(); B.close();
    console.log('');
    console.log(fails ? ('FAILED: ' + fails) : 'ALL PASS');
    process.exit(fails ? 1 : 0);
  }

  drive();
})().catch(e => { console.error('测试崩了:', e); process.exit(1); });
