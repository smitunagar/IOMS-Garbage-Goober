/**
 * tests/load/smoke.js
 *
 * k6 smoke test – runs a small number of VUs across the critical flows
 * to verify the app handles basic load without errors.
 *
 * Run: k6 run tests/load/smoke.js
 *      k6 run --env BASE_URL=https://ioms-garbage-goober.vercel.app tests/load/smoke.js
 */
import http    from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ── Custom metrics ────────────────────────────────────────────────────────────
const errorRate  = new Rate('errors');
const loginTime  = new Trend('login_duration', true);
const homeTime   = new Trend('home_duration', true);

// ── Options ───────────────────────────────────────────────────────────────────
export const options = {
  vus:      5,
  duration: '30s',
  thresholds: {
    http_req_duration:  ['p(95)<3000'],   // 95 % of all requests < 3 s
    errors:             ['rate<0.05'],    // < 5 % error rate
    login_duration:     ['p(95)<2000'],
    home_duration:      ['p(95)<2500'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// ── Shared credentials (seeded via npm run test:seed) ─────────────────────────
const STUDENT = { email: 'e2e_student@test', password: 'Student123!' };

// ── Scenario ──────────────────────────────────────────────────────────────────
export default function () {
  let sessionCookie = '';

  // ── 1. Login ─────────────────────────────────────────────────────────────
  group('login', () => {
    const loginRes = http.post(
      `${BASE_URL}/login`,
      { email: STUDENT.email, password: STUDENT.password },
      { redirects: 0 },
    );
    loginTime.add(loginRes.timings.duration);

    const ok = check(loginRes, {
      'login redirects (302/303)': (r) => r.status === 302 || r.status === 303,
      'redirects to /home or /onboarding': (r) =>
        (r.headers['Location'] || '').match(/\/(home|onboarding)/) !== null,
    });
    errorRate.add(!ok);

    // Extract the session cookie for subsequent requests
    const cookieHeader = loginRes.headers['Set-Cookie'];
    if (cookieHeader) {
      const match = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)
        .match(/connect\.sid=[^;]+/);
      if (match) sessionCookie = match[0];
    }
  });

  if (!sessionCookie) { sleep(1); return; }

  const headers = { Cookie: sessionCookie };

  // ── 2. Home / Dashboard ───────────────────────────────────────────────────
  group('home', () => {
    const res = http.get(`${BASE_URL}/home`, { headers });
    homeTime.add(res.timings.duration);
    const ok = check(res, {
      'home returns 200': (r) => r.status === 200,
    });
    errorRate.add(!ok);
  });

  // ── 3. Disposal log page ──────────────────────────────────────────────────
  group('disposal_log_page', () => {
    const res = http.get(`${BASE_URL}/disposal/log`, { headers });
    const ok  = check(res, {
      'disposal/log returns 200': (r) => r.status === 200,
    });
    errorRate.add(!ok);
  });

  // ── 4. Alerts report page ─────────────────────────────────────────────────
  group('alerts_page', () => {
    const res = http.get(`${BASE_URL}/alerts/report`, { headers });
    const ok  = check(res, {
      'alerts/report returns 200': (r) => r.status === 200,
    });
    errorRate.add(!ok);
  });

  // ── 5. Disposal feed ──────────────────────────────────────────────────────
  group('disposal_feed', () => {
    const res = http.get(`${BASE_URL}/disposal/feed`, { headers });
    const ok  = check(res, {
      'disposal/feed returns 200': (r) => r.status === 200,
    });
    errorRate.add(!ok);
  });

  sleep(1);
}
