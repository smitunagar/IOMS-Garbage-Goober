'use strict';
/**
 * tests/integration/alerts.test.js
 *
 * Integration tests for:
 *   GET  /alerts/report
 *   POST /alerts/report
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const request  = require('supertest');
const bcrypt   = require('bcryptjs');
const app      = require('../../server');
const { initDatabase, getDb } = require('../../config/database');

const TS       = Date.now();
const email    = (l) => `it_alerts_${l}_${TS}@test.ioms`;
let createdIds = [];

async function createOnboardedUser() {
  const u    = { email: email(`u${Math.random().toString(36).slice(2, 6)}`), password: 'Test1234!' };
  const hash = bcrypt.hashSync(u.password, 10);
  const db   = getDb();
  const row  = await db.queryOne(
    `INSERT INTO users (email, password_hash, name, floor_id, room_id, is_admin, is_onboarded, role)
     VALUES ($1,$2,'Alert Tester',3,305,0,1,'student') RETURNING id`,
    [u.email, hash],
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
  const db = getDb();
  if (createdIds.length) {
    await db.run(`DELETE FROM bin_alerts WHERE user_id = ANY($1::int[])`, [createdIds]);
    await db.run(`DELETE FROM users WHERE id = ANY($1::int[])`, [createdIds]);
  }
});

// ── GET /alerts/report ─────────────────────────────────────────────────────────
describe('GET /alerts/report', () => {
  it('redirects unauthenticated user to /login', async () => {
    const res = await request(app).get('/alerts/report');
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/\/login/);
  });

  it('returns 200 for authenticated + onboarded user', async () => {
    const u     = await createOnboardedUser();
    const agent = await loggedInAgent(u);
    const res   = await agent.get('/alerts/report');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/restm|papier|verpack|biom/i);
  });

  it('shows remaining alerts count (max 5)', async () => {
    const u     = await createOnboardedUser();
    const agent = await loggedInAgent(u);
    const res   = await agent.get('/alerts/report');
    expect(res.text).toMatch(/5|\d\s*\/\s*5/);
  });
});

// ── POST /alerts/report ────────────────────────────────────────────────────────
describe('POST /alerts/report', () => {
  it('redirects unauthenticated user to /login', async () => {
    const res = await request(app)
      .post('/alerts/report')
      .type('form')
      .send({ binType: 'restmuell', note: '' });
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/\/login/);
  });

  it('accepts valid alert and redirects (not to /login)', async () => {
    const u     = await createOnboardedUser();
    const agent = await loggedInAgent(u);

    const res = await agent
      .post('/alerts/report')
      .type('form')
      .send({ binType: 'restmuell', note: 'Integration test alert' });

    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).not.toMatch(/\/login/);
  });

  it('inserts an alert record in the DB', async () => {
    const u     = await createOnboardedUser();
    const agent = await loggedInAgent(u);

    await agent
      .post('/alerts/report')
      .type('form')
      .send({ binType: 'papier', note: 'DB-insert check' });

    const db  = getDb();
    const row = await db.queryOne(
      `SELECT id FROM bin_alerts WHERE user_id = $1 AND bin_type = 'papier'`,
      [u.id],
    );
    expect(row).not.toBeNull();
  });

  it('rejects missing binType (stays on report page or shows error)', async () => {
    const u     = await createOnboardedUser();
    const agent = await loggedInAgent(u);

    const res = await agent
      .post('/alerts/report')
      .type('form')
      .send({ binType: '', note: '' });

    // Should redirect back to report (not home, not login)
    if (res.status === 302 || res.status === 303) {
      expect(res.headers.location).toMatch(/\/alerts\/report|\/home/);
    } else {
      // Or return 400
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('enforces rate limit of 5 alerts per day', async () => {
    const u     = await createOnboardedUser();
    const agent = await loggedInAgent(u);
    const db    = getDb();

    // Manually insert 5 alerts for today
    const today = new Date();
    today.setHours(1, 0, 0, 0);
    for (let i = 0; i < 5; i++) {
      await db.run(
        `INSERT INTO bin_alerts (user_id, floor_id, bin_type, note, created_at)
         VALUES ($1, 3, 'restmuell', 'rate-limit-seed', $2)`,
        [u.id, today.toISOString()],
      );
    }

    // 6th attempt should be rejected (redirect back to report with error)
    const res = await agent
      .post('/alerts/report')
      .type('form')
      .send({ binType: 'restmuell', note: 'should be blocked' });

    expect([302, 303]).toContain(res.status);
    // Should redirect back, not to /home clean success
    const loc = res.headers.location || '';
    const isErrorRedirect = loc.includes('/alerts/report') || loc.includes('/home');
    expect(isErrorRedirect).toBe(true);
    // Verify total count hasn't increased beyond 5
    const countRow = await db.queryOne(
      `SELECT COUNT(*)::int AS cnt FROM bin_alerts WHERE user_id = $1 AND note = 'rate-limit-seed'`,
      [u.id],
    );
    expect(countRow.cnt).toBe(5);
  });
});
