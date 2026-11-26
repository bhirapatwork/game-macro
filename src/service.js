const crypto = require('node:crypto');
const { db, tx } = require('./db');
const { parsePayload } = require('./parser');

const ONLINE_MS = Number(process.env.ONLINE_MINUTES || 15) * 60 * 1000;

const rid = (n) => crypto.randomBytes(n).toString('hex');

function mask(name) {
  if (!name) return '???';
  if (name.length <= 4) return name[0] + '***';
  return name.slice(0, 2) + '***' + name.slice(-2);
}

// ---------- accounts ----------
function createAccount(o = {}) {
  const now = Date.now();
  const acc = { id: rid(12), token: rid(24) };
  db.prepare(`INSERT INTO accounts (id, token, roblox_name, roblox_user_id, game, machine, job_title, job_type,
      job_target, job_item, job_start_ts, status, created_at, discord_relay_url)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    acc.id, acc.token, o.roblox_name ?? null, o.roblox_user_id ?? null, o.game || 'Anime Adventures',
    o.machine ?? null, o.job_title ?? null, o.job_type || 'none', o.job_target ?? null, o.job_item ?? null,
    o.job_start_ts ?? now, o.status || 'queued', now, o.discord_relay_url ?? null,
  );
  return getAccountRow(acc.id);
}

const UPDATABLE = ['roblox_name', 'roblox_user_id', 'game', 'machine', 'job_title', 'job_type', 'job_target', 'job_item', 'job_start_ts', 'status', 'discord_relay_url'];
function updateAccount(id, o) {
  const keys = Object.keys(o).filter((k) => UPDATABLE.includes(k));
  if (!keys.length) return getAccountRow(id);
  db.prepare(`UPDATE accounts SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => o[k]), id);
  return getAccountRow(id);
}

const getAccountRow = (id) => db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
const getAccountByToken = (t) => db.prepare('SELECT * FROM accounts WHERE token = ?').get(t);

// ---------- progress ----------
function progressOf(a) {
  const since = a.job_start_ts || 0;
  let current = 0, target = a.job_target || 0, unit = '';
  if (a.job_type === 'hours_won') {
    current = db.prepare(`SELECT COALESCE(SUM(duration_sec),0) s FROM matches WHERE account_id=? AND ts>=? AND result='win'`).get(a.id, since).s / 3600;
    unit = 'ชม.';
  } else if (a.job_type === 'item') {
    current = db.prepare(`SELECT COALESCE(SUM(qty),0) s FROM match_rewards r JOIN matches m ON m.id=r.match_id
      WHERE r.account_id=? AND m.ts>=? AND r.item=?`).get(a.id, since, a.job_item).s;
    unit = a.job_item || '';
  } else if (a.job_type === 'matches') {
    current = db.prepare(`SELECT COUNT(*) c FROM matches WHERE account_id=? AND ts>=? AND result='win'`).get(a.id, since).c;
    unit = 'แมตช์';
  } else if (a.status === 'done') {
    return { type: 'none', current: 1, target: 1, pct: 100, unit: '' };
  } else {
    return { type: 'none', current: 0, target: 1, pct: 0, unit: '' };
  }
  const pct = target > 0 ? Math.min(100, Math.floor((current / target) * 100)) : 0;
  return { type: a.job_type, current, target, pct, unit };
}

function publicAccount(a) {
  const online = a.last_seen && Date.now() - a.last_seen < ONLINE_MS;
  const counts = {
    matches: db.prepare('SELECT COUNT(*) c FROM matches WHERE account_id=?').get(a.id).c,
    items: db.prepare(`SELECT COUNT(DISTINCT item) c FROM match_rewards r JOIN matches m ON m.id=r.match_id
      WHERE r.account_id=? AND m.ts>=?`).get(a.id, a.job_start_ts || 0).c,
    inventory: db.prepare('SELECT COUNT(*) c FROM inventory WHERE account_id=?').get(a.id).c,
    purchases: db.prepare('SELECT COUNT(*) c FROM purchases WHERE account_id=?').get(a.id).c,
  };
  const farmedSec = db.prepare('SELECT COALESCE(SUM(duration_sec),0) s FROM matches WHERE account_id=? AND ts>=?').get(a.id, a.job_start_ts || 0).s;
  return {
    id: a.id,
    name: mask(a.roblox_name),
    roblox_user_id: a.roblox_user_id,
    game: a.game,
    machine: a.machine,
    job_title: a.job_title,
    status: a.status,
    online: !!online,
    in_match: !!(online && a.in_match),
    current_match: a.current_match ? JSON.parse(a.current_match) : null,
    level: a.level, gems: a.gems, battlepass: a.battlepass, summon_count: a.summon_count,
    last_seen: a.last_seen,
    job_start_ts: a.job_start_ts,
    farmed_sec: farmedSec,
    progress: progressOf(a),
    counts,
  };
}

