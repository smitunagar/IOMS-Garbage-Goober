'use strict';
/**
 * tests/e2e/disposal.spec.js
 *
 * Covers: GET /disposal/log UI, submitting a disposal entry,
 * photo validation, and the disposal feed page.
 */
const { test, expect } = require('@playwright/test');
const { loginAs } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAs(page, 'student');
});

// ── GET /disposal/log ─────────────────────────────────────────────────────────
test('disposal log page loads', async ({ page }) => {
  await page.goto('/disposal/log');
  await expect(page).toHaveURL(/\/disposal\/log/);
  const body = await page.textContent('body');
  expect(body).toMatch(/disposal|entsorgen|bin|müll/i);
});

test('disposal page shows bin type options', async ({ page }) => {
  await page.goto('/disposal/log');
  // Should show at least one bin type (restmuell / papier / verpackung / biomuell)
  const body = await page.textContent('body');
  expect(body).toMatch(/restm|papier|verpack|biom/i);
});

test('unauthenticated access to /disposal/log redirects to /login', async ({ browser }) => {
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/disposal/log');
  await expect(page).toHaveURL(/\/login/);
  await ctx.close();
});

// ── POST /disposal/log (via fetch API) ────────────────────────────────────────
test('submitting a valid disposal entry returns {ok:true}', async ({ page }) => {
  await page.goto('/disposal/log');

  // Build a 1×1 pixel JPEG data-URI for the required photo
  const tinyBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    return canvas.toDataURL('image/jpeg', 0.5);
  });

  const response = await page.evaluate(async (photoUri) => {
    const res = await fetch('/disposal/log', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        bins:   ['restmuell'],
        note:   'E2E test disposal',
        photos: [photoUri],
      }),
    });
    return res.json();
  }, tinyBase64);

  expect(response.ok).toBe(true);
});

test('disposal log requires at least one bin', async ({ page }) => {
  await page.goto('/disposal/log');

  const response = await page.evaluate(async () => {
    const res = await fetch('/disposal/log', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ bins: [], note: '', photos: ['data:image/jpeg;base64,/9j/4A=='] }),
    });
    return res.json();
  });

  expect(response.ok).toBe(false);
});

test('disposal log requires at least one photo', async ({ page }) => {
  await page.goto('/disposal/log');

  const response = await page.evaluate(async () => {
    const res = await fetch('/disposal/log', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ bins: ['papier'], note: '', photos: [] }),
    });
    return res.json();
  });

  expect(response.ok).toBe(false);
});

// ── GET /disposal/feed ────────────────────────────────────────────────────────
test('disposal feed page loads', async ({ page }) => {
  await page.goto('/disposal/feed');
  await expect(page).toHaveURL(/\/disposal\/feed/);
  const body = await page.textContent('body');
  expect(body).toMatch(/feed|disposal|photo|log/i);
});

test('disposal feed paginates with ?page param', async ({ page }) => {
  await page.goto('/disposal/feed?page=1');
  await expect(page).toHaveURL(/\/disposal\/feed/);
  // Should render without error
  await expect(page.locator('body')).not.toContainText(/error|500/i);
});
