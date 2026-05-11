import { describe, it, expect } from 'vitest';
import { isHoliday, getHolidaysForYear, isWorkday, getHolidayName } from '../services/holidays.js';

describe('isHoliday', () => {
  it('returns true for a known holiday', () => {
    expect(isHoliday('2025-01-01')).toBe(true);
    expect(isHoliday('2025-10-01')).toBe(true);
  });

  it('returns false for a regular day', () => {
    expect(isHoliday('2025-03-15')).toBe(false);
  });

  it('returns false for unknown year', () => {
    expect(isHoliday('2030-01-01')).toBe(false);
  });

  it('handles date format correctly', () => {
    // 2026 Spring Festival: Feb 16-22
    expect(isHoliday('2026-02-16')).toBe(true);
    expect(isHoliday('2026-02-15')).toBe(false);
    expect(isHoliday('2026-02-23')).toBe(false);
  });
});

describe('getHolidaysForYear', () => {
  it('returns holidays for known year', () => {
    const h = getHolidaysForYear(2025);
    expect(h.length).toBeGreaterThan(0);
    expect(h).toContain('01-01');
  });

  it('returns empty array for unknown year', () => {
    expect(getHolidaysForYear(2030)).toEqual([]);
  });
});

describe('isWorkday', () => {
  it('returns true for a known makeup workday', () => {
    expect(isWorkday('2025-01-26')).toBe(true);
    expect(isWorkday('2025-02-08')).toBe(true);
  });

  it('returns false for a regular weekend', () => {
    expect(isWorkday('2025-03-15')).toBe(false);
  });

  it('returns false for unknown year', () => {
    expect(isWorkday('2030-01-26')).toBe(false);
  });

  it('handle boundary: holiday is not a workday', () => {
    expect(isWorkday('2025-01-01')).toBe(false); // holiday
    expect(isHoliday('2025-01-01')).toBe(true);
  });
});

describe('getHolidayName', () => {
  it('returns name for known holiday', () => {
    expect(getHolidayName('2025-01-01')).toBe('元旦');
    expect(getHolidayName('2025-10-01')).toBe('国庆');
    expect(getHolidayName('2025-04-05')).toBe('清明');
    expect(getHolidayName('2025-05-01')).toBe('劳动节');
    expect(getHolidayName('2025-05-31')).toBe('端午');
    expect(getHolidayName('2025-01-28')).toBe('春节');
  });

  it('returns default for unknown date', () => {
    expect(getHolidayName('2025-03-15')).toBe('节假日');
  });

  it('handles different years same mm-dd', () => {
    expect(getHolidayName('2025-01-01')).toBe('元旦');
    expect(getHolidayName('2026-01-01')).toBe('元旦');
  });
});
