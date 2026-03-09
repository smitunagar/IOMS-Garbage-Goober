'use strict';
/**
 * tests/integration/disposal.test.js
 *
 * Integration tests for:
 *   GET  /disposal/log
 *   POST /disposal/log   (JSON body: { bins, note, photos })
 *   GET  /disposal/feed
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const request  = require('supertest');
const bcrypt   = require('bcryptjs');
const app      = require('../../server');
const { initDatabase, getDb } = require('../../config/database');

// ── Helpers ───────────────────────────────────────────────────────────────────
const TS       = Date.now();
const email    = (l) => `it_disposal_${l}_${TS}@test.ioms`;
let createdIds = [];

/** Small 1×1 transparent GIF as a base64 data-URI (tiny, always valid JPEG-ish). */
const TINY_PHOTO = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

async function createOnboardedUser() {
  const u    = { email: email(`u${Math.random().toString(36).slice(2, 6)}`), password: 'Test1234!' };
  const hash = bcrypt.hashSync(u.password, 10);
  const db   = getDb();
  const row  = await db.queryOne(
    `INSERT INTO users (email, password_hash, name, floor_id, room_id, is_admin, is_onboarded, role)
     VALUES ($1,$2,'Disposal Tester',3,305,0,1,'student') RETURNING id`,
    [u.email, hash],
  );
  createdIds.push(row.id);
  return { ...u, id: row.id };
}

/** Returns a supertest agent logged in as the given user. */
async function loggedInAgent(user) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: user.email, password: user.password });
  return agent;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────
beforeAll(() => initDatabase());

afterAll(async () => {
  const db = getDb();
  if (createdIds.length) {
    await db.run(`DELETE FROM disposal_events WHERE user_id = ANY($1::int[])`, [createdIds]);
    await db.run(`DELETE FROM users WHERE id = ANY($1::int[])`, [createdIds]);
  }
});

// ── GET /disposal/log ──────────────────────────────────────────────────────────
describe('GET /disposal/log', () => {
  it('redirects unauthenticated user to /login', async () => {
    const res = await request(app).get('/disposal/log');
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/\/login/);
  });

  it('returns 200 for authenticated + onboarded user', async () => {
    const u     = await createOnboardedUser();
    const agent = await loggedInAgent(u);
    const res   = await agent.get('/disposal/log');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/restm|papier|verpack|biom/i);
  });
});

// ── POST /disposal/log ─────────────────────────────────────────────────────────
describe('POST /disposal/log', () => {
  it('accepts valid JSON and returns {ok:true}', async () => {
    const u     = await createOnboardedUser();
    const agent = await loggedInAgent(u);

    const res = await agent
      .post('/disposal/log')
      .set('Content-Type', 'application/json')
      .send({ bins: ['restmuell'], note: 'integration test', photos: [TINY_PHOTO] });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects empty bins array', async () => {
    const u     = await createOnboardedUser();
    const agent = await loggedInAgent(u);

    const res = await agent
      .post('/disposal/log')
      .set('Content-Type', 'application/json')
      .send({ bins: [], note: '', photos: [TINY_PHOTO] });

    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects empty photos array', async () => {
    const u     = await createOnboardedUser();
    const agent = await loggedInAgent(u);

    const res = await agent
      .post('/disposal/log')
      .set('Content-Type', 'application/json')
      .send({ bins: ['papier'], note: '', photos: [] });

    expect(res.body.ok).toBe(false);
  });

  it('accepts multiple bins and multiple photos', async () => {
    const u     = await createOnboardedUser();
    const agent = await loggedInAgent(u);

    const res = await agent
      .post('/disposal/log')
      .set('Content-Type', 'application/json')
      .send({
        bins:   ['restmuell', 'papier'],
        note:   'multi-bin test',
        photos: [TINY_PHOTO, TINY_PHOTO],
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 401 / redirect for unauthenticated POST', async () => {
    const res = await request(app)
      .post('/disposal/log')
      .set('Content-Type', 'application/json')
      .send({ bins: ['restmuell'], note: '', photos: [TINY_PHOTO] });

    // Either a redirect (302) or 401
    expect([302, 303, 401]).toContain(res.status);
  });
});

// ── GET /disposal/feed ─────────────────────────────────────────────────────────
describe('GET /disposal/feed', () => {
  it('returns 200 for authenticated user', async () => {
    const u     = await createOnboardedUser();
    const agent = await loggedInAgent(u);
    const res   = await agent.get('/disposal/feed');
    expect(res.status).toBe(200);
  });

  it('redirects unauthenticated user to /login', async () => {
    const res = await request(app).get('/disposal/feed');
    expect([302, 303]).toContain(res.status);
    expect(res.headers.location).toMatch(/\/login/);
  });

  it('accepts pagination query param ?page=1', async () => {
    const u     = await createOnboardedUser();
    const agent = await loggedInAgent(u);
    const res   = await agent.get('/disposal/feed?page=1');
    expect(res.status).toBe(200);
  });
});
