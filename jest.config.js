'use strict';

module.exports = {
  testEnvironment: 'node',
  testTimeout: 30000,
  verbose: true,
  collectCoverage: false,
  // Run unit and integration tests separately via npm scripts;
  // default `npm test` runs both.
  testMatch: [
    '<rootDir>/tests/unit/**/*.test.js',
    '<rootDir>/tests/integration/**/*.test.js',
  ],
  // Ignore Playwright specs and k6 scripts
  testPathIgnorePatterns: [
    '<rootDir>/tests/e2e/',
    '<rootDir>/tests/load/',
    '<rootDir>/node_modules/',
  ],
  // Show one-line summary per test
  reporters: ['default'],
};
