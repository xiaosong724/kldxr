// =============================================================================
// 修仙卡片服务（**独立进程**，2026-09-17）
//
// 为什么不写成 NapCat 插件：NapCat 只在**启动时**扫一遍 `/opt/napcat/plugins/`，
// 装完插件必须重启才认（而重启有可能要重新扫码登录）。这个版本自己用 Node 22 的
// **内置 WebSocket** 连 NapCat 的 OneBot 端口（默认 4999）调 `send_group_msg` 发图 ——
// 于是它随时起停、与 NapCat 的生命周期无关，也不用动插件白名单。
//
// 数据流：
//   MC(Java 插件) --HTTP POST /card--> 本服务 --python3 render_card.py--> 本地 PNG
//                                        └--OneBot WS send_group_msg(file=本地路径)--> 群
//
// 起：setsid nohup node server.mjs >> out/service.log 2>&1 &
// 停：pkill -f 'xiuxian-card/server[.]mjs'
// =============================================================================

import http from 'http';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CFG_FILE = path.join(__dirname, 'config.json');
const RENDER = path.join(__dirname, 'render_card.py');

const DEFAULTS = {
  port: 8099, host: '0.0.0.0', token: 'xiuxian-card-token',
  python: 'python3', pyTimeoutMs: 20000, outDir: 'out', filesToKeep: 40,
  onebotPort: 4999, onebotToken: 'xiuxian-bridge-token',
};

const cfg = { ...DEFAULTS };
try { Object.assign(cfg, JSON.parse(fs.readFileSync(CFG_FILE, 'utf-8'))); } catch (e) { console.warn('[卡片服务] 读 config.json 失败，用默认值：' + e.message); }
const OUT = path.isAbsolute(cfg.outDir) ? cfg.outDir : path.join(__dirname, cfg.outDir);
fs.mkdirSync(OUT, { recursive: true });

// ---------------- OneBot WS 客户端（Node 内置 WebSocket，无依赖） ----------------
const WS_URL = 'ws://127.0.0.1:' + cfg.onebotPort + '/?access_token=' + encodeURIComponent(cfg.onebotToken);
let ws = null;
let wsReady = false;
let seq = 0;
const pending = new Map();

function connect() {
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    console.error('[卡片服务] WS 建连失败：' + e.message);
    setTimeout(connect, 5000);
    return;
  }
  ws.addEventListener('open', () => {
    wsReady = true;
    console.log('[卡片服务] OneBot WS 已连接（端口 ' + cfg.onebotPort + '）');
  });
  ws.addEventListener('message', (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m && m.echo && pending.has(m.echo)) {
      const cb = pending.get(m.echo);
      pending.delete(m.echo);
      cb(m);
    }
  });
  ws.addEventListener('close', () => {
    wsReady = false;
    console.warn('[卡片服务] OneBot WS 断开，3 秒后重连');
    setTimeout(connect, 3000);
  });
  ws.addEventListener('error', () => { /* close 里会重连 */ });
}

function sendGroupImage(groupId, file) {
  return new Promise((resolve, reject) => {
    if (!wsReady || !ws) return reject(new Error('OneBot WS 未连接（NapCat 没登录/没起？）'));
    const echo = 'card' + (++seq);
    pending.set(echo, resolve);
    ws.send(JSON.stringify({
      action: 'send_group_msg',
      params: { message_type: 'group', group_id: String(groupId), message: [{ type: 'image', data: { file } }] },
      echo,
    }));
    setTimeout(() => {
      if (pending.has(echo)) { pending.delete(echo); reject(new Error('发送回执超时')); }
    }, 15000);
  });
}

// ---------------- 渲染 ----------------
function render(kind, data, outPath) {
  const tmp = path.join(OUT, 'in_' + Date.now() + '.json');
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf-8');
  return new Promise((resolve, reject) => {
    execFile(cfg.python, [RENDER, '--kind', kind, '--json', tmp, '--out', outPath],
      { timeout: cfg.pyTimeoutMs }, (err, stdout, stderr) => {
        try { fs.unlinkSync(tmp); } catch { }
        if (err) return reject(new Error('渲染失败：' + err.message + '｜' + String(stderr || '').slice(-300)));
        if (!fs.existsSync(outPath)) return reject(new Error('渲染脚本没产出 PNG'));
        resolve(fs.statSync(outPath).size);
      });
  });
}

function prune() {
  try {
    const fs2 = fs.readdirSync(OUT).filter((f) => f.endsWith('.png'))
      .map((f) => ({ f, t: fs.statSync(path.join(OUT, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const x of fs2.slice(cfg.filesToKeep)) fs.unlinkSync(path.join(OUT, x.f));
  } catch { }
}

// ---------------- HTTP ----------------
function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('body 太大')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}
function json(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
}

const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  try {
    if (req.method === 'GET' && req.url.startsWith('/ping')) {
      return json(res, 200, { ok: true, service: 'xiuxian-card-standalone', wsReady, onebotPort: cfg.onebotPort, render: fs.existsSync(RENDER) });
    }
    if (req.method !== 'POST' || !req.url.startsWith('/card')) return json(res, 404, { ok: false, error: 'not found' });

    const raw = await readBody(req);
    let data;
    try { data = JSON.parse(raw); } catch { return json(res, 400, { ok: false, error: 'body 不是合法 JSON' }); }
    const token = req.headers['x-card-token'] || data.token || '';
    if (String(token) !== String(cfg.token)) return json(res, 403, { ok: false, error: 'token 不对' });

    const kind = String(data.kind || '').toLowerCase();
    const groupId = data.group_id;
    if (!kind) return json(res, 400, { ok: false, error: '缺 kind' });
    if (!groupId) return json(res, 400, { ok: false, error: '缺 group_id' });

    const out = path.join(OUT, 'card_' + kind + '_' + Date.now() + '.png');
    let bytes;
    try { bytes = await render(kind, data, out); }
    catch (e) { console.error('[卡片服务] ' + e.message); return json(res, 500, { ok: false, stage: 'render', error: e.message }); }

    if (data.dry_run) { prune(); return json(res, 200, { ok: true, png: out, bytes, ms: Date.now() - t0, sent: false }); }

    let reply;
    try { reply = await sendGroupImage(groupId, out); }
    catch (e) { console.error('[卡片服务] 发送失败：' + e.message); return json(res, 500, { ok: false, stage: 'send', error: e.message, png: out, bytes }); }

    const ok = !reply || reply.status === 'ok' || reply.retcode === 0;
    if (!ok) return json(res, 500, { ok: false, stage: 'send', error: JSON.stringify(reply).slice(0, 200), png: out, bytes });
    prune();
    console.log('[卡片服务] ' + kind + ' → 群 ' + groupId + ' 已发（' + bytes + ' 字节，' + (Date.now() - t0) + 'ms）');
    return json(res, 200, { ok: true, png: out, bytes, ms: Date.now() - t0 });
  } catch (e) {
    console.error('[卡片服务] 处理出错：' + (e.stack || e.message));
    return json(res, 500, { ok: false, error: String(e.message || e) });
  }
});

server.on('error', (e) => console.error('[卡片服务] HTTP 出错：' + e.message));
server.listen(cfg.port, cfg.host, () => console.log('[卡片服务] HTTP 已监听 ' + cfg.host + ':' + cfg.port + '（渲染脚本 ' + (fs.existsSync(RENDER) ? '就绪' : '缺失！') + '）'));
connect();
