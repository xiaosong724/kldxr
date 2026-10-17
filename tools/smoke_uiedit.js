// 查：① 键位模式下三个按钮还能不能拖 ② 那几个按钮的"蓝框"是什么
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = 'http://127.0.0.1:8899';
const CAND = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
const B = process.env.CHROME || CAND.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const NM = 'ED' + Math.random().toString(36).slice(2, 5);
  const reg = await fetch(ORIGIN + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NM, password: 'abc123456' }),
  }).then(x => x.json());
  const at = await fetch(ORIGIN + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'xiuxian-admin' }),
  }).then(x => x.json());

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx2d-ed-'));
  const port = 9900 + Math.floor(Math.random() * 60);
  const proc = spawn(B, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + dir, '--remote-debugging-port=' + port,
    '--window-size=520,900', ORIGIN + '/'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(250);
    try {
      const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wait = {}; const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errs.push(String((d.exception && d.exception.description) || d.text || '?'));
    }
  };
  const send = (m, p) => new Promise(res => {
    const i = ++id; wait[i] = res;
    ws.send(JSON.stringify({ id: i, method: m, params: p || {} }));
    setTimeout(() => { if (wait[i]) { delete wait[i]; res(null); } }, 20000);
  });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: '(function(){' + x + '})()', returnByValue: true });
    if (r && r.result && r.result.exceptionDetails) {
      return '__THROW__ ' + (r.result.exceptionDetails.exception || {}).description;
    }
    return r && r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Runtime.enable', {});
  await sleep(1200);
  await ev('localStorage.setItem("token",' + JSON.stringify(reg.token) + '); location.reload(); return 1;');
  await sleep(9000);

  // ① 样式：哪些按钮有 outline / tap-highlight / user-select
  const styles = await ev([
    'var ids = ["atk","jmp","auto","tpBtn","setBtn","uiEdit"];',
    'var rows = {};',
    'for (var i = 0; i < ids.length; i++) {',
    '  var e = document.getElementById(ids[i]);',
    '  if (!e) { rows[ids[i]] = "无此元素"; continue; }',
    '  var c = getComputedStyle(e);',
    '  rows[ids[i]] = { outline: c.outlineStyle + "/" + c.outlineWidth,',
    '    tap: c.webkitTapHighlightColor, sel: c.userSelect, ta: c.touchAction };',
    '}',
    'return JSON.stringify(rows);',
  ].join(''));
  console.log('  样式: ' + styles);

  // ② 先测"没进键位模式时不该能拖"
  const dragOff = await ev([
    'if (typeof UI_EDIT !== "undefined" && UI_EDIT) { uiEditToggle(); }',
    'var e = document.getElementById("jmp");',
    'var r0 = e.getBoundingClientRect();',
    'function pd(t, x, y) { e.dispatchEvent(new PointerEvent(t, {bubbles:true, cancelable:true,',
    '  pointerId: 9, clientX: x, clientY: y, pointerType: "mouse", isPrimary: true})); }',
    'pd("pointerdown", r0.left + 10, r0.top + 10);',
    'pd("pointermove", r0.left + 90, r0.top + 70);',
    'pd("pointerup", r0.left + 90, r0.top + 70);',
    'var r1 = e.getBoundingClientRect();',
    'return JSON.stringify({ edit: UI_EDIT,',
    '  moved: Math.round(r1.left - r0.left) + "," + Math.round(r1.top - r0.top) });',
  ].join(''));
  console.log('  拖动(普通模式): ' + dragOff);

  // ③ 进入键位模式，然后用真实的 pointer 事件拖跳跃键
  const drag = await ev([
    'if (typeof uiEditToggle === "function" && !UI_EDIT) { uiEditToggle(); }',
    'var e = document.getElementById("jmp");',
    'var r0 = e.getBoundingClientRect();',
    'function pd(t, x, y) { e.dispatchEvent(new PointerEvent(t, {bubbles:true, cancelable:true,',
    '  pointerId: 7, clientX: x, clientY: y, pointerType: "mouse", isPrimary: true})); }',
    'pd("pointerdown", r0.left + 10, r0.top + 10);',
    'pd("pointermove", r0.left + 60, r0.top + 40);',
    'pd("pointermove", r0.left + 90, r0.top + 60);',
    'pd("pointerup", r0.left + 90, r0.top + 60);',
    'var r1 = e.getBoundingClientRect();',
    'return JSON.stringify({ editMode: UI_EDIT,',
    '  moved: Math.round(r1.left - r0.left) + "," + Math.round(r1.top - r0.top),',
    '  left: Math.round(r1.left), top: Math.round(r1.top),',
    '  cls: e.className });',
  ].join(''));
  console.log('  拖动(键位模式): ' + drag);
  console.log('  页面错误: ' + (errs.length ? errs.slice(0, 2).join(' | ') : '(无)'));

  try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  await sleep(2000);
  await fetch(ORIGIN + '/api/admin/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': at.token },
    body: JSON.stringify({ act: 'delplayer', name: NM }),
  }).catch(() => null);
})();
