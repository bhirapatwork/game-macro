const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const svc = require('./service');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY = 25 * 1024 * 1024; // macro แนบรูป screenshot มาด้วย
const DATA_DIR = path.dirname(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tracker.db'));
const SHOTS_DIR = path.join(DATA_DIR, 'shots');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', ...headers });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// แยก multipart/form-data (Discord webhook ที่แนบไฟล์ส่งแบบนี้) ทำงานบน Buffer เพราะมีไฟล์รูป
function parseMultipart(buf, boundary) {
  const parts = [];
  const delim = Buffer.from(`--${boundary}`);
  let pos = buf.indexOf(delim);
  while (pos !== -1) {
    const start = pos + delim.length;
    if (buf.slice(start, start + 2).toString() === '--') break;
    const next = buf.indexOf(delim, start);
    if (next === -1) break;
    const part = buf.slice(start + 2, next - 2); // ตัด \r\n หน้า/หลัง
    const sep = part.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const head = part.slice(0, sep).toString('utf8');
      parts.push({
        name: (head.match(/name="([^"]*)"/i) || [])[1],
        filename: (head.match(/filename="([^"]*)"/i) || [])[1],
        type: (head.match(/content-type:\s*([^\r\n]+)/i) || [])[1],
        data: part.slice(sep + 4),
      });
    }
    pos = next;
  }
  return parts;
}

// คืน { body, files } — รองรับ application/json, form-urlencoded และ multipart
function decodeBody(req, buf) {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) {
    const boundary = (ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i) || []).slice(1).find(Boolean);
    const parts = boundary ? parseMultipart(buf, boundary.trim()) : [];
    const pj = parts.find((x) => x.name === 'payload_json');
    const files = parts.filter((x) => x.filename && /^image\/(png|jpe?g|webp|gif)$/i.test(x.type || ''));
    return { body: pj ? JSON.parse(pj.data.toString('utf8')) : {}, files };
  }
  const text = buf.toString('utf8');
  if (ct.includes('application/x-www-form-urlencoded')) {
    const p = new URLSearchParams(text);
    return { body: p.get('payload_json') ? JSON.parse(p.get('payload_json')) : Object.fromEntries(p), files: [] };
  }
  return { body: text ? JSON.parse(text) : {}, files: [] };
}

function saveShots(files) {
  return files.slice(0, 4).map((f) => {
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[f.type.toLowerCase()] || '.png';
    const name = crypto.randomBytes(12).toString('hex') + ext;
    fs.writeFileSync(path.join(SHOTS_DIR, name), f.data);
    return name;
  });
}

// ส่งต่อข้อความเดิมไป Discord (ไม่รอผล ไม่ให้กระทบการรับข้อมูล)
const RELAY_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
function relayToDiscord(url, req, buf) {
  if (!url || !RELAY_RE.test(url)) return;
  fetch(url, { method: 'POST', headers: { 'content-type': req.headers['content-type'] || 'application/json' }, body: buf })
    .then((r) => { if (!r.ok) console.warn('[relay] discord ตอบ', r.status); })
    .catch((e) => console.warn('[relay] ส่งไม่สำเร็จ', e.message));
}

function isAdmin(req) {
  const key = req.headers['x-admin-key'] || '';
  return ADMIN_KEY && key.length === ADMIN_KEY.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(ADMIN_KEY));
}

