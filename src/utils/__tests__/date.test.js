import { describe, it, expect } from 'vitest';
import { parseDateStr, fmt, todayStr, getMonday, addDays, getMonthRange, getYearRange, toHours, toHoursAbs, intParam } from '../date';

describe('parseDateStr', () => {
  it('parses YYYY-MM-DD to Date at midnight', () => {
    const d = parseDateStr('2026-05-25');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4); // 0-indexed
    expect(d.getDate()).toBe(25);
    expect(d.getHours()).toBe(0);
  });
});

describe('fmt', () => {
  it('formats Date to YYYY-MM-DD', () => {
    expect(fmt(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
  it('zero-pads month and day', () => {
    expect(fmt(new Date(2026, 10, 1))).toBe('2026-11-01');
  });
});

describe('todayStr', () => {
  it('returns today in YYYY-MM-DD format', () => {
    const result = todayStr();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('getMonday', () => {
  it('returns Monday of same week for a Wednesday', () => {
    // 2026-05-25 is a Monday
    expect(getMonday('2026-05-25')).toBe('2026-05-25');
  });
  it('returns previous Monday for a Sunday', () => {
    // 2026-05-31 is a Sunday
    expect(getMonday('2026-05-31')).toBe('2026-05-25');
  });
  it('returns same Monday for a Saturday', () => {
    // 2026-05-30 is a Saturday
    expect(getMonday('2026-05-30')).toBe('2026-05-25');
  });
});

describe('addDays', () => {
  it('adds positive days', () => {
    expect(addDays('2026-05-25', 7)).toBe('2026-06-01');
  });
  it('adds negative days', () => {
    expect(addDays('2026-05-25', -1)).toBe('2026-05-24');
  });
  it('handles month boundary', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('handles year boundary', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('getMonthRange', () => {
  it('returns range for January (month=0)', () => {
    expect(getMonthRange(2026, 0)).toEqual({ start: '2026-01-01', end: '2026-01-31' });
  });
  it('returns range for February non-leap', () => {
    expect(getMonthRange(2025, 1)).toEqual({ start: '2025-02-01', end: '2025-02-28' });
  });
  it('returns range for February leap year', () => {
    expect(getMonthRange(2028, 1)).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });
  it('returns range for December', () => {
    expect(getMonthRange(2026, 11)).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  });
});

describe('getYearRange', () => {
  it('returns full year range', () => {
    expect(getYearRange(2026)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });
});

describe('toHours', () => {
  it('converts minutes to hours', () => {
    expect(toHours(120)).toBe(2);
  });
  it('handles fractional hours', () => {
    expect(toHours(90)).toBe(1.5);
  });
});

describe('toHoursAbs', () => {
  it('returns absolute value', () => {
    expect(toHoursAbs(-120)).toBe(2);
  });
  it('returns 0 for null', () => {
    expect(toHoursAbs(null)).toBe(0);
  });
  it('returns 0 for undefined', () => {
    expect(toHoursAbs(undefined)).toBe(0);
  });
  it('returns 0 for zero', () => {
    expect(toHoursAbs(0)).toBe(0);
  });
});

describe('intParam', () => {
  // ?year=abc used to become NaN and render "NaN年" with an unrecoverable view.
  it('falls back on non-numeric, empty and missing values', () => {
    expect(intParam('abc', 2026)).toBe(2026);
    expect(intParam('', 2026)).toBe(2026);
    expect(intParam(null, 2026)).toBe(2026);
    expect(intParam('  ', 2026)).toBe(2026);
  });

  it('falls back on non-integers and out-of-range values', () => {
    expect(intParam('2026.5', 2026)).toBe(2026);
    expect(intParam('13', 5, { min: 0, max: 11 })).toBe(5);
    expect(intParam('-1', 5, { min: 0, max: 11 })).toBe(5);
  });

  it('accepts valid values, including 0', () => {
    expect(intParam('2027', 2026, { min: 1000, max: 9999 })).toBe(2027);
    expect(intParam('0', 5, { min: 0, max: 11 })).toBe(0);
  });
});
