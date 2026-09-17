import { describe, it, expect } from 'vitest';
import { parseDateStr, fmt, todayStr, getMonday, addDays, getMonthRange, getYearRange, toHours, toHoursAbs, intParam, isUsableDate } from '../date';

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

// 原生日期输入框的年份段不会在第 4 位后自动跳段，min/max 也只是把越界值标成
// invalid，值照样传出来。这类值比大小会静默算错，交给 new Date() 是 Invalid Date，
// 当循环边界还会一天天跑上几十万次。
describe('isUsableDate', () => {
  it('接受定长且在上下限之内的日期', () => {
    expect(isUsableDate('2026-09-17')).toBe(true);
    expect(isUsableDate('1900-01-01')).toBe(true);
    expect(isUsableDate('2999-12-31')).toBe(true);
  });

  it('拒绝位数不对的年份', () => {
    expect(isUsableDate('20261-08-26')).toBe(false);
    expect(isUsableDate('261-08-26')).toBe(false);
  });

  it('拒绝上下限之外的日期', () => {
    expect(isUsableDate('0002-01-01')).toBe(false);
    expect(isUsableDate('1899-12-31')).toBe(false);
    expect(isUsableDate('3000-01-01')).toBe(false);
  });

  it('拒绝位数正确但日历上不存在的日期', () => {
    expect(isUsableDate('2026-13-01')).toBe(false);
    expect(isUsableDate('2026-02-31')).toBe(false);
    expect(isUsableDate('2026-02-29')).toBe(false);
    expect(isUsableDate('2026-00-10')).toBe(false);
    // 闰年 2 月 29 日是真日期，不能连带拒掉
    expect(isUsableDate('2024-02-29')).toBe(true);
  });

  it('拒绝空值和非日期', () => {
    expect(isUsableDate('')).toBe(false);
    expect(isUsableDate(undefined)).toBe(false);
    expect(isUsableDate('2026-09')).toBe(false);
  });
});
