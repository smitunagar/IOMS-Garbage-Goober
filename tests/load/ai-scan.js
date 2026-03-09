/**
 * tests/load/ai-scan.js
 *
 * k6 load test – POST /api/scan-waste under moderate concurrency.
 *
 * Because the endpoint calls Gemini (external API), this test uses a very
 * small number of VUs and a long duration to avoid overwhelming the quota.
 *
 * Run:
 *   k6 run tests/load/ai-scan.js
 *   k6 run --env BASE_URL=https://ioms-garbage-goober.vercel.app tests/load/ai-scan.js
 *
 * Note: GEMINI_API_KEY must be set server-side. If it is not configured the
 * endpoint returns {ok:false, error:'AI scanner not configured'} with 503,
 * and the test will record those as expected-503 (non-failures in this context).
 */
import http    from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate   = new Rate('scan_errors');
const scanLatency = new Trend('scan_duration_ms', true);

export const options = {
  vus:      2,
  duration: '30s',
  thresholds: {
    scan_errors:   ['rate<0.10'],     // allow up to 10 % (quota / cold-start)
    scan_duration_ms: ['p(90)<10000'],// AI latency can be high
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// A minimal valid JPEG: 1×1 white pixel encoded as base64 → raw binary
// k6's http module requires binary data via ArrayBuffer for multipart
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
  'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEB' +
  'AxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAA' +
  'AAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJQAAP/Z';

export function setup() {
  // Login once and return the session cookie for all VUs
  const res = http.post(
    `${BASE_URL}/login`,
    { email: 'e2e_student@test', password: 'Student123!' },
    { redirects: 0 },
  );
  const setCookie = res.headers['Set-Cookie'];
  if (!setCookie) return { cookie: '' };
  const m = (Array.isArray(setCookie) ? setCookie[0] : setCookie).match(/connect\.sid=[^;]+/);
  return { cookie: m ? m[0] : '' };
}

export default function (data) {
  if (!data.cookie) { sleep(2); return; }

  group('POST /api/scan-waste', () => {
    // Build multipart form data with a tiny JPEG image
    const formData = {
      image: http.file(
        // k6 needs raw bytes; decode base64 → binary string → Uint8Array
        new Uint8Array(
          atob(TINY_JPEG_B64).split('').map((c) => c.charCodeAt(0))
        ).buffer,
        'test.jpg',
        'image/jpeg',
      ),
    };

    const res = http.post(`${BASE_URL}/api/scan-waste`, formData, {
      headers: { Cookie: data.cookie },
    });

    scanLatency.add(res.timings.duration);

    const ok = check(res, {
      'status 200 or 503': (r) => r.status === 200 || r.status === 503,
      'body is JSON':       (r) => {
        try { JSON.parse(r.body); return true; } catch (_) { return false; }
      },
    });
    errorRate.add(!ok);
  });

  sleep(Math.random() * 5 + 3); // 3–8 s between scans (respect rate limits)
}
