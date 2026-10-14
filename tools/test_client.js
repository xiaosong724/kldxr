// P0-7 端到端测试：用 Node 的全局 WebSocket，走和浏览器客户端完全一样的协议路径
// 跑法：node test_client.js

const HTTP = 'http://127.0.0.1:8899';
const WS = 'ws://127.0.0.1:8900/ws';
const PW = 'abc123456';
const N1 = '端到端甲', N2 = '端到端乙';

let fails = 0;
function ok(cond, msg, got) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg + (cond ? '' : '   got=' + JSON.stringify(got)));
  if (!cond) fails++;
}

async function post(path, body, token) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h['X-Token'] = token;
  const r = await fetch(HTTP + path, { method: 'POST', headers: h, body: JSON.stringify(body || {}) });
  let j = {};
  try { j = await r.json(); } catch (e) { }
  return { status: r.status, json: j };
}

class C {
  constructor() { this.q = []; this.ready = false; this.kick = null; this.closed = false; }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(WS);
      this.ws.onopen = () => res();
      this.ws.onerror = (e) => rej(new Error('ws error'));
      this.ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'kick') this.kick = m.d;
        this.q.push(m);
      };
      this.ws.onclose = () => { this.closed = true; };
    });
  }
  send(t, d) { this.ws.send(JSON.stringify({ t, d: d || {} })); }
  async wait(type, ms = 6000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const i = this.q.findIndex(m => m.t === type);
      if (i >= 0) return this.q.splice(i, 1)[0];
      await new Promise(r => setTimeout(r, 25));
    }
    return null;
  }
  close() { try { this.ws.close(); } catch (e) { } }
}

(async () => {
  console.log('== ① 注册（走 HTTP，和客户端登录页一样）==');
  let r = await post('/api/register', { name: N1, password: PW });
  if (!r.json.token) r = await post('/api/login', { name: N1, password: PW });
  const t1 = r.json.token;
  ok(!!t1, '甲拿到 token', r.json);

  r = await post('/api/register', { name: N2, password: PW });
  if (!r.json.token) r = await post('/api/login', { name: N2, password: PW });
  const t2 = r.json.token;
  ok(!!t2, '乙拿到 token', r.json);

  console.log('== ② hello → welcome ==');
  const a = new C(); await a.connect();
  a.send('hello', { token: t1, ver: 1 });
  let w = await a.wait('welcome');
  ok(!!w, '甲收到 welcome', w);
  ok(w && w.d.role && w.d.role.name === N1, 'welcome 带角色（名字对）', w && w.d.role);
  ok(w && w.d.ver === 1, 'welcome 带协议版本', w && w.d.ver);
  ok(w && w.d.cfg && w.d.cfg.tickHz === 30, 'welcome 带 tick 配置', w && w.d.cfg);

  console.log('== ③ 版本 / token 不对都要被踢 ==');
  const bad = new C(); await bad.connect();
  bad.send('hello', { token: t1, ver: 999 });
  const k1 = await bad.wait('kick');
  ok(k1 && k1.d.code === 'ver', '版本不对 → kick(ver)', k1);
  bad.close();

  const bad2 = new C(); await bad2.connect();
  bad2.send('hello', { token: 'nope', ver: 1 });
  const k2 = await bad2.wait('kick');
  ok(k2 && k2.d.code === 'auth', '假 token → kick(auth)', k2);
  bad2.close();

  console.log('== ④ 30Hz 上行 + 下行 ==');
  const b = new C(); await b.connect();
  b.send('hello', { token: t2, ver: 1 });
  ok(!!(await b.wait('welcome')), '乙收到 welcome');

  a.send('move', { x: 300, z: 400, yaw: 1.25, t: 1.0, hp: 200, atk: 7 });
  b.send('move', { x: 303, z: 400, yaw: 0, t: 1.0, hp: 200 });
  await new Promise(r => setTimeout(r, 400));

  // 数 2 秒内乙收到多少条 world
  b.q.length = 0;
  const t0 = Date.now();
  let n = 0;
  while (Date.now() - t0 < 2000) {
    await new Promise(r => setTimeout(r, 50));
    n += b.q.filter(m => m.t === 'world').length;
    b.q = b.q.filter(m => m.t !== 'world');
  }
  const rate = n / 2;
  ok(rate >= 24, '乙收到 ~30Hz 的 world（实测 ' + rate.toFixed(1) + ' 条/秒）', rate);

  console.log('== ⑤ 互相看得见 + 插值字段齐全 ==');
  a.q.length = 0;
  a.send('move', { x: 300, z: 400, yaw: 1.25, t: 2.0 });
  let seen = null;
  const end = Date.now() + 4000;
  while (Date.now() < end && !seen) {
    const m = await a.wait('world', 500);
    if (!m) continue;
    const p = (m.d.players || []).find(x => x.n === N2);
    if (p) seen = p;
  }
  ok(!!seen, '甲在 world 里看见了乙', seen);
  if (seen) {
    ok(typeof seen.id !== 'undefined', '带角色 id（用来认自己）', seen.id);
    ok(typeof seen.x === 'number' && typeof seen.z === 'number', '带坐标', seen);
    ok(typeof seen.y === 'number', '带朝向 y', seen);
    ok(typeof seen.t === 'number', '★ 带对方自己的钟 t（客户端插值要靠它）', seen.t);
    ok(typeof seen.lv === 'number', '带等级 lv', seen.lv);
  }

  console.log('== ⑥ 断线重连（同一个 token 再连一次）==');
  a.close();
  await new Promise(r => setTimeout(r, 300));
  const a2 = new C(); await a2.connect();
  a2.send('hello', { token: t1, ver: 1 });
  const w2 = await a2.wait('welcome');
  ok(!!w2, '★ 断线后用同一个 token 能直接重连（客户端自动重连就靠这个）', w2);
  ok(!a2.kick, '重连没被踢', a2.kick);

  console.log('== ⑦ 未实现的消息只提示一次（不刷屏）==');
  // ★ 第 35 轮：atk 已经【真实现了】（P2 僵尸）→ 它不再回 error ✓
  //   所以这条断言改用还没实现的消息类型（skill 要等 P3）✓
  a2.q.length = 0;
  for (let i = 0; i < 5; i++) a2.send('skill', { slot: 0 });
  await new Promise(r => setTimeout(r, 400));
  const errs = a2.q.filter(m => m.t === 'error');
  ok(errs.length === 1, '连发 5 次未实现的消息只回 1 条 error（实测 ' + errs.length + '）', errs.length);

  console.log('== ⑧ 聊天广播 ==');
  b.q.length = 0;
  a2.send('chat', { text: '有人在吗' });
  const chat = await b.wait('chat', 3000);
  ok(chat && chat.d.text === '有人在吗', '乙收到甲的聊天', chat);
  ok(chat && chat.d['from'] === N1, '带发送者名字', chat && chat.d['from']);

  a2.close(); b.close();
  console.log();
  console.log(fails ? ('FAILED: ' + fails) : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('测试崩了:', e); process.exit(1); });
