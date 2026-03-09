'use strict';
/**
 * tests/e2e/floor-speaker.spec.js
 *
 * Covers: floor-speaker dashboard, rotation page, duty override,
 * toggle-room JSON endpoint, and access control (regular student is blocked).
 */
const { test, expect } = require('@playwright/test');
const { loginAs } = require('./helpers/auth');

// ── Access control ────────────────────────────────────────────────────────────
test.describe('Floor-speaker access control', () => {
  test('regular student cannot access /floor-speaker/rotation/2', async ({ page }) => {
    await loginAs(page, 'student');
    await page.goto('/floor-speaker/rotation/2');
    // Should get 403 or redirect
    const status = await page.evaluate(() => document.readyState);
    expect(status).toBe('complete');
    const body = await page.textContent('body');
    expect(body).toMatch(/403|forbidden|not allowed|access denied|unauthorized/i);
  });

  test('unauthenticated request redirects to /login', async ({ browser }) => {
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('/floor-speaker/rotation/2');
    await expect(page).toHaveURL(/\/login/);
    await ctx.close();
  });
});

// ── Floor-speaker happy paths ─────────────────────────────────────────────────
test.describe('Floor-speaker dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'floorSpeaker');
  });

  test('floor-speaker rotation page for managed floor (2) loads', async ({ page }) => {
    await page.goto('/floor-speaker/rotation/2');
    await expect(page).not.toHaveURL(/\/login/);
    const body = await page.textContent('body');
    expect(body).toMatch(/rotation|duty|floor|etage|pflicht/i);
  });

  test('floor-speaker is blocked from a floor they do NOT manage (floor 5)', async ({ page }) => {
    await page.goto('/floor-speaker/rotation/5');
    const body = await page.textContent('body');
    expect(body).toMatch(/403|forbidden|access denied|not allowed/i);
  });

  test('override form is present on managed-floor rotation page', async ({ page }) => {
    await page.goto('/floor-speaker/rotation/2');
    const form = page.locator('form[action*="rotation"]');
    await expect(form.first()).toBeVisible();
  });

  test('toggle-room endpoint responds with JSON', async ({ page }) => {
    await page.goto('/floor-speaker/rotation/2');

    const result = await page.evaluate(async () => {
      const res = await fetch('/floor-speaker/rotation/2/toggle-room', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ roomNumber: 201 }),
      });
      return { status: res.status, body: await res.json() };
    });

    // Should return JSON with ok field (true or false depending on room existence)
    expect(typeof result.body.ok).toBe('boolean');
  });

  test('duty override POST redirects back to rotation page', async ({ page }) => {
    await page.goto('/floor-speaker/rotation/2');

    // Submit the override form with a room from floor 2
    const response = await page.evaluate(async () => {
      const res = await fetch('/floor-speaker/rotation/2', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    'overrideRoom=201',
        redirect: 'manual',
      });
      return { status: res.status, location: res.headers.get('location') };
    });

    // Expect a 302 redirect back to the rotation page
    expect([302, 303]).toContain(response.status);
    expect(response.location).toMatch(/rotation\/2/);
  });
});
