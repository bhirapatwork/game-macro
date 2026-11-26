// ทดสอบ format ของ Capy's AA Macro v7.4 (Capybara Session Report)
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'capy-')), 't.db');
const { parsePayload } = require('../src/parser');
const svc = require('../src/service');

const report = ({ wins, losses, time, pearls }) => ({
  embeds: [{
    title: 'Summer Rewards',
    fields: [
      { name: 'Map', value: 'Strange Town', inline: true },
      { name: 'Mode', value: 'Summer', inline: true },
      { name: 'Wins / Losses', value: `${wins} / ${losses}`, inline: true },
      { name: 'Session Time', value: time, inline: true },
      { name: 'Mode W/L', value: `${wins} / ${losses}`, inline: true },
      { name: 'Challenge W/L', value: '0 / 0', inline: true },
      { name: 'Summer Pearls (Session)', value: String(pearls) },
      { name: 'Total Time:', value: 'Not Available' },
    ],
    image: { url: 'attachment://screenshot.png' },
    footer: { text: "Capy's AA Macro v7.4 | Capybara Session Report" },
  }],
});

test('parse capy session report', () => {
  const ev = parsePayload(report({ wins: 2, losses: 2, time: '01:40:41', pearls: 26212 }));
  assert.strictEqual(ev.type, 'session_report');
  assert.strictEqual(ev.match.map, 'Strange Town');
  assert.strictEqual(ev.match.mode, 'Summer');
  assert.strictEqual(ev.session.wins, 2);
  assert.strictEqual(ev.session.losses, 2);
  assert.strictEqual(ev.session.session_sec, 6041);
  assert.deepStrictEqual(ev.session.counters, { 'Summer Pearls': 26212 });
});

test('image-only capy message is not a match', () => {
  assert.strictEqual(parsePayload({ embeds: [{ image: { url: 'attachment://a.png' }, footer: { text: "Capy's AA Macro v7.4 | Capybara Session Report" } }] }), null);
});

test('session deltas become per-match results', () => {
  const acc = svc.createAccount({ roblox_name: 'tester' });
  const send = (r) => svc.ingest(svc.getAccountRow(acc.id), report(r));

  send({ wins: 1, losses: 0, time: '00:25:00', pearls: 8043 });   // แมตช์ 1 ชนะ
  send({ wins: 1, losses: 1, time: '00:50:00', pearls: 12000 });  // แมตช์ 2 แพ้
  const dup = send({ wins: 1, losses: 1, time: '00:50:30', pearls: 12000 }); // ส่งซ้ำ
  assert.strictEqual(dup.match_id, null);
  send({ wins: 1, losses: 0, time: '00:20:00', pearls: 5000 });   // macro เริ่ม session ใหม่

  const { items } = svc.accountMatches(acc.id);
  const got = items.reverse().map((m) => [m.result, m.duration_sec, m.rewards[0]?.qty]);
  assert.deepStrictEqual(got, [['win', 1500, 8043], ['lose', 1500, 3957], ['win', 1200, 5000]]);
  assert.strictEqual(svc.accountItems(acc.id, 0)[0].qty, 8043 + 3957 + 5000);
});
