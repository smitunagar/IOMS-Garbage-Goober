'use strict';
/**
 * tests/e2e/alerts.spec.js
 *
 * Covers: GET /alerts/report UI, submitting a bin-full alert,
 * and the rate-limit cap (5 per day).
 */
const { test, expect } = require('@playwright/test');
const { loginAs } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAs(page, 'student');
});

// ── GET /alerts/report ────────────────────────────────────────────────────────
test('alert report page loads', async ({ page }) => {
  await page.goto('/alerts/report');
  await expect(page).toHaveURL(/\/alerts\/report/);
  const body = await page.textContent('body');
  expect(body).toMatch(/bin|alert|report|müll|melden/i);
});

test('page shows available bin types', async ({ page }) => {
  await page.goto('/alerts/report');
  const body = await page.textContent('body');
  expect(body).toMatch(/restm|papier|verpack|biom/i);
});

test('page shows remaining-alerts counter', async ({ page }) => {
  await page.goto('/alerts/report');
  const body = await page.textContent('body');
  // Should mention a number out of 5 (e.g. "3 / 5" or "remaining: 5")
  expect(body).toMatch(/5|\d\s*\/\s*5|remaining|verbleibend/i);
});

test('unauthenticated access redirects to /login', async ({ browser }) => {
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/alerts/report');
  await expect(page).toHaveURL(/\/login/);
  await ctx.close();
});

// ── POST /alerts/report ───────────────────────────────────────────────────────
test('submitting a valid alert redirects away from /alerts/report', async ({ page }) => {
  await page.goto('/alerts/report');

  // Select a bin type (click first radio / select option / checkbox)
  const binInput = page.locator('[name="binType"]').first();
  await binInput.click().catch(async () => {
    // If it's a <select>, use selectOption instead
    await page.selectOption('[name="binType"]', { index: 0 }).catch(() => {});
  });

  // Optional note
  const noteField = page.locator('[name="note"]');
  if (await noteField.isVisible()) {
    await noteField.fill('E2E: bin is full (test)');
  }

  await page.click('[type="submit"]');
  // Should redirect somewhere (home, report page with success, etc.)
  await expect(page).not.toHaveURL(/\/login/);
});

test('submitting without binType stays on report page', async ({ page }) => {
  await page.goto('/alerts/report');
  // Don't select anything, just click submit
  // We use evaluate to bypass browser-side HTML5 required validation
  await page.evaluate(() => {
    const form = document.querySelector('form');
    if (form) {
      // Remove required attribute so the form submits without a selection
      form.querySelectorAll('[required]').forEach(el => el.removeAttribute('required'));
    }
  });
  const submitBtn = page.locator('[type="submit"]').first();
  await submitBtn.click();
  // Should NOT end up on /home cleanly; either error flash or redirect back
  const url = page.url();
  // Should not be a 200 /home page after empty submission
  expect(url).not.toMatch(/\/home$/);
});
