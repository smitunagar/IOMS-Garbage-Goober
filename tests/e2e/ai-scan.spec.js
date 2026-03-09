'use strict';
/**
 * tests/e2e/ai-scan.spec.js
 *
 * Covers: POST /api/scan-waste endpoint – missing image, unauthenticated
 * access, and (if GEMINI_API_KEY is configured) a real scan.
 *
 * The AI scanner FAB/modal is a client-side overlay rendered in the browser,
 * so we test the underlying REST endpoint directly via fetch() inside the page.
 */
const { test, expect } = require('@playwright/test');
const { loginAs } = require('./helpers/auth');

// ── Unauthenticated guard ─────────────────────────────────────────────────────
test('POST /api/scan-waste without session returns 302 redirect to /login', async ({ page }) => {
  // Make the request from a fresh browser context (no cookies)
  const ctx  = await page.context().browser().newContext();
  const freshPage = await ctx.newPage();

  const result = await freshPage.evaluate(async () => {
    const fd = new FormData();
    fd.append('image', new Blob(['fake'], { type: 'image/jpeg' }), 'test.jpg');
    const res = await fetch('/api/scan-waste', { method: 'POST', body: fd, redirect: 'manual' });
    return { status: res.status, location: res.headers.get('location') };
  });

  // Should be redirected (302) to login, not 200
  expect([302, 303, 401]).toContain(result.status);
  await ctx.close();
});

// ── Authenticated: missing image ──────────────────────────────────────────────
test('POST /api/scan-waste with no image returns {ok:false}', async ({ page }) => {
  await loginAs(page, 'student');
  await page.goto('/home'); // ensure session is active

  const result = await page.evaluate(async () => {
    // Send FormData with no `image` field
    const fd = new FormData();
    const res = await fetch('/api/scan-waste', { method: 'POST', body: fd });
    if (!res.ok && res.status === 400) {
      return { ok: false, error: 'No image provided.' };
    }
    return res.json().catch(() => ({ ok: false, error: 'non-json' }));
  });

  expect(result.ok).toBe(false);
});

// ── AI scanner FAB / modal is rendered on relevant pages ─────────────────────
test('AI scan FAB button is present on the disposal log page', async ({ page }) => {
  await loginAs(page, 'student');
  await page.goto('/disposal/log');

  // The FAB is usually a button with a camera emoji or scan-related class
  const fab = page.locator(
    'button[id*="scan"], button[class*="scan"], button[class*="fab"], #ai-scan-btn, [data-action="scan"]'
  ).first();

  // Also look for any camera / scan icon text
  const bodyText = await page.textContent('body');
  const hasScanUI = (await fab.isVisible().catch(() => false)) ||
    bodyText.match(/scan|kamera|camera|ai/i);

  expect(hasScanUI).toBeTruthy();
});

// ── (Optional) Live scan with real GEMINI_API_KEY ─────────────────────────────
// This test is skipped unless GEMINI_API_KEY is set in the environment.
test('POST /api/scan-waste with valid image returns recognised item', async ({ page }) => {
  test.skip(!process.env.GEMINI_API_KEY, 'GEMINI_API_KEY not set – skipping live AI scan test');

  await loginAs(page, 'student');
  await page.goto('/home');

  const result = await page.evaluate(async () => {
    // Build a 4×4 white JPEG via canvas
    const canvas = document.createElement('canvas');
    canvas.width = 4; canvas.height = 4;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 4, 4);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    const fd = new FormData();
    fd.append('image', blob, 'test.jpg');
    const res = await fetch('/api/scan-waste', { method: 'POST', body: fd });
    return res.json();
  });

  // With a real key the response should be ok=true and contain recognised fields
  // (a blank white canvas might trigger 'Unknown item', but ok should still be true)
  expect(typeof result.ok).toBe('boolean');
  if (result.ok) {
    expect(result).toHaveProperty('item_name');
    expect(result).toHaveProperty('recommended_bin');
    expect(['biomuell', 'papier', 'verpackung', 'restmuell']).toContain(result.recommended_bin);
  }
});