function listAccounts({ status, page = 1, perPage = 12 } = {}) {
  const where = status && status !== 'all' ? 'WHERE status = ?' : '';
  const args = where ? [status] : [];
  const total = db.prepare(`SELECT COUNT(*) c FROM accounts ${where}`).get(...args).c;
  const rows = db.prepare(`SELECT * FROM accounts ${where} ORDER BY (status='farming') DESC, last_seen DESC NULLS LAST, created_at DESC LIMIT ? OFFSET ?`)
    .all(...args, perPage, (page - 1) * perPage);
  return { total, page, perPage, items: rows.map(publicAccount) };
}

function overview() {
  const by = Object.fromEntries(db.prepare('SELECT status, COUNT(*) c FROM accounts GROUP BY status').all().map((r) => [r.status, r.c]));
  const firstTs = db.prepare('SELECT MIN(created_at) t FROM accounts').get().t;
  return {
    total: Object.values(by).reduce((a, b) => a + b, 0),
    farming: by.farming || 0, queued: by.queued || 0, done: by.done || 0, cancelled: by.cancelled || 0,
    online: db.prepare('SELECT COUNT(*) c FROM accounts WHERE last_seen > ?').get(Date.now() - ONLINE_MS).c,
    matches_24h: db.prepare('SELECT COUNT(*) c FROM matches WHERE ts > ?').get(Date.now() - 864e5).c,
    days_open: firstTs ? Math.max(1, Math.ceil((Date.now() - firstTs) / 864e5)) : 0,
  };
}

function accountMatches(id, limit = 50) {
  const total = db.prepare('SELECT COUNT(*) c FROM matches WHERE account_id=?').get(id).c;
  const rows = db.prepare('SELECT * FROM matches WHERE account_id=? ORDER BY ts DESC LIMIT ?').all(id, limit);
  const rewardStmt = db.prepare('SELECT item, qty FROM match_rewards WHERE match_id=? ORDER BY rowid');
  const shotStmt = db.prepare('SELECT file FROM shots WHERE account_id=? AND ts BETWEEN ? AND ? ORDER BY ts');
  return {
    total,
    items: rows.map((m) => ({
      ...m, team: m.team ? JSON.parse(m.team) : null, rewards: rewardStmt.all(m.id),
      shots: shotStmt.all(id, m.ts - 180e3, m.ts + 60e3).map((r) => `/shots/${r.file}`),
    })),
  };
}

function accountItems(id, sinceTs) {
  return db.prepare(`SELECT r.item, SUM(r.qty) qty, COUNT(*) drops FROM match_rewards r JOIN matches m ON m.id=r.match_id
    WHERE r.account_id=? AND m.ts>=? GROUP BY r.item ORDER BY qty DESC`).all(id, sinceTs || 0);
}

const accountInventory = (id) => db.prepare('SELECT item, qty, updated_at FROM inventory WHERE account_id=? ORDER BY qty DESC').all(id);

function accountPurchases(id) {
  const items = db.prepare('SELECT * FROM purchases WHERE account_id=? ORDER BY ts DESC LIMIT 200').all(id);
  const byShop = db.prepare('SELECT shop, COUNT(*) c FROM purchases WHERE account_id=? GROUP BY shop').all(id);
  return { items, byShop };
}

