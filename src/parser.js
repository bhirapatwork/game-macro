// แปลง payload ที่ macro ส่งมา -> event มาตรฐาน
// รองรับ 2 แบบ:
//  1) Native JSON  : { type: "match_end", player, match, rewards, inventory }
//  2) Discord webhook (embeds) : macro ส่วนใหญ่ส่งแบบนี้ -> parse แบบ heuristic

const NUM_RE = /^[\d,.]+\s*[kKmMbB]?$/;

function parseNumber(str) {
  if (str == null) return null;
  if (typeof str === 'number') return str;
  const s = String(str).trim().replace(/,/g, '');
  const m = s.match(/^([\d.]+)\s*([kKmMbB])?$/);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1;
  return Math.round(parseFloat(m[1]) * mult);
}

function cleanText(s) {
  return String(s || '')
    .replace(/<a?:\w+:\d+>/g, '')          // custom discord emoji
    .replace(/:[a-z0-9_+-]*[a-z][a-z0-9_+-]*:/gi, '') // :emoji: (ต้องมีตัวอักษร ไม่งั้นจะลบเวลา 01:40:41)
    .replace(/[*_`~|>]/g, '')               // markdown
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '') // unicode emoji
    .replace(/\s+/g, ' ')
    .trim();
}

// "mm:ss" | "hh:mm:ss" | "18m 37s" | "1117s" -> seconds
function parseDuration(str) {
  if (str == null) return null;
  if (typeof str === 'number') return str;
  const s = String(str).trim();
  let m = s.match(/(?:^|\D)(\d+):(\d{1,2}):(\d{1,2})(?!\d)/);
  if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  m = s.match(/(?:^|\D)(\d+):(\d{1,2})(?!\d)/);
  if (m) return +m[1] * 60 + +m[2];
  let total = 0, hit = false;
  for (const [, n, u] of s.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hours?|m|min|minutes?|s|sec|seconds?|ชม|นาที|วิ)/gi)) {
    hit = true;
    const unit = u.toLowerCase();
    total += +n * (/^(h|ชม)/.test(unit) ? 3600 : /^(m|นาที)/.test(unit) ? 60 : 1);
  }
  return hit ? Math.round(total) : null;
}

function normalizeResult(str) {
  const s = String(str || '').toLowerCase();
  if (/(victory|win|won|clear|complete|success|ชนะ)/.test(s)) return 'win';
  if (/(defeat|lose|lost|fail|แพ้)/.test(s)) return 'lose';
  return null;
}

// "SummerPearls x6,334" | "+6334 Summer Pearls" | "Gems: 120" | "3x Stat Cube"
function parseItemLine(line) {
  const l = cleanText(line).replace(/^[-+•·\s]+/, '').trim();
  if (!l) return null;
  let m;
  // name x123 / name ×123 / name: 123 / name - 123
  if ((m = l.match(/^(.+?)\s*(?:[x×]\s*|:\s*|-\s+)([\d,.]+\s*[kKmMbB]?)$/))) {
    return { name: m[1].trim(), qty: parseNumber(m[2]) };
  }
  // 123x name / 123 name / x123 name
  if ((m = l.match(/^[x×]?\s*([\d,.]+\s*[kKmMbB]?)\s*[x×]?\s+(.+)$/))) {
    return { name: m[2].trim(), qty: parseNumber(m[1]) };
  }
  // name (123)
  if ((m = l.match(/^(.+?)\s*\(([\d,.]+\s*[kKmMbB]?)\)$/))) {
    return { name: m[1].trim(), qty: parseNumber(m[2]) };
  }
  return null;
}

function parseItemBlock(text) {
  const out = [];
  for (const raw of String(text || '').split(/\n|,\s(?=\D)|\s\|\s/)) {
    const it = parseItemLine(raw);
    if (it && it.qty != null && it.name && !NUM_RE.test(it.name)) out.push(it);
  }
  return out;
}

// key -> canonical field
const KEY_MAP = [
  [/^(result|status|outcome|ผล)/i, 'result'],
  [/^(map|stage|level name|ด่าน|แมพ)/i, 'map'],
  [/^(mode|gamemode|game mode|type|โหมด)/i, 'mode'],
  [/^(difficulty|diff|ความยาก)/i, 'difficulty'],
  [/^(tier)/i, 'tier'],
  [/^(wave|waves|เวฟ)/i, 'wave'],
  [/^(time|duration|elapsed|clear time|เวลา)/i, 'duration'],
  [/^(modifier|weather|challenge|สภาพ)/i, 'modifier'],
  [/^(act|chapter)/i, 'act'],
  [/^(player level|level|lvl|เลเวล)$/i, 'level'],
  [/^(player|user|username|account|ผู้เล่น)/i, 'player'],
  [/^(gems?|total gems|เพชร)$/i, 'gems'],
  [/^(battle ?pass|bp|เลเวลพาส)/i, 'battlepass'],
  [/^(rewards?|drops?|loot|items? (gained|obtained|received)|obtained|ของที่ได้)/i, 'rewards'],
  [/^(inventory|bag|items?|กระเป๋า)$/i, 'inventory'],
  [/^(units?|team|ทีม)/i, 'units'],
];

function canonicalKey(k) {
  const c = cleanText(k).replace(/[:：]$/, '').trim();
  for (const [re, key] of KEY_MAP) if (re.test(c)) return key;
  return null;
}

function applyField(acc, key, value) {
  const v = cleanText(value);
  switch (key) {
    case 'result': acc.match.result ??= normalizeResult(v); break;
    case 'map': acc.match.map ??= v; break;
    case 'mode': acc.match.mode ??= v; break;
    case 'difficulty': acc.match.difficulty ??= v; break;
    case 'tier': acc.match.tier ??= parseNumber(v.replace(/\D+/g, '')); break;
    case 'wave': acc.match.wave ??= parseNumber((v.match(/\d[\d,]*/) || [])[0]); break;
    case 'duration': acc.match.duration_sec ??= parseDuration(v); break;
    case 'modifier': acc.match.modifier ??= v; break;
    case 'act': acc.match.act ??= v; break;
    case 'player': acc.player.name ??= v; break;
    case 'level': acc.player.level ??= parseNumber((v.match(/[\d,.]+[kKmM]?/) || [])[0]); break;
    case 'gems': acc.player.gems ??= parseNumber((v.match(/[\d,.]+\s*[kKmM]?/) || [])[0]); break;
    case 'battlepass': acc.player.battlepass ??= parseNumber((v.match(/\d+/) || [])[0]); break;
    case 'rewards': acc.rewards.push(...parseItemBlock(value)); break;
    case 'inventory': acc.inventory = (acc.inventory || []).concat(parseItemBlock(value)); break;
    case 'units':
      acc.match.team = String(value).split('\n').map(cleanText).filter(Boolean).map((l) => {
        const m = l.match(/^(.+?)\s*(?:\(|\[)?\s*(?:lv\.?|lvl|level)\s*(\d+)/i);
        return m ? { name: m[1].trim(), level: +m[2] } : { name: l };
      });
      break;
  }
}

function parseDiscord(payload) {
  const acc = { type: 'match_end', player: {}, match: {}, rewards: [], inventory: null };
  const embeds = Array.isArray(payload.embeds) ? payload.embeds : [];
  const freeText = [payload.content || ''];

  for (const e of embeds) {
    freeText.push(e.title || '', e.description || '', e.footer?.text || '', e.author?.name || '');
    for (const f of e.fields || []) {
      const key = canonicalKey(f.name || '');
      if (key) applyField(acc, key, f.value);
      else freeText.push(`${f.name}\n${f.value}`);
    }
  }

  // ข้อความอิสระ: หา "Key: Value" ทีละบรรทัด และ section ของรางวัล
  let section = null;
  for (const rawLine of freeText.join('\n').split('\n')) {
    const line = cleanText(rawLine);
    if (!line) continue;
    const kv = line.match(/^([^:：]{2,30})[:：]\s*(.+)$/);
    const key = kv && canonicalKey(kv[1]);
    if (key && key !== 'rewards' && key !== 'inventory') { applyField(acc, key, kv[2]); section = null; continue; }
    const header = canonicalKey(line.replace(/[:：]$/, ''));
    if (header === 'rewards' || header === 'inventory') { section = header; if (kv) applyField(acc, header, kv[2]); continue; }
    if (section) {
      const it = parseItemLine(line);
      if (it && it.qty != null) {
        if (section === 'rewards') acc.rewards.push(it); else (acc.inventory ||= []).push(it);
        continue;
      }
      section = null;
    }
    acc.match.result ??= normalizeResult(line);
    const w = line.match(/wave\s*:?\s*(\d+)/i);
    if (w) acc.match.wave ??= +w[1];
  }

  if (!acc.match.result && !acc.rewards.length && !acc.match.map) return null; // ไม่ใช่ข้อความจบแมตช์
  acc.rewards = mergeItems(acc.rewards);
  if (acc.inventory) acc.inventory = mergeItems(acc.inventory);
  return acc;
}

function mergeItems(items) {
  const map = new Map();
  for (const it of items) {
    const name = normalizeItemName(it.name);
    if (!name) continue;
    map.set(name, (map.get(name) || 0) + (Number(it.qty) || 0));
  }
  return [...map].map(([name, qty]) => ({ name, qty }));
}

// "SummerPearls" -> "Summer Pearls"  (ให้ชื่อเดียวกันรวมกันได้)
function normalizeItemName(name) {
  return cleanText(name)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .replace(/^(\w)/, (c) => c.toUpperCase())
    .trim();
}

function normalizeNative(p) {
  const type = p.type || 'match_end';
  const out = { type, player: { ...(p.player || {}) }, match: { ...(p.match || {}) } };
  if (out.match.result) out.match.result = normalizeResult(out.match.result) || out.match.result;
  if (out.match.duration && out.match.duration_sec == null) out.match.duration_sec = parseDuration(out.match.duration);
  out.rewards = mergeItems((p.rewards || []).map((r) => ({ name: r.name, qty: parseNumber(r.qty ?? r.amount ?? 1) })));
  out.inventory = p.inventory ? mergeItems(p.inventory.map((r) => ({ name: r.name, qty: parseNumber(r.qty ?? r.amount ?? 1) }))) : null;
  if (type === 'shop_purchase') out.purchase = p.purchase || null;
  if (type === 'summon') out.summon = p.summon || null;
  return out;
}

// ---------- Capy's AA Macro: "Capybara Session Report" ----------
// ข้อมูลเป็นยอดสะสมทั้ง session (Wins / Losses 2 / 2, Summer Pearls (Session) 26212)
// parser ส่งออกเป็น snapshot แล้ว service จะเอาไปลบกับ snapshot ก่อนหน้า -> ได้ผลรายแมตช์
function isCapySession(payload) {
  return (payload.embeds || []).some((e) =>
    /capybara session report|capy'?s aa macro/i.test(e.footer?.text || '') ||
    (e.fields || []).some((f) => /^wins?\s*\/\s*loss(es)?$/i.test(cleanText(f.name))));
}

const pair = (v) => { const m = cleanText(v).match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/); return m ? [parseNumber(m[1]), parseNumber(m[2])] : null; };

function parseCapySession(payload) {
  const e = (payload.embeds || []).find((x) => (x.fields || []).length) || (payload.embeds || [])[0] || {};
  const out = { type: 'session_report', player: {}, match: {}, session: { counters: {} }, rewards: [], inventory: null };
  let key;
  const title = cleanText(e.title);
  if (title) out.match.mode = title.replace(/\s*rewards?$/i, '') || null;
  for (const f of e.fields || []) {
    const name = cleanText(f.name).replace(/[:：]$/, '');
    const val = cleanText(f.value);
    let m;
    if (/^map$/i.test(name)) out.match.map = val;
    else if (/^mode$/i.test(name)) out.match.mode = val;
    else if (/^wins?\s*\/\s*loss(es)?$/i.test(name)) { const p = pair(val); if (p) [out.session.wins, out.session.losses] = p; }
    else if (/^mode\s*w\/?l$/i.test(name)) { const p = pair(val); if (p) [out.session.mode_wins, out.session.mode_losses] = p; }
    else if (/^challenge\s*w\/?l$/i.test(name)) { const p = pair(val); if (p) [out.session.ch_wins, out.session.ch_losses] = p; }
    else if (/^session time$/i.test(name)) out.session.session_sec = parseDuration(val);
    else if (/^total time$/i.test(name)) out.session.total_sec = parseDuration(val);
    else if ((m = name.match(/^(.+?)\s*\(session\)$/i)) && parseNumber(val.replace(/\s/g, '')) != null) {
      out.session.counters[normalizeItemName(m[1])] = parseNumber(val.replace(/\s/g, ''));
    } else if ((key = canonicalKey(name))) applyField(out, key, f.value);
  }
  // ข้อความอื่นที่อาจมีรายการของ (เผื่อเวอร์ชันอื่นของ macro)
  if (e.description) out.rewards.push(...parseItemBlock(e.description));
  out.rewards = mergeItems(out.rewards);
  return out;
}

function parsePayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.type || payload.match || payload.rewards) return normalizeNative(payload);
  if (isCapySession(payload)) {
    const ev = parseCapySession(payload);
    if (ev.session.wins != null || Object.keys(ev.session.counters).length) return ev;
    return null; // ข้อความที่มีแต่รูป (เช่นรูป VICTORY) — เก็บรูปอย่างเดียว
  }
  if (payload.embeds || payload.content) return parseDiscord(payload);
  return null;
}

module.exports = { parsePayload, parseItemLine, parseDuration, parseNumber, normalizeItemName, cleanText };
