'use strict';
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { TOTAL_FLOORS, ROOMS_PER_FLOOR, roomsForFloor } = require('../utils/constants');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    });
  }
  return pool;
}

// ── Async DB helper ────────────────────────────────────────────────────────
const dbHelper = {
  async query(sql, params) {
    const { rows } = await getPool().query(sql, params || []);
    return rows;
  },
  async queryOne(sql, params) {
    const { rows } = await getPool().query(sql, params || []);
    return rows[0] || null;
  },
  async run(sql, params) {
    return getPool().query(sql, params || []);
  },
};

function getDb() {
  return dbHelper;
}

async function initDatabase() {
  const p = getPool();

  // ── Schema ────────────────────────────────────────────────────────────────
  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name          TEXT NOT NULL,
      floor_id      INTEGER,
      room_id       INTEGER,
      is_admin      INTEGER DEFAULT 0,
      is_onboarded  INTEGER DEFAULT 0,
      language      TEXT DEFAULT 'de',
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id          SERIAL PRIMARY KEY,
      room_number INTEGER NOT NULL,
      floor_id    INTEGER NOT NULL,
      is_active   INTEGER DEFAULT 1,
      UNIQUE(room_number, floor_id)
    );

    CREATE TABLE IF NOT EXISTS duty_anchors (
      id                      SERIAL PRIMARY KEY,
      floor_id                INTEGER UNIQUE NOT NULL,
      anchor_start_monday     TEXT NOT NULL,
      anchor_room_id          INTEGER NOT NULL,
      manual_override_room_id INTEGER,
      week_lock_enabled       INTEGER DEFAULT 1,
      updated_by              TEXT,
      updated_at              TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS disposal_events (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      room_id     INTEGER NOT NULL,
      floor_id    INTEGER NOT NULL,
      bin_types   TEXT NOT NULL,
      note        TEXT,
      photo_path  TEXT,
      qr_verified INTEGER DEFAULT 0,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bin_alerts (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      floor_id    INTEGER NOT NULL,
      bin_type    TEXT NOT NULL,
      note        TEXT,
      is_resolved INTEGER DEFAULT 0,
      resolved_at TIMESTAMPTZ,
      resolved_by INTEGER,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS room_holidays (
      id          SERIAL PRIMARY KEY,
      room_number INTEGER NOT NULL,
      floor_id    INTEGER NOT NULL,
      start_date  TEXT NOT NULL,
      end_date    TEXT NOT NULL,
      note        TEXT,
      created_by  TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS pending_duty_queue (
      id                  SERIAL PRIMARY KEY,
      floor_id            INTEGER NOT NULL,
      room_number         INTEGER NOT NULL,
      skipped_week_start  TEXT NOT NULL,
      queued_at           TIMESTAMPTZ DEFAULT NOW(),
      assigned_week_start TEXT,
      is_processed        INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS duty_schedule (
      id               SERIAL PRIMARY KEY,
      floor_id         INTEGER NOT NULL,
      week_start       TEXT NOT NULL,
      assigned_room    INTEGER NOT NULL,
      is_override      INTEGER DEFAULT 0,
      is_from_pending  INTEGER DEFAULT 0,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(floor_id, week_start)
    );
  `);

  // ── Schema migrations (add new columns if they don't exist) ──────────────
  await p.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'student';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS managed_floor_id INTEGER;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_suspended INTEGER DEFAULT 0;
  `);

  // ── Performance indexes ───────────────────────────────────────────────────
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_disposal_floor_date
      ON disposal_events (floor_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alerts_floor_resolved
      ON bin_alerts (floor_id, is_resolved);
    CREATE INDEX IF NOT EXISTS idx_duty_schedule_floor_week
      ON duty_schedule (floor_id, week_start);
    CREATE INDEX IF NOT EXISTS idx_duty_schedule_floor_normal
      ON duty_schedule (floor_id, is_from_pending, is_override, week_start DESC);
    CREATE INDEX IF NOT EXISTS idx_pending_duty_floor
      ON pending_duty_queue (floor_id, is_processed, queued_at);
    CREATE INDEX IF NOT EXISTS idx_rooms_floor_active
      ON rooms (floor_id, is_active);
  `);

  // ── Seed / migrate rooms (idempotent – inserts missing rooms on every start) ─────────
  {
    const values = [];
    const placeholders = [];
    let idx = 1;
    for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
      for (const roomNum of roomsForFloor(floor)) {
        values.push(roomNum, floor);
        placeholders.push(`($${idx}, $${idx + 1})`);
        idx += 2;
      }
    }
    await p.query(
      `INSERT INTO rooms (room_number, floor_id) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`,
      values
    );
  }

  // ── Remove merged rooms (X09 and X11 are part of X08/X09 and X10/X11) ──────
  await p.query(`DELETE FROM rooms WHERE room_number % 100 IN (9, 11)`);

  // ── Seed default admin ────────────────────────────────────────────────────
  const { rows: adminRows } = await p.query('SELECT id FROM users WHERE email = $1', ['admin@ioms.de']);
  if (adminRows.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await p.query(
      `INSERT INTO users (email, password_hash, name, floor_id, room_id, is_admin, is_onboarded)
       VALUES ($1, $2, $3, $4, $5, 1, 1) ON CONFLICT DO NOTHING`,
      ['admin@ioms.de', hash, 'Admin', 1, 101]
    );
    console.log('Seeded admin user: admin@ioms.de / admin123');
  }

  // ── Seed duty anchors ─────────────────────────────────────────────────────
  const { rows: anchorRows } = await p.query('SELECT COUNT(*)::int AS cnt FROM duty_anchors');
  if (anchorRows[0].cnt === 0) {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    const mondayStr = monday.toISOString().slice(0, 10);

    for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
      await p.query(
        `INSERT INTO duty_anchors (floor_id, anchor_start_monday, anchor_room_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [floor, mondayStr, floor * 100 + 1]
      );
    }
    console.log('Seeded duty anchors for all floors.');
  }

  console.log('Database initialised.');
}

module.exports = { initDatabase, getDb, getPool };