// cache รูป avatar จาก Roblox (ฝั่ง server เพื่อเลี่ยง CORS)
const avatarCache = new Map();
async function avatarUrl(userId) {
  const hit = avatarCache.get(userId);
  if (hit && hit.exp > Date.now()) return hit.url;
  const r = await fetch(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`);
  const url = (await r.json())?.data?.[0]?.imageUrl || null;
  avatarCache.set(userId, { url, exp: Date.now() + 6 * 3600e3 });
  return url;
}

function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'forbidden');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC_DIR, 'index.html'); // SPA fallback
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  let m;

  // ---------- Webhook รับข้อมูลจาก macro ----------
  // แบบ Discord-compatible: แค่เปลี่ยน host ของ webhook URL เดิมเป็นเว็บเรา
  //   https://<your-site>/api/webhooks/<anything>/<token>
  // หรือแบบตรง: https://<your-site>/api/ingest/<token>
  if (req.method === 'POST' && ((m = p.match(/^\/api\/ingest\/([a-f0-9]{48})$/)) || (m = p.match(/^\/api\/webhooks\/[^/]+\/([a-f0-9]{48})$/)))) {
    const acc = svc.getAccountByToken(m[1]);
    if (!acc) return send(res, 404, { error: 'unknown token' });
    let buf, decoded;
    try { buf = await readBody(req); decoded = decodeBody(req, buf); } catch { return send(res, 400, { error: 'invalid body' }); }
    relayToDiscord(acc.discord_relay_url, req, buf);
    const r = svc.ingest(acc, decoded.body, saveShots(decoded.files));
    // Discord ตอบ 204 — macro บางตัวเช็คแบบนั้น
    return url.searchParams.get('wait') === 'true' ? send(res, 200, r) : (res.writeHead(204), res.end());
  }

  // ---------- Public API ----------
  if (req.method === 'GET') {
    if (p === '/api/overview') return send(res, 200, svc.overview());
    if (p === '/api/accounts') {
      return send(res, 200, svc.listAccounts({
        status: url.searchParams.get('status') || 'all',
        page: Math.max(1, Number(url.searchParams.get('page')) || 1),
        perPage: Math.min(50, Number(url.searchParams.get('perPage')) || 12),
      }));
    }
    if ((m = p.match(/^\/api\/accounts\/([a-f0-9]{24})(\/\w+)?$/))) {
      const a = svc.getAccountRow(m[1]);
      if (!a) return send(res, 404, { error: 'not found' });
      switch (m[2]) {
        case undefined: return send(res, 200, svc.publicAccount(a));
        case '/matches': return send(res, 200, svc.accountMatches(a.id, Math.min(200, Number(url.searchParams.get('limit')) || 50)));
        case '/items': return send(res, 200, svc.accountItems(a.id, a.job_start_ts));
        case '/inventory': return send(res, 200, svc.accountInventory(a.id));
        case '/purchases': return send(res, 200, svc.accountPurchases(a.id));
      }
    }
    if ((m = p.match(/^\/shots\/([a-f0-9]{24}\.(?:png|jpg|webp|gif))$/))) {
      const f = path.join(SHOTS_DIR, m[1]);
      if (!fs.existsSync(f)) return send(res, 404, 'not found');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)], 'Cache-Control': 'public, max-age=604800' });
      return fs.createReadStream(f).pipe(res);
    }
    if ((m = p.match(/^\/api\/avatar\/(\d{1,20})$/))) {
      try {
        const u = await avatarUrl(m[1]);
        if (u) { res.writeHead(302, { Location: u, 'Cache-Control': 'public, max-age=3600' }); return res.end(); }
      } catch { /* fall through */ }
      return send(res, 404, { error: 'no avatar' });
    }
  }

  // ---------- Admin API (ต้องมี header x-admin-key) ----------
  if (p.startsWith('/api/admin/')) {
    if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });
    let body = {};
    if (req.method !== 'GET') { try { body = JSON.parse((await readBody(req)).toString() || '{}'); } catch { return send(res, 400, { error: 'invalid json' }); } }
    if (req.method === 'POST' && p === '/api/admin/accounts') {
      if (body.discord_relay_url && !RELAY_RE.test(body.discord_relay_url)) return send(res, 400, { error: 'discord_relay_url ต้องเป็น https://discord.com/api/webhooks/...' });
      const a = svc.createAccount(body);
      const base = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
      return send(res, 201, { ...a, dashboard_url: `${base}/a/${a.id}`, webhook_url: `${base}/api/ingest/${a.token}`, discord_style_url: `${base}/api/webhooks/0/${a.token}` });
    }
    if (req.method === 'GET' && (m = p.match(/^\/api\/admin\/accounts\/([a-f0-9]{24})\/raw$/))) {
      return send(res, 200, svc.rawEvents(m[1], Math.min(50, Number(url.searchParams.get('limit')) || 5)));
    }
    if (req.method === 'PATCH' && (m = p.match(/^\/api\/admin\/accounts\/([a-f0-9]{24})$/))) {
      if (body.discord_relay_url && !RELAY_RE.test(body.discord_relay_url)) return send(res, 400, { error: 'discord_relay_url ต้องเป็น https://discord.com/api/webhooks/...' });
      const a = svc.updateAccount(m[1], body);
      return a ? send(res, 200, { id: a.id, status: a.status, job_title: a.job_title, relay: !!a.discord_relay_url }) : send(res, 404, { error: 'not found' });
    }
  }

  if (p.startsWith('/api/')) return send(res, 404, { error: 'not found' });
  return serveStatic(req, res, p);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => { console.error(e); if (!res.headersSent) send(res, 500, { error: 'internal' }); });
});

if (require.main === module) {
  if (!ADMIN_KEY) console.warn('[warn] ADMIN_KEY ไม่ได้ตั้ง — admin API จะใช้ไม่ได้');
  server.listen(PORT, () => console.log(`AA Tracker running at http://localhost:${PORT}`));
}
module.exports = server;
