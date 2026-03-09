/**
 * tests/load/stress_200.js
 *
 * k6 stress test – simulates 200 concurrent users hitting all critical
 * app flows simultaneously to find the breaking point.
 *
 * Stages:
 *   0  →  50 VUs  over 30 s  (warm-up)
 *   50 → 200 VUs  over 60 s  (ramp to full load)
 *   200 VUs       for  2 m   (sustained peak load)
 *   200 →   0 VUs over 30 s  (cool-down)
 *
 * Total runtime: ~4 minutes
 *
 * Run:
 *   ~/k6 run --env BASE_URL=http://localhost:3000 tests/load/stress_200.js
 */
import http    from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ── Custom metrics ────────────────────────────────────────────────────────────
const errorRate      = new Rate('errors');
const loginTime      = new Trend('login_duration_ms',   true);
const homeTime       = new Trend('home_duration_ms',    true);
const disposalGetMs  = new Trend('disposal_get_ms',     true);
const disposalPostMs = new Trend('disposal_post_ms',    true);
const feedMs         = new Trend('feed_duration_ms',    true);
const totalRequests  = new Counter('total_requests');
const failedRequests = new Counter('failed_requests');

// ── Test options ──────────────────────────────────────────────────────────────
export const options = {
  stages: [
    { duration: '30s',  target: 50  },   // warm-up
    { duration: '60s',  target: 200 },   // ramp to 200 users
    { duration: '2m',   target: 200 },   // hold at 200 users
    { duration: '30s',  target: 0   },   // cool-down
  ],

  thresholds: {
    // Overall request latency under 200-user load
    http_req_duration:  ['p(95)<6000', 'p(99)<10000'],

    // Error rate must stay below 5 %
    errors:             ['rate<0.05'],

    // Individual flow thresholds (relaxed for 200-user stress)
    login_duration_ms:  ['p(90)<3000'],
    home_duration_ms:   ['p(90)<6000'],
    disposal_post_ms:   ['p(90)<6000'],
    feed_duration_ms:   ['p(90)<6000'],

    // No more than 10 % of requests should fail
    http_req_failed:    ['rate<0.10'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Spread load across all seeded + admin accounts
const USERS = [
  { email: 'e2e_student@test', password: 'Student123!' },
  { email: 'e2e_fs@test',      password: 'FloorSp123!' },
  { email: 'e2e_new@test',     password: 'NewUser123!' },
  { email: 'admin@ioms.de',    password: 'admin123'    },
];

// Tiny 1×1 GIF – valid image payload for disposal POST
const TINY_PHOTO = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const BIN_TYPES  = ['restmuell', 'papier', 'verpackung', 'biomuell'];

// Each VU picks a random flow weight so not everyone does the same thing
const FLOWS = ['browse', 'browse', 'browse', 'log_disposal', 'browse', 'feed'];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Helper: login and return session cookie ───────────────────────────────────
function doLogin(user) {
  const res = http.post(
    `${BASE_URL}/login`,
    { email: user.email, password: user.password },
    { redirects: 0 },
  );
  loginTime.add(res.timings.duration);
  totalRequests.add(1);

  const ok = check(res, {
    'login: 302/303':             (r) => r.status === 302 || r.status === 303,
    'login: redirects correctly': (r) =>
      (r.headers['Location'] || '').match(/\/(home|onboarding)/) !== null,
  });

  errorRate.add(!ok);
  if (!ok) failedRequests.add(1);

  const setCookie = res.headers['Set-Cookie'];
  if (!setCookie) return null;
  const m = (Array.isArray(setCookie) ? setCookie[0] : setCookie).match(/connect\.sid=[^;]+/);
  return m ? m[0] : null;
}

// ── Main scenario ─────────────────────────────────────────────────────────────
export default function () {
  const user   = randomItem(USERS);
  const cookie = doLogin(user);

  if (!cookie) {
    sleep(1);
    return;
  }

  const headers = { Cookie: cookie };

  // ── Home / dashboard ──────────────────────────────────────────────────────
  group('GET /home', () => {
    const res = http.get(`${BASE_URL}/home`, { headers });
    homeTime.add(res.timings.duration);
    totalRequests.add(1);
    const ok = check(res, { 'home: 200': (r) => r.status === 200 });
    errorRate.add(!ok);
    if (!ok) failedRequests.add(1);
  });

  sleep(Math.random() * 1 + 0.5);   // 0.5–1.5 s think time

  // ── Pick a random secondary flow ──────────────────────────────────────────
  const flow = randomItem(FLOWS);

  if (flow === 'log_disposal') {
    // GET disposal form
    group('GET /disposal/log', () => {
      const res = http.get(`${BASE_URL}/disposal/log`, { headers });
      disposalGetMs.add(res.timings.duration);
      totalRequests.add(1);
      const ok = check(res, { 'disposal/log: 200': (r) => r.status === 200 });
      errorRate.add(!ok);
      if (!ok) failedRequests.add(1);
    });

    sleep(Math.random() * 1 + 0.5);

    // POST a disposal entry
    group('POST /disposal/log', () => {
      const payload = JSON.stringify({
        bins:   [randomItem(BIN_TYPES)],
        note:   `stress-test VU-${__VU}`,
        photos: [TINY_PHOTO],
      });
      const res = http.post(`${BASE_URL}/disposal/log`, payload, {
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
      disposalPostMs.add(res.timings.duration);
      totalRequests.add(1);
      const ok = check(res, {
        'disposal POST: 200':     (r) => r.status === 200,
        'disposal POST: ok:true': (r) => {
          try { return JSON.parse(r.body).ok === true; } catch (_) { return false; }
        },
      });
      errorRate.add(!ok);
      if (!ok) failedRequests.add(1);
    });

  } else if (flow === 'feed') {
    group('GET /disposal/feed', () => {
      const res = http.get(`${BASE_URL}/disposal/feed`, { headers });
      feedMs.add(res.timings.duration);
      totalRequests.add(1);
      const ok = check(res, { 'feed: 200': (r) => r.status === 200 });
      errorRate.add(!ok);
      if (!ok) failedRequests.add(1);
    });

  } else {
    // 'browse' – check alerts/report page
    group('GET /alerts/report', () => {
      const res = http.get(`${BASE_URL}/alerts/report`, { headers });
      totalRequests.add(1);
      const ok = check(res, { 'alerts: 200': (r) => r.status === 200 });
      errorRate.add(!ok);
      if (!ok) failedRequests.add(1);
    });
  }

  sleep(Math.random() * 2 + 1);   // 1–3 s think time between iterations
}
