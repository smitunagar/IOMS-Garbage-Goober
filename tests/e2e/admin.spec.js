'use strict';
/**
 * tests/e2e/admin.spec.js
 *
 * Covers: admin dashboard, per-floor rotation page, anchor-date save,
 * duty override, toggle-room, and access control for non-admins.
 */
const { test, expect } = require('@playwright/test');
const { loginAs } = require('./helpers/auth');

// ── Access control ────────────────────────────────────────────────────────────
test.describe('Admin access control', () => {
  test('regular student is denied /admin', async ({ page }) => {
    await loginAs(page, 'student');
    await page.goto('/admin');
    const body = await page.textContent('body');
    expect(body).toMatch(/403|forbidden|not allowed|access denied/i);
  });

  test('unauthenticated request to /admin redirects to /login', async ({ browser }) => {
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
    await ctx.close();
  });
});

// ── Admin happy paths ─────────────────────────────────────────────────────────
test.describe('Admin dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin');
  });

  test('admin dashboard loads at /admin', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin/);
    const body = await page.textContent('body');
    expect(body).toMatch(/floor|etage|rotation|admin/i);
  });

  test('floor 1 rotation page loads', async ({ page }) => {
    await page.goto('/admin/rotation/1');
    await expect(page).not.toHaveURL(/\/login/);
    const body = await page.textContent('body');
    expect(body).toMatch(/rotation|duty|floor 1|etage 1/i);
  });

  test('floor rotation page shows current duty room', async ({ page }) => {
    await page.goto('/admin/rotation/1');
    // Page should contain a 3-digit room number (e.g. 101)
    const body = await page.textContent('body');
    expect(body).toMatch(/1\d{2}/);
  });

  test('anchor-date form is present', async ({ page }) => {
    await page.goto('/admin/rotation/1');
    const anchorInput = page.locator('[name="anchorDate"]');
    await expect(anchorInput).toBeVisible();
  });

  test('override-room form field is present', async ({ page }) => {
    await page.goto('/admin/rotation/1');
    const overrideInput = page.locator('[name="overrideRoom"]');
    await expect(overrideInput).toBeVisible();
  });

  test('duty override POST redirects back to rotation page', async ({ page }) => {
    await page.goto('/admin/rotation/1');

    const result = await page.evaluate(async () => {
      const res = await fetch('/admin/rotation/1', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    'overrideRoom=101',
        redirect: 'manual',
      });
      return { status: res.status, location: res.headers.get('location') };
    });

    expect([302, 303]).toContain(result.status);
    expect(result.location).toMatch(/rotation\/1/);
  });

  test('toggle-room JSON endpoint returns {ok, isActive}', async ({ page }) => {
    await page.goto('/admin/rotation/1');

    const result = await page.evaluate(async () => {
      const res = await fetch('/admin/rotation/1/toggle-room', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ roomNumber: 101 }),
      });
      return { status: res.status, body: await res.json() };
    });

    expect(result.status).toBe(200);
    expect(typeof result.body.ok).toBe('boolean');
    if (result.body.ok) {
      expect(typeof result.body.isActive).toBe('boolean');
    }
  });

  test('invalid floorId redirects to /admin', async ({ page }) => {
    await page.goto('/admin/rotation/99');
    await expect(page).toHaveURL(/\/admin/);
  });
});
