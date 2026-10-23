// ============================================================================
// 修仙属性查询插件  ——  群内发送「x 角色名」查属性面板
//
// 用法（群里）：
//   x fangou          → 查 fangou 的属性面板（图片）
//   x 半个六道        → 同理
//
// 为什么做成插件而不是让游戏服轮询：
//   · 插件直接拿到 event.raw_message / group_id / msgId
//   · 可以用【被动回复】（5 分钟窗口，不受主动推送限流）
//   · 不用碰游戏服的 tick 线程
//   · 和现有 checkin / wiki 一套机制
//
// 依赖：
//   · 游戏服提供 GET /api/qq/stat?name=xxx&token=xxx  → 返回 PNG
//   · config.json 里 qqForwarder.statQuery 配置地址和 token
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// ── 配置（从主 config.json 读，没有就用默认）──
let CFG = {
  enabled: true,
  // 游戏服查询接口
  url: 'http://127.0.0.1:8899/api/qq/stat',
  token: '',
  // 图片临时目录
  outDir: path.join(ROOT, 'data', 'cards'),
  // 命令前缀（不带空格也能识别：x名字 / X名字）
  prefixes: ['x', 'X'],
  // 同一个人多久内不能重复查（秒）✗ 防刷 ✓
  cooldownSec: 8,
};
// ★ 配置读取顺序：
//   ① 插件自己目录的 config.json（本地测试 / 独立部署 ✓）
//   ② 上级 qq-forwarder 的 config.json 里的 statQuery 段（正式部署 ✓）
for (const p of [path.join(__dirname, 'config.json'), path.join(ROOT, 'config.json')]) {
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const c = (p === path.join(__dirname, 'config.json')) ? j : (j.statQuery || j.stat_query || {});
    if (c && Object.keys(c).length) { CFG = { ...CFG, ...c }; break; }
  } catch { /* 继续找下一个 */ }
}

fs.mkdirSync(CFG.outDir, { recursive: true });

// 冷却表：`group|user` -> 到期时间
const COOLDOWN = new Map();

function log(...args) {
  console.log('[stat]', ...args);
}

/** 解析「x 名字」✗ 返回名字或 null */
function parseQuery(text) {
  const t = String(text || '').trim();
  // ★ 支持：x 名字 / x名字 / X 名字 / Ｘ 名字
  for (const p of CFG.prefixes) {
    if (!t.startsWith(p)) continue;
    const rest = t.slice(p.length);
    // 前缀后面必须是空格 / 或直接跟汉字（x名字）
    if (rest.length === 0) continue;
    if (rest[0] !== ' ' && rest[0] !== '\u3000') {
      // 允许「x名字」这种没有空格的写法 ✗ 但要求第一个字符不是字母数字
      // （避免 "xxx" 这种普通单词被误识别）
      if (/^[a-zA-Z0-9_]/.test(rest)) continue;
    }
    const name = rest.trim();
    if (!name || name.length > 16) continue;
    return name;
  }
  return null;
}

/** 拉游戏服的属性面板 PNG ✗ 返回 Buffer 或 { err } */
async function fetchCard(name) {
  const u = new URL(CFG.url);
  u.searchParams.set('name', name);
  if (CFG.token) u.searchParams.set('token', CFG.token);
  const res = await fetch(u.toString(), { signal: AbortSignal.timeout(20000) });
  if (res.status === 404) return { err: 'notfound' };
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch { /* ignore */ }
    return { err: 'http', status: res.status, body: body.slice(0, 200) };
  }
  const ct = String(res.headers.get('content-type') || '');
  if (!ct.includes('image/png')) return { err: 'notpng', ct };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) return { err: 'empty', size: buf.length };
  return { buf };
}

/** 插件初始化 */
export async function plugin_init(ctx) {
  // ★ 宿主给的 ctx.logger 是【函数】不是对象 ✗ 不能写 logger.log() ✓
  try {
    const msg = `[stat] 已加载（接口 ${CFG.url}）`;
    if (ctx && typeof ctx.logger === 'function') ctx.logger(msg);
    else if (ctx && ctx.logger && typeof ctx.logger.log === 'function') ctx.logger.log(msg);
    else console.log(msg);
  } catch { /* 初始化日志失败不影响功能 */ }
}

/** 收到群消息 */
export async function plugin_onmessage(ctx, event) {
  try {
    if (!CFG.enabled) return;
    const text = String(event.raw_message || '');
    const name = parseQuery(text);
    if (!name) return;

    const gid = String(event.group_id || '');
    const uid = String(event.user_id || '');
    if (!gid) return;

    // 冷却（防刷）
    const key = `${gid}|${uid}`;
    const now = Date.now();
    const until = COOLDOWN.get(key) || 0;
    if (now < until) return;               // 静默忽略，不回复
    COOLDOWN.set(key, now + (CFG.cooldownSec || 8) * 1000);
    // 顺手清理过期项
    if (COOLDOWN.size > 2000) {
      for (const [k, v] of COOLDOWN) { if (v < now) COOLDOWN.delete(k); }
    }

    log(`查询「${name}」← 群 ${gid} 用户 ${uid}`);

    const r = await fetchCard(name);

    if (r.err === 'notfound') {
      await sendGroup(ctx, event, [`⚠️ 查无此人：${name}\n（确认角色名有没有打错）`]);
      return;
    }
    if (r.err) {
      log('查询失败:', JSON.stringify(r));
      await sendGroup(ctx, event, ['⚠️ 查询失败，稍后再试（服务器可能正在忙）']);
      return;
    }

    // 存成临时 PNG ✗ 发完就删 ✓
    const safe = name.replace(/[^\w\u4e00-\u9fa5]/g, '');
    const fp = path.join(CFG.outDir, `stat_${safe}_${now}.png`);
    fs.writeFileSync(fp, r.buf);

    try {
      await sendGroup(ctx, event, [{ type: 'image', data: { file: fp } }]);
      log(`已发送「${name}」的面板 (${r.buf.length} bytes)`);
    } finally {
      // 延迟删除（等发送完成 ✗ 有些实现是异步读文件）
      setTimeout(() => { try { fs.unlinkSync(fp); } catch { /* ignore */ } }, 30000);
    }
  } catch (e) {
    log('onmessage 异常:', e.message);
  }
}

/**
 * 发消息到群（★ 和 checkin 插件完全一样的调用方式）
 *
 *   ctx.actions.call('send_msg', { message, message_type, group_id })
 *
 * ★ 字符串元素要转成 { type:'text', data:{text} } ✗ NapCat 要求段必须是对象 ✓
 * ★ 宿主内部会用 message_id 走【被动回复】✗ 5 分钟窗口内不受主动推送限制 ✓
 *   （见 qqofficial.mjs 的 passive 窗口逻辑）
 */
async function sendGroup(ctx, event, segments) {
  try {
    const msg = Array.isArray(segments)
      ? segments.map((s) => (typeof s === 'string' ? { type: 'text', data: { text: s } } : s))
      : segments;
    await ctx.actions.call('send_msg', {
      message: msg,
      message_type: 'group',
      group_id: String(event.group_id),
    }, ctx.adapterName, ctx.pluginManager.config);
  } catch (e) {
    log('发送失败:', e.message);
  }
}

export default { plugin_init, plugin_onmessage };
