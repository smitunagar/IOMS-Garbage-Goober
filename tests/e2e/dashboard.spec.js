'use strict';
/**
 * tests/e2e/dashboard.spec.js
 *
 * Covers: /home page content, sidebar navigation links, unauthenticated redirect.
 */
const { test, expect } = require('@playwright/test');
const { loginAs } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAs(page, 'student');
});

test('dashboard loads at /home', async ({ page }) => {
  await expect(page).toHaveURL(/\/home/);
});

test('page title contains IOMS or Garbage or Building name', async ({ page }) => {
  const title = await page.title();
  expect(title).toMatch(/IOMS|Garbage|GWG|Home|Dashboard/i);
});

test('sidebar is visible', async ({ page }) => {
  const sidebar = page.locator('nav, aside, [class*="sidebar"], [id*="sidebar"]').first();
  await expect(sidebar).toBeVisible();
});

test('sidebar contains Disposal link', async ({ page }) => {
  const link = page.locator('a[href*="disposal"]').first();
  await expect(link).toBeVisible();
});

test('sidebar contains Alerts link', async ({ page }) => {
  const link = page.locator('a[href*="alert"]').first();
  await expect(link).toBeVisible();
});

test('current duty room information is displayed', async ({ page }) => {
  // The home page should mention duty, Pflicht, or a room number
  const body = await page.textContent('body');
  expect(body).toMatch(/duty|pflicht|room|zimmer|\d{3}/i);
});

test('unauthenticated request to /home redirects to /login', async ({ browser }) => {
  // Fresh context = no session cookie
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/home');
  await expect(page).toHaveURL(/\/login/);
  await ctx.close();
});

test('admin nav link visible for admin user', async ({ page }) => {
  await page.goto('/logout');
  await loginAs(page, 'admin');
  const adminLink = page.locator('a[href*="admin"]').first();
  await expect(adminLink).toBeVisible();
});

test('admin nav link NOT visible for regular student', async ({ page }) => {
  // student is already logged in from beforeEach
  const adminLinks = page.locator('a[href="/admin"]');
  // Either zero links or all are hidden
  const count = await adminLinks.count();
  if (count > 0) {
    for (let i = 0; i < count; i++) {
      await expect(adminLinks.nth(i)).toBeHidden();
    }
  } else {
    expect(count).toBe(0);
  }
});
