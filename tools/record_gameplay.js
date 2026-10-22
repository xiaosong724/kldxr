// record_gameplay.js -- 无头 Chrome 真实录制《块来修仙》游戏画面
// 用法: node tools/record_gameplay.js [输出目录] [秒数]
// 产出: 逐帧 PNG（frame_00000.png ...），之后用 ffmpeg 合成视频

const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const ORIGIN = process.env.PAGE || 'http://127.0.0.1:8899';
const ROOT = path.resolve(__dirname, '..');
const OUTDIR = process.argv[2] || path.join(ROOT, '.videotools', 'capture');
const SECONDS = parseFloat(process.argv[3] || '40');
const FPS = 30;
const W = 720, H = 1280;          // 竖屏 9:16，抖音标准

const CAND = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const B = CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

fs.mkdirSync(OUTDIR, { recursive: true });
// 清掉旧帧
for (const f of fs.readdirSync(OUTDIR)) {
  if (f.startsWith('frame_') && f.endsWith('.png')) { try { fs.unlinkSync(path.join(OUTDIR, f)); } catch (e) { } }
}

(async () => {
  // ---- 1. 注册账号 ----
  const nm = 'rec' + Math.random().toString(36).slice(2, 8);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, password: 'abc123456' })
  }).then(x => x.json());
  if (!reg.ok || !reg.token) { console.error('注册失败', reg); process.exit(1); }
  console.log('账号:', nm);

  // ---- 2. 启动 Chrome ----
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  const port = 9600 + Math.floor(Math.random() * 90);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    `--window-size=${W},${H}`, '--hide-scrollbars', '--mute-audio', 'about:blank'],
    { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 120 && !target; i++) {
    await sleep(250);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { }
  }
  if (!target) { console.error('Chrome 没起来'); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; } };
  const send = (m, p) => new Promise(res => { const i = ++id; wait[i] = res; ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  await send('Page.enable', {});
  await send('Runtime.enable', {});
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: true });

  // ---- 3. 进游戏 ----
  await send('Page.navigate', { url: ORIGIN + '/?t=' + Date.now() });
  await sleep(1500);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + ')');
  await send('Page.reload', {});
  await sleep(11000);   // 等世界加载
  await ev('try{ annClose(); }catch(e){}');
  await sleep(500);

  // 关闭可能的弹窗/菜单
  for (const fn of ['closeSet()', 'hideLogin()', 'bootDone()']) {
    await ev(`try{ ${fn}; }catch(e){}`);
  }
  await sleep(800);

  const ready = await ev('typeof keys !== "undefined" && !!document.getElementById("cv")');
  console.log('游戏就绪:', ready);

  // ---- 4. 驱动角色：WASD + 攻击 ----
  // 每 16ms 循环读取当前"操作意图"，用 Input.dispatchKeyEvent 真实按键
  const keyMap = { w: ['KeyW', 87], a: ['KeyA', 65], s: ['KeyS', 83], d: ['KeyD', 68], j: ['KeyJ', 74], ' ': ['Space', 32] };

  async function keyDown(k) {
    const [code, vk] = keyMap[k];
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  }
  async function keyUp(k) {
    const [code, vk] = keyMap[k];
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  }

  // ---- 5. 逐帧抓取 ----
  const totalFrames = Math.floor(SECONDS * FPS);
  const held = new Set();
  let captureStart;

  // 简化的"假玩家"：方向随机切换 + 周期性攻击
  const plan = [];
  let t = 0;
  let curDir = 'w';
  while (t < SECONDS) {
    // 每个 0.7~1.4 秒换方向
    const seg = 0.7 + Math.random() * 0.7;
    const dirs = ['w', 'w', 'a', 'd', 's'];
    curDir = dirs[Math.floor(Math.random() * dirs.length)];
    const attack = Math.random() < 0.75;
    plan.push({ start: t, end: t + seg, dir: curDir, attack });
    t += seg;
  }

  console.log(`开始录制 ${SECONDS} 秒 / ${totalFrames} 帧`);
  captureStart = Date.now();

  for (let f = 0; f < totalFrames; f++) {
    const now = (Date.now() - captureStart) / 1000;
    const step = plan.find(p => now >= p.start && now < p.end) || plan[plan.length - 1];

    // 按键状态同步
    const want = new Set([step.dir]);
    if (step.attack) { want.add('j'); }
    if (Math.floor(now * 2) % 7 === 0) { want.add(' '); }

    for (const k of held) { if (!want.has(k)) { await keyUp(k); held.delete(k); } }
    for (const k of want) { if (!held.has(k)) { await keyDown(k); held.add(k); } }

    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
    if (r.result && r.result.data) {
      fs.writeFileSync(path.join(OUTDIR, `frame_${String(f).padStart(5, '0')}.jpg`), Buffer.from(r.result.data, 'base64'));
    }
    if (f % 30 === 0) { console.log(`  ${f}/${totalFrames}`); }

    // 对齐帧率
    const target = captureStart + ((f + 1) * 1000) / FPS;
    const gapMs = target - Date.now();
    if (gapMs > 0) { await sleep(gapMs); }
  }

  for (const k of held) { await keyUp(k); }

  console.log('录制完成 →', OUTDIR);
  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
})();
