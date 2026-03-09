'use strict';
/**
 * tests/e2e/auth.spec.js
 *
 * Covers: signup, login (happy + sad paths), logout, floor-speaker signup.
 */
const { test, expect } = require('@playwright/test');
const { loginAs, logout, TEST_USERS } = require('./helpers/auth');

// Unique email per test run to avoid duplicate-email errors
const uid  = () => `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const mail = () => `signup_${uid()}@test.ioms`;

// ── GET /login ────────────────────────────────────────────────────────────────
test.describe('Login page', () => {
  test('renders login form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('[name="email"]')).toBeVisible();
    await expect(page.locator('[name="password"]')).toBeVisible();
    await expect(page.locator('[type="submit"]')).toBeVisible();
  });

  test('redirects authenticated user straight to /home', async ({ page }) => {
    await loginAs(page, 'student');
    await page.goto('/login');
    await expect(page).toHaveURL(/\/home/);
  });
});

// ── POST /login ───────────────────────────────────────────────────────────────
test.describe('Login flow', () => {
  test('valid credentials → redirect to /home', async ({ page }) => {
    await loginAs(page, 'student');
    await expect(page).toHaveURL(/\/home/);
  });

  test('wrong password → stays on /login with error', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[name="email"]', TEST_USERS.student.email);
    await page.fill('[name="password"]', 'wrongpassword!!');
    await page.click('[type="submit"]');
    await expect(page).toHaveURL(/\/login/);
    const text = await page.textContent('body');
    expect(text).toMatch(/invalid|incorrect|wrong|ungültig|falsch/i);
  });

  test('unknown email → stays on /login with error', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[name="email"]', 'nobody_ever@no.where');
    await page.fill('[name="password"]', 'Password123!');
    await page.click('[type="submit"]');
    await expect(page).toHaveURL(/\/login/);
  });

  test('missing email/password → stays on /login', async ({ page }) => {
    await page.goto('/login');
    await page.click('[type="submit"]');
    await expect(page).toHaveURL(/\/login/);
  });
});

// ── POST /signup ──────────────────────────────────────────────────────────────
test.describe('Signup flow', () => {
  test('valid new account → redirects to /onboarding', async ({ page }) => {
    await page.goto('/signup');
    await page.fill('[name="name"]', 'New Student');
    await page.fill('[name="email"]', mail());
    await page.fill('[name="password"]', 'Test1234!');
    await page.fill('[name="confirmPassword"]', 'Test1234!');
    await page.click('[type="submit"]');
    await expect(page).toHaveURL(/\/onboarding/);
  });

  test('password shorter than 8 chars → stays on /signup', async ({ page }) => {
    await page.goto('/signup');
    await page.fill('[name="name"]', 'Short Pass');
    await page.fill('[name="email"]', mail());
    await page.fill('[name="password"]', 'abc');
    await page.fill('[name="confirmPassword"]', 'abc');
    await page.click('[type="submit"]');
    await expect(page).toHaveURL(/\/signup/);
  });

  test('passwords do not match → stays on /signup', async ({ page }) => {
    await page.goto('/signup');
    await page.fill('[name="name"]', 'Mismatch User');
    await page.fill('[name="email"]', mail());
    await page.fill('[name="password"]', 'Password123!');
    await page.fill('[name="confirmPassword"]', 'DifferentPass!');
    await page.click('[type="submit"]');
    await expect(page).toHaveURL(/\/signup/);
  });

  test('duplicate email → stays on /signup with error', async ({ page }) => {
    await page.goto('/signup');
    await page.fill('[name="name"]', 'Duplicate');
    await page.fill('[name="email"]', TEST_USERS.student.email);
    await page.fill('[name="password"]', 'Password123!');
    await page.fill('[name="confirmPassword"]', 'Password123!');
    await page.click('[type="submit"]');
    await expect(page).toHaveURL(/\/signup/);
    const text = await page.textContent('body');
    expect(text).toMatch(/already|exists|vergeben|existiert/i);
  });

  test('floor-speaker signup with valid code → redirects to /onboarding', async ({ page }) => {
    await page.goto('/signup');
    await page.fill('[name="name"]', 'Floor Speaker Test');
    await page.fill('[name="email"]', mail());
    await page.fill('[name="password"]', 'FsPass123!');
    await page.fill('[name="confirmPassword"]', 'FsPass123!');

    // Toggle the floor-speaker checkbox if present
    const fsCheckbox = page.locator('[name="is_floor_speaker"]');
    if (await fsCheckbox.isVisible()) {
      await fsCheckbox.check();
      await page.fill('[name="fs_code"]', 'WebMeister360_1_FS_425');
      // Select a floor (pick floor 4)
      const floorSelect = page.locator('[name="fs_floor"]');
      if (await floorSelect.isVisible()) {
        await floorSelect.selectOption('4');
      }
    }
    await page.click('[type="submit"]');
    await expect(page).toHaveURL(/\/(onboarding|home)/);
  });

  test('floor-speaker signup with wrong code → stays on /signup', async ({ page }) => {
    await page.goto('/signup');
    await page.fill('[name="name"]', 'Fake FS');
    await page.fill('[name="email"]', mail());
    await page.fill('[name="password"]', 'FsPass123!');
    await page.fill('[name="confirmPassword"]', 'FsPass123!');

    const fsCheckbox = page.locator('[name="is_floor_speaker"]');
    if (await fsCheckbox.isVisible()) {
      await fsCheckbox.check();
      await page.fill('[name="fs_code"]', 'WRONG_CODE');
      const floorSelect = page.locator('[name="fs_floor"]');
      if (await floorSelect.isVisible()) await floorSelect.selectOption('1');
    }
    await page.click('[type="submit"]');
    await expect(page).toHaveURL(/\/signup/);
  });
});

// ── GET /logout ───────────────────────────────────────────────────────────────
test.describe('Logout', () => {
  test('destroys session and redirects to /login', async ({ page }) => {
    await loginAs(page, 'student');
    await logout(page);
    await expect(page).toHaveURL(/\/login/);
  });

  test('after logout, /home redirects to /login', async ({ page }) => {
    await loginAs(page, 'student');
    await logout(page);
    await page.goto('/home');
    await expect(page).toHaveURL(/\/login/);
  });
});
