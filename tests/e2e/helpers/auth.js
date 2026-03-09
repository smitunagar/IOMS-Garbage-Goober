'use strict';
/**
 * tests/e2e/helpers/auth.js
 *
 * Shared Playwright helpers for logging in as a known test account.
 *
 * All credentials match what tests/helpers/seed.js creates in the DB.
 * Run `npm run test:seed` before the E2E suite if the accounts don't exist yet.
 */

/** @type {Record<string, {email:string, password:string, name:string}>} */
const TEST_USERS = {
  admin: {
    email:    'admin@ioms.de',
    password: 'admin123',
    name:     'Admin',
  },
  student: {
    email:    'e2e_student@test',
    password: 'Student123!',
    name:     'E2E Student',
  },
  floorSpeaker: {
    email:    'e2e_fs@test',
    password: 'FloorSp123!',
    name:     'E2E Floor Speaker',
  },
  newUser: {
    email:    'e2e_new@test',
    password: 'NewUser123!',
    name:     'E2E New User',
  },
};

/**
 * Navigate to /login and authenticate as the given user key.
 * Waits until the browser leaves /login (redirect to /home or /onboarding).
 *
 * @param {import('@playwright/test').Page} page
 * @param {'admin'|'student'|'floorSpeaker'|'newUser'} userKey
 */
async function loginAs(page, userKey) {
  const u = TEST_USERS[userKey];
  if (!u) throw new Error(`Unknown test user key: ${userKey}`);

  await page.goto('/login');
  await page.waitForSelector('[name="email"]');
  await page.fill('[name="email"]', u.email);
  await page.fill('[name="password"]', u.password);
  await page.click('[type="submit"]');
  // Wait for redirect away from /login
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15_000 });
}

/**
 * Log out from any page by navigating to /logout.
 * @param {import('@playwright/test').Page} page
 */
async function logout(page) {
  await page.goto('/logout');
  await page.waitForURL(/\/login/);
}

module.exports = { loginAs, logout, TEST_USERS };
