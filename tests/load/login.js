/**
 * tests/load/login.js
 *
 * k6 load test – login endpoint under sustained concurrency.
 *
 * Run:
 *   k6 run tests/load/login.js
 *   k6 run --env BASE_URL=https://ioms-garbage-goober.vercel.app tests/load/login.js
 *
 * Stages:
 *   0 → 10 VUs over  30s  (ramp-up)
 *   10 VUs for        60s  (steady state)
 *   10 → 0 VUs over  20s  (ramp-down)
 */
import http    from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const errorRate     = new Rate('login_errors');
const loginDuration = new Trend('login_duration_ms', true);
const loginSuccess  = new Counter('login_success');
const loginFail     = new Counter('login_fail');

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '60s', target: 10 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000', 'p(99)<5000'],
    login_errors:      ['rate<0.02'],       // < 2 % errors
    login_duration_ms: ['p(90)<2000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Valid credentials – must exist in the DB (run test:seed first)
const USERS = [
  { email: 'e2e_student@test',  password: 'Student123!' },
  { email: 'e2e_fs@test',       password: 'FloorSp123!' },
  { email: 'admin@ioms.de',     password: 'admin123'    },
];

export default function () {
  const user = USERS[Math.floor(Math.random() * USERS.length)];

  group('POST /login', () => {
    const res = http.post(
      `${BASE_URL}/login`,
      { email: user.email, password: user.password },
      { redirects: 0 },
    );

    loginDuration.add(res.timings.duration);

    const ok = check(res, {
      'status is 302 or 303':          (r) => r.status === 302 || r.status === 303,
      'redirects to /home or /onboard': (r) =>
        (r.headers['Location'] || '').match(/\/(home|onboarding)/) !== null,
    });

    if (ok) {
      loginSuccess.add(1);
    } else {
      loginFail.add(1);
    }
    errorRate.add(!ok);
  });

  sleep(Math.random() * 2 + 0.5); // 0.5 – 2.5 s think time
}
