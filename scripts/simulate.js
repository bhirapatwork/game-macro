// จำลอง macro ยิง webhook เข้าเว็บ (ใช้ทดสอบ / ทำข้อมูลตัวอย่าง)
//   ADMIN_KEY=xxx node scripts/simulate.js [baseUrl]
const BASE = process.argv[2] || 'http://localhost:3000';
const ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY) { console.error('ต้องตั้ง ADMIN_KEY'); process.exit(1); }

const rnd = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (arr) => arr[rnd(0, arr.length - 1)];
const UNITS = ['Shadow Monarch', 'Rimuru', 'Gojo', 'Megumin', 'Kurumi', 'Aqua', 'Speedwagon', 'Kakashi'];
const MAPS = ['Sky Island', 'Spirit World', 'Haunted Academy (Summer)', 'Puppet Island (Summer)', 'Alien Spaceship (Underwater)'];
const MODS = ['ไฟลุก', 'พายุหิมะ', 'ดาวตก', null];

async function admin(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN_KEY }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}
const post = (url, body) => fetch(url + '?wait=true', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

// แบบที่ macro ทั่วไปส่ง (Discord embed)
function discordPayload(i, player) {
  const win = Math.random() > 0.2, map = pick(MAPS), portal = map === 'Sky Island';
  const rewards = [`+${rnd(3000, 15000).toLocaleString('en-US')} SummerPearls`];
  if (portal) rewards.push(`+${rnd(2, 6)} Curse Talisman II`);
  if (Math.random() > 0.4) rewards.push(`+${rnd(1, 3)} Star Remnant (Limited)`);
  if (Math.random() > 0.85) rewards.push('+1 Sky Portal');
  if (Math.random() > 0.95) rewards.push('+1 Divine Wish');
  return {
    username: 'AA Macro',
    embeds: [{
      title: win ? '✅ Victory!' : '❌ Defeat',
      color: win ? 0x48e0a4 : 0xff7a8a,
      fields: [
        { name: 'Player', value: player.name, inline: true },
        { name: 'Player Level', value: String(player.level), inline: true },
        { name: 'Gems', value: player.gems.toLocaleString('en-US'), inline: true },
        { name: 'Mode', value: portal ? 'Portal' : 'Raid', inline: true },
        { name: 'Map', value: map, inline: true },
        { name: 'Difficulty', value: 'Hard', inline: true },
        ...(portal ? [{ name: 'Tier', value: `Tier ${rnd(6, 9)}`, inline: true }] : []),
        { name: 'Wave', value: String(win ? (portal ? 20 : 50) : rnd(30, 49)), inline: true },
        { name: 'Time', value: `${rnd(18, 29)}:${String(rnd(0, 59)).padStart(2, '0')}`, inline: true },
        ...(MODS[i % 4] ? [{ name: 'Modifier', value: MODS[i % 4] }] : []),
        { name: '🎁 Rewards', value: rewards.join('\n') },
      ],
      footer: { text: `Match #${i}` },
    }],
  };
}

(async () => {
  const jobs = [
    { roblox_name: 'za12345638', roblox_user_id: 1, machine: 'PC-26:6', job_title: 'ปาร์ตี้ Sky Portal 1 วัน', job_type: 'hours_won', job_target: 24 },
    { roblox_name: 'So_player_o9', machine: 'PC-2:2', job_title: 'การันตีตัวลับ มัลโก้', job_type: 'none' },
    { roblox_name: 'Kuroneko_ox', machine: 'PC-11:3', job_title: 'Summer Pearl 300K', job_type: 'item', job_item: 'Summer Pearls', job_target: 300000 },
    { roblox_name: 'po_test_at', machine: 'PC-36:9', job_title: 'Summer Hunt 20 แมตช์', job_type: 'matches', job_target: 20 },
  ];
  for (const j of jobs) {
    const acc = await admin('/api/admin/accounts', { ...j, status: 'farming', job_start_ts: Date.now() - 864e5 });
    console.log(`${j.roblox_name}\n  dashboard: ${acc.dashboard_url}\n  webhook:   ${acc.webhook_url}`);
    const player = { name: j.roblox_name, level: rnd(130, 240), gems: rnd(10000, 95000) };
    const team = UNITS.slice(0, 6).map((n) => ({ name: n, level: pick([100, 110]) }));

    for (let i = 1; i <= rnd(8, 16); i++) {
      const r = await post(acc.webhook_url, discordPayload(i, player));
      if (!r.parsed) console.warn('  ! parse failed', r);
    }
    // native format: ร้านค้า, สุ่มตู้, inventory snapshot, แมตช์ที่กำลังเล่น
    await post(acc.webhook_url, { type: 'shop_purchase', purchase: { shop: 'Travelling Merchant', item: 'Star Fruit (Rainbow)', price: 300, currency: 'Gems', qty: 20, balance_after: player.gems - 300 } });
    await post(acc.webhook_url, { type: 'shop_purchase', purchase: { shop: "Gambler's Shop", item: 'Star Fruit Capsule', price: 20, currency: 'Tokens', qty: 9, balance_after: 18 } });
    await post(acc.webhook_url, { type: 'summon', summon: { banner: 'Summer', count: rnd(100, 4000) } });
    await post(acc.webhook_url, {
      type: 'status',
      inventory: [
        { name: 'Summer Pearls', qty: rnd(1e5, 5e6) }, { name: 'Gems', qty: player.gems }, { name: 'Stat Cube', qty: rnd(5, 30) },
        { name: 'Perfect Stat Cube', qty: rnd(0, 3) }, { name: 'Summer Charm', qty: rnd(10, 100) }, { name: 'Sky Portal', qty: rnd(10, 200) },
      ],
    });
    await post(acc.webhook_url, { type: 'match_start', match: { mode: 'Raid', map: 'Spirit World', difficulty: 'Hard', modifier: 'ไฟลุก · ศัตรูเร็วขึ้น 50%', wave: rnd(1, 50), team } });
  }
  console.log('\nเสร็จแล้ว เปิด', BASE);
})().catch((e) => { console.error(e); process.exit(1); });
