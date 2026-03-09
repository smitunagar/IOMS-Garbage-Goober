'use strict';
/**
 * tests/integration/admin.test.js
 *
 * Integration tests for admin and floor-speaker rotation routes:
 *   GET  /admin
 *   GET  /admin/rotation/:floorId
 *   POST /admin/rotation/:floorId
 *   POST /admin/rotation/:floorId/toggle-room
 *   GET  /floor-speaker/rotation/:floorId
 *   POST /floor-speaker/rotation/:floorId
 *   POST /floor-speaker/rotation/:floorId/toggle-room
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const request  = require('supertest');
const bcrypt   = require('bcryptjs');
const app      = require('../../server');
const { initDatabase, getDb } = require('../../config/database');

const TS       = Date.now();
const email    = (l) => `it_admin_${l}_${TS}@test.ioms`;
let createdIds = [];

async function createUser(overrides = {}) {
  const defaults = {
    email:            email(`u${Math.random().toString(36).slice(2, 6)}`),
    password:         'Test1234!',
    name:             'Admin Tester',
    floor_id:         1,
    room_id:          101,
    is_admin:         0,
    is_onboarded:     1,
    role:             'student',
    managed_floor_id: null,
  };
  const u    = { ...defaults, ...overrides };
  const hash = bcrypt.hashSync(u.password, 10);
  const db   = getDb();
  const row  = await db.queryOne(
    `INSERT INTO users (email, password_hash, name, floor_id, room_id, is_admin, is_onboarded, role, managed_floor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [u.email, hash, u.name, u.floor_id, u.room_id, u.is_admin, u.is_onboarded, u.role, u.managed_floor_id],
  );
  createdIds.push(row.id);
  return { ...u, id: row.id };
}

async function loggedInAgent(user) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: user.email, password: user.password });
  return agent;
}

beforeAll(() => initDatabase());

afterAll(async () => {
  if (createdIds.length) {
    const db = getDb();
    await db.run(`DELETE FROM users WHERE id = ANY($1::int[])`, [createdIds]);
  }
});

// ─── /admin access control ────────────────────────────────────────────────────
describe('Admin access control', () => {
  it('GET /admin → 403 for regular student', async () => {
    const u     = await createUser();
    const agent = await loggedInAgent(u);
    const res   = await agent.get('/admin');
    expect(res.status).toBe(403);
  });

  it('GET /admin → redirects unauthenticated to /login', async () => {
    const res = await request(app).get('/admin');
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/\/login/);
  });
});

// ─── Admin happy paths ─────────────────────────────────────────────────────────
describe('Admin rotation management', () => {
  let adminAgent;

  beforeAll(async () => {
    // Use the pre-seeded admin@ioms.de / admin123 (created by initDatabase)
    adminAgent = request.agent(app);
    const login = await adminAgent
      .post('/login')
      .type('form')
      .send({ email: 'admin@ioms.de', password: 'admin123' });
    expect([302, 303]).toContain(login.status);
  });

  it('GET /admin returns 200', async () => {
    const res = await adminAgent.get('/admin');
    expect(res.status).toBe(200);
  });

  it('GET /admin/rotation/1 returns 200', async () => {
    const res = await adminAgent.get('/admin/rotation/1');
    expect(res.status).toBe(200);
  });

  it('GET /admin/rotation/99 redirects to /admin (invalid floor)', async () => {
    const res = await adminAgent.get('/admin/rotation/99');
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/\/admin/);
  });

  it('POST /admin/rotation/1 with overrideRoom redirects back', async () => {
    const res = await adminAgent
      .post('/admin/rotation/1')
      .type('form')
      .send({ overrideRoom: '101' });
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/rotation\/1/);
  });

  it('POST /admin/rotation/1/toggle-room returns JSON', async () => {
    const res = await adminAgent
      .post('/admin/rotation/1/toggle-room')
      .set('Content-Type', 'application/json')
      .send({ roomNumber: 101 });
    expect(res.status).toBe(200);
    expect(typeof res.body.ok).toBe('boolean');
    if (res.body.ok) {
      expect(typeof res.body.isActive).toBe('boolean');
    }
  });
});

// ─── Floor-speaker access control ─────────────────────────────────────────────
describe('Floor-speaker access control', () => {
  it('GET /floor-speaker/rotation/2 → 403 for regular student', async () => {
    const u     = await createUser({ floor_id: 2, room_id: 201 });
    const agent = await loggedInAgent(u);
    const res   = await agent.get('/floor-speaker/rotation/2');
    expect(res.status).toBe(403);
  });

  it('GET /floor-speaker/rotation/2 → redirects unauthenticated to /login', async () => {
    const res = await request(app).get('/floor-speaker/rotation/2');
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/\/login/);
  });
});

// ─── Floor-speaker happy paths ─────────────────────────────────────────────────
describe('Floor-speaker rotation management', () => {
  let fsAgent;
  let fsUser;

  beforeAll(async () => {
    fsUser = await createUser({
      role:             'floor_speaker',
      managed_floor_id: 2,
      floor_id:         2,
      room_id:          201,
    });
    fsAgent = await loggedInAgent(fsUser);
  });

  it('GET /floor-speaker/rotation/2 returns 200', async () => {
    const res = await fsAgent.get('/floor-speaker/rotation/2');
    expect(res.status).toBe(200);
  });

  it('floor speaker cannot access a floor they do not manage (floor 5)', async () => {
    const res = await fsAgent.get('/floor-speaker/rotation/5');
    expect(res.status).toBe(403);
  });

  it('POST /floor-speaker/rotation/2 with overrideRoom redirects back', async () => {
    const res = await fsAgent
      .post('/floor-speaker/rotation/2')
      .type('form')
      .send({ overrideRoom: '201' });
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/rotation\/2/);
  });

  it('POST /floor-speaker/rotation/2/toggle-room returns JSON', async () => {
    const res = await fsAgent
      .post('/floor-speaker/rotation/2/toggle-room')
      .set('Content-Type', 'application/json')
      .send({ roomNumber: 201 });
    expect(res.status).toBe(200);
    expect(typeof res.body.ok).toBe('boolean');
  });
});