// ---------- ingest ----------
function insertMatch(accountId, ts, m, rewards) {
  const id = Number(db.prepare(`INSERT INTO matches (account_id, ts, mode, map, difficulty, tier, act, wave, duration_sec, result, modifier, portal_owner, team)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    accountId, ts, m.mode ?? null, m.map ?? null, m.difficulty ?? null, m.tier ?? null, m.act ?? null,
    m.wave ?? null, m.duration_sec ?? null, m.result ?? null, m.modifier ?? null, m.portal_owner ?? null,
    m.team ? JSON.stringify(m.team) : null,
  ).lastInsertRowid);
  const ins = db.prepare('INSERT INTO match_rewards (match_id, account_id, item, qty) VALUES (?,?,?,?)');
  for (const r of rewards || []) if (r.qty > 0) ins.run(id, accountId, r.name, r.qty);
  return id;
}

// Capy session report = ยอดสะสม -> เทียบกับ snapshot ก่อนหน้าเพื่อหาว่าแมตช์ล่าสุดได้อะไร
function applySessionReport(account, ev, now) {
  const cur = { wins: 0, losses: 0, session_sec: 0, ...ev.session, counters: ev.session.counters || {} };
  const prev = account.session_state ? JSON.parse(account.session_state) : null;
  const reset = !prev || cur.session_sec < prev.session_sec || cur.wins < prev.wins || cur.losses < prev.losses;
  const base = reset ? { wins: 0, losses: 0, session_sec: 0, counters: {} } : prev;
  db.prepare('UPDATE accounts SET session_state=?, in_match=0 WHERE id=?').run(JSON.stringify(cur), account.id);

  const dw = cur.wins - base.wins, dl = cur.losses - base.losses;
  if (dw + dl <= 0) return null; // ไม่มีแมตช์ใหม่ (ส่งซ้ำ)

  const rewards = Object.entries(cur.counters)
    .map(([name, v]) => ({ name, qty: v - (base.counters[name] || 0) }))
    .concat(ev.rewards || []);
  const games = dw + dl;
  const m = {
    ...ev.match,
    result: dl === 0 ? 'win' : dw === 0 ? 'lose' : null,
    // เวลาโดยประมาณ = เวลา session ที่เพิ่มขึ้น / จำนวนแมตช์ (รวมเวลาโหลดใน lobby)
    duration_sec: cur.session_sec ? Math.round((cur.session_sec - base.session_sec) / games) : null,
    modifier: games > 1 ? `รวม ${games} แมตช์ (ชนะ ${dw} แพ้ ${dl})` : ev.match.modifier,
  };
  return insertMatch(account.id, now, m, rewards);
}

function ingest(account, body, shots = []) {
  const now = Date.now();
  const ev = parsePayload(body);
  db.prepare('INSERT INTO raw_events (account_id, ts, body, parsed) VALUES (?,?,?,?)')
    .run(account.id, now, JSON.stringify(body).slice(0, 100_000), ev ? 1 : 0);

  db.prepare('UPDATE accounts SET last_seen=? WHERE id=?').run(now, account.id);
  const insShot = db.prepare('INSERT INTO shots (account_id, ts, file) VALUES (?,?,?)');
  for (const f of shots) insShot.run(account.id, now, f);
  if (!ev) return { ok: true, parsed: false, shots: shots.length };

  const p = ev.player || {};
  db.prepare(`UPDATE accounts SET
      roblox_name = COALESCE(roblox_name, ?), roblox_user_id = COALESCE(?, roblox_user_id),
      level = COALESCE(?, level), gems = COALESCE(?, gems), battlepass = COALESCE(?, battlepass),
      status = CASE WHEN status='queued' THEN 'farming' ELSE status END
    WHERE id=?`).run(p.name ?? null, p.user_id ?? null, p.level ?? null, p.gems ?? null, p.battlepass ?? null, account.id);

  return tx(() => {
    let matchId = null;
    switch (ev.type) {
      case 'match_start':
        db.prepare('UPDATE accounts SET in_match=1, current_match=? WHERE id=?').run(JSON.stringify(ev.match || {}), account.id);
        break;
      case 'match_end': {
        const m = ev.match || {};
        const ts = m.ended_at ? Date.parse(m.ended_at) || now : now;
        matchId = insertMatch(account.id, ts, m, ev.rewards);
        db.prepare('UPDATE accounts SET in_match=0 WHERE id=?').run(account.id);
        break;
      }
      case 'session_report':
        matchId = applySessionReport(account, ev, now);
        break;
      case 'shop_purchase': {
        const b = ev.purchase || {};
        db.prepare(`INSERT INTO purchases (account_id, ts, shop, item, price, currency, qty, balance_after) VALUES (?,?,?,?,?,?,?,?)`)
          .run(account.id, now, b.shop ?? null, b.item ?? null, b.price ?? null, b.currency ?? null, b.qty ?? 1, b.balance_after ?? null);
        break;
      }
      case 'summon':
        db.prepare('UPDATE accounts SET summon_count = summon_count + ? WHERE id=?').run(Number(ev.summon?.count) || 1, account.id);
        break;
    }

    if (ev.inventory) {
      db.prepare('DELETE FROM inventory WHERE account_id=?').run(account.id);
      const ins = db.prepare('INSERT INTO inventory (account_id, item, qty, updated_at) VALUES (?,?,?,?)');
      for (const it of ev.inventory) ins.run(account.id, it.name, it.qty, now);
    }

    // งานเสร็จอัตโนมัติเมื่อถึงเป้า
    const a = getAccountRow(account.id);
    if (a.status === 'farming' && a.job_type !== 'none' && progressOf(a).pct >= 100) {
      db.prepare(`UPDATE accounts SET status='done' WHERE id=?`).run(a.id);
    }
    return { ok: true, parsed: true, type: ev.type, match_id: matchId, rewards: ev.rewards?.length || 0 };
  });
}

const rawEvents = (id, limit = 5) => db.prepare('SELECT ts, parsed, body FROM raw_events WHERE account_id=? ORDER BY id DESC LIMIT ?')
  .all(id, limit).map((r) => ({ ...r, body: JSON.parse(r.body) }));

module.exports = {
  rawEvents, createAccount, updateAccount, getAccountRow, getAccountByToken, publicAccount, listAccounts, overview,
  accountMatches, accountItems, accountInventory, accountPurchases, ingest, mask,
};
