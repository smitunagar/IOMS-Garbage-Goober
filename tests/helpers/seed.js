'use strict';
/**
 * tests/helpers/seed.js
 *
 * Creates fixed test accounts in the database so that E2E and integration
 * tests always have known credentials to work with.
 *
 * Usage:
 *   npm run test:seed          ← run standalone
 *   require('./seed')()        ← called programmatically from tests
 *
 * Accounts created:
 *   admin@ioms.de      / admin123       (pre-seeded by initDatabase – not touched here)
 *   e2e_student@test   / Student123!    (onboarded, floor 3, room 305)
 *   e2e_fs@test        / FloorSp123!    (floor_speaker, managed_floor_id 2, floor 2, room 201)
 *   e2e_new@test       / NewUser123!    (registered only, NOT onboarded)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const bcrypt  = require('bcryptjs');
const { initDatabase, getDb } = require('../../config/database');

const TEST_USERS = [
  {
    email:            'e2e_student@test',
    password:         'Student123!',
    name:             'E2E Student',
    floor_id:         3,
    room_id:          305,
    is_admin:         0,
    is_onboarded:     1,
    role:             'student',
    managed_floor_id: null,
  },
  {
    email:            'e2e_fs@test',
    password:         'FloorSp123!',
    name:             'E2E Floor Speaker',
    floor_id:         2,
    room_id:          201,
    is_admin:         0,
    is_onboarded:     1,
    role:             'floor_speaker',
    managed_floor_id: 2,
  },
  {
    email:            'e2e_new@test',
    password:         'NewUser123!',
    name:             'E2E New User',
    floor_id:         null,
    room_id:          null,
    is_admin:         0,
    is_onboarded:     0,
    role:             'student',
    managed_floor_id: null,
  },
];

async function seed() {
  await initDatabase();      // ensures schema + default admin exist
  const db = getDb();

  for (const u of TEST_USERS) {
    const exists = await db.queryOne('SELECT id FROM users WHERE email = $1', [u.email]);
    if (exists) {
      // keep credentials in sync (re-hash on every seed run)
      const hash = bcrypt.hashSync(u.password, 10);
      await db.run(
        `UPDATE users
            SET password_hash = $1, floor_id = $2, room_id = $3,
                is_admin = $4, is_onboarded = $5, role = $6, managed_floor_id = $7
          WHERE email = $8`,
        [hash, u.floor_id, u.room_id, u.is_admin, u.is_onboarded, u.role, u.managed_floor_id, u.email],
      );
      console.log(`[seed] Updated : ${u.email}`);
    } else {
      const hash = bcrypt.hashSync(u.password, 10);
      await db.run(
        `INSERT INTO users
           (email, password_hash, name, floor_id, room_id, is_admin, is_onboarded, role, managed_floor_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [u.email, hash, u.name, u.floor_id, u.room_id, u.is_admin, u.is_onboarded, u.role, u.managed_floor_id],
      );
      console.log(`[seed] Created : ${u.email}`);
    }
  }
  console.log('[seed] Done.');
}

module.exports = seed;

// Allow running directly: node tests/helpers/seed.js
if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}
