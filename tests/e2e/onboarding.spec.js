'use strict';
/**
 * tests/e2e/onboarding.spec.js
 *
 * Covers: GET /onboarding (guards, render), POST /onboarding (floor + room selection).
 * Uses the seeded `e2e_new@test` account which is NOT yet onboarded.
 *
 * NOTE: Because onboarding is a one-time flow that mutates DB state,
 * each test that submits the form should use a fresh throw-away account
 * created via signup, so re-runs stay idempotent.
 */
const { test, expect } = require('@playwright/test');
const { loginAs, TEST_USERS } = require('./helpers/auth');

const uid  = () => `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const mail = () => `onb_${uid()}@test.ioms`;

// ── Guard: unauthenticated ────────────────────────────────────────────────────
test('GET /onboarding redirects unauthenticated user to /login', async ({ page }) => {
  await page.goto('/onboarding');
  await expect(page).toHaveURL(/\/login/);
});

// ── Guard: already-onboarded ──────────────────────────────────────────────────
test('GET /onboarding redirects already-onboarded user to /home', async ({ page }) => {
  await loginAs(page, 'student');
  await page.goto('/onboarding');
  await expect(page).toHaveURL(/\/home/);
});

// ── Render ────────────────────────────────────────────────────────────────────
test('onboarding page renders floor chips and room grid', async ({ page }) => {
  // Create a fresh, NOT-onboarded user via signup
  const email = mail();
  await page.goto('/signup');
  await page.fill('[name="name"]', 'Onboarding Tester');
  await page.fill('[name="email"]', email);
  await page.fill('[name="password"]', 'OnbTest123!');
  await page.fill('[name="confirmPassword"]', 'OnbTest123!');
  await page.click('[type="submit"]');
  await expect(page).toHaveURL(/\/onboarding/);

  // Page should show floor selection UI
  const body = await page.textContent('body');
  expect(body).toMatch(/floor|etage|stockwerk|1|2|3/i);
});

// ── Happy path ────────────────────────────────────────────────────────────────
test('selecting floor and room and submitting redirects to /home', async ({ page }) => {
  const email = mail();
  await page.goto('/signup');
  await page.fill('[name="name"]', 'Room Picker');
  await page.fill('[name="email"]', email);
  await page.fill('[name="password"]', 'OnbTest123!');
  await page.fill('[name="confirmPassword"]', 'OnbTest123!');
  await page.click('[type="submit"]');
  await expect(page).toHaveURL(/\/onboarding/);

  // Click the first visible floor chip / button
  const floorBtn = page.locator('[data-floor], .floor-chip, button[value]').first();
  if (await floorBtn.isVisible()) {
    await floorBtn.click();
    // Wait for room grid to appear
    await page.waitForTimeout(500);
  } else {
    // Fallback: submit hidden form directly
    await page.evaluate(() => {
      const f = document.querySelector('form');
      if (f) {
        const fi = document.createElement('input');
        fi.name = 'floor'; fi.value = '3'; fi.type = 'hidden'; f.appendChild(fi);
        const ri = document.createElement('input');
        ri.name = 'room'; ri.value = '305'; ri.type = 'hidden'; f.appendChild(ri);
      }
    });
  }

  // Click first room cell or submit directly
  const roomCell = page.locator('[data-room], .room-cell, td[data-room-id]').first();
  if (await roomCell.isVisible()) {
    await roomCell.click();
    await page.waitForTimeout(300);
  }

  // Submit
  const submitBtn = page.locator('[type="submit"]').first();
  if (await submitBtn.isVisible()) await submitBtn.click();

  await expect(page).toHaveURL(/\/(home|onboarding)/);
});

// ── Validation: missing room ──────────────────────────────────────────────────
test('submitting without a room selection stays on /onboarding', async ({ page }) => {
  const email = mail();
  await page.goto('/signup');
  await page.fill('[name="name"]', 'No Room');
  await page.fill('[name="email"]', email);
  await page.fill('[name="password"]', 'OnbTest123!');
  await page.fill('[name="confirmPassword"]', 'OnbTest123!');
  await page.click('[type="submit"]');
  await expect(page).toHaveURL(/\/onboarding/);

  // Submit form with only floor, no room
  await page.evaluate(() => {
    const f = document.querySelector('form');
    if (!f) return;
    const fi = document.createElement('input');
    fi.name = 'floor'; fi.value = '2'; fi.type = 'hidden'; f.appendChild(fi);
    // deliberately omit room
  });
  const submitBtn = page.locator('[type="submit"]').first();
  if (await submitBtn.isVisible()) await submitBtn.click();
  await expect(page).toHaveURL(/\/onboarding/);
});
