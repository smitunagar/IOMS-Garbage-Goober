'use strict';
/**
 * tests/integration/auth.test.js
 *
 * Integration tests for the authentication routes:
 *   GET  /login
 *   POST /login
 *   GET  /signup
 *   POST /signup
 *   GET  /onboarding
 *   POST /onboarding
 *   GET  /logout
 *
 * Uses supertest against the real Express app (server.js) and a real
 * Neon PostgreSQL connection via DATABASE_URL.
 * Each test file creates its own isolated users (email prefix `it_auth_`)
 * and deletes them in afterAll to stay idempotent.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const request  = require('supertest');
const bcrypt   = require('bcryptjs');
const app      = require('../../server');
const { initDatabase, getDb } = require('../../config/database');

// ── Test-user factory ─────────────────────────────────────────────────────────
const TS       = Date.now();
const email    = (label) => `it_auth_${label}_${TS}@test.ioms`;
let createdIds = [];

async function createUser(overrides = {}) {
  const defaults = {
    email:        email(`u${Math.random().toString(36).slice(2, 6)}`),
    password:     'TestPass123!',
    name:         'Integration Test',
    floor_id:     3,
    room_id:      305,
    is_admin:     0,
    is_onboarded: 1,
    role:         'student',
  };
  const u    = { ...defaults, ...overrides };
  const hash = bcrypt.hashSync(u.password, 10);
  const db   = getDb();
  const row  = await db.queryOne(
    `INSERT INTO users (email, password_hash, name, floor_id, room_id, is_admin, is_onboarded, role)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [u.email, hash, u.name, u.floor_id, u.room_id, u.is_admin, u.is_onboarded, u.role],
  );
  createdIds.push(row.id);
  return { ...u, id: row.id };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────
beforeAll(async () => {
  await initDatabase();
});

afterAll(async () => {
  if (createdIds.length) {
    const db = getDb();
    await db.run(`DELETE FROM users WHERE id = ANY($1::int[])`, [createdIds]);
  }
});

// ── GET /login ─────────────────────────────────────────────────────────────────
describe('GET /login', () => {
  it('returns 200 and renders login form', async () => {
    const res = await request(app).get('/login');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/email|password/i);
  });
});

// ── GET /signup ────────────────────────────────────────────────────────────────
describe('GET /signup', () => {
  it('returns 200', async () => {
    const res = await request(app).get('/signup');
    expect(res.status).toBe(200);
  });
});

// ── POST /signup ───────────────────────────────────────────────────────────────
describe('POST /signup', () => {
  it('creates account and redirects to /onboarding', async () => {
    const agent = request.agent(app);
    const e = email('new');
    const res = await agent
      .post('/signup')
      .type('form')
      .send({ name: 'New User', email: e, password: 'Test1234!', confirmPassword: 'Test1234!' });

    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/\/onboarding/);

    // Track the created user for cleanup
    const db  = getDb();
    const row = await db.queryOne('SELECT id FROM users WHERE email = $1', [e.toLowerCase()]);
    if (row) createdIds.push(row.id);
  });

  it('rejects password shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/signup')
      .type('form')
      .send({ name: 'Short', email: email('short'), password: 'abc', confirmPassword: 'abc' });
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/\/signup/);
  });

  it('rejects mismatched confirmPassword', async () => {
    const res = await request(app)
      .post('/signup')
      .type('form')
      .send({ name: 'Mismatch', email: email('mm'), password: 'Password1!', confirmPassword: 'Different1!' });
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/\/signup/);
  });

  it('rejects duplicate email', async () => {
    const u = await createUser();
    const res = await request(app)
      .post('/signup')
      .type('form')
      .send({ name: 'Dup', email: u.email, password: 'Password1!', confirmPassword: 'Password1!' });
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/\/signup/);
  });
});

// ── POST /login ────────────────────────────────────────────────────────────────
describe('POST /login', () => {
  it('valid credentials → redirect to /home', async () => {
    const u   = await createUser();
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ email: u.email, password: u.password });
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/\/home/);
  });

  it('wrong password → redirect to /login', async () => {
    const u   = await createUser();
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ email: u.email, password: 'wrongpassword!!' });
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/\/login/);
  });

  it('unknown email → redirect to /login', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ email: 'nobody_ever@no.where', password: 'Password1!' });
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/\/login/);
  });

  it('missing fields → redirect to /login', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({});
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/\/login/);
  });

  it('non-onboarded user → redirect to /onboarding after login', async () => {
    const u   = await createUser({ is_onboarded: 0, floor_id: null, room_id: null });
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ email: u.email, password: u.password });
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/\/onboarding/);
  });
});

// ── GET /onboarding (guard) ────────────────────────────────────────────────────
describe('GET /onboarding', () => {
  it('redirects unauthenticated request to /login', async () => {
    const res = await request(app).get('/onboarding');
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/\/login/);
  });
});

// ── POST /onboarding ───────────────────────────────────────────────────────────
describe('POST /onboarding', () => {
  it('saves floor and room, redirects to /home', async () => {
    // Create a not-yet-onboarded user then log in
    const u     = await createUser({ is_onboarded: 0, floor_id: null, room_id: null });
    const agent = request.agent(app);

    // Login to establish session
    await agent.post('/login').type('form').send({ email: u.email, password: u.password });

    // Submit onboarding
    const res = await agent
      .post('/onboarding')
      .type('form')
      .send({ floor: 3, room: 305 });
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/\/home/);
  });

  it('rejects missing room', async () => {
    const u     = await createUser({ is_onboarded: 0, floor_id: null, room_id: null });
    const agent = request.agent(app);
    await agent.post('/login').type('form').send({ email: u.email, password: u.password });

    const res = await agent.post('/onboarding').type('form').send({ floor: 2 });
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/\/onboarding/);
  });
});

// ── GET /logout ────────────────────────────────────────────────────────────────
describe('GET /logout', () => {
  it('destroys session and redirects to /login', async () => {
    const u     = await createUser();
    const agent = request.agent(app);
    await agent.post('/login').type('form').send({ email: u.email, password: u.password });

    const res = await agent.get('/logout');
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/\/login/);

    // Confirm session is gone: /home should now redirect to /login
    const home = await agent.get('/home');
    expect([302, 303]).toContain(home.status);
    expect(home.headers.location).toMatch(/\/login/);
  });
});
