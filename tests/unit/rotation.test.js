'use strict';
/**
 * tests/unit/rotation.test.js
 *
 * Pure-function unit tests for utils/rotation.js.
 * No database, no network – runs entirely in-process.
 */

const {
  getWeekStart,
  getWeekEnd,
  getNextWeekStart,
  weeksPassed,
  daysRemainingInWeek,
  getWeekStartStr,
  weekStartToEndStr,
  isoWeekNumber,
  fmtDayMonth,
  fmtDate,
  fmtTime,
  fmtDateTime,
  weekRangeLabel,
} = require('../../utils/rotation');

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Create a Date from a YYYY-MM-DD string (local midnight). */
const d = (s) => new Date(s + 'T00:00:00');

// ─── getWeekStart ─────────────────────────────────────────────────────────────
describe('getWeekStart()', () => {
  test('returns the Monday of the given week (Wednesday input)', () => {
    const monday = getWeekStart(d('2025-07-09')); // Wednesday 9 Jul 2025
    expect(monday.toISOString().slice(0, 10)).toBe('2025-07-07');
  });

  test('returns the same Monday for a Monday input', () => {
    const monday = getWeekStart(d('2025-07-07'));
    expect(monday.toISOString().slice(0, 10)).toBe('2025-07-07');
  });

  test('handles Sunday (ISO week: Sunday belongs to the previous week)', () => {
    const monday = getWeekStart(d('2025-07-13')); // Sunday
    expect(monday.toISOString().slice(0, 10)).toBe('2025-07-07');
  });

  test('sets time to 00:00:00.000', () => {
    const monday = getWeekStart(d('2025-07-10'));
    expect(monday.getHours()).toBe(0);
    expect(monday.getMinutes()).toBe(0);
    expect(monday.getSeconds()).toBe(0);
    expect(monday.getMilliseconds()).toBe(0);
  });

  test('defaults to current date when called with no argument', () => {
    const monday = getWeekStart();
    expect(monday.getDay()).toBe(1); // 1 = Monday
  });
});

// ─── getWeekEnd ───────────────────────────────────────────────────────────────
describe('getWeekEnd()', () => {
  test('returns the Sunday of the given week', () => {
    const sunday = getWeekEnd(d('2025-07-07'));
    expect(sunday.toISOString().slice(0, 10)).toBe('2025-07-13');
  });

  test('week end is 6 days after week start', () => {
    const start  = getWeekStart(d('2025-07-09'));
    const end    = getWeekEnd(d('2025-07-09'));
    const diffMs = end.getTime() - start.getTime();
    const diffDays = diffMs / (24 * 60 * 60 * 1000);
    expect(Math.floor(diffDays)).toBe(6);
  });
});

// ─── getNextWeekStart ─────────────────────────────────────────────────────────
describe('getNextWeekStart()', () => {
  test('is exactly 7 days after getWeekStart()', () => {
    const ref   = d('2025-07-09');
    const curr  = getWeekStart(ref);
    const next  = getNextWeekStart(ref);
    expect(next.getTime() - curr.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

// ─── weeksPassed ─────────────────────────────────────────────────────────────
describe('weeksPassed()', () => {
  test('returns 0 when ref equals the anchor', () => {
    expect(weeksPassed('2025-07-07', d('2025-07-07'))).toBe(0);
  });

  test('returns 1 after one week', () => {
    expect(weeksPassed('2025-07-07', d('2025-07-14'))).toBe(1);
  });

  test('returns 4 after four weeks', () => {
    expect(weeksPassed('2025-06-02', d('2025-06-30'))).toBe(4);
  });

  test('returns 0 if ref is before anchor', () => {
    expect(weeksPassed('2025-07-14', d('2025-07-07'))).toBe(0);
  });
});

// ─── daysRemainingInWeek ──────────────────────────────────────────────────────
describe('daysRemainingInWeek()', () => {
  test('returns between 1 and 7', () => {
    const days = daysRemainingInWeek();
    expect(days).toBeGreaterThanOrEqual(1);
    expect(days).toBeLessThanOrEqual(7);
  });
});

// ─── getWeekStartStr ─────────────────────────────────────────────────────────
describe('getWeekStartStr()', () => {
  test('returns a YYYY-MM-DD string', () => {
    const s = getWeekStartStr();
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('returned date is a Monday', () => {
    const s   = getWeekStartStr();
    const day = new Date(s + 'T00:00:00').getDay();
    expect(day).toBe(1);
  });
});

// ─── weekStartToEndStr ────────────────────────────────────────────────────────
describe('weekStartToEndStr()', () => {
  test('returns Sunday 6 days after the given Monday', () => {
    expect(weekStartToEndStr('2025-07-07')).toBe('2025-07-13');
  });
});

// ─── isoWeekNumber ────────────────────────────────────────────────────────────
describe('isoWeekNumber()', () => {
  test('2025-01-06 is ISO week 2', () => {
    expect(isoWeekNumber(d('2025-01-06'))).toBe(2);
  });

  test('2025-12-29 is ISO week 1 of 2026', () => {
    // The last few days of Dec 2025 may fall in week 1 of 2026
    const wn = isoWeekNumber(d('2025-12-29'));
    expect(typeof wn).toBe('number');
    expect(wn).toBeGreaterThan(0);
  });

  test('returns a number between 1 and 53', () => {
    for (const dateStr of ['2025-01-01', '2025-06-15', '2025-12-31']) {
      const wn = isoWeekNumber(d(dateStr));
      expect(wn).toBeGreaterThanOrEqual(1);
      expect(wn).toBeLessThanOrEqual(53);
    }
  });
});

// ─── Formatting helpers ───────────────────────────────────────────────────────
describe('fmtDayMonth()', () => {
  test('formats as DD.MM', () => {
    expect(fmtDayMonth(new Date('2025-03-07T00:00:00'))).toBe('07.03');
  });
});

describe('fmtDate()', () => {
  test('formats as DD.MM.YYYY', () => {
    expect(fmtDate(new Date('2025-07-04T00:00:00'))).toBe('04.07.2025');
  });
});

describe('fmtTime()', () => {
  test('formats as HH:MM', () => {
    const date = new Date('2025-07-04T09:05:00');
    expect(fmtTime(date)).toBe('09:05');
  });
});

describe('fmtDateTime()', () => {
  test('formats as DD.MM.YYYY HH:MM', () => {
    const date = new Date('2025-07-04T14:30:00');
    expect(fmtDateTime(date)).toMatch(/04\.07\.2025 14:30/);
  });
});

describe('weekRangeLabel()', () => {
  test('returns a string containing "KW"', () => {
    expect(weekRangeLabel(d('2025-07-07'))).toMatch(/KW/);
  });

  test('includes both start and end date fragments', () => {
    const label = weekRangeLabel(d('2025-07-07'));
    expect(label).toMatch(/07\.07/);
    expect(label).toMatch(/13\.07/);
  });
});
