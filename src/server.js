const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const svc = require('./service');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY = 2 * 1024 * 1024;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

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

// รองรับทั้ง application/json, form-urlencoded (payload_json) และ multipart (Discord-style ที่แนบรูป)
function decodeBody(req, buf) {
  const ct = req.headers['content-type'] || '';
  const text = buf.toString('utf8');
  if (ct.includes('multipart/form-data')) {
    const m = text.match(/name="payload_json"[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*\r?\n([\s\S]*?)\r?\n--/);
    return m ? JSON.parse(m[1]) : {};
  }
  if (ct.includes('application/x-www-form-urlencoded')) {
    const p = new URLSearchParams(text);
    return p.get('payload_json') ? JSON.parse(p.get('payload_json')) : Object.fromEntries(p);
  }
  return text ? JSON.parse(text) : {};
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
    let body;
    try { body = decodeBody(req, await readBody(req)); } catch { return send(res, 400, { error: 'invalid body' }); }
    const r = svc.ingest(acc, body);
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
      const a = svc.createAccount(body);
      const base = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
      return send(res, 201, { ...a, dashboard_url: `${base}/a/${a.id}`, webhook_url: `${base}/api/ingest/${a.token}`, discord_style_url: `${base}/api/webhooks/0/${a.token}` });
    }
    if (req.method === 'PATCH' && (m = p.match(/^\/api\/admin\/accounts\/([a-f0-9]{24})$/))) {
      return send(res, 200, svc.updateAccount(m[1], body));
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
