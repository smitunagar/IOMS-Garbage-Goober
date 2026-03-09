'use strict';
/**
 * scripts/reset-for-production.js
 *
 * ONE-TIME production reset:
 *   - Wipes ALL users, disposal events, alerts, duty schedules,
 *     pending queue, room holidays, and sessions
 *   - Keeps rooms (structural data stays intact)
 *   - Resets duty anchors to this week's Monday
 *   - Recreates a clean admin account  →  admin@ioms.de / admin123
 *   - Resets all sequences back to 1
 *
 * Run ONCE before going live:
 *   node scripts/reset-for-production.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const bcrypt = require('bcryptjs');
const { getPool } = require('../config/database');
const { TOTAL_FLOORS, roomsForFloor } = require('../utils/constants');

async function getMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

async function run() {
  const pool = getPool();

  console.log('\n🗑️  IOMS Production Reset\n');

  // ── 1. Wipe all transactional data ────────────────────────────────────────
  console.log('Clearing sessions...');
  await pool.query('DELETE FROM session').catch(() => {}); // table may not exist yet

  console.log('Clearing disposal events...');
  await pool.query('TRUNCATE disposal_events RESTART IDENTITY CASCADE');

  console.log('Clearing bin alerts...');
  await pool.query('TRUNCATE bin_alerts RESTART IDENTITY CASCADE');

  console.log('Clearing duty schedule...');
  await pool.query('TRUNCATE duty_schedule RESTART IDENTITY CASCADE');

  console.log('Clearing pending duty queue...');
  await pool.query('TRUNCATE pending_duty_queue RESTART IDENTITY CASCADE');

  console.log('Clearing room holidays...');
  await pool.query('TRUNCATE room_holidays RESTART IDENTITY CASCADE');

  console.log('Clearing duty anchors...');
  await pool.query('TRUNCATE duty_anchors RESTART IDENTITY CASCADE');

  // ── 2. Wipe all users ─────────────────────────────────────────────────────
  console.log('Clearing all users...');
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');

  // ── 3. Recreate clean admin account ──────────────────────────────────────
  console.log('Creating fresh admin account (admin@ioms.de)...');
  const hash = bcrypt.hashSync('admin123', 12);
  await pool.query(
    `INSERT INTO users (email, password_hash, name, floor_id, room_id, is_admin, is_onboarded, role)
     VALUES ($1, $2, $3, $4, $5, 1, 1, 'student')`,
    ['admin@ioms.de', hash, 'Admin', 1, 101]
  );

  // ── 4. Re-seed duty anchors from today's Monday ───────────────────────────
  const mondayStr = await getMonday();
  console.log(`Seeding duty anchors (anchor week: ${mondayStr})...`);

  for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
    const rooms = roomsForFloor(floor).filter(r => r % 100 !== 9 && r % 100 !== 11);
    const firstRoom = rooms[0];
    await pool.query(
      `INSERT INTO duty_anchors (floor_id, anchor_start_monday, anchor_room_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [floor, mondayStr, firstRoom]
    );
  }

  // ── 5. Summary ────────────────────────────────────────────────────────────
  const { rows: roomCount }  = await pool.query('SELECT COUNT(*)::int AS cnt FROM rooms');
  const { rows: userCount }  = await pool.query('SELECT COUNT(*)::int AS cnt FROM users');
  const { rows: anchorCount} = await pool.query('SELECT COUNT(*)::int AS cnt FROM duty_anchors');

  console.log('\n✅  Reset complete!\n');
  console.log(`   Rooms intact:      ${roomCount[0].cnt}`);
  console.log(`   Users in DB:       ${userCount[0].cnt}  (admin@ioms.de only)`);
  console.log(`   Duty anchors:      ${anchorCount[0].cnt} floors`);
  console.log(`   Anchor week:       ${mondayStr}`);
  console.log('\n   Admin login → admin@ioms.de / admin123');
  console.log('   ⚠️  Change the admin password after first login!\n');

  await pool.end();
}

run().catch(err => {
  console.error('\n❌ Reset failed:', err.message);
  process.exit(1);
});
