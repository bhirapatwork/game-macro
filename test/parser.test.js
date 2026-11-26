const test = require('node:test');
const assert = require('node:assert');
const { parsePayload, parseItemLine, parseDuration } = require('../src/parser');

test('item line formats', () => {
  assert.deepStrictEqual(parseItemLine('SummerPearls x6,334'), { name: 'SummerPearls', qty: 6334 });
  assert.deepStrictEqual(parseItemLine('+ 3 Stat Cube'), { name: 'Stat Cube', qty: 3 });
  assert.deepStrictEqual(parseItemLine('**Gems**: 1.2k'), { name: 'Gems', qty: 1200 });
  assert.deepStrictEqual(parseItemLine('<:pearl:123> Summer Pearls ×9,453'), { name: 'Summer Pearls', qty: 9453 });
  assert.deepStrictEqual(parseItemLine('Star Remnant (Limited) x2'), { name: 'Star Remnant (Limited)', qty: 2 });
  assert.deepStrictEqual(parseItemLine('Sky Portal (1)'), { name: 'Sky Portal', qty: 1 });
});

test('duration formats', () => {
  assert.strictEqual(parseDuration('18:37'), 1117);
  assert.strictEqual(parseDuration('1:02:03'), 3723);
  assert.strictEqual(parseDuration('20m 51s'), 1251);
  assert.strictEqual(parseDuration('28:00 นาที'), 1680);
});

test('discord embed with fields', () => {
  const ev = parsePayload({
    embeds: [{
      title: '🏆 Match Finished - Victory!',
      fields: [
        { name: 'Map', value: 'Sky Island' },
        { name: 'Mode', value: 'Portal' },
        { name: 'Difficulty', value: 'Hard' },
        { name: 'Tier', value: 'Tier 8' },
        { name: 'Wave', value: '20' },
        { name: 'Time', value: '18:37' },
        { name: '🎁 Rewards', value: '+6,334 SummerPearls\n+6 Curse Talisman II\n+2 Star Remnant (Limited)' },
        { name: 'Player Level', value: '235' },
        { name: 'Gems', value: '92.6K' },
      ],
    }],
  });
  assert.strictEqual(ev.type, 'match_end');
  assert.strictEqual(ev.match.result, 'win');
  assert.strictEqual(ev.match.map, 'Sky Island');
  assert.strictEqual(ev.match.tier, 8);
  assert.strictEqual(ev.match.wave, 20);
  assert.strictEqual(ev.match.duration_sec, 1117);
  assert.strictEqual(ev.player.level, 235);
  assert.strictEqual(ev.player.gems, 92600);
  assert.deepStrictEqual(ev.rewards, [
    { name: 'Summer Pearls', qty: 6334 },
    { name: 'Curse Talisman II', qty: 6 },
    { name: 'Star Remnant (Limited)', qty: 2 },
  ]);
});

test('discord description-only text', () => {
  const ev = parsePayload({
    content: '',
    embeds: [{ description: '**Result:** Defeat\n**Map:** Haunted Academy (Summer)\n**Wave:** 49\n**Time:** 24m 11s\n\n**Rewards:**\nSummerPearls x13,152\nStar Remnant (Limited) x3' }],
  });
  assert.strictEqual(ev.match.result, 'lose');
  assert.strictEqual(ev.match.map, 'Haunted Academy (Summer)');
  assert.strictEqual(ev.match.wave, 49);
  assert.strictEqual(ev.match.duration_sec, 1451);
  assert.strictEqual(ev.rewards.length, 2);
  assert.strictEqual(ev.rewards[0].qty, 13152);
});

test('non-match discord message ignored', () => {
  assert.strictEqual(parsePayload({ content: 'Macro started' }), null);
});

test('native format', () => {
  const ev = parsePayload({
    type: 'match_end',
    player: { name: 'za123438', level: 235 },
    match: { mode: 'Portal', map: 'Sky Island', result: 'Victory', duration: '18:37' },
    rewards: [{ name: 'SummerPearls', qty: '6,334' }, { name: 'Summer Pearls', qty: 10 }],
  });
  assert.strictEqual(ev.match.result, 'win');
  assert.strictEqual(ev.match.duration_sec, 1117);
  assert.deepStrictEqual(ev.rewards, [{ name: 'Summer Pearls', qty: 6344 }]);
});
