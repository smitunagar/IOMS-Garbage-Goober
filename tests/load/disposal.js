/**
 * tests/load/disposal.js
 *
 * k6 load test – full disposal-logging flow under load:
 *   1. Login  → get session cookie
 *   2. GET /disposal/log
 *   3. POST /disposal/log  (JSON, tiny base64 photo)
 *
 * Run:
 *   k6 run tests/load/disposal.js
 *   k6 run --env BASE_URL=https://ioms-garbage-goober.vercel.app tests/load/disposal.js
 */
import http    from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import encoding from 'k6/encoding';

const errorRate      = new Rate('disposal_errors');
const loginDuration  = new Trend('login_duration_ms',   true);
const postDuration   = new Trend('disposal_post_ms',    true);

export const options = {
  stages: [
    { duration: '20s', target: 5 },
    { duration: '60s', target: 5 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    disposal_errors:   ['rate<0.05'],
    disposal_post_ms:  ['p(90)<4000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Tiny 1×1 GIF as a base64 data-URI (valid image for the server-side check)
const TINY_PHOTO = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

const BIN_TYPES = ['restmuell', 'papier', 'verpackung', 'biomuell'];

function randomBin() {
  return BIN_TYPES[Math.floor(Math.random() * BIN_TYPES.length)];
}

export default function () {
  // ── 1. Login ────────────────────────────────────────────────────────────
  let sessionCookie = '';
  group('login', () => {
    const res = http.post(
      `${BASE_URL}/login`,
      { email: 'e2e_student@test', password: 'Student123!' },
      { redirects: 0 },
    );
    loginDuration.add(res.timings.duration);

    check(res, { 'login 302/303': (r) => r.status === 302 || r.status === 303 });

    const setCookie = res.headers['Set-Cookie'];
    if (setCookie) {
      const m = (Array.isArray(setCookie) ? setCookie[0] : setCookie).match(/connect\.sid=[^;]+/);
      if (m) sessionCookie = m[0];
    }
  });

  if (!sessionCookie) { sleep(1); return; }

  const headers = {
    Cookie:         sessionCookie,
    'Content-Type': 'application/json',
  };

  // ── 2. Load disposal form ─────────────────────────────────────────────────
  group('GET /disposal/log', () => {
    const res = http.get(`${BASE_URL}/disposal/log`, { headers: { Cookie: sessionCookie } });
    check(res, { 'disposal/log 200': (r) => r.status === 200 });
  });

  // ── 3. Submit a disposal entry ────────────────────────────────────────────
  group('POST /disposal/log', () => {
    const payload = JSON.stringify({
      bins:   [randomBin()],
      note:   'k6 load test',
      photos: [TINY_PHOTO],
    });

    const res = http.post(`${BASE_URL}/disposal/log`, payload, { headers });
    postDuration.add(res.timings.duration);

    const ok = check(res, {
      'disposal POST 200':    (r) => r.status === 200,
      'response ok:true':     (r) => {
        try { return JSON.parse(r.body).ok === true; } catch (_) { return false; }
      },
    });
    errorRate.add(!ok);
  });

  sleep(Math.random() * 3 + 1);
}
