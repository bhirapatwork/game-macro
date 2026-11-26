const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tracker.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,           -- public id ใช้ใน URL หน้า dashboard
  token         TEXT NOT NULL UNIQUE,       -- secret ใช้ใน webhook URL ของ macro
  roblox_name   TEXT,
  roblox_user_id INTEGER,
  game          TEXT DEFAULT 'Anime Adventures',
  machine       TEXT,
  job_title     TEXT,                       -- เช่น "Summer Hunt 2 วัน"
  job_type      TEXT DEFAULT 'none',        -- hours_won | item | matches | none
  job_target    REAL,
  job_item      TEXT,
  job_start_ts  INTEGER,
  status        TEXT DEFAULT 'queued',      -- queued | farming | done | cancelled
  in_match      INTEGER DEFAULT 0,
  current_match TEXT,                       -- JSON
  level         INTEGER,
  gems          INTEGER,
  battlepass    INTEGER,
  summon_count  INTEGER DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_seen     INTEGER
);

CREATE TABLE IF NOT EXISTS matches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ts           INTEGER NOT NULL,
  mode         TEXT, map TEXT, difficulty TEXT, tier INTEGER, act TEXT,
  wave         INTEGER, duration_sec INTEGER, result TEXT, modifier TEXT,
  portal_owner TEXT,                         -- self | party
  team         TEXT                          -- JSON
);
CREATE INDEX IF NOT EXISTS idx_matches_acc_ts ON matches(account_id, ts DESC);

CREATE TABLE IF NOT EXISTS match_rewards (
  match_id   INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  item       TEXT NOT NULL,
  qty        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rewards_acc ON match_rewards(account_id, item);
CREATE INDEX IF NOT EXISTS idx_rewards_match ON match_rewards(match_id);

CREATE TABLE IF NOT EXISTS inventory (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item       TEXT NOT NULL,
  qty        INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, item)
);

CREATE TABLE IF NOT EXISTS purchases (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ts         INTEGER NOT NULL,
  shop TEXT, item TEXT, price INTEGER, currency TEXT, qty INTEGER, balance_after INTEGER
);
CREATE INDEX IF NOT EXISTS idx_purchases_acc ON purchases(account_id, ts DESC);

-- เก็บ payload ดิบทุกอัน เผื่อ format macro เปลี่ยนแล้วต้อง parse ใหม่
CREATE TABLE IF NOT EXISTS raw_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT,
  ts         INTEGER NOT NULL,
  body       TEXT NOT NULL,
  parsed     INTEGER NOT NULL
);
`);

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, tx };
