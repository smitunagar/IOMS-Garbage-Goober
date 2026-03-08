const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { TOTAL_FLOORS, ROOMS_PER_FLOOR } = require('../utils/constants');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'ioms.db');

let db;

function getDb() {
  if (!db) throw new Error('Database not initialised – call initDatabase() first');
  return db;
}

function initDatabase() {
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // ── Schema ──────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      email        TEXT    UNIQUE NOT NULL,
      password_hash TEXT   NOT NULL,
      name         TEXT    NOT NULL,
      floor_id     INTEGER,
      room_id      INTEGER,
      is_admin     INTEGER DEFAULT 0,
      is_onboarded INTEGER DEFAULT 0,
      language     TEXT    DEFAULT 'de',
      created_at   TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      room_number INTEGER NOT NULL,
      floor_id    INTEGER NOT NULL,
      is_active   INTEGER DEFAULT 1,
      UNIQUE(room_number, floor_id)
    );

    CREATE TABLE IF NOT EXISTS duty_anchors (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      floor_id               INTEGER UNIQUE NOT NULL,
      anchor_start_monday    TEXT    NOT NULL,
      anchor_room_id         INTEGER NOT NULL,
      manual_override_room_id INTEGER,
      updated_by             TEXT,
      updated_at             TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS disposal_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      room_id     INTEGER NOT NULL,
      floor_id    INTEGER NOT NULL,
      bin_types   TEXT    NOT NULL,
      note        TEXT,
      photo_path  TEXT,
      qr_verified INTEGER DEFAULT 0,
      created_at  TEXT    DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS bin_alerts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      floor_id    INTEGER NOT NULL,
      bin_type    TEXT    NOT NULL,
      note        TEXT,
      is_resolved INTEGER DEFAULT 0,
      resolved_at TEXT,
      resolved_by INTEGER,
      created_at  TEXT    DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid     TEXT PRIMARY KEY,
      sess    TEXT NOT NULL,
      expired INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_holidays (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      room_number INTEGER NOT NULL,
      floor_id    INTEGER NOT NULL,
      start_date  TEXT    NOT NULL,
      end_date    TEXT    NOT NULL,
      note        TEXT,
      created_by  TEXT,
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pending_duty_queue (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      floor_id            INTEGER NOT NULL,
      room_number         INTEGER NOT NULL,
      skipped_week_start  TEXT    NOT NULL,
      queued_at           TEXT    DEFAULT (datetime('now')),
      assigned_week_start TEXT,
      is_processed        INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS duty_schedule (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      floor_id         INTEGER NOT NULL,
      week_start       TEXT    NOT NULL,
      assigned_room    INTEGER NOT NULL,
      is_override      INTEGER DEFAULT 0,
      is_from_pending  INTEGER DEFAULT 0,
      created_at       TEXT    DEFAULT (datetime('now')),
      UNIQUE(floor_id, week_start)
    );
  `);

  // ── Migrations ────────────────────────────────────────────────────────────
  try { db.exec('ALTER TABLE duty_anchors ADD COLUMN week_lock_enabled INTEGER DEFAULT 1'); } catch (_) {}
  try { db.exec('ALTER TABLE duty_anchors ADD COLUMN manual_override_room_id INTEGER'); } catch (_) {}

  // ── Seed rooms ────────────────────────────────────────────────────────
  const roomCount = db.prepare('SELECT COUNT(*) AS cnt FROM rooms').get().cnt;
  if (roomCount === 0) {
    const insert = db.prepare('INSERT INTO rooms (room_number, floor_id) VALUES (?, ?)');
    const batch = db.transaction(() => {
      for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
        for (let r = 1; r <= ROOMS_PER_FLOOR; r++) {
          insert.run(floor * 100 + r, floor);
        }
      }
    });
    batch();
    console.log(`Seeded ${TOTAL_FLOORS * ROOMS_PER_FLOOR} rooms.`);
  }

  // ── Seed default admin ────────────────────────────────────────────────
  const admin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@ioms.de');
  if (!admin) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`
      INSERT INTO users (email, password_hash, name, floor_id, room_id, is_admin, is_onboarded)
      VALUES (?, ?, ?, ?, ?, 1, 1)
    `).run('admin@ioms.de', hash, 'Admin', 1, 101);
    console.log('Seeded admin user: admin@ioms.de / admin123');
  }

  // ── Seed duty anchors (one per floor, starting this week's Monday) ───
  const anchorCount = db.prepare('SELECT COUNT(*) AS cnt FROM duty_anchors').get().cnt;
  if (anchorCount === 0) {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    const mondayStr = monday.toISOString().slice(0, 10);

    const ins = db.prepare(`
      INSERT INTO duty_anchors (floor_id, anchor_start_monday, anchor_room_id)
      VALUES (?, ?, ?)
    `);
    const batch = db.transaction(() => {
      for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
        ins.run(floor, mondayStr, floor * 100 + 1);
      }
    });
    batch();
    console.log('Seeded duty anchors for all floors.');
  }

  console.log('Database initialised.');
  return db;
}

// ─── Custom session store using better-sqlite3 ──────────────────────────────

class SQLiteStore {
  constructor(session) {
    this.Store = session.Store;
  }

  create(session) {
    const Store = session.Store;
    class SqliteSessionStore extends Store {
      constructor() {
        super();
        // Clean expired sessions every 15 min
        setInterval(() => {
          try { getDb().prepare('DELETE FROM sessions WHERE expired < ?').run(Date.now()); } catch (_) {}
        }, 15 * 60 * 1000);
      }
      get(sid, cb) {
        try {
          const row = getDb().prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > ?').get(sid, Date.now());
          cb(null, row ? JSON.parse(row.sess) : null);
        } catch (e) { cb(e); }
      }
      set(sid, sess, cb) {
        try {
          const maxAge = (sess.cookie && sess.cookie.maxAge) || 86400000;
          const expired = Date.now() + maxAge;
          getDb().prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)').run(sid, JSON.stringify(sess), expired);
          cb(null);
        } catch (e) { cb(e); }
      }
      destroy(sid, cb) {
        try {
          getDb().prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
          cb(null);
        } catch (e) { cb(e); }
      }
      touch(sid, sess, cb) {
        this.set(sid, sess, cb);
      }
    }
    return new SqliteSessionStore();
  }
}

module.exports = { initDatabase, getDb, SQLiteStore };
